"""Score every Escambia County subdivision by recurring-cleaning likelihood.

Inputs (git-ignored cache):
  canvass-out/cache/parcels_sf.json        single-family parcels (public records)
  canvass-out/cache/subdivisions.geojson   published subdivision boundaries
  canvass-out/cache/acs_blockgroups.json   ACS block-group estimates
  canvass-out/cache/blockgroups.geojson    block-group boundaries

Outputs:
  canvass-out/neighborhood_scores.csv      every eligible subdivision, all metrics
  canvass-out/neighborhood_scores.json     same, for the route builder
  docs/marketing/CANVASSING-TOP-NEIGHBORHOODS.md  committed aggregate report

Scoring is objective and reproducible; the formula and thresholds are documented
in docs/marketing/CANVASSING-SYSTEM.md. The private operating origin is read
from .env only to compute a travel band; no coordinates are written anywhere.

Usage: python scripts/canvass/score_neighborhoods.py
"""

import csv
import json
import math
import os
import statistics

CACHE = os.path.join("canvass-out", "cache")
OUT_DIR = "canvass-out"
REPORT = os.path.join("docs", "marketing", "CANVASSING-TOP-NEIGHBORHOODS.md")

WEIGHTS = {
    "owner_occupancy": 25,
    "income": 15,
    "families_children": 15,
    "home_value": 15,
    "density": 15,
    "travel": 10,
    "detached": 5,
}


MARKERS = [" PB ", " DB ", " PDB ", " PLAT ", " UNIT ", " PHASE ", " ADDN ", " ADDITION ", " SEC ", " SECTION ", " REPLAT ", " AMENDED "]


def normalize_name(value):
    if not value:
        return ""
    text = value.upper().replace("&", " AND ")
    cleaned = "".join(character if character.isalnum() or character == " " else " " for character in text)
    return " ".join(cleaned.split())


def base_name(value):
    """Strip plat book/page and unit/phase suffixes to reach the base name."""
    out = value
    for marker in MARKERS:
        index = out.find(marker)
        if index > 0:
            out = out[:index]
    return out.strip()


def normalize_address(value):
    if not value:
        return ""
    text = value.upper()
    cleaned = "".join(character if character.isalnum() or character == " " else " " for character in text)
    return " ".join(cleaned.split())


def clamp01(value):
    return max(0.0, min(1.0, value))


def scale(value, low, high):
    if value is None:
        return 0.0
    if high == low:
        return 0.0
    return clamp01((value - low) / (high - low))


def ring_area_centroid(ring):
    area = 0.0
    cx = 0.0
    cy = 0.0
    count = len(ring)
    for index in range(count):
        x0, y0 = ring[index][0], ring[index][1]
        x1, y1 = ring[(index + 1) % count][0], ring[(index + 1) % count][1]
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    area *= 0.5
    if abs(area) < 1e-12:
        return 0.0, statistics.fmean(point[0] for point in ring), statistics.fmean(point[1] for point in ring)
    return abs(area), cx / (6 * area), cy / (6 * area)


def geometry_centroid(geometry):
    polygons = []
    if geometry["type"] == "Polygon":
        polygons = [geometry["coordinates"]]
    elif geometry["type"] == "MultiPolygon":
        polygons = geometry["coordinates"]
    total_area = 0.0
    weighted_x = 0.0
    weighted_y = 0.0
    for polygon in polygons:
        if not polygon:
            continue
        area, cx, cy = ring_area_centroid(polygon[0])
        total_area += area
        weighted_x += cx * area
        weighted_y += cy * area
    if total_area == 0:
        return None
    return weighted_x / total_area, weighted_y / total_area


def point_in_ring(point, ring):
    x, y = point
    inside = False
    count = len(ring)
    for index in range(count):
        x0, y0 = ring[index][0], ring[index][1]
        x1, y1 = ring[(index + 1) % count][0], ring[(index + 1) % count][1]
        if (y0 > y) != (y1 > y):
            intersection = (x1 - x0) * (y - y0) / (y1 - y0) + x0
            if x < intersection:
                inside = not inside
    return inside


