// Physical acquisition print system — builds every field piece from the live
// brand system (tokens, fonts, crest, QR registry) into
// ~/Downloads/Door Knocking/.
//
//   node scripts/print/print-system.mjs
//
// Outputs per piece: bleed PDF (crop marks), trim PDF (online printers) and a
// 300 DPI PNG preview, plus editable HTML sources, specifications and the
// canvassing workbook copy. Nothing here is fabricated: facts come from
// src/config/business.ts (verified at build time) and QR codes from the
// existing marketing-link registry.

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FACTS, verifyFacts } from './print-facts.mjs';

const ROOT = process.cwd();
const TMP = path.join('canvass-out', 'print-tmp');
const OUT = path.join(os.homedir(), 'Downloads', 'Door Knocking');
const BLEED = 0.125;

verifyFacts();

function readQr(id) {
  const file = path.join('public', 'marketing', 'qr', `${id}.svg`);
  const svg = fs.readFileSync(file, 'utf8');
  return svg.replace(/<\?xml[^>]*\?>/, '').replace(/<svg /, '<svg class="qr-svg" preserveAspectRatio="xMidYMid meet" ');
}

function crest() {
  return `<svg class="crest" viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="gold" x1="0" y1="0" x2="0.85" y2="1">
    <stop offset="0" stop-color="#e2c07c"/><stop offset="0.55" stop-color="#c6a369"/><stop offset="1" stop-color="#9d7736"/>
  </linearGradient></defs>
  <g fill="none" stroke="url(#gold)"><circle cx="32" cy="32" r="26.5" stroke-width="1.5"/>
  <path d="M24.6 55.4c-6.1-2.5-11-7.4-13.4-13.6" stroke-width="3.4" stroke-linecap="round"/></g>
  <g fill="url(#gold)">
    <path d="M17.5 9.5 19 15l5.5 1.5L19 18l-1.5 5.5L16 18l-5.5-1.5L16 15z"/>
    <path d="M12.5 22.5 13.4 26l3.6.9-3.6.9-.9 3.6-.9-3.6-3.6-.9 3.6-.9z"/>
    <path d="M50.5 16.5 52 22l5.5 1.5L52 25l-1.5 5.5L49 25l-5.5-1.5L49 22z"/>
  </g>
  <text x="33.5" y="43.5" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-style="italic" font-weight="600" font-size="34" fill="url(#gold)">S</text>
  <g><circle cx="47.2" cy="46.6" r="2.9" fill="#e8b3bf"/><circle cx="51.9" cy="50.3" r="2.9" fill="#c97285"/>
  <circle cx="49.6" cy="55.8" r="2.9" fill="#e8b3bf"/><circle cx="43.9" cy="55.6" r="2.9" fill="#c97285"/>
  <circle cx="41.7" cy="50.1" r="2.9" fill="#e8b3bf"/><circle cx="46.9" cy="51.4" r="2.4" fill="#c6a369"/></g>
</svg>`;
}

function lockup({ crestSize = '0.55in', scale = 1, tone = 'dark' } = {}) {
  const scriptColor = tone === 'light' ? '#e8b3bf' : 'var(--rose-600)';
  const capsColor = tone === 'light' ? '#fdfbf8' : 'var(--ink-800)';
  const descriptorColor = tone === 'light' ? '#e3cda4' : 'var(--taupe-600)';
  return `<div class="lockup" style="--crest:${crestSize};--scale:${scale}">
  ${crest()}
  <div class="lockup__text">
    <div class="lockup__word"><span class="lockup__script" style="color:${scriptColor}">${FACTS.scriptWord}</span><span class="lockup__caps" style="color:${capsColor}">${FACTS.capsWord}</span></div>
    <div class="lockup__descriptor" style="color:${descriptorColor}">${FACTS.descriptor}</div>
  </div>
</div>`;
}

function qr(id, size = '1.3in', caption = 'Scan for a fast estimate') {
  return `<div class="qr" style="--qr:${size}">${readQr(id)}<div class="qr__caption">${caption}</div></div>`;
}

