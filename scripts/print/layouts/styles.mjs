// Print stylesheet — tokens generated from the shared brand palette so the
// print system can never drift from the site tokens.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { printPalette, crestGradient } from '../../../src/config/brand.ts';
import { PRINT_GEOMETRY } from '../manifest.mjs';

const P = printPalette;
const fontUrl = (name) => pathToFileURL(path.resolve('public/fonts', name)).href;

function tokens() {
  return `:root {
  --cream-50:${P.cream50}; --cream-100:${P.cream100}; --cream-200:${P.cream200};
  --sand-300:${P.sand300}; --sand-400:${P.sand400};
  --taupe-500:${P.taupe500}; --taupe-600:${P.taupe600};
  --ink-700:${P.ink700}; --ink-800:${P.ink800}; --ink-900:${P.ink900};
  --rose-50:#fdf4f5; --rose-100:${P.rose100}; --rose-300:${P.rose300}; --rose-500:${P.rose500};
  --rose-600:${P.rose600}; --rose-700:${P.rose700};
  --champagne-100:${P.champagne100}; --champagne-300:${P.champagne300};
  --champagne-500:${P.champagne500}; --champagne-700:${P.champagne700};
  --gold-light:${crestGradient.light}; --gold-mid:${crestGradient.mid}; --gold-dark:${crestGradient.dark};
  --font-display:'Fraunces', Georgia, serif; --font-body:'Nunito Sans', system-ui, sans-serif;
}`;
}

