"""Fetch parcel geometries for parcel subdivision names that have no matching
published subdivision boundary, and cache their aggregate centroids.

Some large areas (e.g. "NEW CITY TRACT", "EAST KING TRACT") are recorded as
tracts rather than platted subdivisions, so they have no boundary polygon in
the county subdivision layer. This script locates their parcels and computes a
centroid so they can be scored like every other neighborhood.

Output: canvass-out/cache/unmatched_centroids.json (git-ignored)

Usage: python scripts/canvass/fetch_unmatched.py
"""

import json
import os
import time
import urllib.parse
import urllib.request

SERVICE = "https://gismaps.myescambia.com/arcgis/rest/services/Individual_Layers/parcels/MapServer/0/query"
CACHE = os.path.join("canvass-out", "cache")
OUT_FILE = os.path.join(CACHE, "unmatched_centroids.json")
PAGE_SIZE = 1000
MARKERS = [" PB ", " DB ", " PDB ", " PLAT ", " UNIT ", " PHASE ", " ADDN ", " ADDITION ", " SEC ", " SECTION ", " REPLAT ", " AMENDED "]


def normalize_name(value):
    if not value:
        return ""
    text = value.upper().replace("&", " AND ")
    cleaned = "".join(character if character.isalnum() or character == " " else " " for character in text)
    return " ".join(cleaned.split())


def base_name(value):
    out = value
    for marker in MARKERS:
        index = out.find(marker)
        if index > 0:
            out = out[:index]
    return out.strip()


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


def polygon_centroid(geometry):
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


def main():
    parcels = json.load(open(os.path.join(CACHE, "parcels_sf.json"), encoding="utf-8"))
    subdivisions = json.load(open(os.path.join(CACHE, "subdivisions.geojson"), encoding="utf-8"))
    layer_bases = sorted(
        {base_name(normalize_name(feature["properties"].get("NAME"))) for feature in subdivisions["features"] if feature["properties"].get("NAME")},
        key=len,
        reverse=True,
    )

    groups = {}
    for parcel in parcels:
        normalized = normalize_name(parcel.get("SUBDIVISION"))
        if not normalized:
            continue
        group = groups.setdefault(normalized, 0)
        groups[normalized] += 1

    unmatched = {}
    for name, count in groups.items():
        if count < 40:
            continue
        base = base_name(name)
        if any(base == layer or base.startswith(layer + " ") for layer in layer_bases):
            continue
        unmatched[base] = unmatched.get(base, 0) + count

    print(f"unmatched bases to locate: {len(unmatched)}", flush=True)
    centroids = {}
    for base, count in sorted(unmatched.items(), key=lambda item: -item[1]):
        offset = 0
        points = []
        while offset < count:
            page = fetch(
                {
                    "where": f"SUBDIVISION LIKE '{base}%'",
                    "outFields": "OBJECTID",
                    "returnGeometry": "true",
                    "outSR": "4326",
                    "geometryPrecision": "6",
                    "resultOffset": str(offset),
                    "resultRecordCount": str(PAGE_SIZE),
                    "f": "geojson",
                }
            )
            features = page.get("features", [])
            if not features:
                break
            for feature in features:
                centroid = polygon_centroid(feature.get("geometry") or {})
                if centroid:
                    points.append(centroid)
            offset += len(features)
            time.sleep(0.15)
        if points:
            centroids[base] = {
                "lon": round(sum(point[0] for point in points) / len(points), 6),
                "lat": round(sum(point[1] for point in points) / len(points), 6),
                "parcels": len(points),
            }
            print(f"  {base[:50]:50} {len(points):>5} parcels -> {centroids[base]['lat']},{centroids[base]['lon']}", flush=True)

    with open(OUT_FILE, "w", encoding="utf-8") as handle:
        json.dump(centroids, handle, indent=1)
    print(f"wrote {len(centroids)} centroids to {OUT_FILE}")


if __name__ == "__main__":
    main()
