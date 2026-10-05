"""Fetch all single-family residential parcels (attributes only) from the
Escambia County public ArcGIS parcel service.

Source: Escambia County GIS / Property Appraiser public parcel layer
(https://gismaps.myescambia.com/arcgis/rest/services/Individual_Layers/parcels/MapServer/0).

Output: canvass-out/cache/parcels_sf.json  (JSON array; git-ignored)
Only public property records are used. Owner names/mailing addresses are kept
for the owner-occupancy score and are never written to the committed outputs.

Usage: python scripts/canvass/fetch_parcels.py
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

SERVICE = "https://gismaps.myescambia.com/arcgis/rest/services/Individual_Layers/parcels/MapServer/0/query"
OUT_DIR = os.path.join("canvass-out", "cache")
OUT_FILE = os.path.join(OUT_DIR, "parcels_sf.json")
PAGE_SIZE = 1000
FIELDS = ",".join(
    [
        "OBJECTID",
        "REFNUM",
        "SITEADDR",
        "CITY",
        "ZIP",
        "SUBDIVISION",
        "DORCD",
        "CURRASDBLDG",
        "CURRMKT",
        "EXEMPTION",
        "MAILADDRESS1",
        "MAILCITY",
        "MAILSTATE",
        "MAILZIP",
        "LANDSIZE",
    ]
)
WHERE = "DORCD='0100'"  # Florida DOR code 0100 = single-family residential


def fetch(params, attempt=1):
    url = SERVICE + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "sparkling-standard-canvass/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001
        if attempt >= 5:
            raise
        print(f"  retry {attempt} after error: {error}", flush=True)
        time.sleep(2 * attempt)
        return fetch(params, attempt + 1)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    count = fetch({"where": WHERE, "returnCountOnly": "true", "f": "json"})["count"]
    print(f"single-family parcels to fetch: {count}", flush=True)

    records = []
    offset = 0
    while offset < count:
        page = fetch(
            {
                "where": WHERE,
                "outFields": FIELDS,
                "returnGeometry": "false",
                "orderByFields": "OBJECTID ASC",
                "resultOffset": str(offset),
                "resultRecordCount": str(PAGE_SIZE),
                "f": "json",
            }
        )
        features = page.get("features", [])
        if not features:
            break
        records.extend(feature["attributes"] for feature in features)
        offset += len(features)
        if (offset // PAGE_SIZE) % 10 == 0 or offset >= count:
            print(f"  fetched {offset}/{count}", flush=True)
        time.sleep(0.15)

    with open(OUT_FILE, "w", encoding="utf-8") as handle:
        json.dump(records, handle)
    print(f"wrote {len(records)} parcels to {OUT_FILE} ({os.path.getsize(OUT_FILE) / 1e6:.1f} MB)")


if __name__ == "__main__":
    sys.exit(main())
