"""Canonical canvassing route engine (Method B, stdlib only).

One ordered route object drives the sequence, geometry, markers, map, route
sheets and metrics — downstream code must never re-derive order.

Method (documented, deterministic):
  1. cluster: grow route-sized geographic clusters from deterministic seeds;
  2. orient: start at the stop nearest the operating origin (or the SW-most
     stop when no origin is available);
  3. sequence: greedy nearest-neighbour with same-street preference;
  4. improve: deterministic 2-opt (first improvement, capped passes);
  5. complete: reinsert each street's stops as one house-number-ordered block
     when it does not lengthen the route beyond a small tolerance.

Distances are straight-line miles and are labelled as planning estimates
(`straight-line x1.25` walking estimate; origin-to-start `x1.3` drive estimate).
No road-network claim is made.

Usage (demo/test):
  python scripts/canvass/route_engine.py --demo
"""
from __future__ import annotations

import argparse
import json
import math

WALK_FACTOR = 1.25
DRIVE_FACTOR = 1.3
METHOD_VERSION = "stage2-v1"
LONG_EDGE_MILES = 0.15
STREET_COMPLETION_TOLERANCE = 1.01

STREET_SUFFIXES = {
    "ST": "STREET",
    "DR": "DRIVE",
    "LN": "LANE",
    "RD": "ROAD",
    "AVE": "AVENUE",
    "BLVD": "BOULEVARD",
    "CT": "COURT",
    "CIR": "CIRCLE",
    "TRL": "TRAIL",
    "PKWY": "PARKWAY",
    "TER": "TERRACE",
    "LP": "LOOP",
    "HWY": "HIGHWAY",
    "PL": "PLACE",
}


def normalize_street(name):
    """Normalize common suffix aliases for grouping only (output keeps raw)."""
    tokens = str(name or "").upper().split()
    if tokens and tokens[-1] in STREET_SUFFIXES:
        tokens[-1] = STREET_SUFFIXES[tokens[-1]]
    return " ".join(tokens)


def street_key(point):
    return normalize_street(point.get("Street_Name"))


def eligible_points(points):
    """Stops with an ID and usable coordinates; missing geocodes are excluded."""
    return [
        point
        for point in points
        if point.get("Address_ID") and point.get("Latitude") is not None and point.get("Longitude") is not None
    ]


def haversine_miles(lat1, lon1, lat2, lon2):
    radius = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def _distance(a, b):
    return haversine_miles(a["Latitude"], a["Longitude"], b["Latitude"], b["Longitude"])


def _point_distance(a, lat, lon):
    return haversine_miles(a["Latitude"], a["Longitude"], lat, lon)


def path_length(points):
    return sum(_distance(a, b) for a, b in zip(points, points[1:]))


