#!/usr/bin/env node
/**
 * Generate the service-area county map (directive §5 — Premium County Map).
 *
 * Source data: U.S. Census Bureau 2010 cartographic boundary files (500k),
 * the same public-domain county/state geometry distributed by the Census
 * Bureau's GENZ program and mirrored at eric.clst.org. Polylines are
 * simplified with Douglas–Peucker and projected with an equirectangular
 * projection (cos mid-latitude x-scale) — fully accurate for this small
 * region, with no heavyweight mapping dependency shipped to customers.
 *
 * Output: src/lib/geo/service-area-map.ts (committed; regenerate after
 * editing CATEGORIES/CITIES with `node scripts/generate-service-area-map.mjs`).
 *
 * Categories are POLICY, not full-county coverage claims: the page copy and
 * legend keep the "service by arrangement" and "confirm your address"
 * qualifications (a county tint never guarantees whole-county service).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = path.join(os.tmpdir(), 'opencode', 'census');
const SOURCES = {
  counties: {
    file: 'counties.json',
    url: 'https://eric.clst.org/assets/wiki/uploads/Stuff/gz_2010_us_050_00_500k.json',
  },
  states: {
    file: 'states.json',
    url: 'https://eric.clst.org/assets/wiki/uploads/Stuff/gz_2010_us_040_00_500k.json',
  },
};

/** FIPS → coverage category. Core = approved home region; arrangement = by-arrangement Alabama; context = neighboring geography (no coverage). */
const CATEGORIES = [
  { fips: '12033', category: 'core' }, // Escambia County, FL (Pensacola/Cantonment)
  { fips: '12113', category: 'core' }, // Santa Rosa County, FL (Gulf Breeze/Milton/Pace)
  { fips: '01003', category: 'arrangement' }, // Baldwin County, AL
  { fips: '01053', category: 'arrangement' }, // Escambia County, AL
  { fips: '12133', category: 'context' }, // Okaloosa County, FL (neighbor)
  { fips: '01097', category: 'context' }, // Mobile County, AL (neighbor)
  { fips: '01035', category: 'context' }, // Conecuh County, AL (neighbor)
  { fips: '01099', category: 'context' }, // Monroe County, AL (neighbor)
];

/**
 * City markers (lon, lat) + label placement hints, in SVG units.
 * Label placement is collision-aware by design (owner-directed map
 * refinement, 2026-10-23): Cantonment's label sits centered ABOVE its dot so
 * it can never collide with the Escambia county label or Milton; Pensacola
 * and Gulf Breeze anchor to opposite sides of the bayou so their labels
 * never share a row; the county labels are pinned away from the city
 * cluster (see LABEL_OVERRIDES).
 */
const CITIES = [
  { name: 'Pensacola', lon: -87.2169, lat: 30.4213, dx: -12, dy: 0, anchor: 'end' },
  { name: 'Cantonment', lon: -87.3394, lat: 30.6094, dx: 0, dy: -15, anchor: 'middle' },
  { name: 'Gulf Breeze', lon: -87.0383, lat: 30.3583, dx: 12, dy: 0, anchor: 'start' },
  { name: 'Milton', lon: -87.0408, lat: 30.6324, dx: 10, dy: -6, anchor: 'start' },
  { name: 'Pace', lon: -87.1597, lat: 30.5994, dx: -10, dy: 14, anchor: 'end' },
];

/**
 * Explicit county-label positions (SVG units), overriding the automatic
 * centroid. Centroids land the labels on top of each other in this
 * crowded corner of the Gulf Coast, so every label is placed by measured
 * glyph boxes (≈11.4 units per uppercase character at the 11px county
 * size) into a collision-free band:
 *   - Escambia FL sits ABOVE the Cantonment/Baldwin rows.
 *   - Santa Rosa FL sits BELOW Escambia FL's row, clear of Milton/Pace.
 *   - Mobile AL (context) drops to the lower-left of its county, away from
 *     Baldwin AL's row.
 */
const LABEL_OVERRIDES = {
  '12033': { x: 245, y: 268 }, // Escambia FL
  '12113': { x: 355, y: 300 }, // Santa Rosa FL
  '01003': { x: 166, y: 297 }, // Baldwin AL
  '01053': { x: 359, y: 202 }, // Escambia AL
  '01097': { x: 85, y: 345 }, // Mobile AL (context)
};

