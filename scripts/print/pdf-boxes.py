"""Set or check TrimBox/BleedBox on generated print PDFs (PyMuPDF).

Usage:
  python scripts/print/pdf-boxes.py set --bleed 9 file.pdf [file.pdf ...]
  python scripts/print/pdf-boxes.py check file.pdf [file.pdf ...]

`--bleed` is given in points (0.125 in = 9 pt). TrimBox = MediaBox inset by the
bleed; BleedBox = MediaBox. `check` prints one JSON object per file.
"""
import argparse
import json
import sys

import pymupdf

POINTS_PER_INCH = 72


def rect_inches(rect):
    return [round(rect.width / POINTS_PER_INCH, 4), round(rect.height / POINTS_PER_INCH, 4)]


def describe(path):
    doc = pymupdf.open(path)
    pages = []
    for page in doc:
        pages.append(
            {
                "media": rect_inches(page.mediabox),
                "trim": rect_inches(page.trimbox),
                "bleed": rect_inches(page.bleedbox),
                "trim_offset_in": [
                    round((page.trimbox.x0 - page.mediabox.x0) / POINTS_PER_INCH, 4),
                    round((page.trimbox.y0 - page.mediabox.y0) / POINTS_PER_INCH, 4),
                ],
            }
        )
    doc.close()
    return {"file": path, "pages": pages}


def set_boxes(path, bleed_points):
    doc = pymupdf.open(path)
    for page in doc:
        media = page.mediabox
        bleed = max(0.0, bleed_points)
        trim = pymupdf.Rect(media.x0 + bleed, media.y0 + bleed, media.x1 - bleed, media.y1 - bleed)
        page.set_trimbox(trim)
        page.set_bleedbox(media)
    doc.save(path, incremental=True, encryption=pymupdf.PDF_ENCRYPT_KEEP)
    doc.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["set", "check"])
    parser.add_argument("--bleed", type=float, default=0.0, help="bleed in points")
    parser.add_argument("files", nargs="+")
    args = parser.parse_args()

    if args.mode == "set":
        for path in args.files:
            set_boxes(path, args.bleed)
        print(json.dumps({"mode": "set", "files": len(args.files), "bleed_pt": args.bleed}))
        return 0

    failures = 0
    for path in args.files:
        try:
            print(json.dumps(describe(path)))
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(json.dumps({"file": path, "error": str(error)}))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
