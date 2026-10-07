"""Build the canvassing deliverables from the canonical route object:

  canvass-out/Canvassing-Workbook.xlsx    multi-tab workbook (stdlib writer)
  canvass-out/route_sheets.html           printable route sheets (one per page)
  canvass-out/performance_tracking.csv    per-address tracking template
  canvass-out/map.html                    interactive route map (MapLibre)

Every sheet, row and map geometry derives from the same ordered stops in
canvass-out/route_object.json — order is never re-derived.

Usage: python scripts/canvass/build_outputs.py
"""

import csv
import datetime
import html
import json
import os
import zipfile
from xml.sax.saxutils import escape

OUT = "canvass-out"

TRACKING_COLUMNS = [
    "Door_Knocked",
    "No_Answer",
    "Conversation",
    "Homeowner",
    "Interested",
    "Phone_Captured",
    "Estimate_Requested",
    "Estimate_Sent",
    "Booked",
    "Recurring_Customer",
    "Retention_Status",
    "Revenue",
    "Notes",
    "Follow_Up_Date",
]


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def load_canonical():
    with open(os.path.join(OUT, "route_object.json"), encoding="utf-8") as handle:
        return json.load(handle)


def ordered_rows(route_object):
    rows = []
    for route in route_object["routes"]:
        for stop in route["stops"]:
            rows.append(
                {
                    "Route_ID": route["route_id"],
                    "Priority": route["priority"],
                    "Neighborhood": route["neighborhood"],
                    "Seq": stop["seq"],
                    "Address_ID": stop["address_id"],
                    "Full_Address": stop.get("address", ""),
                    "Owner_Occupied": stop["owner_occupied"],
                }
            )
    return rows


def column_letter(index):
    letters = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def sheet_xml(rows):
    body = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row):
            reference = f"{column_letter(column_index)}{row_index}"
            style = ' s="1"' if row_index == 1 else ""
            text = escape("" if value is None else str(value))
            cells.append(f'<c r="{reference}" t="inlineStr"{style}><is><t xml:space="preserve">{text}</t></is></c>')
        body.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(body)}</sheetData></worksheet>'
    )


def write_xlsx(path, sheets):
    content_types = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ]
    for index in range(len(sheets)):
        content_types.append(
            f'<Override PartName="/xl/worksheets/sheet{index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    content_types.append("</Types>")

    workbook_sheets = "".join(
        f'<sheet name="{escape(name)}" sheetId="{index + 1}" r:id="rId{index + 1}"/>'
        for index, (name, _) in enumerate(sheets)
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{workbook_sheets}</sheets></workbook>"
    )

    relationships = "".join(
        f'<Relationship Id="rId{index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index + 1}.xml"/>'
        for index in range(len(sheets))
    )
    relationships += (
        f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{relationships}</Relationships>"
    )

    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )

    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        '<borders count="1"><border/></borders>'
        '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs>'
        "</styleSheet>"
    )

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "".join(content_types))
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/styles.xml", styles)
        for index, (_, rows) in enumerate(sheets):
            archive.writestr(f"xl/worksheets/sheet{index + 1}.xml", sheet_xml(rows))


