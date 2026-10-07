"""Unmistakably synthetic route fixtures — no real addresses or coordinates.

Every ID is prefixed SYN- and every street name starts with SYNTHETIC.
Coordinates are fictional offsets around a generic point.
"""


def _point(identifier, street, number, lat, lon, owner="yes"):
    return {
        "Address_ID": identifier,
        "Street_Name": street,
        "House_Number": str(number),
        "Latitude": lat,
        "Longitude": lon,
        "Owner_Occupied": owner,
        "Coordinate_Precision": "synthetic",
    }


def grid(rows=6, columns=10):
    points = []
    for row in range(rows):
        for column in range(columns):
            points.append(
                _point(
                    f"SYN-GRID-{row:02d}-{column:02d}",
                    f"SYNTHETIC ROW {row}",
                    100 + column * 2,
                    40.0 + row * 0.0015,
                    -80.0 + column * 0.0015,
                )
            )
    return points


def loop(count=24):
    points = []
    for index in range(count):
        angle = 2 * 3.141592653589793 * index / count
        points.append(
            _point(
                f"SYN-LOOP-{index:02d}",
                "SYNTHETIC LOOP",
                100 + index * 2,
                40.0 + 0.002 * __import__("math").cos(angle),
                -80.0 + 0.002 * __import__("math").sin(angle),
            )
        )
    return points


def cul_de_sac(access=8, bulb=10):
    points = []
    for index in range(access):
        points.append(
            _point(f"SYN-CUL-ACCESS-{index:02d}", "SYNTHETIC CUL DE SAC DR", 100 + index * 2, 40.0 + index * 0.0008, -80.0)
        )
    import math

    for index in range(bulb):
        angle = 2 * math.pi * index / bulb
        points.append(
            _point(
                f"SYN-CUL-BULB-{index:02d}",
                "SYNTHETIC CUL DE SAC CT",
                200 + index * 2,
                40.0 + 0.0064 + 0.0009 * math.cos(angle),
                -80.0 + 0.0009 * math.sin(angle),
            )
        )
    return points


def parallel_streets(count=12):
    points = []
    for index in range(count):
        points.append(
            _point(f"SYN-PAR-A-{index:02d}", "SYNTHETIC FIRST ST", 100 + index * 2, 40.0, -80.0 + index * 0.0008)
        )
        points.append(
            _point(f"SYN-PAR-B-{index:02d}", "SYNTHETIC SECOND ST", 100 + index * 2, 40.0006, -80.0 + index * 0.0008)
        )
    return points


def divided_road(count=14):
    """Two carriageways of one road with a crossing far to the east."""
    points = []
    for index in range(count):
        points.append(
            _point(f"SYN-DIV-N-{index:02d}", "SYNTHETIC DIVIDED PKWY", 100 + index * 2, 40.0004, -80.0 + index * 0.0008)
        )
        points.append(
            _point(f"SYN-DIV-S-{index:02d}", "SYNTHETIC DIVIDED PKWY", 101 + index * 2, 40.0, -80.0 + index * 0.0008)
        )
    return points


def barrier():
    """Two groups separated by a wide empty band (a barrier the data cannot cross)."""
    west = [
        _point(f"SYN-BAR-W-{index:02d}", "SYNTHETIC WEST AVE", 100 + index * 2, 40.0 + index * 0.0006, -80.02)
        for index in range(10)
    ]
    east = [
        _point(f"SYN-BAR-E-{index:02d}", "SYNTHETIC EAST AVE", 100 + index * 2, 40.0 + index * 0.0006, -80.0)
        for index in range(10)
    ]
    return west + east


def suffix_alias(count=10):
    points = []
    for index in range(count):
        street = "SYNTHETIC OAK ST" if index % 2 == 0 else "SYNTHETIC OAK STREET"
        points.append(
            _point(f"SYN-OAK-{index:02d}", street, 100 + index * 2, 40.0, -80.0 + index * 0.0006)
        )
    return points


def street_completion():
    """Two streets interleaved along the same line: the nearest-neighbour walk
    alternates between them, and completing each street is a near-zero detour,
    so completion must merge them into two contiguous blocks."""
    main = [
        _point(f"SYN-MAIN-{index:02d}", "SYNTHETIC MAIN ST", 100 + index * 2, 40.0, -80.0 + index * 0.0008)
        for index in range(10)
    ]
    side = [
        _point(f"SYN-SIDE-{index:02d}", "SYNTHETIC SIDE CT", 200 + index * 2, 40.000001, -80.0 + 0.0016 + index * 0.0008)
        for index in range(3)
    ]
    return main + side


def duplicate_coordinates(count=6):
    return [
        _point(f"SYN-DUP-{index:02d}", "SYNTHETIC DUPLICATE WAY", 100 + index, 40.0, -80.0)
        for index in range(count)
    ]


def missing_geocode():
    points = grid(rows=2, columns=3)
    points.append(
        {
            "Address_ID": "SYN-MISSING-01",
            "Street_Name": "SYNTHETIC NOWHERE RD",
            "House_Number": "1",
            "Latitude": None,
            "Longitude": None,
            "Owner_Occupied": "yes",
            "Coordinate_Precision": "unknown",
        }
    )
    return points


def cluster_boundary():
    near = [
        _point(f"SYN-CLUSTER-A-{index:02d}", "SYNTHETIC NEAR CT", 100 + index * 2, 40.0 + index * 0.0004, -80.0)
        for index in range(12)
    ]
    far = [
        _point(f"SYN-CLUSTER-B-{index:02d}", "SYNTHETIC FAR CT", 100 + index * 2, 40.02 + index * 0.0004, -80.0)
        for index in range(12)
    ]
    return near + far


def orientation():
    """A north-south line; the origin sits at the north end."""
    points = []
    for index in range(10):
        points.append(
            _point(f"SYN-ORIENT-{index:02d}", "SYNTHETIC ORIENTATION DR", 100 + index * 2, 40.0 + index * 0.001, -80.0)
        )
    return points
