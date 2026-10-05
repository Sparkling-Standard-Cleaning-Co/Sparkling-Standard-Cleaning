"""Collect addresses for the top-scoring neighborhoods and build canvassing
routes from public Escambia County parcel records.

Inputs:
  canvass-out/neighborhood_scores.json   ranked subdivisions
  canvass-out/cache/unmatched_centroids.json

Outputs (git-ignored):
  canvass-out/master_addresses.csv
  canvass-out/routes.csv
  canvass-out/routes.geojson
  canvass-out/routes_summary.json

Rules:
  - Real public addresses only; nothing fabricated.
  - Single-family parcels (DOR 0100) with a situs address and coordinates.
  - Owner names and mailing addresses are never written to outputs; they are
    used only to flag owner-occupied homes.
  - Routes target 50-100 homes, ordered as a greedy nearest-neighbour walk.

Usage: python scripts/canvass/build_routes.py [--neighborhoods 20] [--homes-per-route 75]
"""

import argparse
import csv
import json
import math
import os
import time
import urllib.parse
import urllib.request

SERVICE = "https://gismaps.myescambia.com/arcgis/rest/services/Individual_Layers/parcels/MapServer/0/query"
CACHE = os.path.join("canvass-out", "cache")
OUT = "canvass-out"
PAGE_SIZE = 1000
FIELDS = "REFNUM,SITEADDR,CITY,ZIP,DORCD,EXEMPTION,MAILADDRESS1"


def fetch(params, attempt=1):
    url = SERVICE + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "sparkling-standard-canvass/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001
        if attempt >= 5:
            raise
        print(f"    retry {attempt}: {error}", flush=True)
        time.sleep(2 * attempt)
        return fetch(params, attempt + 1)


def normalize_address(value):
    if not value:
        return ""
    text = value.upper()
    cleaned = "".join(character if character.isalnum() or character == " " else " " for character in text)
    return " ".join(cleaned.split())


def polygon_point(geometry):
    if not geometry or "type" not in geometry:
        return None
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    points = []
    for polygon in polygons:
        if polygon:
            points.extend(polygon[0])
    if not points:
        return None
    return sum(point[0] for point in points) / len(points), sum(point[1] for point in points) / len(points)


def haversine_miles(lat1, lon1, lat2, lon2):
    radius = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def read_origin():
    if not os.path.exists(".env"):
        return None
    for line in open(".env", encoding="utf-8"):
        if line.startswith("TRAVEL_ORIGIN"):
            _, _, value = line.partition("=")
            parts = value.strip().strip('"').split(",")
            if len(parts) == 2:
                return float(parts[0]), float(parts[1])
    return None


def collect_addresses(key):
    where = "DORCD='0100' AND SITEADDR IS NOT NULL AND SUBDIVISION LIKE '" + key.replace("'", "''") + "%'"
    features = []
    offset = 0
    while True:
        page = fetch(
            {
                "where": where,
                "outFields": FIELDS,
                "returnGeometry": "true",
                "outSR": "4326",
                "geometryPrecision": "6",
                "resultOffset": str(offset),
                "resultRecordCount": str(PAGE_SIZE),
                "orderByFields": "OBJECTID ASC",
                "f": "geojson",
            }
        )
        batch = page.get("features", [])
        if not batch:
            break
        features.extend(batch)
        offset += len(batch)
        if offset % 5000 == 0:
            print(f"    {offset} parcels", flush=True)
        time.sleep(0.15)
    return features


