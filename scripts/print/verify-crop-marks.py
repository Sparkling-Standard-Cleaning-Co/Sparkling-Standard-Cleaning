"""Verify crop-mark geometry on generated bleed PDFs.

For every bleed PDF:
  - renders the page with PyMuPDF,
  - checks that no dark artwork pixels appear inside the trim area near the
    corners (the Stage 1 defect put marks inside the artwork),
  - checks that dark crop marks exist in the bleed margin beside each trim
    corner.

Usage: python scripts/print/verify-crop-marks.py file1.pdf [file2.pdf ...]
Prints one JSON object per file; exits non-zero if any check fails.
"""
import json
import sys

import pymupdf

DPI = 200
POINTS_PER_INCH = 72
INSIDE_BOX_IN = 0.09
DARK_THRESHOLD = 120


def dark_fraction(pix, x0, y0, x1, y1):
    x0 = max(0, int(x0))
    y0 = max(0, int(y0))
    x1 = min(pix.width, int(x1))
    y1 = min(pix.height, int(y1))
    if x1 <= x0 or y1 <= y0:
        return 0.0
    samples = pix.samples
    stride = pix.stride
    channels = pix.n
    dark = 0
    total = 0
    for y in range(y0, y1):
        row = y * stride
        for x in range(x0, x1):
            offset = row + x * channels
            r = samples[offset]
            g = samples[offset + 1] if channels > 1 else r
            b = samples[offset + 2] if channels > 2 else r
            if (r + g + b) / 3 < DARK_THRESHOLD:
                dark += 1
            total += 1
    return dark / total if total else 0.0


def check(path):
    doc = pymupdf.open(path)
    page = doc[0]
    scale = DPI / POINTS_PER_INCH
    media = page.mediabox
    trim = page.trimbox
    pix = page.get_pixmap(dpi=DPI)
    bleed_px = (trim.x0 - media.x0) * scale
    trim_px = trim.width * scale
    trim_py = trim.height * scale
    inside = INSIDE_BOX_IN * scale

    corners = {
        "tl": (bleed_px, bleed_px),
        "tr": (bleed_px + trim_px, bleed_px),
        "bl": (bleed_px, bleed_px + trim_py),
        "br": (bleed_px + trim_px, bleed_px + trim_py),
    }
    result = {"file": path, "checks": [], "ok": True}

    for name, (cx, cy) in corners.items():
        ix0 = cx + 2 if name in ("tl", "bl") else cx - inside - 2
        iy0 = cy + 2 if name in ("tl", "tr") else cy - inside - 2
        inside_dark = dark_fraction(pix, ix0, iy0, ix0 + inside, iy0 + inside)

        # Sample the bleed corner band, extending a few pixels across the trim
        # line because crop marks are centred on the trim edge.
        pad = 4
        if name in ("tl", "bl"):
            ox0, ox1 = 0, cx + pad
        else:
            ox0, ox1 = cx - pad, pix.width
        if name in ("tl", "tr"):
            oy0, oy1 = 0, cy + pad
        else:
            oy0, oy1 = cy - pad, pix.height
        outside_dark = dark_fraction(pix, ox0, oy0, ox1, oy1)

        inside_ok = inside_dark < 0.005
        outside_ok = outside_dark > 0.002
        result["checks"].append(
            {
                "corner": name,
                "inside_dark": round(inside_dark, 5),
                "outside_dark": round(outside_dark, 5),
                "inside_ok": inside_ok,
                "outside_ok": outside_ok,
            }
        )
        if not (inside_ok and outside_ok):
            result["ok"] = False

    doc.close()
    return result


def main():
    failures = 0
    for path in sys.argv[1:]:
        result = check(path)
        print(json.dumps(result))
        if not result["ok"]:
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
