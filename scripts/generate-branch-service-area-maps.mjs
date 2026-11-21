#!/usr/bin/env node
/**
 * Generate the Tampa Bay county map and the Florida overview map used by the
 * multi-branch Service Area presentation.
 *
 * Source: U.S. Census Bureau 2010 cartographic boundary files (500k,
 * public domain), cached under the OpenCode temp directory. Geometry is
 * simplified and projected with the same equirectangular method as the
 * existing Pensacola service-area map.
 *
 * Coverage categories are POLICY, not whole-county guarantees. The page copy
 * and the estimator's ZIP/road-distance checks remain authoritative.
 *
 * Regenerate with: node scripts/generate-branch-service-area-maps.mjs
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

const MAP_WIDTH = 720;
const PAD_DEG = 0.08;
const SIMPLIFY_TOLERANCE = 0.0025;

const TAMPA_CATEGORIES = [
  { fips: '12101', category: 'core' }, // Pasco
  { fips: '12103', category: 'core' }, // Pinellas
  { fips: '12057', category: 'core' }, // Hillsborough
  { fips: '12053', category: 'context' }, // Hernando
  { fips: '12017', category: 'context' }, // Citrus
  { fips: '12119', category: 'context' }, // Sumter
  { fips: '12105', category: 'context' }, // Polk
  { fips: '12081', category: 'context' }, // Manatee
  { fips: '12115', category: 'context' }, // Sarasota
  { fips: '12049', category: 'context' }, // Hardee
  { fips: '12027', category: 'context' }, // DeSoto
  { fips: '12075', category: 'context' }, // Levy
];

const TAMPA_CITIES = [
  { name: 'Tampa', lon: -82.4572, lat: 27.9506, dx: 12, dy: -6, anchor: 'start' },
  { name: 'St. Petersburg', lon: -82.64, lat: 27.7709, dx: -10, dy: 14, anchor: 'end' },
  { name: 'Clearwater', lon: -82.8, lat: 27.9659, dx: -10, dy: -5, anchor: 'end' },
  { name: 'Wesley Chapel', lon: -82.32, lat: 28.2397, dx: 10, dy: -4, anchor: 'start' },
  { name: 'New Port Richey', lon: -82.7193, lat: 28.2442, dx: -10, dy: -4, anchor: 'end' },
  { name: 'Brandon', lon: -82.2859, lat: 27.9378, dx: 10, dy: 14, anchor: 'start' },
  { name: 'Largo', lon: -82.7873, lat: 27.9098, dx: 10, dy: 12, anchor: 'start' },
];

const FLORIDA_NORTHWEST = new Set(['12033', '12113']);
const FLORIDA_TAMPA = new Set(['12101', '12103', '12057']);

function readSource(key) {
  const { file, url } = SOURCES[key];
  const target = path.join(CACHE_DIR, file);
  if (fs.existsSync(target)) return JSON.parse(fs.readFileSync(target, 'utf8'));
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  execFileSync('curl', ['-fsSL', '-A', 'Mozilla/5.0', '-o', target, url], { stdio: 'inherit' });
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

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
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
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
      if (dist > maxDist) { maxDist = dist; index = i; }
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

function clipSegment(a, b, box) {
  const [x0, y0] = a;
  const [x1, y1] = b;
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [
    [-dx, x0 - box[0]],
    [dx, box[2] - x0],
    [-dy, y0 - box[1]],
    [dy, box[3] - y0],
  ]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[x0 + t0 * dx, y0 + t0 * dy], [x0 + t1 * dx, y0 + t1 * dy]];
}

function bboxOf(geometries) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const geometry of geometries) {
    const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((poly) => poly[0]);
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

function countyRings(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((poly) => poly[0]);
}

function buildProjection(box) {
  const latMid = (box[1] + box[3]) / 2;
  const lonSpan = (box[2] - box[0]) * Math.cos((latMid * Math.PI) / 180);
  const scale = MAP_WIDTH / lonSpan;
  const height = Math.round((box[3] - box[1]) * scale);
  return {
    height,
    project: ([lon, lat]) => [
      Math.round((lon - box[0]) * Math.cos((latMid * Math.PI) / 180) * scale * 10) / 10,
      Math.round((box[3] - lat) * scale * 10) / 10,
    ],
  };
}

function buildMap({ selected, cities, stateNames, categoryLabel, pad = {} }) {
  const countyBox = bboxOf(selected.map((county) => county.geometry));
  const left = pad.left ?? PAD_DEG;
  const right = pad.right ?? PAD_DEG;
  const bottom = pad.bottom ?? PAD_DEG;
  const top = pad.top ?? PAD_DEG;
  const box = [countyBox[0] - left, countyBox[1] - bottom, countyBox[2] + right, countyBox[3] + top];
  const { height, project } = buildProjection(box);
  const ringToPath = (ring) => simplify(ring, SIMPLIFY_TOLERANCE)
    .map((point, index) => {
      const [x, y] = project(point);
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ') + 'Z';
  const countyRows = selected.map((county) => ({
    fips: county.fips,
    name: county.name,
    state: county.state,
    category: county.category,
    path: countyRings(county.geometry).map(ringToPath).join(' '),
  }));
  const core = countyRows.filter((county) => county.category !== 'context');
  const contextPaths = countyRows.filter((county) => county.category === 'context').map((county) => county.path);

  const states = readSource('states');
  const stateSegments = [];
  for (const state of states.features) {
    if (!stateNames.includes(state.properties.NAME)) continue;
    const rings = state.geometry.type === 'Polygon' ? state.geometry.coordinates : state.geometry.coordinates.flat();
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const clipped = clipSegment(ring[i], ring[i + 1], box);
        if (clipped) stateSegments.push(clipped);
      }
    }
  }
  const KEY = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const byStart = new Map();
  for (const segment of stateSegments) {
    const key = KEY(segment[0]);
    if (!byStart.has(key)) byStart.set(key, []);
    byStart.get(key).push(segment);
  }
  const used = new Set();
  const runs = [];
  for (const segment of stateSegments) {
    if (used.has(segment)) continue;
    used.add(segment);
    const run = [segment[0], segment[1]];
    let extended = true;
    while (extended) {
      extended = false;
      for (const next of byStart.get(KEY(run[run.length - 1])) ?? []) {
        if (used.has(next)) continue;
        used.add(next);
        run.push(next[1]);
        extended = true;
        break;
      }
    }
    runs.push(run);
  }
  const stateLine = runs.map((run) => run.map((point, index) => {
    const [x, y] = project(point);
    return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
  }).join(' ')).join(' ');

  const cityPoints = cities.map((city) => {
    const [x, y] = project([city.lon, city.lat]);
    return { name: city.name, x, y, dx: city.dx, dy: city.dy, anchor: city.anchor };
  });
  const centroid = (county) => {
    const rings = countyRings(county.geometry);
    let best = rings[0];
    for (const ring of rings) if (ring.length > best.length) best = ring;
    const points = simplify(best, SIMPLIFY_TOLERANCE * 2);
    const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
    return project([sum[0] / points.length, sum[1] / points.length]);
  };
  const labels = selected
    .filter((county) => county.category !== 'context')
    .map((county) => {
      const [x, y] = centroid(county);
      return {
        name: county.name,
        state: county.state === 'Florida' ? 'FL' : 'AL',
        x,
        y,
        category: county.category,
      };
    });
  return { height, core, contextPaths, cityPoints, labels, stateLine, categoryLabel };
}

function renderTampa() {
  const counties = readSource('counties');
  const selected = TAMPA_CATEGORIES.map(({ fips, category }) => {
    const feature = counties.features.find((f) => `${f.properties.STATE}${f.properties.COUNTY}` === fips);
    if (!feature) throw new Error(`County FIPS ${fips} not found`);
    return { fips, category, name: feature.properties.NAME, state: 'Florida', geometry: feature.geometry };
  });
  const map = buildMap({
    selected,
    cities: TAMPA_CITIES,
    stateNames: ['Florida'],
    categoryLabel: 'Approved Tampa Bay coverage counties',
    pad: { left: 0.55, right: 0.45, bottom: 0.04, top: 0.06 },
  });
  return `// GENERATED FILE - do not edit by hand.
// Regenerate with: node scripts/generate-branch-service-area-maps.mjs
// Source: U.S. Census Bureau 2010 cartographic boundary files (500k, public domain).
// Coverage categories are POLICY, not whole-county guarantees. The Tampa
// estimator still requires an approved ZIP in Pasco, Pinellas or Hillsborough
// AND <= 20 miles actual road-driving distance from the configured origin.

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

export const TAMPA_MAP_WIDTH = ${MAP_WIDTH};
export const TAMPA_MAP_HEIGHT = ${map.height};
export const TAMPA_MAP_COUNTIES: MapCounty[] = ${JSON.stringify(map.core, null, 2)};
export const TAMPA_MAP_CONTEXT_PATHS: string[] = ${JSON.stringify(map.contextPaths, null, 2)};
export const TAMPA_MAP_CITIES: MapCity[] = ${JSON.stringify(map.cityPoints, null, 2)};
export const TAMPA_MAP_COUNTY_LABELS: MapCountyLabel[] = ${JSON.stringify(map.labels, null, 2)};
export const TAMPA_MAP_STATE_LINE = ${JSON.stringify(map.stateLine)};
`;
}

function renderFlorida() {
  const counties = readSource('counties');
  const selected = counties.features
    .filter((feature) => String(feature.properties.STATE) === '12')
    .map((feature) => {
      const fips = `12${feature.properties.COUNTY}`;
      const category = FLORIDA_NORTHWEST.has(fips)
        ? 'northwest'
        : FLORIDA_TAMPA.has(fips)
          ? 'tampa'
          : 'context';
      return { fips, category, name: feature.properties.NAME, state: 'Florida', geometry: feature.geometry };
    });
  const map = buildMap({
    selected,
    cities: [],
    stateNames: ['Florida'],
    categoryLabel: 'Florida operating regions',
  });
  return `// GENERATED FILE - do not edit by hand.
// Regenerate with: node scripts/generate-branch-service-area-maps.mjs
// Florida overview: only the six approved operating counties are highlighted.
// All other Florida counties are neutral context and imply no coverage.

export const FLORIDA_MAP_WIDTH = ${MAP_WIDTH};
export const FLORIDA_MAP_HEIGHT = ${map.height};
export const FLORIDA_MAP_REGIONS = ${JSON.stringify(map.core.map((county) => ({
  fips: county.fips,
  name: county.name,
  category: FLORIDA_NORTHWEST.has(county.fips) ? 'northwest' : 'tampa',
  path: county.path,
})), null, 2)};
export const FLORIDA_MAP_CONTEXT_PATHS: string[] = ${JSON.stringify(map.contextPaths, null, 2)};
export const FLORIDA_MAP_STATE_LINE = ${JSON.stringify(map.stateLine)};
`;
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'geo');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'tampa-service-area-map.ts'), renderTampa());
fs.writeFileSync(path.join(dir, 'florida-service-area-overview.ts'), renderFlorida());
process.stdout.write('wrote tampa-service-area-map.ts and florida-service-area-overview.ts\n');
