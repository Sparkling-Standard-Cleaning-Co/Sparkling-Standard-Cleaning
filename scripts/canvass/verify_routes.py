"""Verify the canonical route pipeline outputs (local-only, aggregate report).

Checks, from the actual generated artifacts:
  1. coverage: every stop exactly once; contiguous sequence numbers;
  2. master_addresses.csv row order equals the canonical route object order;
  3. routes.geojson line/marker geometry equals the canonical stop order;
  4. route_sheets.html first/last address per route matches the canonical object;
  5. metric model consistency (walking = straight x 1.25, rounded);
  6. workload bounds (routes 40-100 stops; smaller tails reported).

Usage: python scripts/canvass/verify_routes.py
Prints JSON and exits non-zero on any failure.
"""
import csv
import html as html_module
import json
import os
import re
import sys

OUT = "canvass-out"
WALK_FACTOR = 1.25


def main():
    with open(os.path.join(OUT, "route_object.json"), encoding="utf-8") as handle:
        route_object = json.load(handle)
    routes = route_object["routes"]
    with open(os.path.join(OUT, "master_addresses.csv"), newline="", encoding="utf-8") as handle:
        master = list(csv.DictReader(handle))
    with open(os.path.join(OUT, "routes.geojson"), encoding="utf-8") as handle:
        geojson = json.load(handle)
    with open(os.path.join(OUT, "route_sheets.html"), encoding="utf-8") as handle:
        sheets_html = handle.read()

    failures = []

    # 1. Coverage + contiguous sequence.
    seen = set()
    duplicates = 0
    stop_total = 0
    for route in routes:
        sequences = [stop["seq"] for stop in route["stops"]]
        if sequences != list(range(1, len(sequences) + 1)):
            failures.append(f"{route['route_id']}: sequence is not contiguous")
        for stop in route["stops"]:
            stop_total += 1
            if stop["address_id"] in seen:
                duplicates += 1
            seen.add(stop["address_id"])
    if duplicates:
        failures.append(f"{duplicates} duplicate stop(s)")
    if stop_total != len(master):
        failures.append(f"stop total {stop_total} != master rows {len(master)}")

    # 2. Master order.
    expected = []
    for route in routes:
        for stop in route["stops"]:
            expected.append((stop["address_id"], str(stop["seq"]), route["route_id"]))
    actual = [(row["Address_ID"], str(row["Sequence"]), row["Route_ID"]) for row in master]
    if expected != actual:
        for index, (want, got) in enumerate(zip(expected, actual)):
            if want != got:
                failures.append(f"master order mismatch at row {index + 1}: {want} != {got}")
                break

    # 3. GeoJSON geometry.
    lines = {}
    points = {}
    for feature in geojson["features"]:
        geometry = feature["geometry"]
        if geometry["type"] == "LineString":
            lines[feature["properties"]["Route_ID"]] = geometry["coordinates"]
        else:
            points.setdefault(feature["properties"]["Route_ID"], []).append(
                (feature["properties"]["Seq"], tuple(geometry["coordinates"]))
            )
    for route in routes:
        expected_coords = [[stop["lon"], stop["lat"]] for stop in route["stops"]]
        line = lines.get(route["route_id"])
        if line != expected_coords:
            failures.append(f"{route['route_id']}: geojson line does not match stop order")
        marker_seqs = [seq for seq, _ in sorted(points.get(route["route_id"], []), key=lambda item: item[0])]
        if marker_seqs != list(range(1, len(route["stops"]) + 1)):
            failures.append(f"{route['route_id']}: geojson marker sequence mismatch")

    # 4. Route sheets first/last address.
    sections = re.findall(r'<section class="route">(.*?)</section>', sheets_html, re.S)
    if len(sections) != len(routes):
        failures.append(f"route sheets: {len(sections)} sections for {len(routes)} routes")
    for section, route in zip(sections, routes):
        addresses = re.findall(r'<td class="num">\d+</td><td>(.*?)</td>', section)
        addresses = [html_module.unescape(value) for value in addresses]
        if not addresses:
            failures.append(f"{route['route_id']}: route sheet has no addresses")
            continue
        if addresses[0] != route["start_address"] or addresses[-1] != route["end_address"]:
            failures.append(f"{route['route_id']}: route sheet order does not match the canonical object")

    # 5. Metric model consistency.
    for route in routes:
        metrics = route["metrics"]
        expected_walking = round(metrics["straight_mi"] * WALK_FACTOR, 3)
        if abs(metrics["walking_mi_est"] - expected_walking) > 0.002:
            failures.append(f"{route['route_id']}: walking estimate does not match straight x{WALK_FACTOR}")

    # 6. Workload bounds.
    sizes = [route["metrics"]["stop_count"] for route in routes]
    tails = [route["route_id"] for route in routes if route["metrics"]["stop_count"] < 40]

    summary = {
        "method_version": route_object.get("method_version"),
        "routes": len(routes),
        "stops": stop_total,
        "duplicates": duplicates,
        "size_min": min(sizes) if sizes else 0,
        "size_max": max(sizes) if sizes else 0,
        "tail_routes_under_40": tails,
        "straight_mi": round(sum(route["metrics"]["straight_mi"] for route in routes), 1),
        "walking_mi_est": round(sum(route["metrics"]["walking_mi_est"] for route in routes), 1),
        "long_edges_over_0_15mi": sum(route["metrics"]["long_edges_over_0_15mi"] for route in routes),
        "street_reentries": sum(route["metrics"]["street_reentries"] for route in routes),
        "failures": failures,
        "ok": not failures,
    }
    print(json.dumps(summary, indent=1))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
