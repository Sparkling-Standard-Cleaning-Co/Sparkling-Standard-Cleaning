"""Fetch American Community Survey block-group data and boundaries for
Escambia County, FL (FIPS 12033) from the free Census Reporter API.

Tables:
  B19013 median household income
  B11003 family households (incl. with children)
  B25003 housing tenure (owner/renter occupied)
  B25077 median home value
  B25024 units in structure (detached single-family share)
  B25010 average household size

Outputs (git-ignored):
  canvass-out/cache/acs_blockgroups.json
  canvass-out/cache/blockgroups.geojson

Usage: python scripts/canvass/fetch_acs.py
"""

import json
import os
import urllib.parse
import urllib.request

TABLES = "B19013,B11003,B25003,B25077,B25024,B25010"
GEO = "150|05000US12033"  # all block groups in Escambia County, FL
DATA_URL = "https://api.censusreporter.org/1.0/data/show/latest"
GEO_URL = "https://api.censusreporter.org/1.0/geo/show/tiger2023"
CACHE = os.path.join("canvass-out", "cache")


def get_json(url, params):
    request = urllib.request.Request(
        url + "?" + urllib.parse.urlencode(params),
        headers={"User-Agent": "sparkling-standard-canvass/1.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    os.makedirs(CACHE, exist_ok=True)

    data = get_json(DATA_URL, {"table_ids": TABLES, "geo_ids": GEO})
    with open(os.path.join(CACHE, "acs_blockgroups.json"), "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    print(f"block groups with data: {len(data.get('data', {}))}")

    geo = get_json(GEO_URL, {"geo_ids": GEO})
    with open(os.path.join(CACHE, "blockgroups.geojson"), "w", encoding="utf-8") as handle:
        json.dump(geo, handle)
    print(f"block-group boundaries: {len(geo.get('features', []))}")


if __name__ == "__main__":
    main()
