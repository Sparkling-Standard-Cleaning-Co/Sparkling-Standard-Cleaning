"""Route engine tests — synthetic fixtures only, no real data.

Run: python -m unittest discover -s tests/routes -p "test_*.py" -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "canvass"))

import fixtures  # noqa: E402
import route_engine  # noqa: E402


def sequences(routes):
    return [[stop["address_id"] for stop in route["stops"]] for route in routes]


class CoverageTests(unittest.TestCase):
    def test_every_eligible_stop_exactly_once_and_contiguous(self):
        for name in [
            "grid",
            "loop",
            "cul_de_sac",
            "parallel_streets",
            "divided_road",
            "barrier",
            "suffix_alias",
            "duplicate_coordinates",
            "cluster_boundary",
            "orientation",
        ]:
            points = getattr(fixtures, name)()
            routes = route_engine.build_neighborhood_routes(points, f"SYNTHETIC {name}", target_size=25)
            seen = []
            for route in routes:
                sequences_in_route = [stop["seq"] for stop in route["stops"]]
                self.assertEqual(
                    sequences_in_route,
                    list(range(1, len(sequences_in_route) + 1)),
                    f"{name}: sequence not contiguous",
                )
                seen.extend(stop["address_id"] for stop in route["stops"])
            eligible = {point["Address_ID"] for point in route_engine.eligible_points(points)}
            self.assertEqual(len(seen), len(eligible), f"{name}: stop count mismatch")
            self.assertEqual(set(seen), eligible, f"{name}: coverage mismatch")
            self.assertEqual(len(seen), len(set(seen)), f"{name}: duplicate stop")

    def test_missing_geocode_is_excluded(self):
        points = fixtures.missing_geocode()
        eligible = route_engine.eligible_points(points)
        self.assertNotIn("SYN-MISSING-01", {point["Address_ID"] for point in eligible})
        routes = route_engine.build_neighborhood_routes(points, "SYNTHETIC missing", target_size=25)
        ids = [stop["address_id"] for route in routes for stop in route["stops"]]
        self.assertNotIn("SYN-MISSING-01", ids)


class DeterminismTests(unittest.TestCase):
    def test_same_input_same_order(self):
        for name in ["grid", "cul_de_sac", "parallel_streets", "barrier", "cluster_boundary", "orientation"]:
            points = getattr(fixtures, name)()
            first = route_engine.build_neighborhood_routes(points, f"SYNTHETIC {name}", target_size=25)
            second = route_engine.build_neighborhood_routes(points, f"SYNTHETIC {name}", target_size=25)
            self.assertEqual(sequences(first), sequences(second), f"{name}: not deterministic")


class StreetTests(unittest.TestCase):
    def test_suffix_alias_street_is_contiguous(self):
        points = fixtures.suffix_alias()
        routes = route_engine.build_neighborhood_routes(points, "SYNTHETIC oak", target_size=25)
        stops = [stop for route in routes for stop in route["stops"]]
        keys = [" ".join(stop["street"].upper().split()[:-1]) for stop in stops]
        # every normalized "SYNTHETIC OAK" stop must form one contiguous block
        first = keys.index(keys[0])
        self.assertEqual(len(set(keys)), 1, "alias fixture should normalize to one street key")

    def test_parallel_streets_no_long_edges_and_deterministic(self):
        points = fixtures.parallel_streets()
        first = route_engine.build_neighborhood_routes(points, "SYNTHETIC parallel", target_size=30)
        second = route_engine.build_neighborhood_routes(points, "SYNTHETIC parallel", target_size=30)
        self.assertEqual(sequences(first), sequences(second))
        long_edges = sum(route["metrics"]["long_edges_over_0_15mi"] for route in first)
        self.assertEqual(long_edges, 0)

    def test_street_completion_never_worsens_beyond_tolerance(self):
        """Completion is conditional on geometry; it must never make a route
        worse than the documented tolerance and must keep every stop."""
        for name in ["grid", "parallel_streets", "street_completion", "suffix_alias", "barrier", "cul_de_sac"]:
            points = getattr(fixtures, name)()
            base = route_engine.order_cluster(points)
            completed = route_engine.complete_streets(base)
            self.assertLessEqual(
                route_engine.path_length(completed),
                route_engine.path_length(base) * route_engine.STREET_COMPLETION_TOLERANCE + 1e-9,
                f"{name}: completion exceeded tolerance",
            )
            self.assertEqual(
                sorted(point["Address_ID"] for point in completed),
                sorted(point["Address_ID"] for point in base),
                f"{name}: completion changed the stop set",
            )

    def test_orientation_starts_near_origin(self):
        points = fixtures.orientation()
        origin = (40.009, -80.0)  # north end
        routes = route_engine.build_neighborhood_routes(points, "SYNTHETIC orientation", origin=origin, target_size=25)
        first_stop = routes[0]["stops"][0]
        self.assertEqual(first_stop["address_id"], "SYN-ORIENT-09")

    def test_cluster_boundary_keeps_groups_separate(self):
        points = fixtures.cluster_boundary()
        routes = route_engine.build_neighborhood_routes(points, "SYNTHETIC boundary", target_size=12)
        for route in routes:
            prefixes = {stop["address_id"].split("-")[2] for stop in route["stops"]}
            self.assertEqual(len(prefixes), 1, f"{route['route_id']} mixes distant groups")


class QualityTests(unittest.TestCase):
    def test_grid_has_no_long_edges(self):
        points = fixtures.grid()
        routes = route_engine.build_neighborhood_routes(points, "SYNTHETIC grid", target_size=30)
        long_edges = sum(route["metrics"]["long_edges_over_0_15mi"] for route in routes)
        self.assertEqual(long_edges, 0)

    def test_cul_de_sac_and_loop_have_no_long_edges(self):
        for name in ["cul_de_sac", "loop"]:
            points = getattr(fixtures, name)()
            routes = route_engine.build_neighborhood_routes(points, f"SYNTHETIC {name}", target_size=25)
            long_edges = sum(route["metrics"]["long_edges_over_0_15mi"] for route in routes)
            self.assertEqual(long_edges, 0, f"{name}: long edge present")

    def test_duplicate_coordinates_are_deterministic(self):
        points = fixtures.duplicate_coordinates()
        first = route_engine.build_neighborhood_routes(points, "SYNTHETIC duplicate", target_size=25)
        second = route_engine.build_neighborhood_routes(points, "SYNTHETIC duplicate", target_size=25)
        self.assertEqual(sequences(first), sequences(second))

    def test_workload_balance(self):
        points = fixtures.grid(rows=10, columns=20)  # 200 stops
        routes = route_engine.build_neighborhood_routes(points, "SYNTHETIC balance", target_size=75)
        self.assertEqual(len(routes), 3)
        sizes = [route["metrics"]["stop_count"] for route in routes]
        self.assertLessEqual(max(sizes), 100)
        self.assertGreaterEqual(min(sizes), 50)


if __name__ == "__main__":
    unittest.main()