const MAP_WIDTH = 720;
const PAD_DEG = 0.08;
const SIMPLIFY_TOLERANCE = 0.0025;

// ── Tiny geo helpers ─────────────────────────────────────────────────────────

function readSource(key) {
  const { file, url } = SOURCES[key];
  const file_ = path.join(CACHE_DIR, file);
  if (fs.existsSync(file_)) return JSON.parse(fs.readFileSync(file_, 'utf8'));
  process.stderr.write(`Downloading ${url}\n`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Synchronous fetch via curl keeps this script dependency-free.
  execFileSync('curl', ['-fsSL', '-A', 'Mozilla/5.0', '-o', file_, url], { stdio: 'inherit' });
  return JSON.parse(fs.readFileSync(file_, 'utf8'));
}

/** Douglas–Peucker simplification on [lon, lat] rings. */
function simplify(ring, tolerance) {
  if (ring.length < 5) return ring;
  const sqTol = tolerance * tolerance;

  const sqSegDist = (p, a, b) => {
    let x = a[0];
    let y = a[1];
    let dx = b[0] - x;
    let dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b[0];
        y = b[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  };

  const step = (first, last, marks) => {
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const dist = sqSegDist(ring[i], ring[first], ring[last]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > sqTol && index > 0) {
      marks.add(index);
      step(first, index, marks);
      step(index, last, marks);
    }
  };

  const marks = new Set([0, ring.length - 1]);
  step(0, ring.length - 1, marks);
  return ring.filter((_, i) => marks.has(i));
}

/** Liang–Barsky segment clip against a bbox; returns null when fully outside. */
function clipSegment(a, b, box) {
  const [x0, y0] = a;
  const [x1, y1] = b;
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const edges = [
    [-dx, x0 - box[0]], // left
    [dx, box[2] - x0], // right
    [-dy, y0 - box[1]], // bottom
    [dy, box[3] - y0], // top
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [
    [x0 + t0 * dx, y0 + t0 * dy],
    [x0 + t1 * dx, y0 + t1 * dy],
  ];
}

function bboxOf(geometries) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const geometry of geometries) {
    const rings =
      geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((poly) => poly[0]);
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < minX) minX = lon;
        if (lat < minY) minY = lat;
        if (lon > maxX) maxX = lon;
        if (lat > maxY) maxY = lat;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

// ── Main ─────────────────────────────────────────────────────────────────────

const counties = readSource('counties');
const states = readSource('states');

const selected = CATEGORIES.map(({ fips, category }) => {
  const feature = counties.features.find(
    (f) => `${f.properties.STATE}${f.properties.COUNTY}` === fips,
  );
  if (!feature) throw new Error(`County FIPS ${fips} not found in source data`);
  return { fips, category, name: feature.properties.NAME, state: stateName(fips), geometry: feature.geometry };
});

function stateName(fips) {
  return fips.startsWith('12') ? 'Florida' : 'Alabama';
}

const countyBox = bboxOf(selected.map((c) => c.geometry));
const box = [countyBox[0] - PAD_DEG, countyBox[1] - PAD_DEG, countyBox[2] + PAD_DEG, countyBox[3] + PAD_DEG];

const LAT_MID = (box[1] + box[3]) / 2;
const lonSpan = (box[2] - box[0]) * Math.cos((LAT_MID * Math.PI) / 180);
const SCALE = MAP_WIDTH / lonSpan;
const MAP_HEIGHT = Math.round((box[3] - box[1]) * SCALE);

const project = ([lon, lat]) => [
  Math.round(((lon - box[0]) * Math.cos((LAT_MID * Math.PI) / 180) * SCALE) * 10) / 10,
  Math.round(((box[3] - lat) * SCALE) * 10) / 10,
];

function ringToPath(ring) {
  const simplified = simplify(ring, SIMPLIFY_TOLERANCE);
  return (
    simplified
      .map((point, index) => {
        const [x, y] = project(point);
        return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
      })
      .join(' ') + 'Z'
  );
}

const countyPathData = selected.map((county) => {
  const rings = county.geometry.type === 'Polygon' ? [county.geometry.coordinates[0]] : county.geometry.coordinates.map((poly) => poly[0]);
  return {
    fips: county.fips,
    name: county.name,
    state: county.state,
    category: county.category,
    path: rings.map(ringToPath).join(' '),
  };
});
const countyPaths = countyPathData.filter((county) => county.category !== 'context');
const contextPaths = countyPathData
  .filter((county) => county.category === 'context')
  .map((county) => county.path);

// State lines: every ring segment of FL and AL, Liang–Barsky-clipped to the
// map box, then merged into one polyline path.
const stateSegments = [];
for (const state of states.features) {
  if (!['Florida', 'Alabama'].includes(state.properties.NAME)) continue;
  const geometry = state.geometry;
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const clipped = clipSegment(ring[i], ring[i + 1], box);
      if (clipped) stateSegments.push(clipped);
    }
  }
}
// Merge segments sharing endpoints into continuous runs.
const runs = [];
const KEY = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
const byStart = new Map();
for (const segment of stateSegments) {
  const key = KEY(segment[0]);
  if (!byStart.has(key)) byStart.set(key, []);
  byStart.get(key).push(segment);
}
const used = new Set();
for (const segment of stateSegments) {
  const id = segment;
  if (used.has(id)) continue;
  used.add(id);
  const run = [segment[0], segment[1]];
  let extended = true;
  while (extended) {
    extended = false;
    const candidates = byStart.get(KEY(run[run.length - 1])) ?? [];
    for (const next of candidates) {
      if (used.has(next)) continue;
      used.add(next);
      run.push(next[1]);
      extended = true;
      break;
    }
  }
  runs.push(run);
}
const stateLinePath = runs
  .map((run) =>
    run
      .map((point, index) => {
        const [x, y] = project(point);
        return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
      })
      .join(' '),
  )
  .join(' ');

