# Route planning — canonical canvassing engine

The canvassing pipeline is documented in `docs/marketing/CANVASSING-SYSTEM.md`. This document covers
the Stage 2 route **engine**, its objective, data contract, benchmark and verification.

## Canonical route object

`scripts/canvass/build_routes.py` writes `canvass-out/route_object.json` (local-only). Every downstream
output — route sheets, workbook rows, tracking CSV, map lines and numbered markers — derives from the
same ordered stops. Order is never re-derived.

```
Route {
  route_id, priority, neighborhood, neighborhood_score, method_version,
  start_address, end_address,
  stops: [ { seq, address_id, street, house_number, lat, lon,
             owner_occupied, coordinate_precision, address } ],
  metrics: { stop_count, straight_mi, walking_mi_est, driving_mi_est, model, drive_model,
             street_count, street_reentries, long_edges_over_0_15mi }
}
```

`route_id` is `{A|B|C}-NN` in neighborhood-score order; `seq` is 1..n per route; `coordinate_precision`
is `parcel_polygon_vertex_mean` (not rooftop).

## Objective (owner-approved, lexicographic)

1. No omitted or duplicated eligible stops.
2. Geographic continuity / street-block completion where the layout allows it cheaply.
3. Reduce routed distance.
4. Reduce backtracking, re-entry, unsafe crossings and repositioning where measurable.
5. Practical workload limits (target 50–100 stops per route).
6. Preserve the existing selection/priority unless explicitly changed.

## Method B (shipped, deterministic)

1. **Cluster**: walk-based growth from deterministic seeds (SW-most unassigned stop); each new stop is
   the nearest unassigned stop to the last added, so clusters are geographically contiguous. Route
   sizes are balanced: `k = ceil(stops / target)` routes of `ceil(stops / k)` stops; undersized
   clusters (< half the target, capped at 40) merge into the nearest cluster.
2. **Orient**: start at the stop nearest the private operating origin (or SW-most without an origin).
3. **Sequence**: greedy nearest-neighbour with a strong same-street preference.
4. **Improve**: deterministic 2-opt (first improvement, capped passes).
5. **Complete streets**: merge each street's stops into one house-number-ordered block only when the
   detour stays within 1% of the route length (a strict block-first variant was measured and rejected —
   see `DESIGN-DECISIONS.md`).

Distance model: straight-line miles; walking estimate = straight-line × 1.25; drive estimate =
origin-to-start straight-line × 1.3. These are labelled planning estimates — no road-network claim.

## Frozen baseline and benchmark (same 4,241 stops)

| Metric | Record order (Stage 1 defect) | Greedy NN | 2-opt | **Stage 2 engine** |
| --- | --- | --- | --- | --- |
| Straight-line total | 310.7 mi | 107.1 mi | 100.0 mi | **101.6 mi** |
| Long edges (>0.15 mi) | 941 | 95 | — | **34** |
| Street re-entries | 1,279 | 335 | 348 | **287** |
| Routes | 66 | — | — | **66** (sizes 42–75, no tail <40) |
| Duplicates / lost stops | — | — | — | **0 / 0** |

Reproduce with `python scripts/canvass/build_routes.py` (local data) then
`python scripts/canvass/verify_routes.py`. The baseline figures are frozen from Stage 1 evidence
(commit `4e3a33a` working tree).

## Commands

```
python scripts/canvass/build_routes.py     # cluster/order → route_object.json + routes.csv + geojson
python scripts/canvass/build_outputs.py    # workbook, sheets, tracking, map from the canonical object
python scripts/canvass/verify_routes.py    # coverage/order/consistency/workload checks
npm run test:routes                        # synthetic engine tests (grid, loop, cul-de-sac, …)
```

## Tests

`tests/routes/test_route_engine.py` covers synthetic fixtures for grid, loop, cul-de-sac, parallel
streets, divided road, barrier, street-suffix alias, duplicate coordinates, missing geocode, cluster
boundary, route orientation, determinism, coverage, workload balance and completion tolerance.
`tests/routes/privacy.test.ts` enforces that no operational output is tracked.

## Limitations

- Coordinates are parcel-polygon vertex means, not rooftop/entry points.
- Distances are straight-line estimates, not surveyed road/walking paths; one-way roads, barriers and
  safe crossings are not modelled.
- The engine cannot know physical barriers between nearby stops; clusters are geographic only.
- ACS/parcel inputs refresh on their own cadence (see `CANVASSING-SYSTEM.md`).
