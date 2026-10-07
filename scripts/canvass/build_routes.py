"""Collect addresses for the top-scoring neighborhoods and build canvassing
routes from public Escambia County parcel records.

Inputs:
  canvass-out/neighborhood_scores.json   ranked subdivisions
  canvass-out/cache/unmatched_centroids.json

Outputs (git-ignored, local-only):
  canvass-out/route_object.json     canonical ordered routes (sequence/metrics)
  canvass-out/master_addresses.csv  addresses in canonical route order
  canvass-out/routes.csv            route summary
  canvass-out/routes.geojson        line + numbered points (canonical order)
  canvass-out/routes_summary.json

Rules:
  - Real public addresses only; nothing fabricated.
  - Single-family parcels (DOR 0100) with a situs address and coordinates.
  - Owner names and mailing addresses are never written to outputs; they are
    used only to flag owner-occupied homes.
  - Ordering/optimization lives in scripts/canvass/route_engine.py (Method B);
    every downstream output must derive from the canonical route object.

Usage: python scripts/canvass/build_routes.py [--neighborhoods 20] [--homes-per-route 75]
"""

import argparse
import csv
import json
import os
import time
import urllib.parse
import urllib.request

import route_engine

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
                    "Coordinate_Precision": "parcel_polygon_vertex_mean",
                    "Property_Type": "single_family",
                    "Owner_Occupied": "yes" if owner_occupied else "no",
                    "Homestead": "yes" if homestead else "no",
                    "Route_ID": "",
                    "Sequence": "",
                }
            )
        print(f"    {len(addresses)} addresses collected so far", flush=True)

    # Canonical routing: cluster -> orient -> sequence -> improve -> complete.
    routes = []
    route_counter = 0
    for neighborhood in selected:
        name = neighborhood["neighborhood"].title()
        group = [address for address in addresses if address["Neighborhood"] == name]
        if not group:
            continue
        priority = "A" if neighborhood["score"] >= 70 else "B" if neighborhood["score"] >= 60 else "C"
        built = route_engine.build_neighborhood_routes(
            group,
            name,
            origin=origin,
            target_size=args.homes_per_route,
            priority=priority,
        )
        by_id = {address["Address_ID"]: address for address in group}
        for route in built:
            route_counter += 1
            route_id = f"{priority}-{route_counter:02d}"
            route["route_id"] = route_id
            route["neighborhood_score"] = neighborhood["score"]
            for stop in route["stops"]:
                address = by_id[stop["address_id"]]
                address["Route_ID"] = route_id
                address["Sequence"] = stop["seq"]
                stop["address"] = address["Full_Address"]
            route["start_address"] = by_id[route["stops"][0]["address_id"]]["Full_Address"]
            route["end_address"] = by_id[route["stops"][-1]["address_id"]]["Full_Address"]
            routes.append(route)

    os.makedirs(OUT, exist_ok=True)

    # Canonical route object (local-only; contains addresses/coordinates).
    with open(os.path.join(OUT, "route_object.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "method_version": route_engine.METHOD_VERSION,
                "model": route_engine.route_metrics([])["model"],
                "routes": routes,
            },
            handle,
        )

    # Master address list in canonical route order (one row per stop).
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
        "Coordinate_Precision",
        "Property_Type",
        "Owner_Occupied",
        "Homestead",
        "Route_ID",
        "Sequence",
    ]
    address_by_id = {address["Address_ID"]: address for address in addresses}
    with open(os.path.join(OUT, "master_addresses.csv"), "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=address_fields)
        writer.writeheader()
        for route in routes:
            for stop in route["stops"]:
                writer.writerow({field: address_by_id[stop["address_id"]][field] for field in address_fields})

    # Route summary.
    route_rows = []
    for route in routes:
        metrics = route["metrics"]
        streets = []
        for stop in route["stops"]:
            if stop["street"] not in streets:
                streets.append(stop["street"])
        route_rows.append(
            {
                "Route_ID": route["route_id"],
                "Priority": route["priority"],
                "Neighborhood": route["neighborhood"],
                "Neighborhood_Score": route["neighborhood_score"],
                "Estimated_Home_Count": metrics["stop_count"],
                "Street_Sequence": " > ".join(streets),
                "Estimated_Walking_Distance_Miles": metrics["walking_mi_est"],
                "Estimated_Driving_Distance_Miles": metrics["driving_mi_est"],
                "Start_Point": f"{route['stops'][0]['lat']},{route['stops'][0]['lon']}",
                "End_Point": f"{route['stops'][-1]['lat']},{route['stops'][-1]['lon']}",
                "Start_Address": route["start_address"],
                "End_Address": route["end_address"],
                "Method_Version": route["method_version"],
            }
        )
    with open(os.path.join(OUT, "routes.csv"), "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(route_rows[0].keys()))
        writer.writeheader()
        writer.writerows(route_rows)

    # GeoJSON line + numbered points from the same ordered stops.
    geojson = route_engine.routes_geojson(routes)
    with open(os.path.join(OUT, "routes.geojson"), "w", encoding="utf-8") as handle:
        json.dump(geojson, handle)

    summary = {
        "method_version": route_engine.METHOD_VERSION,
        "neighborhoods": len(selected),
        "addresses": len(addresses),
        "owner_occupied": sum(1 for address in addresses if address["Owner_Occupied"] == "yes"),
        "routes": len(routes),
        "priority_a_routes": sum(1 for route in routes if route["priority"] == "A"),
        "priority_b_routes": sum(1 for route in routes if route["priority"] == "B"),
        "priority_c_routes": sum(1 for route in routes if route["priority"] == "C"),
        "estimated_hours": round(sum(route["metrics"]["stop_count"] / 30 for route in routes), 1),
        "straight_mi": round(sum(route["metrics"]["straight_mi"] for route in routes), 1),
        "walking_mi_est": round(sum(route["metrics"]["walking_mi_est"] for route in routes), 1),
        "long_edges_over_0_15mi": sum(route["metrics"]["long_edges_over_0_15mi"] for route in routes),
        "street_reentries": sum(route["metrics"]["street_reentries"] for route in routes),
    }
    with open(os.path.join(OUT, "routes_summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)

    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