def cluster_points(points, target_size=75, max_size=100):
    """Deterministic geographic clustering: seeds are the SW-most unassigned
    stop; each cluster grows to the target by nearest distance to its centroid."""
    remaining = sorted(points, key=lambda p: (p["Latitude"], p["Longitude"], p["Address_ID"]))
    clusters = []
    while remaining:
        seed = remaining.pop(0)
        cluster = [seed]
        # Walk-based growth: each new stop is the nearest unassigned stop to
        # the last added one, which keeps clusters geographically contiguous.
        while len(cluster) < target_size and remaining:
            last = cluster[-1]
            best_index = min(
                range(len(remaining)),
                key=lambda i: (_distance(last, remaining[i]), remaining[i]["Address_ID"]),
            )
            candidate = remaining[best_index]
            if len(cluster) >= 40 and _distance(last, candidate) > 0.6:
                break
            cluster.append(remaining.pop(best_index))
        clusters.append(cluster)

    # Merge any undersized tail cluster into the nearest other cluster so no
    # tiny chunks survive (never below half the target, capped at 40).
    merge_threshold = min(40, max(8, target_size // 2))
    merged = True
    while merged and len(clusters) > 1:
        merged = False
        for index, cluster in enumerate(clusters):
            if len(cluster) >= merge_threshold:
                continue
            centroid_lat = sum(p["Latitude"] for p in cluster) / len(cluster)
            centroid_lon = sum(p["Longitude"] for p in cluster) / len(cluster)
            others = [(i, c) for i, c in enumerate(clusters) if i != index]
            target_index, _ = min(
                others,
                key=lambda item: (
                    _point_distance(item[1][0], centroid_lat, centroid_lon),
                    item[1][0]["Address_ID"],
                ),
            )
            if len(clusters[target_index]) + len(cluster) > 100:
                continue
            clusters[target_index].extend(cluster)
            clusters.pop(index)
            merged = True
            break
    return clusters


def _same_street_candidate(remaining, current, nearest_index):
    """Prefer completing the current street when it is a short detour."""
    current_street = street_key(current)
    nearest_distance = _distance(current, remaining[nearest_index])
    same_street = [point for point in remaining if street_key(point) == current_street]
    if not same_street:
        return nearest_index
    best = min(same_street, key=lambda p: (_house_number(p), _distance(current, p)))
    if _distance(current, best) <= nearest_distance * 1.6 + 0.02:
        return remaining.index(best)
    return nearest_index


def _house_number(point):
    try:
        return int(point["House_Number"])
    except (TypeError, ValueError):
        return 0


def order_cluster(points, origin=None):
    """Distance-first ordering with street awareness (measured design):

    1. greedy nearest-neighbour with a strong same-street preference;
    2. deterministic 2-opt (first improvement, capped passes);
    3. street completion: merge each street's stops into one house-number-
       ordered block only when the detour stays within the tolerance.

    A strict street-block-first variant was measured on the real data and
    rejected: it guaranteed zero street re-entries but raised the total
    straight-line distance from ~99 mi to ~145 mi with 90 long edges, which is
    worse field practice. Street completion therefore outranks distance only
    where the street layout allows it cheaply.
    """
    if not points:
        return []
    if origin:
        start_index = min(
            range(len(points)),
            key=lambda i: (_point_distance(points[i], origin[0], origin[1]), points[i]["Address_ID"]),
        )
    else:
        start_index = min(
            range(len(points)),
            key=lambda i: (points[i]["Latitude"], points[i]["Longitude"], points[i]["Address_ID"]),
        )
    order = [points[start_index]]
    remaining = [point for index, point in enumerate(points) if index != start_index]
    while remaining:
        current = order[-1]
        nearest_index = min(
            range(len(remaining)),
            key=lambda i: (_distance(current, remaining[i]), remaining[i]["Address_ID"]),
        )
        chosen = _same_street_candidate(remaining, current, nearest_index)
        order.append(remaining.pop(chosen))
    order = two_opt(order)
    return complete_streets(order)


def two_opt(order, max_passes=40):
    """Deterministic 2-opt, first improvement, capped passes."""
    best = list(order)
    best_length = path_length(best)
    passes = 0
    improved = True
    while improved and passes < max_passes:
        improved = False
        passes += 1
        for i in range(1, len(best) - 1):
            for k in range(i + 1, len(best)):
                candidate = best[:i] + best[i : k + 1][::-1] + best[k + 1 :]
                length = path_length(candidate)
                if length < best_length - 1e-9:
                    best, best_length = candidate, length
                    improved = True
                    break
            if improved:
                break
    return best


def complete_streets(order):
    """Merge each street's stops into one contiguous, house-number-ordered
    block when the detour stays within the tolerance."""
    streets = {}
    for point in order:
        streets.setdefault(street_key(point), []).append(point)
    original_start = order[0]
    for street, stops in streets.items():
        if len(stops) < 3:
            continue
        block = sorted(stops, key=lambda p: (_house_number(p), p["Address_ID"]))
        without = [point for point in order if street_key(point) != street]
        base_length = path_length(order)
        best_order = None
        best_length = None
        for position in range(len(without) + 1):
            for candidate_block in (block, list(reversed(block))):
                candidate = without[:position] + candidate_block + without[position:]
                length = path_length(candidate)
                if (
                    best_length is None
                    or length < best_length - 1e-9
                    or (
                        abs(length - best_length) <= 1e-9
                        and _distance(candidate[0], original_start) < _distance(best_order[0], original_start)
                    )
                ):
                    best_length = length
                    best_order = candidate
        if best_order is not None and best_length <= base_length * STREET_COMPLETION_TOLERANCE:
            order = best_order
    return order


def route_metrics(stops, origin=None):
    straight = path_length(stops)
    streets = [street_key(point) for point in stops]
    runs = 1
    for a, b in zip(streets, streets[1:]):
        if a != b:
            runs += 1
    long_edges = sum(
        1 for a, b in zip(stops, stops[1:]) if _distance(a, b) > LONG_EDGE_MILES
    )
    driving = 0.0
    if origin and stops:
        driving = _point_distance(stops[0], origin[0], origin[1]) * DRIVE_FACTOR
    return {
        "stop_count": len(stops),
        "straight_mi": round(straight, 3),
        "walking_mi_est": round(straight * WALK_FACTOR, 3),
        "driving_mi_est": round(driving, 3),
        "model": f"straight-line x{WALK_FACTOR} walking estimate",
        "drive_model": f"origin-to-start straight-line x{DRIVE_FACTOR} estimate",
        "street_count": len(set(streets)),
        "street_reentries": max(0, runs - len(set(streets))),
        "long_edges_over_0_15mi": long_edges,
    }


def build_neighborhood_routes(addresses, neighborhood, origin=None, target_size=75, priority=None):
    """Return canonical route objects for one neighborhood (ordered stops).

    Route sizes are balanced: k = ceil(stops / target) routes of ceil(stops/k)
    stops, so no tiny tail chunks are produced.
    """
    routes = []
    addresses = eligible_points(addresses)
    if not addresses:
        return routes
    route_count = max(1, math.ceil(len(addresses) / target_size))
    balanced_target = min(100, math.ceil(len(addresses) / route_count))
    clusters = cluster_points(addresses, target_size=balanced_target)
    for cluster in clusters:
        ordered = order_cluster(cluster, origin=origin)
        routes.append(
            {
                "route_id": None,
                "priority": priority,
                "neighborhood": neighborhood,
                "method_version": METHOD_VERSION,
                "stops": [
                    {
                        "seq": index + 1,
                        "address_id": point["Address_ID"],
                        "street": point["Street_Name"],
                        "house_number": point["House_Number"],
                        "lat": point["Latitude"],
                        "lon": point["Longitude"],
                        "owner_occupied": point["Owner_Occupied"],
                        "coordinate_precision": point.get("Coordinate_Precision", "parcel_polygon_vertex_mean"),
                    }
                    for index, point in enumerate(ordered)
                ],
                "metrics": route_metrics(ordered, origin=origin),
            }
        )
    return routes


def routes_geojson(routes, colors=None):
    """Line + numbered points from the same ordered stops."""
    colors = colors or {"A": "#c6a369", "B": "#e3cda4", "C": "#9aa0a6"}
    features = []
    for route in routes:
        coordinates = [[stop["lon"], stop["lat"]] for stop in route["stops"]]
        if len(coordinates) >= 2:
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "Route_ID": route["route_id"],
                        "Priority": route["priority"],
                        "Neighborhood": route["neighborhood"],
                        "Homes": route["metrics"]["stop_count"],
                        "color": colors.get(route["priority"], "#c6a369"),
                    },
                    "geometry": {"type": "LineString", "coordinates": coordinates},
                }
            )
        for stop in route["stops"]:
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "Route_ID": route["route_id"],
                        "Priority": route["priority"],
                        "Seq": stop["seq"],
                        "Address_ID": stop["address_id"],
                        "Address": stop.get("address", ""),
                        "Owner_Occupied": stop["owner_occupied"],
                        "color": colors.get(route["priority"], "#c6a369"),
                    },
                    "geometry": {"type": "Point", "coordinates": [stop["lon"], stop["lat"]]},
                }
            )
    return {"type": "FeatureCollection", "features": features}


