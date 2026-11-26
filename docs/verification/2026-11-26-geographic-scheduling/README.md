# Geographic and scheduling acceptance — 2026-11-26

## Geographic matrix

- **70 representative addresses**, two per approved live Pensacola ZIP, generated from the U.S. Census TIGER/Line 2024 address-range files and independently re-geocoded with the U.S. Census Geocoder.
- Every address resolved to the expected county and state; all 70 assigned to `branch_pensacola`; all 70 production travel lookups were live, verified routes; all 70 production calendar probes returned an enabled Pensacola calendar.
- The matrix includes the ZIP 32534 recovery, Molino 32577 (Escambia correction), and both sides of split ZIP 32561 (Pensacola Beach/Escambia and Gulf Breeze/Santa Rosa).
- These are representative address-range records, not customer records. No booking, hold, payment, customer, email or calendar write was created.

| # | ZIP | Census-verified representative address | County | Branch | Zone | Production travel | Production calendar | Commercial tax |
|---:|---|---|---|---|---|---|---|---:|
| 1 | 32501 | 1 Attucks Ct, Pensacola, FL 32501 | Escambia | branch_pensacola | core | verified 16 mi | enabled (37 slots) | 7.5% |
| 2 | 32501 | 1000 Baars St, Pensacola, FL 32501 | Escambia | branch_pensacola | core | verified 13.9 mi | enabled (37 slots) | 7.5% |
| 3 | 32502 | 501 Aragon St, Pensacola, FL 32502 | Escambia | branch_pensacola | core | verified 16 mi | enabled (37 slots) | 7.5% |
| 4 | 32502 | 1100 Barrancas Ave, Pensacola, FL 32502 | Escambia | branch_pensacola | core | verified 16.4 mi | enabled (37 slots) | 7.5% |
| 5 | 32503 | 1801 11th Ave, Pensacola, FL 32503 | Escambia | branch_pensacola | core | verified 14.7 mi | enabled (37 slots) | 7.5% |
| 6 | 32503 | 3100 19th Ave, Pensacola, FL 32503 | Escambia | branch_pensacola | core | verified 14.8 mi | enabled (37 slots) | 7.5% |
| 7 | 32504 | 1900 750, Pensacola, FL 32504 | Escambia | branch_pensacola | core | verified 12.2 mi | enabled (37 slots) | 7.5% |
| 8 | 32504 | 4700 Abercrombie Cir, Pensacola, FL 32504 | Escambia | branch_pensacola | core | verified 16.6 mi | enabled (37 slots) | 7.5% |
| 9 | 32505 | 900 493, Pensacola, FL 32505 | Escambia | branch_pensacola | core | verified 11.8 mi | enabled (37 slots) | 7.5% |
| 10 | 32505 | 1200 Albuquerque Cir, Pensacola, FL 32505 | Escambia | branch_pensacola | core | verified 11.3 mi | enabled (37 slots) | 7.5% |
| 11 | 32506 | 600 3, Pensacola, FL 32506 | Escambia | branch_pensacola | core | verified 11.5 mi | enabled (37 slots) | 7.5% |
| 12 | 32506 | 1000 46th Ave, Pensacola, FL 32506 | Escambia | branch_pensacola | core | verified 10.7 mi | enabled (37 slots) | 7.5% |
| 13 | 32507 | 13501 292, Pensacola, FL 32507 | Escambia | branch_pensacola | core | verified 21.3 mi | enabled (37 slots) | 7.5% |
| 14 | 32507 | 1 2nd St, Pensacola, FL 32507 | Escambia | branch_pensacola | core | verified 13.3 mi | enabled (37 slots) | 7.5% |
| 15 | 32508 | 1 Abb St, Pensacola, FL 32508 | Escambia | branch_pensacola | core | verified 21.9 mi | enabled (37 slots) | 7.5% |
| 16 | 32508 | 1898 Andrew Jackson Ct, Pensacola, FL 32508 | Escambia | branch_pensacola | core | verified 21.8 mi | enabled (37 slots) | 7.5% |
| 17 | 32511 | 700 2nd St, Pensacola, FL 32511 | Escambia | branch_pensacola | core | verified 12.4 mi | enabled (37 slots) | 7.5% |
| 18 | 32511 | 701 4th St, Pensacola, FL 32511 | Escambia | branch_pensacola | core | verified 12.5 mi | enabled (37 slots) | 7.5% |
| 19 | 32514 | 4001 290, Pensacola, FL 32514 | Escambia | branch_pensacola | core | verified 12.6 mi | enabled (37 slots) | 7.5% |
| 20 | 32514 | 8698 9th Avenue Ct, Pensacola, FL 32514 | Escambia | branch_pensacola | core | verified 13.3 mi | enabled (37 slots) | 7.5% |
| 21 | 32526 | 5800 Abba Ln, Pensacola, FL 32526 | Escambia | branch_pensacola | core | verified 7.6 mi | enabled (37 slots) | 7.5% |
| 22 | 32526 | 3000 Abel Ct, Pensacola, FL 32526 | Escambia | branch_pensacola | core | verified 7.4 mi | enabled (37 slots) | 7.5% |
| 23 | 32530 | 6801 Bushnell St, Bagdad, FL 32530 | Santa Rosa | branch_pensacola | surrounding | verified 24.9 mi | enabled (37 slots) | 7% |
| 24 | 32530 | 6900 Dorr St, Bagdad, FL 32530 | Santa Rosa | branch_pensacola | surrounding | verified 24.7 mi | enabled (37 slots) | 7% |
| 25 | 32533 | 1598 2nd Ave, Cantonment, FL 32533 | Escambia | branch_pensacola | core | verified 5.9 mi | enabled (37 slots) | 7.5% |
| 26 | 32533 | 1598 3rd Ave, Cantonment, FL 32533 | Escambia | branch_pensacola | core | verified 6 mi | enabled (37 slots) | 7.5% |
| 27 | 32534 | 8403 465, Pensacola, FL 32534 | Escambia | branch_pensacola | core | verified 5 mi | enabled (37 slots) | 7.5% |
| 28 | 32534 | 7600 Aaron Dr, Pensacola, FL 32534 | Escambia | branch_pensacola | core | verified 5.4 mi | enabled (37 slots) | 7.5% |
| 29 | 32561 | 100 10th Avenida, Pensacola Beach, FL 32561 | Escambia | branch_pensacola | surrounding | verified 23.9 mi | enabled (37 slots) | 7.5% |
| 30 | 32561 | 101 Andrew Jackson Trl, Gulf Breeze, FL 32561 | Santa Rosa | branch_pensacola | surrounding | verified 21.2 mi | enabled (37 slots) | 7% |
| 31 | 32563 | 2598 Abbie Elizabeth Ct, Gulf Breeze, FL 32563 | Santa Rosa | branch_pensacola | surrounding | verified 24.6 mi | enabled (37 slots) | 7% |
| 32 | 32563 | 1700 Abercrombie Rd, Gulf Breeze, FL 32563 | Santa Rosa | branch_pensacola | surrounding | verified 33.3 mi | enabled (37 slots) | 7% |
| 33 | 32565 | 3500 Aileens Ln, Jay, FL 32565 | Santa Rosa | branch_pensacola | surrounding | verified 36.3 mi | enabled (37 slots) | 7% |
| 34 | 32565 | 6798 Allen Field Rd, Jay, FL 32565 | Santa Rosa | branch_pensacola | surrounding | verified 42.5 mi | enabled (37 slots) | 7% |
| 35 | 32566 | 2598 1st Ct, Navarre, FL 32566 | Santa Rosa | branch_pensacola | surrounding | verified 39.9 mi | enabled (37 slots) | 7% |
| 36 | 32566 | 2598 2nd Ct, Navarre, FL 32566 | Santa Rosa | branch_pensacola | surrounding | verified 40 mi | enabled (37 slots) | 7% |
| 37 | 32570 | 298 2nd Ave, Milton, FL 32570 | Santa Rosa | branch_pensacola | surrounding | verified 26.9 mi | enabled (37 slots) | 7% |
| 38 | 32570 | 100 3rd Ave, Milton, FL 32570 | Santa Rosa | branch_pensacola | surrounding | verified 27.5 mi | enabled (37 slots) | 7% |
| 39 | 32571 | 4100 6th Ave, Pace, FL 32571 | Santa Rosa | branch_pensacola | surrounding | verified 13.7 mi | enabled (37 slots) | 7% |
| 40 | 32571 | 4252 9th Ave, Pace, FL 32571 | Santa Rosa | branch_pensacola | surrounding | verified 13.7 mi | enabled (37 slots) | 7% |
| 41 | 32577 | 7300 Abbott Ln, Molino, FL 32577 | Escambia | branch_pensacola | surrounding | verified 15.6 mi | enabled (37 slots) | 7.5% |
| 42 | 32577 | 8058 Abramovich Ln, Molino, FL 32577 | Escambia | branch_pensacola | surrounding | verified 16.6 mi | enabled (37 slots) | 7.5% |
| 43 | 32583 | 3001 12th Ave, Milton, FL 32583 | Santa Rosa | branch_pensacola | surrounding | verified 20.5 mi | enabled (37 slots) | 7% |
| 44 | 32583 | 2900 13th Ave, Milton, FL 32583 | Santa Rosa | branch_pensacola | surrounding | verified 20.4 mi | enabled (37 slots) | 7% |
| 45 | 36426 | 1 1st Ave, Brewton, AL 36426 | Escambia | branch_pensacola | extended | verified 46.9 mi | enabled (37 slots) | 0% |
| 46 | 36426 | 101 Adams St, Brewton, AL 36426 | Escambia | branch_pensacola | extended | verified 51.6 mi | enabled (37 slots) | 0% |
| 47 | 36502 | 298 10th Ave, Atmore, AL 36502 | Escambia | branch_pensacola | extended | verified 38.9 mi | enabled (37 slots) | 0% |
| 48 | 36502 | 298 11th Ave, Atmore, AL 36502 | Escambia | branch_pensacola | extended | verified 39 mi | enabled (37 slots) | 0% |
| 49 | 36507 | 101 12th St, Bay Minette, AL 36507 | Baldwin | branch_pensacola | extended | verified 39.8 mi | enabled (37 slots) | 0% |
| 50 | 36507 | 408 15th St, Bay Minette, AL 36507 | Baldwin | branch_pensacola | extended | verified 40.5 mi | enabled (37 slots) | 0% |
| 51 | 36526 | 28100 10th Ave, Daphne, AL 36526 | Baldwin | branch_pensacola | extended | verified 40.7 mi | enabled (37 slots) | 0% |
| 52 | 36526 | 28298 1st Ave N, Daphne, AL 36526 | Baldwin | branch_pensacola | extended | verified 40.3 mi | enabled (37 slots) | 0% |
| 53 | 36527 | 8399 Pine Run, Spanish Fort, AL 36527 | Baldwin | branch_pensacola | extended | verified 37.3 mi | enabled (37 slots) | 0% |
| 54 | 36527 | 101 Adams St, Spanish Fort, AL 36527 | Baldwin | branch_pensacola | extended | verified 37.6 mi | enabled (37 slots) | 0% |
| 55 | 36530 | 11598 Acre Run Ln, Elberta, AL 36530 | Baldwin | branch_pensacola | extended | verified 28.8 mi | enabled (37 slots) | 0% |
| 56 | 36530 | 13101 Illinois St, Elberta, AL 36530 | Baldwin | branch_pensacola | extended | verified 27.8 mi | enabled (37 slots) | 0% |
| 57 | 36532 | 23650 2nd St, Fairhope, AL 36532 | Baldwin | branch_pensacola | extended | verified 45.1 mi | enabled (37 slots) | 0% |
| 58 | 36532 | 23299 3rd St, Fairhope, AL 36532 | Baldwin | branch_pensacola | extended | verified 44.9 mi | enabled (37 slots) | 0% |
| 59 | 36535 | 12698 2nd Ave, Foley, AL 36535 | Baldwin | branch_pensacola | extended | verified 42.7 mi | enabled (37 slots) | 0% |
| 60 | 36535 | 12699 3rd Ave, Foley, AL 36535 | Baldwin | branch_pensacola | extended | verified 42.7 mi | enabled (37 slots) | 0% |
| 61 | 36542 | 10301 2nd St, Gulf Shores, AL 36542 | Baldwin | branch_pensacola | extended | verified 52.4 mi | enabled (37 slots) | 0% |
| 62 | 36542 | 9001 Adair Ln, Gulf Shores, AL 36542 | Baldwin | branch_pensacola | extended | verified 54 mi | enabled (37 slots) | 0% |
| 63 | 36551 | 5100 A Ave, Loxley, AL 36551 | Baldwin | branch_pensacola | extended | verified 30 mi | enabled (37 slots) | 0% |
| 64 | 36551 | 18500 Access Ave, Loxley, AL 36551 | Baldwin | branch_pensacola | extended | verified 26.9 mi | enabled (37 slots) | 0% |
| 65 | 36561 | 26800 1st St, Orange Beach, AL 36561 | Baldwin | branch_pensacola | extended | verified 35 mi | enabled (37 slots) | 0% |
| 66 | 36561 | 26899 2nd St, Orange Beach, AL 36561 | Baldwin | branch_pensacola | extended | verified 35 mi | enabled (37 slots) | 0% |
| 67 | 36567 | 19700 Adams Acres Rd, Robertsdale, AL 36567 | Baldwin | branch_pensacola | extended | verified 25.9 mi | enabled (37 slots) | 0% |
| 68 | 36567 | 20801 Adams Dr, Robertsdale, AL 36567 | Baldwin | branch_pensacola | extended | verified 27.5 mi | enabled (37 slots) | 0% |
| 69 | 36580 | 16799 Acadiana Dr, Summerdale, AL 36580 | Baldwin | branch_pensacola | extended | verified 32.2 mi | enabled (37 slots) | 0% |
| 70 | 36580 | 19000 Adams Dr, Summerdale, AL 36580 | Baldwin | branch_pensacola | extended | verified 29.3 mi | enabled (37 slots) | 0% |

