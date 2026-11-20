# Admin address autocomplete

**Last verified:** 2026-11-19  
**Applies to:** Admin Quick Estimate, New Customer first property, Add Property, Edit Property, and request-linked customer creation

## 1. Implementation

Admin address fields use the existing private Google Maps Platform server key
and **Places API (New)**. The browser never receives the server key.

- Server endpoint: `POST /api/admin/address-autocomplete`
- Actions: `suggest` and `details`
- Client module: `src/scripts/admin-address-autocomplete.ts`
- Provider helper: `src/lib/location/admin-address.ts`
- Google helper: `src/lib/location/server-geocode.ts`
- UI styling: `src/styles/admin.css` (`.admin-address-*`)

The public estimator is unchanged. It continues to use its approved address
workflow and `AutocompleteSuggestion`-equivalent server behavior through
`/api/geocode`.

## 2. Behaviour

1. The administrator types at least four characters in a street-address field.
2. Predictions appear in an accessible listbox after a short debounce.
3. Arrow keys and Enter select; Escape closes; mouse/touch selection works.
4. On selection the server retrieves the place details and fills:
   - street number and route (street address);
   - apartment/unit when the source provides one and the field is empty;
   - city, county, state, ZIP;
   - Google Place ID;
   - latitude and longitude;
   - formatted address;
   - verified precision (`exact` or `street`).
5. The visible status says the Google address is selected and verified.
6. Editing the street, city, state, ZIP or branch clears the stored coordinates
   and requires a new selection. Editing only the apartment/unit keeps the
   verified coordinates.
7. Selecting a saved customer property fills its saved address and coordinates;
   it replaces a previous Google selection rather than reusing stale coordinates.

## 3. Branch bias

Predictions are location-biased, never hard-restricted:

| Branch | Bias centre | Radius |
| --- | --- | --- |
| Pensacola | 30.4213, -87.2169 | 50 km |
| Tampa (future) | 27.9506, -82.4572 | 50 km |

The API returns nationwide US predictions so nearby Alabama and other valid
service addresses remain selectable. The UI rejects a non-FL/AL state with a
clear service-area message; it never silently relabels an out-of-area address.

The Tampa branch is currently **inactive** in D1 and disabled in the Quick
Estimate selector. Its bias exists for the future activation; it is not a live
branch.

## 4. Security and cost

- Requires an authenticated admin session, CSRF, and `customer.write` or
  `booking.write` (owner included).
- Managers cannot request another branch's bias.
- Rate limit: 90 requests per five minutes per administrator for suggestions and
  details combined.
- Server key stays in Cloudflare; only predictions/components are returned.
- Google Places (New) is billed per request/session according to the owner's
  Google Cloud account. Requests use a session token and a tight field mask.
- If Google is unavailable, the client falls back to the existing public address
  lookup (MapMap/Census). It labels the result as address lookup, not Google.
- If both are unavailable, manual entry remains and no coordinates are invented.

## 5. Coordinates and travel

- `properties.latitude` / `longitude` / `precision` are now saved by the admin
  property forms. Previously entered coordinates are preserved unless the address
  materially changes.
- Missing or `(0,0)` coordinates are treated as missing. They are never used as
  a route origin or destination.
- Quick Estimate sends the selected latitude/longitude, place ID, county and unit
  with the saved estimate. Property records store coordinates and precision;
  the existing schema has no dedicated Place ID/county column.
- Travel still uses the existing server routing policy and the correct branch
  origin. A suggestion is not proof of deliverability or accessibility.

## 6. Tests

- `tests/admin-address.test.ts` — Google request shape, branch bias, manager
  scope, place-detail parsing (unit/county/state/ZIP/coordinates), no key leakage,
  no Google key, invalid place ID.
- `tests/admin.test.ts` — property coordinates stored, preserved on unrelated
  updates, cleared when the address changes, and replaced when new coordinates
  arrive.
- `tests/quick-estimate.test.ts` — unit/place ID/county travel with the saved
  estimate.
- `tests/browser/admin-address-autocomplete.test.mjs` — predictions, keyboard
  selection, autofill, unit preservation, edited-after-selection invalidation,
  mobile menu bounds, saved-property selection and stale-coordinate removal.

## 7. Known limitations

- Authenticated visual verification in production requires an owner/admin
  session; automated tests use synthetic authenticated sessions.
- The property schema does not persist Google Place ID or county. Quick Estimate
  retains both in its input snapshot; property records retain coordinates and
  precision.
- Tampa is not active; the branch option is disabled until the owner activates it.