const cityPoints = CITIES.map((city) => {
  const [x, y] = project([city.lon, city.lat]);
  return { name: city.name, x, y, dx: city.dx, dy: city.dy, anchor: city.anchor };
});

// Rough centroid of the largest ring for county labels.
function centroidOf(county) {
  const rings = county.geometry.type === 'Polygon' ? [county.geometry.coordinates[0]] : county.geometry.coordinates.map((poly) => poly[0]);
  let best = null;
  let bestLen = 0;
  for (const ring of rings) {
    if (ring.length > bestLen) {
      bestLen = ring.length;
      best = ring;
    }
  }
  const simplified = simplify(best, SIMPLIFY_TOLERANCE * 2);
  let sx = 0;
  let sy = 0;
  for (const point of simplified) {
    sx += point[0];
    sy += point[1];
  }
  return project([sx / simplified.length, sy / simplified.length]);
}

const countyLabels = selected.map((county) => {
  const override = LABEL_OVERRIDES[county.fips];
  const [x, y] = override ? [override.x, override.y] : centroidOf(county);
  return { name: county.name, state: county.state === 'Florida' ? 'FL' : 'AL', x, y, category: county.category };
});

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/generate-service-area-map.mjs
// Source: U.S. Census Bureau 2010 cartographic boundary files (500k, public
// domain), simplified (Douglas–Peucker) and projected equirectangular with a
// cos mid-latitude x-scale. Coverage categories are policy data, below.

export interface MapCounty {
  fips: string;
  name: string;
  state: 'Florida' | 'Alabama';
  category: 'core' | 'arrangement';
  path: string;
}

export interface MapCity {
  name: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface MapCountyLabel {
  name: string;
  state: 'FL' | 'AL';
  x: number;
  y: number;
  category: 'core' | 'arrangement' | 'context';
}

export const MAP_WIDTH = ${MAP_WIDTH};
export const MAP_HEIGHT = ${MAP_HEIGHT};

export const MAP_COUNTIES: MapCounty[] = ${JSON.stringify(countyPaths, null, 2)};

/** Neighboring counties drawn as neutral geography — no coverage implied. */
export const MAP_CONTEXT_PATHS: string[] = ${JSON.stringify(contextPaths, null, 2)};

export const MAP_CITIES: MapCity[] = ${JSON.stringify(cityPoints, null, 2)};

export const MAP_COUNTY_LABELS: MapCountyLabel[] = ${JSON.stringify(countyLabels, null, 2)};

export const MAP_STATE_LINE = ${JSON.stringify(stateLinePath)};
`;

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'geo', 'service-area-map.ts');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out);
process.stdout.write(
  `wrote ${path.relative(process.cwd(), target)} (${MAP_WIDTH}x${MAP_HEIGHT}, ${countyPaths.length} counties, ${runs.length} state-line runs, ${cityPoints.length} cities)\n`,
);