def main():
    route_object = load_canonical()
    rows = ordered_rows(route_object)
    scores = json.load(open(os.path.join(OUT, "neighborhood_scores.json"), encoding="utf-8"))
    routes = read_csv(os.path.join(OUT, "routes.csv"))
    master = read_csv(os.path.join(OUT, "master_addresses.csv"))

    neighborhood_rows = [
        [
            "Rank",
            "Neighborhood",
            "ZIP",
            "SF homes",
            "Owner-occupied %",
            "Median bldg value",
            "Median HH income",
            "Families w/ children %",
            "Detached %",
            "Travel band",
            "Score",
        ]
    ]
    for row in scores[:50]:
        neighborhood_rows.append(
            [
                row["rank"],
                row["neighborhood"].title(),
                row["zip_primary"],
                row["parcels"],
                f"{row['owner_occupancy_rate'] * 100:.0f}%",
                row["median_bldg_value"] or "",
                row["median_hh_income"] or "",
                f"{(row['families_with_children_share'] or 0) * 100:.0f}%",
                f"{(row['detached_share'] or 0) * 100:.0f}%",
                row["travel_band"],
                row["score"],
            ]
        )

    route_header = list(routes[0].keys())
    route_rows = [route_header] + [[route[column] for column in route_header] for route in routes]

    address_header = list(master[0].keys())
    address_rows = [address_header] + [[address[column] for column in address_header] for address in master]

    route_sheet_rows = [["Route_ID", "Seq", "Priority", "Neighborhood", "Full_Address", "Result", "Notes", "Follow_Up"]]
    for row in rows:
        route_sheet_rows.append(
            [row["Route_ID"], row["Seq"], row["Priority"], row["Neighborhood"], row["Full_Address"], "", "", ""]
        )

    tracking_header = ["Address_ID", "Route_ID", "Seq", "Neighborhood", "Full_Address", "Owner_Occupied"] + TRACKING_COLUMNS
    tracking_rows = [tracking_header] + [
        [
            row["Address_ID"],
            row["Route_ID"],
            row["Seq"],
            row["Neighborhood"],
            row["Full_Address"],
            row["Owner_Occupied"],
        ]
        + [""] * len(TRACKING_COLUMNS)
        for row in rows
    ]

    write_xlsx(
        os.path.join(OUT, "Canvassing-Workbook.xlsx"),
        [
            ("Neighborhood Summary", neighborhood_rows),
            ("Route Summary", route_rows),
            ("Master Address List", address_rows),
            ("Route Sheets", route_sheet_rows),
            ("Performance Tracking", tracking_rows),
        ],
    )

    # Printable route sheets (one route per page), canonical order.
    generated = datetime.date.today().isoformat()
    method = route_object.get("method_version", "stage2-v1")
    pages = []
    for route in route_object["routes"]:
        route_rows_for_sheet = [row for row in rows if row["Route_ID"] == route["route_id"]]
        metrics = route["metrics"]
        table_rows = "".join(
            f'<tr><td class="num">{row["Seq"]}</td><td>{html.escape(row["Full_Address"])}</td>'
            f'<td class="box"></td><td class="notes"></td><td class="box"></td></tr>'
            for row in route_rows_for_sheet
        )
        pages.append(
            f"""<section class="route">
  <header>
    <h1>Route {html.escape(route['route_id'])} <span class="priority">Priority {html.escape(route['priority'])}</span></h1>
    <p><strong>{html.escape(route['neighborhood'])}</strong> · {metrics['stop_count']} homes ·
    walking ≈ {metrics['walking_mi_est']} mi · driving ≈ {metrics['driving_mi_est']} mi</p>
    <p class="meta">Generated {generated} · method {html.escape(method)} · distance model: {html.escape(metrics['model'])} ·
    map: <a href="map.html#route={html.escape(route['route_id'])}">map.html → {html.escape(route['route_id'])}</a></p>
    <p class="start">Start: {html.escape(route['start_address'])} → End: {html.escape(route['end_address'])}</p>
  </header>
  <table>
    <thead><tr><th>#</th><th>Address</th><th>Result</th><th>Notes</th><th>Follow-up</th></tr></thead>
    <tbody>{table_rows}</tbody>
  </table>
</section>"""
        )
    html_document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sparkling Standard — Route Sheets</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 0; color: #2f2a2e; }}
  section.route {{ page-break-after: always; padding: 18px 22px; }}
  h1 {{ font-size: 20px; margin: 0 0 4px; }}
  .priority {{ font-size: 12px; background: #f3e7d3; border: 1px solid #c6a369; border-radius: 999px; padding: 2px 10px; vertical-align: middle; }}
  p {{ margin: 2px 0; font-size: 12px; }}
  p.meta {{ color: #6f5f57; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
  th, td {{ border: 1px solid #cfc4bb; padding: 5px 6px; font-size: 12px; text-align: left; }}
  th {{ background: #faf6f1; }}
  td.num {{ width: 28px; color: #8a8188; }}
  td.box {{ width: 70px; }}
  td.notes {{ width: 34%; }}
  @media print {{ section.route {{ padding: 10px 12px; }} }}
</style></head><body>{''.join(pages)}</body></html>"""
    with open(os.path.join(OUT, "route_sheets.html"), "w", encoding="utf-8") as handle:
        handle.write(html_document)

    with open(os.path.join(OUT, "performance_tracking.csv"), "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerows(tracking_rows)

    # Interactive map — canonical geometry, numbered markers, escaped popups,
    # priority filter, route jump, tile-failure notice.
    geojson = json.load(open(os.path.join(OUT, "routes.geojson"), encoding="utf-8"))
    route_ids = [route["route_id"] for route in route_object["routes"]]
    map_document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sparkling Standard — Canvassing Routes</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<style>
  html,body,#map{{height:100%;margin:0}}
  .legend{{position:absolute;top:12px;left:12px;background:#fff;padding:10px 12px;border-radius:10px;font:13px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.15);max-width:250px}}
  .legend b{{display:block;margin-bottom:4px}}
  .legend label{{display:block;margin-top:3px}}
  #routeSelect{{margin-top:6px;width:100%;font:13px system-ui;padding:3px}}
  #tileNotice{{position:absolute;bottom:12px;left:12px;right:12px;background:#fff4f4;border:1px solid #8f2f2f;color:#8f2f2f;padding:8px 12px;border-radius:8px;font:13px system-ui;display:none}}
</style>
</head><body><div id="map"></div>
<div class="legend"><b>Route priority</b>
  <label><input type="checkbox" class="prio" value="A" checked> <span style="color:#a98545">●</span> A — highest value</label>
  <label><input type="checkbox" class="prio" value="B" checked> <span style="color:#c6a369">●</span> B — strong</label>
  <label><input type="checkbox" class="prio" value="C" checked> <span style="color:#8a8188">●</span> C — lower</label>
  <label for="routeSelect">Jump to route</label>
  <select id="routeSelect"><option value="">All routes</option>{''.join(f'<option value="{rid}">{rid}</option>' for rid in route_ids)}</select>
</div>
<div id="tileNotice">Map tiles are unavailable (offline?). The route sheets remain authoritative.</div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
const data = {json.dumps(geojson)};
let tilesFailed = false;
const map = new maplibregl.Map({{ container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty', center: [-87.28, 30.55], zoom: 10 }});
map.on('error', () => {{ if (!tilesFailed) {{ tilesFailed = true; document.getElementById('tileNotice').style.display = 'block'; }} }});
map.on('load', () => {{
  map.addSource('routes', {{ type: 'geojson', data }});
  const color = ['coalesce', ['get', 'color'], '#c6a369'];
  map.addLayer({{ id: 'route-lines', type: 'line', source: 'routes', filter: ['==', ['geometry-type'], 'LineString'], paint: {{ 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.8 }} }});
  map.addLayer({{ id: 'route-points', type: 'circle', source: 'routes', filter: ['==', ['geometry-type'], 'Point'], paint: {{ 'circle-color': color, 'circle-radius': 5, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 }} }});
  map.addLayer({{ id: 'route-numbers', type: 'symbol', source: 'routes', minzoom: 13, filter: ['==', ['geometry-type'], 'Point'], layout: {{ 'text-field': ['to-string', ['coalesce', ['get', 'Seq'], '']], 'text-size': 11, 'text-font': ['Noto Sans Regular'] }}, paint: {{ 'text-color': '#302429', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 }} }});
  map.on('click', 'route-points', (event) => {{ const p = event.features[0].properties; new maplibregl.Popup().setLngLat(event.lngLat).setText(p.Route_ID + ' · stop ' + p.Seq).addTo(map); }});
  const applyFilter = () => {{
    const active = [...document.querySelectorAll('.prio')].filter((c) => c.checked).map((c) => c.value);
    const routeId = document.getElementById('routeSelect').value;
    const filter = ['all', ['in', ['get', 'Priority'], ['literal', active]]];
    if (routeId) filter.push(['==', ['get', 'Route_ID'], routeId]);
    map.setFilter('route-lines', filter);
    map.setFilter('route-points', filter);
    map.setFilter('route-numbers', filter);
  }};
  document.querySelectorAll('.prio').forEach((box) => box.addEventListener('change', applyFilter));
  document.getElementById('routeSelect').addEventListener('change', applyFilter);
  const hash = location.hash.match(/route=([A-Z]-\\d+)/);
  if (hash) {{ document.getElementById('routeSelect').value = hash[1]; applyFilter(); }}
}});
</script></body></html>"""
    with open(os.path.join(OUT, "map.html"), "w", encoding="utf-8") as handle:
        handle.write(map_document)

    print("wrote:")
    for name in ["Canvassing-Workbook.xlsx", "route_sheets.html", "performance_tracking.csv", "map.html"]:
        path = os.path.join(OUT, name)
        print(f"  {path} ({os.path.getsize(path) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