function baseCss() {
  return `
  @font-face { font-family: 'Fraunces'; src: url('../../public/fonts/fraunces-normal-latin.woff2') format('woff2'); font-weight: 300 700; font-style: normal; }
  @font-face { font-family: 'Fraunces'; src: url('../../public/fonts/fraunces-italic-latin.woff2') format('woff2'); font-weight: 300 700; font-style: italic; }
  @font-face { font-family: 'Nunito Sans'; src: url('../../public/fonts/nunito-sans-normal-latin.woff2') format('woff2'); font-weight: 200 1000; font-style: normal; }
  @font-face { font-family: 'Great Vibes'; src: url('../../public/fonts/great-vibes-normal-latin.woff2') format('woff2'); font-weight: 400; font-style: normal; }
  :root {
    --cream-50:#fdfbf8; --cream-100:#f9f3ed; --cream-200:#f1e7dd; --sand-300:#e4d5c7; --sand-400:#cdb9a8;
    --taupe-500:#8c7a70; --taupe-600:#6f5f57; --ink-700:#4a3b40; --ink-800:#3d3036; --ink-900:#302429;
    --rose-100:#f9e6e9; --rose-300:#e8b3bf; --rose-500:#c97285; --rose-600:#b15a6f; --rose-700:#93475b;
    --champagne-100:#f7efdf; --champagne-300:#e3cda4; --champagne-500:#c6a369; --champagne-700:#8a6d38;
    --font-display:'Fraunces', Georgia, serif; --font-body:'Nunito Sans', system-ui, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: var(--font-body); color: var(--ink-800); background: var(--cream-50); }
  .sheet { position: absolute; overflow: hidden; background: var(--cream-50); }
  .crop { position: absolute; background: #111; }
  .crop--h { height: 0.008in; width: 0.07in; }
  .crop--v { width: 0.008in; height: 0.07in; }
  .lockup { display: flex; align-items: center; gap: calc(0.09in * var(--scale)); }
  .crest { width: var(--crest); height: var(--crest); flex: 0 0 auto; }
  .lockup__word { display: flex; align-items: baseline; gap: calc(0.05in * var(--scale)); }
  .lockup__script { font-family: 'Great Vibes', cursive; color: var(--rose-600); font-size: calc(0.42in * var(--scale)); line-height: 0.95; }
  .lockup__caps { font-family: var(--font-display); color: var(--ink-800); font-size: calc(0.2in * var(--scale)); letter-spacing: calc(0.045in * var(--scale)); font-weight: 600; }
  .lockup__descriptor { font-family: var(--font-display); color: var(--taupe-600); font-size: calc(0.11in * var(--scale)); letter-spacing: calc(0.03in * var(--scale)); text-transform: uppercase; margin-top: calc(0.02in * var(--scale)); }
  .qr { display: flex; flex-direction: column; align-items: center; gap: 0.05in; }
  .qr-svg { width: var(--qr); height: var(--qr); display: block; }
  .qr__caption { font-size: 0.105in; font-weight: 700; color: var(--ink-700); text-align: center; line-height: 1.25; }
  .headline { font-family: var(--font-display); font-weight: 600; color: var(--ink-900); line-height: 1.05; }
  .accent { color: var(--rose-700); }
  .gold { color: var(--champagne-700); }
  .bullets { list-style: none; display: grid; gap: 0.07in; }
  .bullets li { display: flex; gap: 0.07in; align-items: flex-start; font-size: 0.115in; line-height: 1.35; color: var(--ink-700); }
  .bullets li::before { content: ''; flex: 0 0 auto; width: 0.055in; height: 0.055in; border-radius: 50%; background: var(--champagne-500); margin-top: 0.035in; }
  .trust { font-size: 0.1in; color: var(--taupe-600); line-height: 1.35; }
  .phone { font-weight: 800; color: var(--ink-900); }
  .gold-rule { height: 0.012in; background: var(--champagne-500); border-radius: 99px; }
  .chip { display: inline-block; background: var(--champagne-100); border: 0.008in solid var(--champagne-300); color: var(--champagne-700); border-radius: 99px; padding: 0.035in 0.09in; font-size: 0.09in; font-weight: 800; letter-spacing: 0.02in; text-transform: uppercase; }
  `;
}