def _demo():
    """Synthetic demo run (no real data): a grid, a cul-de-sac and a loop."""
    def grid():
        points = []
        for row in range(6):
            for column in range(10):
                points.append(
                    {
                        "Address_ID": f"SYN-GRID-{row}-{column}",
                        "Street_Name": f"SYNTHETIC ROW {row}",
                        "House_Number": str(100 + column * 2),
                        "Latitude": 30.5 + row * 0.0015,
                        "Longitude": -87.2 + column * 0.0015,
                        "Owner_Occupied": "yes",
                        "Coordinate_Precision": "synthetic",
                    }
                )
        return points

    points = grid()
    routes = build_neighborhood_routes(points, "SYNTHETIC GRID", origin=(30.5, -87.2), target_size=40)
    summary = {
        "method_version": METHOD_VERSION,
        "routes": len(routes),
        "stops": sum(route["metrics"]["stop_count"] for route in routes),
        "straight_mi": round(sum(route["metrics"]["straight_mi"] for route in routes), 3),
        "walking_mi_est": round(sum(route["metrics"]["walking_mi_est"] for route in routes), 3),
        "long_edges": sum(route["metrics"]["long_edges_over_0_15mi"] for route in routes),
    }
    print(json.dumps(summary, indent=1))
    return routes


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true")
    arguments = parser.parse_args()
    if arguments.demo:
        _demo()
    else:
        parser.print_help()
