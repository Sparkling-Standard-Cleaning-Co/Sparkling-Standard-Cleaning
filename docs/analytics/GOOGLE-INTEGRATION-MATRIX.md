# Google integration matrix — October 2026

This is a status record, not a claim that every external report has been independently opened.
Owner-confirmed means the owner stated the connection was completed; verified means the repository
or a reproducible local check proves the website-side behavior.

| Item | Status | Evidence / remaining action |
| --- | --- | --- |
| Google Search Console domain property connected to GA4 | Owner-confirmed | Owner completed it. Do not recreate. GA4 Search Console report availability still needs a dashboard check. |
| Search Console report collection published in GA4 | Owner-confirmed | Owner completed it. Verify the report is populated in GA4. |
| Google Business Profile connected to GA4 | Owner-confirmed | Owner completed it. Do not reconnect. Verify GBP report data in GA4. |
| Search Console sitemap submitted | Not independently verified | `dist/sitemap-index.xml` is generated and `npm run validate` checks the site map. Confirm the property shows the sitemap as processed. |
| Sitemap processing / indexed URLs | Not independently verified | Requires Search Console access. No claim of indexing or ranking is made. |
| Indexing and canonical issues | Website-side verified | `npm run validate` passes 29 pages, unique titles and canonical checks. External coverage still needs Search Console. |
| Core Web Vitals / page experience | Not independently measured | Use Search Console and PageSpeed Insights. No field data is fabricated here. |
| Organic-search landing pages and queries | Not independently measured | Requires Search Console/GA4. |
| GA4 key-event receipt | Partially owner-confirmed | Owner reported GA4 receiving page views, `estimate_start` and all three inquiry key events under GTM Version 3. New church/promotion events need DebugView/Realtime confirmation. |
| GTM duplication | Website-side verified | Tests assert one Google tag on Initialization and exact-match triggers; no second Google tag is installed by the repository. |
| Purchase conversion validity | Website-side verified, live payment not run | Checkout readiness and event taxonomy are tested. No live card charge or purchase conversion has been produced. |
| Consent correctness | Verified | Analytics and GTM load only after explicit consent; preference withdrawal is implemented and browser-tested. |
| Google Ads readiness | Prepared, not active | No Google Ads account/spend is activated. $0 advertising spend remains in force. |
| Local SEO — Escambia/Santa Rosa FL and Baldwin/Escambia AL | Website-side verified | Four-county service-area content and 18-county map are present. Local ranking/GBP performance is not claimed. |

## Guardrails

- Do not recreate owner-completed Search Console or Business Profile links.
- Do not add a second Google tag.
- Do not send names, emails, phones, addresses, ZIPs, form contents or private customer data to GA4.
- Advertising remains $0 until a separate owner authorization.
- A reported link is not proof of data receipt; use GA4 Realtime/DebugView for the remaining checks.
