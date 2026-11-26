// Geographic acceptance for every approved service-area ZIP.
//
// Default mode is offline and deterministic: it validates the 70-address
// matrix, the Census ZCTA county snapshot, branch assignment, zone and tax
// treatment. `--live` re-geocodes every address with the U.S. Census Geocoder.
// `--travel` and `--calendar` additionally exercise the read-only production
// endpoints with conservative rate limiting. No booking, hold, payment or
// customer record is created.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { branchConfigs } from '../src/config/branches.ts';
import { zipReference, zoneForZip } from '../src/config/geography.ts';
import { zipTaxJurisdictions } from '../src/config/tax.ts';
import { resolveServiceBranchStrict } from '../src/lib/branches/registry.ts';
import { calculateServiceTax } from '../src/lib/tax/engine.ts';

const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const BASE = valueArg('base', 'https://sparkling-standard.com').replace(/\/+$/, '');
const OUTPUT = valueArg('output', path.join('docs', 'verification', '2026-11-26-geographic-acceptance.json'));
const TODAY = valueArg('date', '2026-12-02');
const matrix = JSON.parse(fs.readFileSync(path.join('scripts', 'data', 'geographic-acceptance.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join('scripts', 'data', 'census-zcta-counties.json'), 'utf8'));
const failures = [];
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeCounty = (value) => String(value ?? '').trim().replace(/\s+County$/i, '');

function fail(message) {
  failures.push(message);
}

function checkCoverage() {
  const addresses = matrix.addresses ?? [];
  if (addresses.length < 70) fail(`matrix has ${addresses.length} addresses; minimum is 70`);
  const zips = new Set(addresses.map((entry) => entry.zip));
  for (const zip of Object.keys(zipReference)) {
    if (!zips.has(zip)) fail(`approved Pensacola ZIP ${zip} has no matrix address`);
  }
  for (const [zip, entry] of Object.entries(snapshot.entries ?? {})) {
    if (!entry.counties?.length) fail(`Census snapshot has no county for approved ZIP ${zip}`);
  }
  for (const zip of Object.keys(zipReference)) {
    if (!snapshot.entries?.[zip]) fail(`approved Pensacola ZIP ${zip} is missing from the Census snapshot`);
  }
  for (const zip of branchConfigs.branch_tampa.serviceAreaZips) {
    if (!snapshot.entries?.[zip]) fail(`approved Tampa ZIP ${zip} is missing from the Census snapshot`);
  }
  for (const zip of Object.keys(zipTaxJurisdictions)) {
    if (!zipReference[zip]) fail(`tax ZIP ${zip} is not in the live geography table`);
  }
}

function buildZipAudit() {
  const live = [];
  for (const zip of Object.keys(zipReference).sort()) {
    const entry = snapshot.entries?.[zip];
    const tax = zipTaxJurisdictions[zip];
    const primary = entry?.counties?.[0] ?? null;
    const taxCounty = tax?.county ?? null;
    const issue =
      !entry ? 'missing_census'
        : !tax ? 'missing_tax'
          : zip === '32561'
            ? null
            : primary && taxCounty && primary !== taxCounty
              ? 'county_mismatch'
              : null;
    if (issue) fail('ZIP audit ' + zip + ': ' + issue);
    live.push({ zip, counties: entry?.counties ?? [], primaryCounty: primary, taxCounty, taxKey: tax?.key ?? null, issue });
  }
  const tampa = [];
  const allowed = new Set(branchConfigs.branch_tampa.serviceCounties.map((value) => value.replace(/ County, (FL|AL)$/, '')));
  for (const zip of [...branchConfigs.branch_tampa.serviceAreaZips].sort()) {
    const entry = snapshot.entries?.[zip];
    const crossCounty = (entry?.counties ?? []).length > 1;
    const outsideApproved = (entry?.counties ?? []).filter((county) => !allowed.has(county));
    if (!entry) fail('Tampa ZIP audit ' + zip + ': missing_census');
    tampa.push({ zip, counties: entry?.counties ?? [], crossCounty, outsideApproved });
  }
  return {
    live: { approved: live.length, audited: live.filter((entry) => entry.counties.length > 0).length, entries: live },
    tampa: {
      approved: tampa.length,
      audited: tampa.filter((entry) => entry.counties.length > 0).length,
      crossCounty: tampa.filter((entry) => entry.crossCounty),
      outsideConfiguredCounties: tampa.filter((entry) => entry.outsideApproved.length > 0),
    },
  };
}

async function censusGeocode(address) {
  const url =
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress' +
    `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return { error: `census_http_${response.status}` };
  const data = await response.json().catch(() => ({}));
  const match = data.result?.addressMatches?.[0];
  if (!match) return { error: 'census_no_match' };
  return {
    matched: match.matchedAddress,
    lat: Number(match.coordinates?.y),
    lng: Number(match.coordinates?.x),
    county: normalizeCounty(match.geographies?.Counties?.[0]?.NAME),
    state: match.matchedAddress?.match(/,\s*([A-Z]{2}),\s*\d{5}/)?.[1] ?? '',
  };
}

async function productionTravel(lat, lng) {
  const response = await fetch(`${BASE}/api/travel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { error: body.error ?? `http_${response.status}` };
  return {
    oneWayMiles: body.oneWayMiles ?? null,
    durationMinutes: body.durationMinutes ?? null,
    method: body.method ?? '',
    verified: body.verified === true,
  };
}

async function productionGeocode(address) {
  const response = await fetch(`${BASE}/api/geocode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'resolve', query: address }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true || !body.result) return { error: body.error ?? `http_${response.status}` };
  return {
    label: body.result.label ?? '',
    state: body.result.state ?? '',
    zip: body.result.zip ?? '',
    county: normalizeCounty(body.result.county ?? ''),
    precise: body.result.precise === true,
    source: body.result.source ?? '',
  };
}

async function productionCalendar(zip, lat, lng) {
  const response = await fetch(
    `${BASE}/api/availability-month?from=${TODAY}&to=${TODAY}&durationMinutes=180&zip=${encodeURIComponent(zip)}&lat=${lat}&lng=${lng}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { error: body.error ?? `http_${response.status}` };
  return {
    enabled: body.enabled === true,
    reason: body.reason ?? '',
    branch: body.branch ?? '',
    days: Array.isArray(body.days) ? body.days.length : 0,
    slots: Array.isArray(body.days) ? body.days.reduce((sum, day) => sum + Number(day.slotCount ?? 0), 0) : 0,
  };
}

async function main() {
  checkCoverage();
  const addresses = matrix.addresses ?? [];
  const live = [];
  let next = 0;
  const workers = Array.from({ length: args.has('--live') ? 5 : 1 }, async () => {
    while (next < addresses.length) {
      const index = next++;
      const entry = addresses[index];
      const branch = await resolveServiceBranchStrict(null, { zip: entry.zip, state: entry.zip.startsWith('36') ? 'AL' : 'FL' });
      const state = entry.zip.startsWith('36') ? 'AL' : 'FL';
      const county = normalizeCounty(entry.censusCounty || entry.county);
      const snapshotEntry = snapshot.entries?.[entry.zip];
      const residential = calculateServiceTax({
        serviceType: 'residential',
        state,
        zip: entry.zip,
        county,
        taxableBase: 100,
        at: new Date('2026-11-26T12:00:00Z'),
      });
      const commercial = calculateServiceTax({
        serviceType: 'commercial_cleaning',
        state,
        zip: entry.zip,
        county,
        taxableBase: 100,
        at: new Date('2026-11-26T12:00:00Z'),
      });
      const row = {
        ...entry,
        state,
        expectedCounty: county,
        snapshotCounties: snapshotEntry?.counties ?? [],
        branch: branch.branch?.id ?? null,
        branchReason: branch.reason,
        zone: zoneForZip(entry.zip),
        residentialTax: { treatment: residential.treatment, canCharge: residential.canCharge },
        commercialTax: {
          treatment: commercial.treatment,
          canCharge: commercial.canCharge,
          county: commercial.county,
          ratePercent: commercial.ratePercent,
        },
      };
      if (live[index] !== undefined) row.census = live[index];
      if (branch.branch?.id !== 'branch_pensacola') fail(`${entry.zip} ${entry.address}: branch is ${branch.branch?.id ?? branch.reason}`);
      if (!snapshotEntry?.counties?.includes(county)) fail(`${entry.zip} ${entry.address}: expected county ${county} not in Census snapshot`);
      if (residential.treatment !== 'not_taxable' || !residential.canCharge) fail(`${entry.zip} ${entry.address}: residential tax is not not_taxable`);
      const expectedRate = state === 'AL' ? null : county === 'Escambia' ? 7.5 : county === 'Santa Rosa' ? 7 : null;
      if (state === 'AL') {
        if (commercial.treatment !== 'not_taxable' || !commercial.canCharge) fail(`${entry.zip} ${entry.address}: Alabama commercial cleaning must be not_taxable`);
      } else if (commercial.treatment !== 'taxable' || !commercial.canCharge || commercial.ratePercent !== expectedRate) {
        fail(`${entry.zip} ${entry.address}: commercial tax ${commercial.treatment}/${commercial.ratePercent} expected taxable/${expectedRate}`);
      }
      results[index] = row;
      if (args.has('--live')) {
        const census = await censusGeocode(entry.address);
        results[index].census = census;
        if (census.error) fail(`${entry.zip} ${entry.address}: ${census.error}`);
        else {
          if (normalizeCounty(census.county) !== county) fail(`${entry.zip} ${entry.address}: Census county ${census.county} != expected ${county}`);
          if (census.state !== state) fail(`${entry.zip} ${entry.address}: Census state ${census.state} != expected ${state}`);
        }
      }
    }
  });
  await Promise.all(workers);

  if (args.has('--geocode')) {
    console.log('Checking production address resolution with a 0.7s interval...');
    for (let index = 0; index < results.length; index += 1) {
      const row = results[index];
      row.productionGeocode = await productionGeocode(row.address);
      if (row.productionGeocode.error) fail(`${row.zip} ${row.address}: production geocode ${row.productionGeocode.error}`);
      else {
        if (row.productionGeocode.state !== row.state) fail(`${row.zip} ${row.address}: production geocode state ${row.productionGeocode.state}`);
        if (row.productionGeocode.zip !== row.zip) fail(`${row.zip} ${row.address}: production geocode ZIP ${row.productionGeocode.zip}`);
        if (row.productionGeocode.county && normalizeCounty(row.productionGeocode.county) !== row.expectedCounty) {
          fail(`${row.zip} ${row.address}: production geocode county ${row.productionGeocode.county} != ${row.expectedCounty}`);
        }
      }
      await sleep(1100);
    }
  }

  if (args.has('--travel')) {
    console.log('Checking production travel routes with a 2.1s interval...');
    for (let index = 0; index < results.length; index += 1) {
      const row = results[index];
      const census = row.census;
      if (!census || census.error || !Number.isFinite(census.lat) || !Number.isFinite(census.lng)) {
        fail(`${row.zip} ${row.address}: travel skipped because Census coordinates are missing`);
        continue;
      }
      row.travel = await productionTravel(census.lat, census.lng);
      if (row.travel.error) fail(`${row.zip} ${row.address}: travel ${row.travel.error}`);
      else if (!row.travel.verified) fail(`${row.zip} ${row.address}: travel is not verified`);
      await sleep(2100);
    }
  }

  if (args.has('--calendar')) {
    console.log('Checking production calendar availability with a 5.1s interval...');
    for (let index = 0; index < results.length; index += 1) {
      const row = results[index];
      const census = row.census;
      if (!census || census.error || !Number.isFinite(census.lat) || !Number.isFinite(census.lng)) {
        fail(`${row.zip} ${row.address}: calendar skipped because Census coordinates are missing`);
        continue;
      }
      row.calendar = await productionCalendar(row.zip, census.lat, census.lng);
      if (row.calendar.error) fail(`${row.zip} ${row.address}: calendar ${row.calendar.error}`);
      else if (!row.calendar.enabled || row.calendar.branch !== 'branch_pensacola') {
        fail(`${row.zip} ${row.address}: calendar not enabled for branch_pensacola (${row.calendar.reason || row.calendar.branch})`);
      }
      await sleep(5100);
    }
  }

  if (args.has('--merge') && fs.existsSync(OUTPUT)) {
    try {
      const previous = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      const byKey = new Map((previous.results ?? []).map((row) => [row.zip + '|' + row.address, row]));
      for (const row of results) {
        const old = byKey.get(row.zip + '|' + row.address);
        if (old?.travel) row.travel = old.travel;
        if (old?.calendar) row.calendar = old.calendar;
      }
    } catch {
      // A missing or unreadable previous run simply means no merge.
    }
  }
  const zipAudit = buildZipAudit();
  const summary = {
    generatedAt: new Date().toISOString(),
    source: matrix.source,
    addressCount: addresses.length,
    zipCount: new Set(addresses.map((entry) => entry.zip)).size,
    failCount: failures.length,
    failures,
    zipAudit,
    results,
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`Geographic acceptance: ${addresses.length} addresses / ${summary.zipCount} ZIPs; ${failures.length} failure(s).`);
  for (const failure of failures.slice(0, 30)) console.log(`- ${failure}`);
  console.log(`Evidence written to ${OUTPUT}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