def point_in_geometry(point, geometry):
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    for polygon in polygons:
        if polygon and point_in_ring(point, polygon[0]):
            return True
    return False


def haversine_miles(lat1, lon1, lat2, lon2):
    radius = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def read_origin():
    if not os.path.exists(".env"):
        return None
    for line in open(".env", encoding="utf-8"):
        if line.startswith("TRAVEL_ORIGIN"):
            _, _, value = line.partition("=")
            parts = value.strip().strip('"').split(",")
            if len(parts) == 2:
                return float(parts[0]), float(parts[1])
    return None


def travel_band(miles):
    if miles is None:
        return "unknown"
    if miles <= 5:
        return "0-5 mi"
    if miles <= 10:
        return "5-10 mi"
    if miles <= 15:
        return "10-15 mi"
    if miles <= 20:
        return "15-20 mi"
    return "20+ mi"


def main():
    parcels = json.load(open(os.path.join(CACHE, "parcels_sf.json"), encoding="utf-8"))
    subdivisions = json.load(open(os.path.join(CACHE, "subdivisions.geojson"), encoding="utf-8"))
    acs = json.load(open(os.path.join(CACHE, "acs_blockgroups.json"), encoding="utf-8"))["data"]
    blockgroups = json.load(open(os.path.join(CACHE, "blockgroups.geojson"), encoding="utf-8"))
    unmatched_path = os.path.join(CACHE, "unmatched_centroids.json")
    unmatched = json.load(open(unmatched_path, encoding="utf-8")) if os.path.exists(unmatched_path) else {}
    origin = read_origin()

    # Subdivision centroids, area-weighted per base name.
    centroid_parts = {}
    for feature in subdivisions["features"]:
        name = base_name(normalize_name(feature["properties"].get("NAME")))
        if not name:
            continue
        geometry = feature.get("geometry")
        if not geometry:
            continue
        centroid = geometry_centroid(geometry)
        if centroid is None:
            continue
        ring = geometry["coordinates"][0] if geometry["type"] == "Polygon" else geometry["coordinates"][0][0]
        area, _, _ = ring_area_centroid(ring)
        entry = centroid_parts.setdefault(name, [0.0, 0.0, 0.0])
        entry[0] += centroid[0] * area
        entry[1] += centroid[1] * area
        entry[2] += area
    layer_bases = sorted(centroid_parts, key=len, reverse=True)
    centroids = {
        name: (values[0] / values[2], values[1] / values[2])
        for name, values in centroid_parts.items()
        if values[2] > 0
    }

    def neighborhood_key(parcel_subdivision):
        normalized = normalize_name(parcel_subdivision)
        if not normalized:
            return ""
        base = base_name(normalized)
        for layer in layer_bases:
            if base == layer or base.startswith(layer + " "):
                return layer
        return base

    # Block-group lookup structures.
    bg_centroids = {}
    for feature in blockgroups["features"]:
        geoid = feature["properties"].get("geoid") or feature["properties"].get("GEOID")
        centroid = geometry_centroid(feature["geometry"])
        if geoid and centroid:
            bg_centroids[geoid] = centroid

    def find_blockgroup(point):
        for feature in blockgroups["features"]:
            geoid = feature["properties"].get("geoid") or feature["properties"].get("GEOID")
            if geoid and point_in_geometry(point, feature["geometry"]):
                return geoid
        best = None
        best_distance = float("inf")
        for geoid, centroid in bg_centroids.items():
            distance = haversine_miles(point[1], point[0], centroid[1], centroid[0])
            if distance < best_distance:
                best_distance = distance
                best = geoid
        return best

    # Parcel aggregation per subdivision.
    groups = {}
    for parcel in parcels:
        name = neighborhood_key(parcel.get("SUBDIVISION")) or "(UNPLATTED)"
        group = groups.setdefault(
            name,
            {"parcels": 0, "owner_occupied": 0, "values": [], "lots": [], "zips": {}},
        )
        group["parcels"] += 1
        homestead = "HOMESTEAD" in (parcel.get("EXEMPTION") or "").upper()
        site = normalize_address(parcel.get("SITEADDR"))
        mail = normalize_address(parcel.get("MAILADDRESS1"))
        mail_match = bool(site) and site == mail
        if homestead or mail_match:
            group["owner_occupied"] += 1
        value = parcel.get("CURRASDBLDG")
        if isinstance(value, (int, float)) and value > 0:
            group["values"].append(float(value))
        lot = parcel.get("LANDSIZE")
        if isinstance(lot, (int, float)) and lot > 0:
            group["lots"].append(float(lot))
        zip_code = (parcel.get("ZIP") or "").strip()[:5]
        if zip_code:
            group["zips"][zip_code] = group["zips"].get(zip_code, 0) + 1

    rows = []
    matched_centroids = 0
    for name, group in groups.items():
        if name == "(UNPLATTED)" or group["parcels"] < 40:
            continue
        centroid = centroids.get(name)
        if centroid is None:
            fallback = unmatched.get(name)
            if fallback is None:
                continue
            centroid = (fallback["lon"], fallback["lat"])
        matched_centroids += 1
        blockgroup = find_blockgroup(centroid)
        block = acs.get(blockgroup, {}) if blockgroup else {}

        def estimate(table, column):
            try:
                value = block[table]["estimate"][column]
                return float(value) if value is not None else None
            except (KeyError, TypeError):
                return None

        owner_rate = group["owner_occupied"] / group["parcels"]
        median_value = statistics.median(group["values"]) if group["values"] else None
        median_lot = statistics.median(group["lots"]) if group["lots"] else None
        income = estimate("B19013", "B19013001")
        households = estimate("B11003", "B11003001")
        children = None
        if households:
            children = (
                (estimate("B11003", "B11003004") or 0)
                + (estimate("B11003", "B11003011") or 0)
                + (estimate("B11003", "B11003017") or 0)
            )
        family_share = children / households if children is not None and households else None
        detached_total = estimate("B25024", "B25024001")
        detached = estimate("B25024", "B25024002")
        detached_share = detached / detached_total if detached and detached_total else None
        distance = haversine_miles(origin[0], origin[1], centroid[1], centroid[0]) if origin else None

        components = {
            "owner_occupancy": scale(owner_rate, 0.35, 0.90),
            "income": scale(income, 30000, 130000),
            "families_children": scale(family_share, 0.08, 0.45),
            "home_value": scale(median_value, 60000, 350000),
            "density": scale(math.log10(group["parcels"]), math.log10(50), math.log10(1000)),
            "travel": 1 - scale(distance, 0, 25) if distance is not None else 0.5,
            "detached": scale(detached_share, 0.5, 0.95),
        }
        score = round(sum(components[key] * WEIGHTS[key] for key in WEIGHTS), 1)

        zip_codes = sorted(group["zips"], key=group["zips"].get, reverse=True)
        rows.append(
            {
                "neighborhood": name,
                "zip_primary": zip_codes[0] if zip_codes else "",
                "zip_all": "|".join(zip_codes[:3]),
                "parcels": group["parcels"],
                "owner_occupied": group["owner_occupied"],
                "owner_occupancy_rate": round(owner_rate, 3),
                "median_bldg_value": round(median_value) if median_value else None,
                "median_lot_acres": round(median_lot, 2) if median_lot else None,
                "blockgroup": blockgroup or "",
                "median_hh_income": round(income) if income else None,
                "families_with_children_share": round(family_share, 3) if family_share else None,
                "detached_share": round(detached_share, 3) if detached_share else None,
                "distance_miles": round(distance, 1) if distance is not None else None,
                "travel_band": travel_band(distance),
                "score": score,
                **{f"c_{key}": round(value, 3) for key, value in components.items()},
            }
        )

    rows.sort(key=lambda row: (-row["score"], -row["parcels"]))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "neighborhood_scores.csv"), "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    with open(os.path.join(OUT_DIR, "neighborhood_scores.json"), "w", encoding="utf-8") as handle:
        json.dump(rows, handle, indent=1)

    # ZIP-area aggregation for context (parcel-weighted).
    zip_groups = {}
    for row in rows:
        zip_code = row["zip_primary"]
        if not zip_code:
            continue
        entry = zip_groups.setdefault(zip_code, {"weighted": 0.0, "parcels": 0, "subdivisions": 0})
        entry["weighted"] += row["score"] * row["parcels"]
        entry["parcels"] += row["parcels"]
        entry["subdivisions"] += 1
    zip_rows = sorted(
        (
            {"zip": zip_code, "score": round(entry["weighted"] / entry["parcels"], 1), **entry}
            for zip_code, entry in zip_groups.items()
            if entry["parcels"] >= 300
        ),
        key=lambda item: -item["score"],
    )

    # Committed aggregate report (no owner names, no coordinates, no exact origin).
    lines = [
        "# Top neighborhoods for recurring-cleaning canvassing (objective ranking)",
        "",
        "Generated by `scripts/canvass/score_neighborhoods.py` from public data: Escambia County",
        "Property Appraiser parcel records (single-family, DOR code 0100), published subdivision",
        "boundaries, and ACS 5-year block-group estimates via the Census Reporter API. Every",
        "eligible subdivision is scored; the data decides priority. Methodology:",
        "`docs/marketing/CANVASSING-SYSTEM.md`.",
        "",
        f"Eligible subdivisions scored: **{len(rows)}** (≥40 single-family parcels, mapped",
        f"boundaries; {matched_centroids} matched).",
        "",
        "## Top 20 neighborhoods (subdivisions)",
        "",
        "| Rank | Neighborhood | ZIP | SF homes | Owner-occ. | Median bldg value | Median HH income | Families w/ children | Travel band | Score |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows[:20]:
        lines.append(
            "| {rank} | {neighborhood} | {zip} | {parcels} | {owner:.0%} | ${value:,} | ${income:,} | {family:.0%} | {band} | **{score}** |".format(
                rank=row["rank"],
                neighborhood=row["neighborhood"].title(),
                zip=row["zip_primary"],
                parcels=row["parcels"],
                owner=row["owner_occupancy_rate"],
                value=row["median_bldg_value"] or 0,
                income=row["median_hh_income"] or 0,
                family=row["families_with_children_share"] or 0,
                band=row["travel_band"],
                score=row["score"],
            )
        )
    lines += [
        "",
        "## Top ZIP areas (parcel-weighted subdivision score, ≥300 SF homes)",
        "",
        "| Rank | ZIP | SF homes | Subdivisions | Score |",
        "| --- | --- | --- | --- | --- |",
    ]
    for index, row in enumerate(zip_rows[:15], start=1):
        lines.append(
            f"| {index} | {row['zip']} | {row['parcels']} | {row['subdivisions']} | **{row['score']}** |"
        )
    lines += [
        "",
        "## Where commonly assumed areas landed",
        "",
        "| Subdivision match | Rank | Score | SF homes |",
        "| --- | --- | --- | --- |",
    ]
    for keyword in ["CORDOVA", "EAST", "NORTH HILL", "SCENIC", "BEULAH", "KINGS", "HERITAGE"]:
        matches = [row for row in rows if keyword in row["neighborhood"]]
        if not matches:
            lines.append(f"| no subdivision name contains “{keyword}” | — | — | — |")
        else:
            best = matches[0]
            lines.append(f"| {best['neighborhood'].title()} | {best['rank']} | {best['score']} | {best['parcels']} |")
    lines += [
        "",
        "Assumptions to challenge: the ranking is parcel-data driven; owner-occupancy uses the",
        "homestead exemption plus a mailing-address match (a strong but imperfect proxy). Income,",
        "family and detached-share inputs come from ACS block groups (2019–2023 estimates). The",
        "travel band is measured from the private operating origin and is reported only as a band.",
        "",
    ]
    with open(REPORT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines))

    print(f"scored {len(rows)} subdivisions; top 5:")
    for row in rows[:5]:
        print(f"  {row['rank']:>2}. {row['neighborhood']} ({row['zip_primary']}) score={row['score']} homes={row['parcels']} owner={row['owner_occupancy_rate']:.0%}")
    print(f"wrote {REPORT}")


if __name__ == "__main__":
    main()