export function baseCss() {
  const g = PRINT_GEOMETRY;
  return `
@font-face { font-family:'Fraunces'; src:url('${fontUrl('fraunces-normal-latin.woff2')}') format('woff2'); font-weight:300 700; font-style:normal; }
@font-face { font-family:'Fraunces'; src:url('${fontUrl('fraunces-italic-latin.woff2')}') format('woff2'); font-weight:300 700; font-style:italic; }
@font-face { font-family:'Nunito Sans'; src:url('${fontUrl('nunito-sans-normal-latin.woff2')}') format('woff2'); font-weight:200 1000; font-style:normal; }
@font-face { font-family:'Nunito Sans'; src:url('${fontUrl('nunito-sans-italic-latin.woff2')}') format('woff2'); font-weight:200 1000; font-style:italic; }
@font-face { font-family:'Great Vibes'; src:url('${fontUrl('great-vibes-normal-latin.woff2')}') format('woff2'); font-weight:400; font-style:normal; }
${tokens()}
* { box-sizing:border-box; margin:0; padding:0; }
html, body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { font-family:var(--font-body); color:var(--ink-800); background:#fff; }
.page { position:relative; overflow:hidden; background:var(--cream-50); }
.qrsvg { width:100% !important; height:auto !important; display:block; }
img { max-width:100%; }
.crop { position:absolute; background:#111; }
.crop--h { height:${g.cropMarkThickness}in; width:${g.cropMarkLength}in; }
.crop--v { width:${g.cropMarkThickness}in; height:${g.cropMarkLength}in; }

/* ── Direction A — editorial ─────────────────────────────────────────────── */
.dir-editorial .a-lockup { display:flex; align-items:center; gap:.08in; }
.dir-editorial .a-word { display:flex; align-items:baseline; gap:.045in; }
.dir-editorial .a-script { font-family:'Great Vibes', cursive; color:var(--rose-600); line-height:.95; }
.dir-editorial .a-caps { font-family:var(--font-display); font-weight:600; color:var(--ink-900); letter-spacing:.15em; }
.dir-editorial .a-descriptor { font-family:var(--font-display); color:var(--taupe-600); letter-spacing:.22em; text-transform:uppercase; margin-top:.02in; }
.dir-editorial .a-name { font-family:var(--font-display); font-weight:600; color:var(--ink-900); line-height:1; }
.dir-editorial .a-role { font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:var(--rose-700); }
.dir-editorial .a-rule { height:.006in; background:var(--champagne-500); width:100%; }
.dir-editorial .a-rule-soft { height:.004in; background:var(--sand-300); width:100%; }
.dir-editorial .a-phone { font-weight:800; color:var(--ink-900); line-height:1; white-space:nowrap; }
.dir-editorial .a-small { color:var(--ink-700); line-height:1.4; }
.dir-editorial .a-label { font-weight:800; letter-spacing:.18em; text-transform:uppercase; color:var(--taupe-600); }
.dir-editorial .a-head { font-family:var(--font-display); font-weight:600; color:var(--ink-900); line-height:1.03; }
.dir-editorial .a-body { line-height:1.45; color:var(--ink-700); }
.dir-editorial .a-row { display:flex; gap:.1in; border-top:.004in solid var(--sand-300); }
.dir-editorial .a-row:last-child { border-bottom:.004in solid var(--sand-300); }
.dir-editorial .a-num { font-family:var(--font-display); font-style:italic; color:var(--champagne-700); flex:0 0 auto; }
.dir-editorial .a-rowtext { color:var(--ink-700); line-height:1.25; }
.dir-editorial .a-qr { flex:0 0 auto; }
.dir-editorial .a-qr-frame { border:.006in solid var(--ink-700); padding:.07in; background:#fff; width:fit-content; margin:0 auto; }
.dir-editorial .a-qr-cap { letter-spacing:.14em; text-transform:uppercase; color:var(--taupe-600); text-align:center; margin-top:.05in; line-height:1.3; }

/* ── Direction B — hospitality ───────────────────────────────────────────── */
.dir-neighbor .b-lockup { display:flex; align-items:center; gap:.08in; }
.dir-neighbor .b-lockup--center { justify-content:center; }
.dir-neighbor .b-word { display:flex; align-items:baseline; gap:.045in; }
.dir-neighbor .b-script { font-family:'Great Vibes', cursive; color:var(--rose-600); line-height:.95; }
.dir-neighbor .b-caps { font-family:var(--font-display); font-weight:600; color:var(--ink-900); letter-spacing:.15em; }
.dir-neighbor .b-descriptor { font-family:var(--font-display); color:var(--taupe-600); letter-spacing:.22em; text-transform:uppercase; margin-top:.02in; }
.dir-neighbor .b-name { font-family:var(--font-display); font-weight:600; color:var(--ink-900); line-height:1; }
.dir-neighbor .b-role { font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--rose-700); margin-top:.03in; }
.dir-neighbor .b-phone { font-weight:800; color:var(--ink-900); line-height:1; white-space:nowrap; }
.dir-neighbor .b-small { color:var(--ink-700); line-height:1.35; }
.dir-neighbor .b-head { font-family:var(--font-display); font-weight:600; color:var(--ink-900); line-height:1.05; }
.dir-neighbor .b-body { line-height:1.45; color:var(--ink-700); }
.dir-neighbor .b-item { display:flex; gap:.07in; align-items:flex-start; margin-bottom:.06in; color:var(--ink-700); line-height:1.3; }
.dir-neighbor .b-check { display:flex; }
.dir-neighbor .b-qr { flex:0 0 auto; }
.dir-neighbor .b-qr-frame { border:.008in solid var(--sand-300); background:#fff; border-radius:.12in; padding:.09in; width:fit-content; margin:0 auto; }
.dir-neighbor .b-qr-cap { color:var(--taupe-600); text-align:center; margin-top:.06in; line-height:1.35; }
.dir-neighbor .b-pill { display:inline-block; background:var(--rose-100); border:.008in solid var(--rose-300); color:var(--rose-700); border-radius:99px; padding:.04in .12in; font-size:.09in; font-weight:800; letter-spacing:.04in; text-transform:uppercase; }
.dir-neighbor .b-panel { background:var(--champagne-100); border:.008in solid var(--champagne-300); border-radius:.14in; padding:.16in .18in; }

/* ── Direction C — detail utility ────────────────────────────────────────── */
.dir-utility .c-lockup { display:flex; align-items:center; gap:.08in; }
.dir-utility .c-word { display:flex; align-items:baseline; gap:.045in; }
.dir-utility .c-script { font-family:'Great Vibes', cursive; color:var(--rose-600); line-height:.95; }
.dir-utility .c-caps { font-family:var(--font-display); font-weight:600; color:var(--ink-900); letter-spacing:.15em; }
.dir-utility .c-descriptor { font-family:var(--font-display); color:var(--taupe-600); letter-spacing:.22em; text-transform:uppercase; margin-top:.02in; }
.dir-utility .c-name { font-family:var(--font-display); font-weight:600; color:var(--ink-900); line-height:1; }
.dir-utility .c-role { font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--rose-700); margin-top:.03in; }
.dir-utility .c-rule { height:.008in; background:var(--ink-900); width:100%; }
.dir-utility .c-head { font-family:var(--font-display); font-weight:600; color:var(--ink-900); line-height:1.04; }
.dir-utility .c-body { line-height:1.45; color:var(--ink-700); }
.dir-utility .c-phone { font-weight:800; color:var(--ink-900); line-height:1; white-space:nowrap; }
.dir-utility .c-label { font-weight:800; letter-spacing:.18em; text-transform:uppercase; color:var(--champagne-700); }
.dir-utility .c-label--light { color:var(--champagne-300); }
.dir-utility .c-tag { display:inline-block; border:.008in solid var(--sand-400); color:var(--ink-700); padding:.035in .09in; font-weight:800; letter-spacing:.12em; text-transform:uppercase; background:#fff; }
.dir-utility .c-grid2 { display:grid; grid-template-columns:auto 1fr; gap:.045in .12in; align-items:baseline; }
.dir-utility .c-lab { font-size:.06in; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--taupe-600); }
.dir-utility .c-val { font-weight:700; color:var(--ink-900); }
.dir-utility .c-check { display:flex; gap:.07in; align-items:flex-start; margin-bottom:.055in; color:var(--ink-700); line-height:1.3; }
.dir-utility .c-box { width:.075in; height:.075in; border:.008in solid var(--ink-700); flex:0 0 auto; margin-top:.015in; background:#fff; }
.dir-utility .c-step { display:flex; gap:.08in; align-items:center; margin-bottom:.06in; color:var(--ink-700); line-height:1.3; }
.dir-utility .c-step-num { width:.17in; height:.17in; border-radius:50%; background:var(--champagne-100); border:.008in solid var(--champagne-300); color:var(--champagne-700); font-weight:800; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
.dir-utility .c-qr { flex:0 0 auto; }
.dir-utility .c-qr-box { position:relative; padding:.06in; background:#fff; border:.004in solid var(--sand-300); width:fit-content; margin:0 auto; }
.dir-utility .c-qr-inner { width:100%; }
.dir-utility .c-tick { position:absolute; width:.1in; height:.1in; }
.dir-utility .c-tick--tl { top:-.008in; left:-.008in; border-top:.014in solid var(--ink-900); border-left:.014in solid var(--ink-900); }
.dir-utility .c-tick--tr { top:-.008in; right:-.008in; border-top:.014in solid var(--ink-900); border-right:.014in solid var(--ink-900); }
.dir-utility .c-tick--bl { bottom:-.008in; left:-.008in; border-bottom:.014in solid var(--ink-900); border-left:.014in solid var(--ink-900); }
.dir-utility .c-tick--br { bottom:-.008in; right:-.008in; border-bottom:.014in solid var(--ink-900); border-right:.014in solid var(--ink-900); }
.dir-utility .c-qr-cap { letter-spacing:.16em; text-transform:uppercase; color:var(--taupe-600); text-align:center; margin-top:.05in; line-height:1.3; }
.dir-utility .c-panel { background:var(--champagne-100); border:.008in solid var(--champagne-300); padding:.12in .14in; }
.dir-utility .c-matrix { border-top:.004in solid var(--sand-300); }
.dir-utility .c-matrix-row { display:flex; justify-content:space-between; gap:.15in; border-bottom:.004in solid var(--sand-300); padding:.055in 0; font-size:.085in; color:var(--ink-700); }
.dir-utility .c-matrix-row span:last-child { color:var(--taupe-600); }

/* ── Suite board ─────────────────────────────────────────────────────────── */
.board { position:relative; overflow:hidden; background:var(--cream-50); font-family:var(--font-body); color:var(--ink-800); }
.board h1 { font-family:var(--font-display); font-weight:600; color:var(--ink-900); line-height:1.02; }
.board .board-sub { color:var(--taupe-600); line-height:1.45; }
.board .board-label { font-weight:800; letter-spacing:.18em; text-transform:uppercase; color:var(--champagne-700); }
.board .board-cell { background:#fff; border:.008in solid var(--sand-300); display:flex; flex-direction:column; }
.board .board-cell .imgwrap { flex:1; display:flex; align-items:center; justify-content:center; padding:.12in; overflow:hidden; }
.board .board-cell img { max-width:100%; max-height:100%; object-fit:contain; }
.board .board-cap { border-top:.004in solid var(--sand-300); padding:.06in .1in; font-size:.085in; color:var(--ink-700); display:flex; justify-content:space-between; gap:.1in; }
.board .board-cap span:last-child { color:var(--taupe-600); }
.board .swatch { width:.28in; height:.28in; border:.004in solid var(--sand-300); }
`;
}
