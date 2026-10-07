# Privacy and data handling — field acquisition systems

Two data domains: **print** (public brand assets) and **canvassing** (residential data, sensitive).

## Classification

| Class | Examples | Rule |
| --- | --- | --- |
| Restricted | `TRAVEL_ORIGIN`, owner names/mailing addresses in caches, credentials, tokens | Never in commits, docs, screenshots, logs, reports, fixtures, PRs or telemetry |
| Operational | Real addresses, coordinates, route sequences, canvassing results | Local only; `canvass-out/` is git-ignored; owner-approved storage |
| Internal | Generator code, aggregate metrics, benchmark numbers | Repository-committable if address-free |
| Public | Approved brand assets, QR SVGs, print PDFs, aggregate rankings | Repository/print-safe |

## Where operational data lives

- `canvass-out/` (git-ignored): `route_object.json`, `master_addresses.csv`, `routes.geojson`,
  `performance_tracking.csv`, caches, workbook, sheets, map.
- Owner copies: `~/Downloads/Door Knocking/Canvassing/` (from the earlier packet) and the Stage 2
  output root.

## Enforced rules

1. **Owner names and mailing addresses never leave the cache layer.** `fetch_parcels.py` and
   `build_routes.py` use them only to compute the owner-occupancy flag; no output field contains them.
2. **The private operating origin never appears in any output.** `.env` is read at runtime for start
   orientation and the drive estimate only; no coordinate is written to committed files. The route
   summary reports aggregate mileage only.
3. **No operational output is tracked.** `tests/routes/privacy.test.ts` verifies `canvass-out` is
   ignored, no `master_addresses.csv`/`routes.geojson`/`route_object.json`/`performance_tracking.csv`
   is tracked, and no tracked file carries a canvass-style address+coordinate record.
4. **No origin value is committed** — the privacy test scans every tracked/untracked file.
5. **Fixtures are unmistakably synthetic** — every ID starts `SYN-`, every street starts `SYNTHETIC`,
   and coordinates are fictional.
6. **Generated print artifacts are PII-scanned** — `npm run print:verify` scans `Sources/` and
   `Specifications/` for address/coordinate/origin patterns and fails on a hit.
7. **Map popups are text, not HTML** — `map.html` uses MapLibre `setText` so an address string can
   never inject markup.

## Retention

- Keep the reviewed output folder until the next build is accepted; regenerate into the same versioned
  root rather than editing artifacts by hand.
- Never copy operational outputs into the repository, issues, PRs, screenshots or chat.
