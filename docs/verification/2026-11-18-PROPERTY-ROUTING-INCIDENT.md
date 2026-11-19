# Property routing incident — 2026-11-18

## Summary

The admin New Booking screen reported a **7,151-mile one-way route** for a saved Milton, FL
property. The distance was not a real road route. It was the straight-line distance from the
missing-coordinate sentinel `(0, 0)` to the service area.

## Root cause

- The saved property had `latitude = NULL` and `longitude = NULL`.
- `Number(null)` evaluates to `0`.
- The manual-booking destination check accepted finite values within the coordinate range, so
  `(0, 0)` was treated as the saved property.
- The routing provider could not produce a road route from `(0, 0)` and the shared fallback
  produced a labelled straight-line estimate: **7,150.9 miles**, rounded to **7,151 miles**.
- The admin quote then displayed the normal “route exceeds the instant-estimate range” warning.

This was a missing-coordinate handling defect, not a real distance or a customer address change.

## Anomaly audit

| Check | Result |
| --- | --- |
| Saved properties | 5 |
| Missing latitude/longitude | 5 |
| Stored `0,0` pairs | 0 |
| Invalid coordinate ranges | 0 |
| Active properties potentially bookable | 2 |
| Archived properties | 3 |

The three archived records contain privacy-removed address text and are not bookable. The second
active property has a verified local geocode candidate but was not bulk-overwritten.

## Repair

Only the affected active Milton property was corrected, using an exact Google geocode result and
an existing `properties.id`. The address, customer, booking data, service and pricing were not
changed. The repair is reversible: the previous values were `NULL, NULL`.

Audit record: `property.coordinates_repaired` in `admin_audit`.

## Verification

- Corrected route: **16.4 miles one way**, **24 minutes**, provider `google`, method `route`,
  verified `true`.
- Route from `(0, 0)` reproduced the incident at **7,150.9 miles** before the fix.
- No other active property was overwritten.

## Code hardening

- Shared `isUsableLatLng()` rejects non-finite/out-of-range coordinates and the `(0,0)` sentinel.
- Manual booking no longer converts null coordinates to zero; it geocodes the saved address.
- Manual quotes use only provider-verified routes for mileage; a failed route is shown as travel
  unavailable rather than fabricated mileage.
- Lead persistence and confirmed-booking property creation no longer store `0,0`.
- Submitted pins, route origin and the public travel endpoint reject `(0,0)`.
- The private origin remains server-only; no origin or provider secret is exposed.

## Customer impact assessment

- The defect affected the **admin manual booking** path for properties with null coordinates.
- It did not alter the stored customer address.
- It could have caused manual estimates to require review unnecessarily and could have blocked
  “Generate Estimate and Check Times” / availability for affected properties.
- It did not create charges, payments, invoices or appointments by itself.
- Public estimates that used a confirmed pin or resolved address were not affected by this null
  property record.
- Legitimate distant addresses still receive review warnings.
