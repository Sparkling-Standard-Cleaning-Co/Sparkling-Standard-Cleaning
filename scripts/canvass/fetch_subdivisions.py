"""Fetch the Escambia County published Subdivision boundaries (GeoJSON).

Source: Escambia County GIS public layer
(https://gismaps.myescambia.com/arcgis/rest/services/Escambia_County/MapServer/1).

Output: canvass-out/cache/subdivisions.geojson (git-ignored)

Usage: python scripts/canvass/fetch_subdivisions.py
"""

import json
import os
import time
import urllib.parse
import urllib.request

SERVICE = "https://gismaps.myescambia.com/arcgis/rest/services/Escambia_County/MapServer/1/query"
OUT_FILE = os.path.join("canvass-out", "cache", "subdivisions.geojson")
PAGE_SIZE = 1000


def fetch(params, attempt=1):
    url = SERVICE + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "sparkling-standard-canvass/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001
        if attempt >= 5:
            raise
        print(f"  retry {attempt} after error: {error}", flush=True)
        time.sleep(2 * attempt)
        return fetch(params, attempt + 1)


def main():
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    features = []
    offset = 0
    while True:
        page = fetch(
            {
                "where": "1=1",
                "outFields": "NAME,REFNO",
                "returnGeometry": "true",
                "outSR": "4326",
                "geometryPrecision": "6",
                "orderByFields": "OBJECTID ASC",
                "resultOffset": str(offset),
                "resultRecordCount": str(PAGE_SIZE),
                "f": "geojson",
            }
        )
        batch = page.get("features", [])
        if not batch:
            break
        features.extend(batch)
        offset += len(batch)
        print(f"  fetched {offset} subdivisions", flush=True)
        time.sleep(0.15)
    geojson = {"type": "FeatureCollection", "features": features}
    with open(OUT_FILE, "w", encoding="utf-8") as handle:
        json.dump(geojson, handle)
    print(f"wrote {len(features)} subdivisions to {OUT_FILE} ({os.path.getsize(OUT_FILE) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