function pageHtml({ name, width, height, bleed, body }) {
  const pageWidth = width + bleed * 2;
  const pageHeight = height + bleed * 2;
  const marks = bleed > 0 ? cropMarks(width, height, bleed) : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<style>
  @page { size: ${pageWidth}in ${pageHeight}in; margin: 0; }
  ${baseCss()}
  body { width: ${pageWidth}in; height: ${pageHeight}in; position: relative; }
  .sheet { left: ${bleed}in; top: ${bleed}in; width: ${width}in; height: ${height}in; }
</style></head><body>${marks}<div class="sheet">${body}</div></body></html>`;
}

function cropMarks(width, height, bleed) {
  const gap = 0.02;
  const length = 0.07;
  const mark = (cls, left, top) => `<div class="crop crop--${cls}" style="left:${left}in;top:${top}in"></div>`;
  const corners = [];
  for (const [x, y] of [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ]) {
    corners.push(mark('h', x - length - gap, y - 0.004));
    corners.push(mark('v', x - 0.004, y - length - gap));
  }
  return corners.join('');
}

const pieces = [];

function definePiece(piece) {
  pieces.push(piece);
}

// ── 1. Business card (3.5 × 2) ────────────────────────────────────────────────
definePiece({
  slug: 'business-card',
  name: 'Business card',
  width: 3.5,
  height: 2,
  sides: [
    {
      suffix: 'front',
      html: () => `
      <div style="position:absolute;inset:0;padding:0.17in 0.2in;display:flex;flex-direction:column;justify-content:space-between">
        ${lockup({ crestSize: '0.45in', scale: 0.7 })}
        <div>
          <div class="headline" style="font-size:0.3in;margin-bottom:0.02in">${FACTS.founder}</div>
          <div style="font-size:0.105in;font-weight:700;color:var(--rose-700);letter-spacing:0.015in;text-transform:uppercase">${FACTS.founderRole}</div>
        </div>
        <div style="display:grid;gap:0.035in;font-size:0.105in;color:var(--ink-700)">
          <div>${FACTS.phoneDisplay} &nbsp;·&nbsp; ${FACTS.email}</div>
          <div>${FACTS.domain}</div>
          <div class="trust">${FACTS.serviceArea}</div>
        </div>
      </div>`,
    },
    {
      suffix: 'back',
      html: () => `
      <div style="position:absolute;inset:0;display:flex">
        <div style="flex:1.15;padding:0.17in 0.14in 0.17in 0.2in;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="headline" style="font-size:0.22in">A cleaner home.<br><span class="accent">Less stress. More time.</span></div>
          </div>
          <ul class="bullets" style="font-size:0.105in">
            <li>Weekly, biweekly or monthly</li>
            <li>The same standard every visit</li>
            <li>${FACTS.founder} confirms every request</li>
          </ul>
          <div class="gold-rule" style="width:0.7in"></div>
        </div>
        <div style="flex:0.85;background:var(--ink-900);display:flex;align-items:center;justify-content:center">
          <div style="background:var(--cream-50);border-radius:0.12in;padding:0.12in 0.1in;display:flex;flex-direction:column;align-items:center;gap:0.05in">
            ${readQr('business-card').replace('class="qr-svg"', 'class="qr-svg" style="width:1.05in;height:1.05in"')}
            <div style="font-size:0.095in;font-weight:800;color:var(--ink-900);text-align:center;line-height:1.25">Scan for a fast,<br>free estimate</div>
          </div>
        </div>
      </div>`,
    },
  ],
});

// ── 2. Quarter sheet (4.25 × 5.5) ────────────────────────────────────────────
definePiece({
  slug: 'quarter-sheet',
  name: 'Quarter sheet',
  width: 4.25,
  height: 5.5,
  sides: [
    {
      suffix: 'front',
      html: () => `
      <div style="position:absolute;inset:0;padding:0.3in;display:flex;flex-direction:column;gap:0.22in;background:var(--cream-50)">
        ${lockup({ crestSize: '0.55in', scale: 0.8 })}
        <div>
          <div class="headline" style="font-size:0.42in">${FACTS.tagline}</div>
          <div style="margin-top:0.12in;font-size:0.13in;line-height:1.4;color:var(--ink-700)">Recurring house cleaning planned around your home — not a route clock.</div>
        </div>
        <ul class="bullets" style="font-size:0.125in">
          <li>Estimates built from real labor hours, not guesswork</li>
          <li>Weekly, biweekly or monthly — the details stay done</li>
          <li>${FACTS.founder} personally confirms every request</li>
        </ul>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;border-top:0.01in solid var(--sand-300);padding-top:0.18in">
          ${qr('quarter-sheet', '1.5in', 'Scan to start your<br>free estimate')}
          <div style="text-align:right;display:grid;gap:0.05in">
            <div class="phone" style="font-size:0.17in">${FACTS.phoneDisplay}</div>
            <div style="font-size:0.105in;color:var(--taupe-600)">${FACTS.domain}</div>
            <div class="trust">Owner-operated · ${FACTS.hours}</div>
          </div>
        </div>
      </div>`,
    },
  ],
});

// ── 3. Door hanger (3.5 × 8.5, 1.25in die-cut hole) ──────────────────────────
definePiece({
  slug: 'door-hanger',
  name: 'Door hanger',
  width: 3.5,
  height: 8.5,
  sides: [
    {
      suffix: 'front',
      html: () => `
      <div style="position:absolute;inset:0;background:var(--cream-50);display:flex;flex-direction:column">
        <div style="height:2.5in;position:relative;background:var(--ink-900);display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:0.22in">
          <div style="position:absolute;top:0.3in;left:50%;transform:translateX(-50%);width:1.25in;height:1.25in;border-radius:50%;border:0.012in dashed rgba(253,251,248,0.55)"></div>
          <div style="text-align:center">
            ${lockup({ crestSize: '0.45in', scale: 0.7, tone: 'light' })}
            <div style="font-family:'Great Vibes',cursive;color:var(--rose-300);font-size:0.17in;margin-top:0.04in">${FACTS.tagline}</div>
          </div>
        </div>
        <div style="flex:1;padding:0.28in 0.26in;display:flex;flex-direction:column;gap:0.2in">
          <div class="headline" style="font-size:0.34in">A cleaning standard your neighbors can see.</div>
          <div style="font-size:0.13in;line-height:1.4;color:var(--ink-700)">Recurring house cleaning in this neighborhood — with the details most cleaners skip.</div>
          <ul class="bullets">
            <li>Weekly, biweekly or monthly recurring plans</li>
            <li>Honest estimates built from real labor hours</li>
            <li>Every request confirmed personally by ${FACTS.founder}</li>
          </ul>
          <div style="margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:0.16in">
            ${qr('door-hanger', '1.75in', 'Scan for your free estimate')}
            <div class="phone" style="font-size:0.19in">${FACTS.phoneDisplay}</div>
            <div style="font-size:0.105in;color:var(--taupe-600)">${FACTS.domain}</div>
          </div>
        </div>
      </div>`,
    },
  ],
});

// ── 4. QR estimate card (4 × 6) ──────────────────────────────────────────────
definePiece({
  slug: 'qr-estimate-card',
  name: 'QR estimate card',
  width: 4,
  height: 6,
  sides: [
    {
      suffix: 'front',
      html: () => `
      <div style="position:absolute;inset:0;padding:0.3in;display:flex;flex-direction:column;align-items:center;gap:0.14in;background:var(--cream-50)">
        ${lockup({ crestSize: '0.45in', scale: 0.72 })}
        <div class="headline" style="font-size:0.4in;text-align:center;margin-top:0.05in">Your estimate in<br><span class="accent">about a minute.</span></div>
        <div style="display:grid;gap:0.09in;width:100%;margin-top:0.06in">
          <div style="display:flex;gap:0.1in;align-items:center;font-size:0.12in;color:var(--ink-700)"><span class="chip">1</span> Scan the code</div>
          <div style="display:flex;gap:0.1in;align-items:center;font-size:0.12in;color:var(--ink-700)"><span class="chip">2</span> Answer a few questions about your home</div>
          <div style="display:flex;gap:0.1in;align-items:center;font-size:0.12in;color:var(--ink-700)"><span class="chip">3</span> See your proposed price instantly</div>
        </div>
        <div style="margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:0.12in">
          ${qr('qr-estimate-card', '1.95in', 'Scan me')}
          <div class="trust" style="text-align:center;max-width:2.9in">No obligation. Every request is confirmed personally by ${FACTS.founder} before anything is scheduled.</div>
          <div class="phone" style="font-size:0.16in">${FACTS.phoneDisplay}</div>
        </div>
      </div>`,
    },
  ],
});

// ── 5. Event poster (11 × 17) ────────────────────────────────────────────────
definePiece({
  slug: 'event-poster',
  name: 'Event poster',
  width: 11,
  height: 17,
  sides: [
    {
      suffix: 'front',
      html: () => `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--cream-50)">
        <div style="padding:0.55in 0.7in 0.3in;display:flex;justify-content:space-between;align-items:flex-start">
          ${lockup({ crestSize: '1in', scale: 1.5 })}
          <div class="chip" style="margin-top:0.15in">Owner-operated</div>
        </div>
        <div style="flex:1;display:flex;gap:0.7in;padding:0.1in 0.7in 0.5in">
          <div style="flex:1.15;display:flex;flex-direction:column;gap:0.3in">
            <div class="headline" style="font-size:1.15in">${FACTS.tagline}</div>
            <div style="font-size:0.28in;line-height:1.4;color:var(--ink-700);max-width:5.4in">Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
            <ul class="bullets" style="gap:0.16in;margin-top:0.1in">
              <li style="font-size:0.24in">Estimates built from real labor hours</li>
              <li style="font-size:0.24in">The details most cleaners skip, every visit</li>
              <li style="font-size:0.24in">${FACTS.founder} confirms every request personally</li>
            </ul>
            <div class="chip" style="font-size:0.16in;align-self:flex-start">Now scheduling in your neighborhood</div>
            <div style="margin-top:auto;display:flex;align-items:center;gap:0.55in">
              ${qr('event-poster', '2.5in', 'Scan for a free instant estimate')}
              <div style="display:grid;gap:0.12in">
                <div class="phone" style="font-size:0.32in;white-space:nowrap">${FACTS.phoneDisplay}</div>
                <div style="font-size:0.2in;color:var(--taupe-600);white-space:nowrap">${FACTS.domain}</div>
                <div class="trust" style="font-size:0.17in">${FACTS.hours}</div>
              </div>
            </div>
          </div>
          <div style="flex:0.85;display:flex;flex-direction:column;align-items:center;gap:0.2in">
            <div style="width:100%;border-radius:0.25in;overflow:hidden;border:0.02in solid var(--sand-300);background:var(--cream-200)">
              <img src="../../src/assets/images/hayli-founder.webp" style="width:100%;display:block" alt="">
            </div>
            <div style="text-align:center">
              <div class="headline" style="font-size:0.34in">${FACTS.founder}</div>
              <div style="font-size:0.17in;font-weight:700;color:var(--rose-700);text-transform:uppercase;letter-spacing:0.03in">${FACTS.founderRole}</div>
            </div>
          </div>
        </div>
        <div style="background:var(--ink-900);color:var(--cream-50);padding:0.28in 0.7in;display:flex;justify-content:space-between;align-items:center;font-size:0.2in">
          <span>${FACTS.serviceArea}</span>
          <span style="font-family:'Great Vibes',cursive;color:var(--rose-300);font-size:0.3in">${FACTS.tagline}</span>
        </div>
      </div>`,
    },
  ],
});

// ── 6. Foam board (24 × 36) ──────────────────────────────────────────────────
definePiece({
  slug: 'foam-board',
  name: 'Foam board',
  width: 24,
  height: 36,
  sides: [
    {
      suffix: 'front',
      html: () => `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--cream-50)">
        <div style="padding:1.1in 1.4in 0.5in;display:flex;justify-content:space-between;align-items:flex-start">
          ${lockup({ crestSize: '2in', scale: 3 })}
          <div class="chip" style="margin-top:0.3in;font-size:0.2in;padding:0.08in 0.2in">Owner-operated</div>
        </div>
        <div style="flex:1;display:flex;gap:1.4in;padding:0.2in 1.4in 1in">
          <div style="flex:1.15;display:flex;flex-direction:column;gap:0.6in">
            <div class="headline" style="font-size:2.4in">${FACTS.tagline}</div>
            <div style="font-size:0.62in;line-height:1.4;color:var(--ink-700);max-width:12in">Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
            <ul class="bullets" style="gap:0.34in;margin-top:0.2in">
              <li style="font-size:0.52in">Estimates built from real labor hours</li>
              <li style="font-size:0.52in">The details most cleaners skip, every visit</li>
              <li style="font-size:0.52in">${FACTS.founder} confirms every request personally</li>
            </ul>
            <div class="chip" style="font-size:0.34in;align-self:flex-start">Now scheduling in your neighborhood</div>
            <div style="margin-top:auto;display:flex;align-items:center;gap:1.2in">
              ${qr('foam-board', '5.4in', 'Scan for a free instant estimate')}
              <div style="display:grid;gap:0.28in">
                <div class="phone" style="font-size:0.72in;white-space:nowrap">${FACTS.phoneDisplay}</div>
                <div style="font-size:0.44in;color:var(--taupe-600);white-space:nowrap">${FACTS.domain}</div>
                <div class="trust" style="font-size:0.36in">${FACTS.hours}</div>
              </div>
            </div>
          </div>
          <div style="flex:0.8;display:flex;flex-direction:column;align-items:center;gap:0.5in">
            <div style="width:100%;border-radius:0.5in;overflow:hidden;border:0.04in solid var(--sand-300);background:var(--cream-200)">
              <img src="../../src/assets/images/hayli-founder.webp" style="width:100%;display:block" alt="">
            </div>
            <div style="text-align:center">
              <div class="headline" style="font-size:0.75in">${FACTS.founder}</div>
              <div style="font-size:0.38in;font-weight:700;color:var(--rose-700);text-transform:uppercase;letter-spacing:0.06in">${FACTS.founderRole}</div>
            </div>
          </div>
        </div>
        <div style="background:var(--ink-900);color:var(--cream-50);padding:0.55in 1.4in;display:flex;justify-content:space-between;align-items:center;font-size:0.42in">
          <span>${FACTS.serviceArea}</span>
          <span style="font-family:'Great Vibes',cursive;color:var(--rose-300);font-size:0.66in">${FACTS.tagline}</span>
        </div>
      </div>`,
    },
  ],
});

// ── 7. Community leave-behind (5 × 7) ────────────────────────────────────────
definePiece({
  slug: 'community-leave-behind',
  name: 'Community leave-behind',
  width: 5,
  height: 7,
  sides: [
    {
      suffix: 'front',
      html: () => `
      <div style="position:absolute;inset:0;padding:0.4in;display:flex;flex-direction:column;gap:0.24in;background:var(--cream-50)">
        ${lockup({ crestSize: '0.5in', scale: 0.85 })}
        <div>
          <div class="headline" style="font-size:0.42in">A home company, built one detail at a time.</div>
          <div style="margin-top:0.1in;font-size:0.125in;line-height:1.4;color:var(--ink-700)">Keep this card. When your home needs a hand, ${FACTS.founder} answers personally.</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.09in 0.16in;font-size:0.115in;color:var(--ink-700)">
          <div>· Recurring house cleaning</div><div>· Deep cleaning</div>
          <div>· Move-in / move-out</div><div>· Short-term rentals</div>
          <div>· Commercial spaces</div><div>· Churches</div>
        </div>
        <div style="background:var(--champagne-100);border:0.01in solid var(--champagne-300);border-radius:0.14in;padding:0.16in 0.18in;display:grid;gap:0.06in">
          <div style="font-family:var(--font-display);font-size:0.17in;color:var(--ink-900)">Owner-operated by ${FACTS.founder}</div>
          <div style="font-size:0.11in;color:var(--ink-700);line-height:1.4">Every request is confirmed personally, and the details stay done visit after visit.</div>
        </div>
        <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between;border-top:0.01in solid var(--sand-300);padding-top:0.2in">
          ${qr('community-leave-behind', '1.4in', 'Scan for your<br>free estimate')}
          <div style="text-align:right;display:grid;gap:0.05in">
            <div class="phone" style="font-size:0.18in">${FACTS.phoneDisplay}</div>
            <div style="font-size:0.105in;color:var(--taupe-600)">${FACTS.email}</div>
            <div style="font-size:0.105in;color:var(--taupe-600)">${FACTS.domain}</div>
          </div>
        </div>
      </div>`,
    },
  ],
});

// ── 8. Realtor referral card (3.5 × 2) ───────────────────────────────────────
definePiece({
  slug: 'realtor-card',
  name: 'Realtor referral card',
  width: 3.5,
  height: 2,
  sides: [
    {
      suffix: 'front',
      html: () => `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column">
        <div style="padding:0.13in 0.16in 0.08in;display:flex;justify-content:space-between;align-items:center">
          ${lockup({ crestSize: '0.34in', scale: 0.55 })}
          <div class="chip" style="font-size:0.075in">For realtors</div>
        </div>
        <div style="flex:1;display:flex">
          <div style="flex:1.25;padding:0.02in 0.1in 0.14in 0.16in;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div class="headline" style="font-size:0.22in">For your move-out clients.</div>
              <div style="font-size:0.1in;line-height:1.35;color:var(--ink-700);margin-top:0.03in">Move-in / move-out cleaning, scheduled around closings.</div>
            </div>
            <div style="display:grid;gap:0.02in;color:var(--ink-700)">
              <div class="phone" style="font-size:0.13in">${FACTS.phoneDisplay}</div>
              <div style="font-size:0.085in">${FACTS.email}</div>
              <div style="font-size:0.085in">${FACTS.domain}</div>
            </div>
          </div>
          <div style="flex:0.75;background:var(--ink-900);display:flex;align-items:center;justify-content:center;padding:0.08in">
            <div style="background:var(--cream-50);border-radius:0.1in;padding:0.08in 0.06in;display:flex;flex-direction:column;align-items:center;gap:0.035in">
              ${readQr('realtor-packet').replace('class="qr-svg"', 'class="qr-svg" style="width:0.85in;height:0.85in"')}
              <div style="font-size:0.07in;font-weight:800;color:var(--ink-900);text-align:center;line-height:1.2">Scan for the move-out page</div>
            </div>
          </div>
        </div>
      </div>`,
    },
  ],
});

// ── Build ─────────────────────────────────────────────────────────────────────
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, item.name);
    const target = path.join(to, item.name);
    if (item.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

async function main() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  for (const dir of ['Print-Ready-PDF', 'PNG-Previews', 'Editable-Sources', 'Specifications']) {
    fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  }

  const browser = await chromium.launch();
  const manifest = [];

  for (const piece of pieces) {
    for (const side of piece.sides) {
      const fileBase = `${piece.slug}-${side.suffix}`;
      const body = side.html();

      // Bleed PDF (crop marks) and trim PDF.
      for (const variant of [
        { suffix: 'bleed', bleed: BLEED },
        { suffix: 'trim', bleed: 0 },
      ]) {
        const htmlPath = path.join(TMP, `${fileBase}-${variant.suffix}.html`);
        fs.writeFileSync(htmlPath, pageHtml({ name: fileBase, width: piece.width, height: piece.height, bleed: variant.bleed, body }), 'utf8');
        const page = await browser.newPage();
        await page.goto('file://' + path.resolve(htmlPath).replace(/\\/g, '/'), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.pdf({
          path: path.join(OUT, 'Print-Ready-PDF', `${fileBase}-${variant.suffix}.pdf`),
          preferCSSPageSize: true,
          printBackground: true,
        });
        await page.close();
      }

      // 300 DPI PNG preview (trim size).
      const pngHtml = path.join(TMP, `${fileBase}-trim.html`);
      const context = await browser.newContext({
        viewport: { width: Math.round(piece.width * 96), height: Math.round(piece.height * 96) },
        deviceScaleFactor: 3.125,
      });
      const page = await context.newPage();
      await page.goto('file://' + path.resolve(pngHtml).replace(/\\/g, '/'), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(OUT, 'PNG-Previews', `${fileBase}.png`), clip: { x: 0, y: 0, width: Math.round(piece.width * 96), height: Math.round(piece.height * 96) } });
      await context.close();

      manifest.push({
        piece: piece.name,
        side: side.suffix,
        trim: `${piece.width} x ${piece.height} in`,
        files: [`${fileBase}-bleed.pdf`, `${fileBase}-trim.pdf`, `${fileBase}.png`],
      });
      console.log(`  built ${fileBase} (${piece.width}×${piece.height} in)`);
    }
  }

  await browser.close();

  // Editable sources: HTML with relative asset paths + copied assets.
  const assets = path.join(OUT, 'Editable-Sources', 'assets');
  copyDir(path.join('public', 'fonts'), path.join(assets, 'fonts'));
  fs.mkdirSync(path.join(assets, 'images'), { recursive: true });
  fs.copyFileSync(path.join('src', 'assets', 'images', 'hayli-founder.webp'), path.join(assets, 'images', 'hayli-founder.webp'));
  fs.mkdirSync(path.join(assets, 'qr'), { recursive: true });
  for (const qrId of ['business-card', 'quarter-sheet', 'door-hanger', 'qr-estimate-card', 'event-poster', 'foam-board', 'community-leave-behind', 'realtor-packet']) {
    fs.copyFileSync(path.join('public', 'marketing', 'qr', `${qrId}.svg`), path.join(assets, 'qr', `${qrId}.svg`));
  }
  for (const piece of pieces) {
    for (const side of piece.sides) {
      const fileBase = `${piece.slug}-${side.suffix}`;
      let html = fs.readFileSync(path.join(TMP, `${fileBase}-trim.html`), 'utf8');
      html = html
        .replace(/\.\.\/\.\.\/public\/fonts\//g, 'assets/fonts/')
        .replace(/\.\.\/\.\.\/src\/assets\/images\//g, 'assets/images/');
      fs.writeFileSync(path.join(OUT, 'Editable-Sources', `${fileBase}.html`), html, 'utf8');
    }
  }

  fs.writeFileSync(path.join(OUT, 'Specifications', 'asset-manifest.json'), JSON.stringify(manifest, null, 2));

  // Owner-facing documentation copies (single source lives in the repository).
  fs.copyFileSync(
    path.join('docs', 'marketing', 'field-acquisition', 'OWNER-GUIDE.md'),
    path.join(OUT, 'README.md'),
  );
  fs.copyFileSync(
    path.join('docs', 'marketing', 'field-acquisition', 'PRINT-SPECIFICATIONS.md'),
    path.join(OUT, 'Specifications', 'PRINT-SPECIFICATIONS.md'),
  );
  fs.copyFileSync(
    path.join('docs', 'brand', 'PHYSICAL-BRAND-SYSTEM-AUDIT.md'),
    path.join(OUT, 'Specifications', 'BRAND-AUDIT.md'),
  );

  const registerRows = [
    ['piece', 'side', 'trim', 'files'],
    ...manifest.map((entry) => [entry.piece, entry.side, entry.trim, entry.files.join(' ')]),
  ];
  fs.writeFileSync(
    path.join(OUT, 'Specifications', 'ASSET-REGISTER.csv'),
    registerRows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n',
  );

  // Canvassing operations copy.
  const canvassSource = 'canvass-out';
  if (fs.existsSync(canvassSource)) {
    const target = path.join(OUT, 'Canvassing');
    fs.mkdirSync(target, { recursive: true });
    for (const file of ['Canvassing-Workbook.xlsx', 'route_sheets.html', 'performance_tracking.csv', 'master_addresses.csv', 'routes.csv', 'map.html', 'routes_summary.json']) {
      const source = path.join(canvassSource, file);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, file));
    }
  }

  console.log(`\nbuilt ${manifest.length} print sides into ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