def route_order(points):
    """Greedy nearest-neighbour ordering starting from the south-west point."""
    remaining = list(range(len(points)))
    current = min(remaining, key=lambda index: (points[index]["Latitude"], points[index]["Longitude"]))
    order = [current]
    remaining.remove(current)
    while remaining:
        last = points[current]
        current = min(
            remaining,
            key=lambda index: haversine_miles(
                last["Latitude"], last["Longitude"], points[index]["Latitude"], points[index]["Longitude"]
            ),
        )
        order.append(current)
        remaining.remove(current)
    return order


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--neighborhoods", type=int, default=20)
    parser.add_argument("--homes-per-route", type=int, default=75)
    args = parser.parse_args()

    scores = json.load(open(os.path.join(OUT, "neighborhood_scores.json"), encoding="utf-8"))
    selected = scores[: args.neighborhoods]
    origin = read_origin()

    addresses = []
    for neighborhood in selected:
        key = neighborhood["neighborhood"]
        cache_file = os.path.join(CACHE, "collected_" + key.replace(" ", "_").replace("/", "-")[:60] + ".json")
        if os.path.exists(cache_file):
            features = json.load(open(cache_file, encoding="utf-8"))
            print(f"  {key}: {len(features)} parcels (cached)", flush=True)
        else:
            print(f"  collecting {key} ...", flush=True)
            features = collect_addresses(key)
            with open(cache_file, "w", encoding="utf-8") as handle:
                json.dump(features, handle)
        seen = set()
        for feature in features:
            attributes = feature["properties"]
            reference = attributes.get("REFNUM")
            street = (attributes.get("SITEADDR") or "").strip()
            if not reference or not street or reference in seen:
                continue
            seen.add(reference)
            point = polygon_point(feature.get("geometry"))
            if point is None:
                continue
            tokens = street.split()
            house_number = tokens[0] if tokens and tokens[0].isdigit() else ""
            if not house_number:
                continue  # redacted or numberless situs records are not canvassable
            street_name = " ".join(tokens[1:]).strip() or street
            site = normalize_address(street)
            mail = normalize_address(attributes.get("MAILADDRESS1"))
            homestead = "HOMESTEAD" in (attributes.get("EXEMPTION") or "").upper()
            owner_occupied = homestead or (site and site == mail)
            addresses.append(
                {
                    "Address_ID": f"{key[:3].replace(' ', '')}-{len(addresses) + 1:05d}",
                    "Neighborhood": neighborhood["neighborhood"].title(),
                    "Neighborhood_Score": neighborhood["score"],
                    "Street_Name": street_name,
                    "House_Number": house_number,
                    "Full_Address": f"{street}, {attributes.get('CITY', '').title()}, FL {attributes.get('ZIP', '')}".strip(),
                    "ZIP_Code": (attributes.get("ZIP") or "")[:5],
                    "Latitude": round(point[1], 6),
                    "Longitude": round(point[0], 6),
                    "Property_Type": "single_family",
                    "Owner_Occupied": "yes" if owner_occupied else "no",
                    "Homestead": "yes" if homestead else "no",
                    "Route_ID": "",
                }
            )
        print(f"    {len(addresses)} addresses collected so far", flush=True)

    # Group by neighborhood and build routes.
    routes = []
    route_counter = 0
    for neighborhood in selected:
        name = neighborhood["neighborhood"].title()
        group = [address for address in addresses if address["Neighborhood"] == name]
        if not group:
            continue
        order = route_order(group)
        ordered = [group[index] for index in order]
        chunks = [ordered[index : index + args.homes_per_route] for index in range(0, len(ordered), args.homes_per_route)]
        priority = "A" if neighborhood["score"] >= 70 else "B" if neighborhood["score"] >= 60 else "C"
        for chunk in chunks:
            route_counter += 1
            route_id = f"{priority}-{route_counter:02d}"
            for address in chunk:
                address["Route_ID"] = route_id
            walking = 0.0
            for index in range(len(chunk) - 1):
                walking += haversine_miles(
                    chunk[index]["Latitude"], chunk[index]["Longitude"], chunk[index + 1]["Latitude"], chunk[index + 1]["Longitude"]
                )
            walking *= 1.25
            start = chunk[0]
            end = chunk[-1]
            driving = 0.0
            if origin:
                driving = haversine_miles(origin[0], origin[1], start["Latitude"], start["Longitude"]) * 1.3
            streets = []
            for address in chunk:
                if address["Street_Name"] not in streets:
                    streets.append(address["Street_Name"])
            routes.append(
                {
                    "Route_ID": route_id,
                    "Priority": priority,
                    "Neighborhood": name,
                    "Neighborhood_Score": neighborhood["score"],
                    "Estimated_Home_Count": len(chunk),
                    "Street_Sequence": " > ".join(streets),
                    "Estimated_Walking_Distance_Miles": round(walking, 2),
                    "Estimated_Driving_Distance_Miles": round(driving, 1),
                    "Start_Point": f"{start['Latitude']},{start['Longitude']}",
                    "End_Point": f"{end['Latitude']},{end['Longitude']}",
                    "Start_Address": start["Full_Address"],
                    "End_Address": end["Full_Address"],
                }
            )

    os.makedirs(OUT, exist_ok=True)
    address_fields = [
        "Address_ID",
        "Neighborhood",
        "Neighborhood_Score",
        "Street_Name",
        "House_Number",
        "Full_Address",
        "ZIP_Code",
        "Latitude",
        "Longitude",
        "Property_Type",
        "Owner_Occupied",
        "Homestead",
        "Route_ID",
    ]
    with open(os.path.join(OUT, "master_addresses.csv"), "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=address_fields)
        writer.writeheader()
        writer.writerows(addresses)

    route_fields = list(routes[0].keys()) if routes else []
    with open(os.path.join(OUT, "routes.csv"), "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=route_fields)
        writer.writeheader()
        writer.writerows(routes)

    # GeoJSON: route points coloured by priority.
    colors = {"A": "#c6a369", "B": "#e3cda4", "C": "#9aa0a6"}
    features = []
    for route in routes:
        points = [address for address in addresses if address["Route_ID"] == route["Route_ID"]]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "Route_ID": route["Route_ID"],
                    "Priority": route["Priority"],
                    "Neighborhood": route["Neighborhood"],
                    "Homes": route["Estimated_Home_Count"],
                    "Score": route["Neighborhood_Score"],
                    "color": colors[route["Priority"]],
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[point["Longitude"], point["Latitude"]] for point in points],
                },
            }
        )
        for point in points:
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "Route_ID": route["Route_ID"],
                        "Priority": route["Priority"],
                        "Address": point["Full_Address"],
                        "Owner_Occupied": point["Owner_Occupied"],
                        "color": colors[route["Priority"]],
                    },
                    "geometry": {"type": "Point", "coordinates": [point["Longitude"], point["Latitude"]]},
                }
            )
    with open(os.path.join(OUT, "routes.geojson"), "w", encoding="utf-8") as handle:
        json.dump({"type": "FeatureCollection", "features": features}, handle)

    summary = {
        "neighborhoods": len(selected),
        "addresses": len(addresses),
        "owner_occupied": sum(1 for address in addresses if address["Owner_Occupied"] == "yes"),
        "routes": len(routes),
        "priority_a_routes": sum(1 for route in routes if route["Priority"] == "A"),
        "priority_b_routes": sum(1 for route in routes if route["Priority"] == "B"),
        "priority_c_routes": sum(1 for route in routes if route["Priority"] == "C"),
        "estimated_hours": round(sum(route["Estimated_Home_Count"] / 30 for route in routes), 1),
    }
    with open(os.path.join(OUT, "routes_summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)

    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
