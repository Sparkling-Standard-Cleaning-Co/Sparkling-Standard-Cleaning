# Canvassing intelligence system (Escambia County)

Purpose: identify, prioritize and map the highest-probability **recurring residential cleaning**
customers, and run measurable door-to-door canvassing routes. This is an operational system built
from public data; it is **not** a generic lead list and contains no fabricated addresses.

Owner-facing outputs live in the git-ignored `canvass-out/` directory (address-level data is
operational and is never committed). Committed reports contain aggregates only:

- `docs/marketing/CANVASSING-TOP-NEIGHBORHOODS.md` — objective neighborhood ranking (top 20).
- `docs/marketing/CANVASSING-ROUTES-OVERVIEW.md` — route totals, top streets, top routes, clusters.

## 1. Data sources (all public, zero cost)

| Input | Source | Notes |
| --- | --- | --- |
| Single-family parcels (address, situs city/ZIP, subdivision, DOR use code, assessed value, homestead exemption, owner mailing address) | Escambia County GIS / Property Appraiser public parcel service: `https://gismaps.myescambia.com/arcgis/rest/services/Individual_Layers/parcels/MapServer/0` | Updated monthly; DOR code `0100` = single-family |
| Subdivision boundaries (named) | Escambia County GIS: `.../Escambia_County/MapServer/1` | 1,966 published subdivisions |
| Income, family households, tenure, home value, units in structure, household size | American Community Survey 5-year block-group estimates via the free Census Reporter API (`https://api.censusreporter.org/1.0/data/show/latest`) | 199 block groups in Escambia County |
| Block-group boundaries | Census Reporter TIGER2023 endpoint | Used to join subdivisions to ACS estimates |

No paid data, no skip-tracing, no purchased lists. Property records are public; owner names and
mailing addresses are used **only** to compute an owner-occupancy flag and are never written to any
output file.

## 2. Neighborhood unit and scoring

**Neighborhood = published subdivision** (base name; unit/phase/plat suffixes collapsed). Parcels
whose subdivision name has no published boundary (large tracts such as `NEW CITY TRACT`) get an
aggregate centroid fetched from their own parcel geometries, so they are scored too. A subdivision
is eligible when it has **≥40 single-family parcels** and a mapped centroid.

Score components (0–100):

| Component | Weight | Input | Normalization (0 → 1) |
| --- | --- | --- | --- |
| Owner occupancy | 25 | Parcel records: homestead exemption OR mailing address equals situs address | 35% → 90% |
| Income proxy | 15 | ACS median household income (block group) | $30k → $130k |
| Families with children | 15 | ACS family households with own children ÷ all households | 8% → 45% |
| Home value | 15 | Median building assessed value (parcel) | $60k → $350k |
| Route density | 15 | Single-family parcel count (log scale) | 50 → 1,000 homes |
| Travel efficiency | 10 | Straight-line distance from the private operating origin | 0 → 25 mi (inverse) |
| Detached share | 5 | ACS 1-unit detached ÷ total units (block group) | 50% → 95% |

Scores are rounded to one decimal. The private operating origin is read from `.env` only to compute
a **travel band**; exact coordinates and raw distances never appear in committed files.

## 3. Address collection rules

- Source: the same public parcel service; nothing is invented.
- Keep only DOR code `0100` (single-family), with a situs address and a parcel centroid.
- The service contains no commercial/industrial parcels under `0100`; vacant land is code `0000`
  and is excluded by construction. Schools, churches and government parcels carry non-residential
  DOR codes and are excluded.
- Duplicate parcel references are removed.
- Owner names and mailing addresses are dropped before any file is written.

Master address fields: `Address_ID, Neighborhood, Neighborhood_Score, Street_Name, House_Number,
Full_Address, ZIP_Code, Latitude, Longitude, Property_Type, Owner_Occupied, Homestead, Route_ID`.

## 4. Route engineering

- Target **50–100 homes per route** (default 75).
- Addresses are ordered by a greedy nearest-neighbour walk starting from the south-west point of
  the neighborhood; walking distance is the sum of consecutive straight-line distances × 1.25
  (street detour factor).
- Driving distance is an estimate from the private origin to the route start (× 1.3 road factor),
  written only to local outputs.
- Priority: **A** (neighborhood score ≥ 70), **B** (60–69), **C** (< 60). Route IDs are
  `A-01`, `B-07`, … in neighborhood-score order.

## 5. Conversion tracking

`canvass-out/performance_tracking.csv` (and the workbook's Performance Tracking tab) carries one
row per address with: Door_Knocked, No_Answer, Conversation, Homeowner, Interested, Phone_Captured,
Estimate_Requested, Estimate_Sent, Booked, Recurring_Customer, Retention_Status, Revenue, Notes,
Follow_Up_Date. The key metric is **recurring customers per 100 doors**, computable per route,
street and neighborhood from these columns.

## 6. Pipeline commands

```
python scripts/canvass/fetch_parcels.py       # county-wide single-family parcels (cache)
python scripts/canvass/fetch_subdivisions.py  # published subdivision boundaries (cache)
python scripts/canvass/fetch_acs.py           # ACS block-group data + boundaries (cache)
python scripts/canvass/fetch_unmatched.py     # centroids for unplatted tract areas (cache)
python scripts/canvass/score_neighborhoods.py # ranking + committed top-neighborhoods report
python scripts/canvass/build_routes.py        # address collection + routes (default top 20)
python scripts/canvass/build_outputs.py       # workbook, print sheets, map, tracking template
python scripts/canvass/build_report.py        # committed route overview report
```

Rerun order matters: fetch → score → routes → outputs → report. Parcel data refreshes monthly, so
a quarterly rerun keeps the targeting current; ACS estimates refresh annually.

## 7. Caveats (do not over-trust)

- Owner occupancy is a **proxy**: homestead exemption plus a mailing-address match. Recent buyers
  without homestead and out-of-state owners can both distort it slightly.
- Income/family/detached inputs are block-group estimates (2019–2023 ACS), not parcel truth.
- Assessed building value is not market price and varies with assessment cycles.
- Route walking distance is a planning estimate, not a surveyed path.
- Door outcomes are entered manually; the system cannot fabricate or infer them.

## 8. Privacy and security rules

- `canvass-out/` is git-ignored and must never be committed (address-level operational data).
- Owner names and mailing addresses never leave the cache layer.
- The private operating origin never appears in any committed file or report.
- Committed reports contain aggregates only (counts, rates, bands, rankings).
