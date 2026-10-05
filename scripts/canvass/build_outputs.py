"""Build the canvassing deliverables from the route data:
  canvass-out/Canvassing-Workbook.xlsx    multi-tab workbook (stdlib writer)
  canvass-out/route_sheets.html           printable route sheets (one per page)
  canvass-out/performance_tracking.csv    per-address tracking template
  canvass-out/map.html                    interactive route map (MapLibre)

Usage: python scripts/canvass/build_outputs.py
"""

import csv
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
    scores = json.load(open(os.path.join(OUT, "neighborhood_scores.json"), encoding="utf-8"))
    addresses = read_csv(os.path.join(OUT, "master_addresses.csv"))
    routes = read_csv(os.path.join(OUT, "routes.csv"))

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

    address_header = list(addresses[0].keys())
    address_rows = [address_header] + [[address[column] for column in address_header] for address in addresses]

    route_sheet_rows = [["Route_ID", "Priority", "Neighborhood", "Full_Address", "Result", "Notes", "Follow_Up"]]
    for route in routes:
        for address in addresses:
            if address["Route_ID"] == route["Route_ID"]:
                route_sheet_rows.append(
                    [route["Route_ID"], route["Priority"], route["Neighborhood"], address["Full_Address"], "", "", ""]
                )

    tracking_header = ["Address_ID", "Route_ID", "Neighborhood", "Full_Address", "Owner_Occupied"] + TRACKING_COLUMNS
    tracking_rows = [tracking_header] + [
        [
            address["Address_ID"],
            address["Route_ID"],
            address["Neighborhood"],
            address["Full_Address"],
            address["Owner_Occupied"],
        ]
        + [""] * len(TRACKING_COLUMNS)
        for address in addresses
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

    # Printable route sheets (one route per page).
    pages = []
    for route in routes:
        route_addresses = [address for address in addresses if address["Route_ID"] == route["Route_ID"]]
        rows = "".join(
            f"<tr><td class=\"num\">{index}</td><td>{html.escape(address['Full_Address'])}</td>"
            f"<td class=\"box\"></td><td class=\"notes\"></td><td class=\"box\"></td></tr>"
            for index, address in enumerate(route_addresses, start=1)
        )
        pages.append(
            f"""<section class="route">
  <header>
    <h1>Route {html.escape(route['Route_ID'])} <span class="priority">Priority {html.escape(route['Priority'])}</span></h1>
    <p><strong>{html.escape(route['Neighborhood'])}</strong> · {route['Estimated_Home_Count']} homes ·
    walking ≈ {route['Estimated_Walking_Distance_Miles']} mi · driving ≈ {route['Estimated_Driving_Distance_Miles']} mi</p>
    <p class="start">Start: {html.escape(route['Start_Address'])} → End: {html.escape(route['End_Address'])}</p>
  </header>
  <table>
    <thead><tr><th>#</th><th>Address</th><th>Result</th><th>Notes</th><th>Follow-up</th></tr></thead>
    <tbody>{rows}</tbody>
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

    # Performance tracking template (CSV).
    with open(os.path.join(OUT, "performance_tracking.csv"), "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerows(tracking_rows)

    # Interactive map (MapLibre GL + OpenFreeMap tiles, route GeoJSON embedded).
    geojson = json.load(open(os.path.join(OUT, "routes.geojson"), encoding="utf-8"))
    map_document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sparkling Standard — Canvassing Routes</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<style>html,body,#map{{height:100%;margin:0}} .legend{{position:absolute;top:12px;left:12px;background:#fff;padding:10px 12px;border-radius:10px;font:13px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.15)}} .legend b{{display:block;margin-bottom:4px}}</style>
</head><body><div id="map"></div>
<div class="legend"><b>Route priority</b><span style="color:#a98545">●</span> A — highest value<br><span style="color:#c6a369">●</span> B — strong<br><span style="color:#8a8188">●</span> C — lower</div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
const data = {json.dumps(geojson)};
const map = new maplibregl.Map({{ container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty', center: [-87.28, 30.55], zoom: 10 }});
map.on('load', () => {{
  map.addSource('routes', {{ type: 'geojson', data }});
  map.addLayer({{ id: 'route-lines', type: 'line', source: 'routes', filter: ['==', ['geometry-type'], 'LineString'], paint: {{ 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.8 }} }});
  map.addLayer({{ id: 'route-points', type: 'circle', source: 'routes', filter: ['==', ['geometry-type'], 'Point'], paint: {{ 'circle-color': ['get', 'color'], 'circle-radius': 4, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 }} }});
  map.on('click', 'route-points', (event) => {{ const p = event.features[0].properties; new maplibregl.Popup().setLngLat(event.lngLat).setHTML('<strong>' + p.Route_ID + '</strong><br>' + p.Address).addTo(map); }});
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