## ZIP audit

- **168 approved service-area ZIPs audited**: 35 live Pensacola ZIPs and 133 prepared Tampa ZIPs.
- Every ZIP has a 2020 Census ZCTA-to-county record. Snapshot: `scripts/data/census-zcta-counties.json`.
- Live Pensacola: 35/35 Census records; tax table now agrees with Census for every single-county ZIP.
- `32534` = Escambia (restored), `32577` = Escambia (corrected), `32561` = Escambia/Santa Rosa (address county required).
- Prepared Tampa: 133/133 Census records. **14 cross-county ZIPs** and **9 ZIPs containing land outside the configured Pasco/Pinellas/Hillsborough counties** are recorded for owner review before any Tampa activation. Tampa is not bookable and was not activated.
- Pensacola AL ZIPs 36426 and 36502 also cross into Conecuh/Monroe; they remain Pensacola branch coverage, and Alabama cleaning services are outside the sales-tax base.

## Scheduling conflict matrix

| Scenario | Result |
|---|---|
| Active hold blocks an overlapping hold for the same resource | Pass |
| Expired hold stops blocking capacity | Pass |
| Released/confirmed holds are excluded from active capacity | Pass |
| Two independent cleaners accept simultaneous holds | Pass |
| Two-person job consumes both resources and blocks a simultaneous job | Pass |
| Required crew larger than roster is withheld, never silently reduced | Pass |
| First job starts at opening without origin travel | Pass |
| Travel + combined job/travel buffer applies between real jobs only | Pass |
| Chicago and Tampa (New York) time zones produce distinct UTC starts | Pass |
| All-day blocked event removes the resource's day | Pass |
| Future recurring conflict is reported without losing the paid first visit | Pass (existing recurring matrix) |
| Initial Deep Cleaning vs ongoing maintenance duration | Pass — server-owned ongoing labor creates 120-minute maintenance visits while the 180-minute first Deep Cleaning is preserved |

Implementation tests: `tests/scheduling-conflict-matrix.test.ts`, `tests/customer-recurring.test.ts`, `tests/booking-availability.test.ts`, `tests/booking-crew.test.ts`, `tests/booking-holds.test.ts`.

## Evidence files

- `geographic-acceptance.json` — all 70 rows with Census match, coordinates, branch, zone, residential/commercial tax, production travel and calendar results.
- `scripts/data/geographic-acceptance.json` — reproducible address matrix input.
- `scripts/data/census-zcta-counties.json` — 168-ZIP Census county snapshot with source URL.
- `scripts/geographic-acceptance.mjs` — offline/live acceptance runner (`npm run geography:acceptance -- --live --travel --calendar`).

## Preserved limitations

- The public test matrix deliberately uses no customer or private property data.
- Tampa cross-county findings require an owner decision before activation; they do not affect the live Pensacola booking branch.
- The Stripe test-mode credentials required for a completed payment acceptance test are documented separately in the release verification.
