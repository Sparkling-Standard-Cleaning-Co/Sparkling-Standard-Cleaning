// Verify every QR code in the rendered print previews decodes to the exact
// tracked URL from the marketing-link registry.
//
//   node scripts/print/verify-print-qrs.mjs
//
// Reads ~/Downloads/Door Knocking/PNG-Previews/*.png (300 DPI), decodes the QR
// with jsQR and compares against the expected registry URL. Exits non-zero on
// any mismatch so a misprint can never ship.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const PREVIEWS = path.join(os.homedir(), 'Downloads', 'Door Knocking', 'PNG-Previews');
const BASE = 'https://sparkling-standard.com';

const EXPECTED = {
  'business-card-back.png': `${BASE}/estimate/?utm_source=business_card&utm_medium=print&utm_campaign=business_card&utm_content=qr`,
  'quarter-sheet-front.png': `${BASE}/recurring-cleaning/?utm_source=quarter_sheet&utm_medium=print&utm_campaign=neighborhood&utm_content=qr`,
  'door-hanger-front.png': `${BASE}/recurring-cleaning/?utm_source=door_hanger&utm_medium=print&utm_campaign=door_hanger&utm_content=recurring`,
  'qr-estimate-card-front.png': `${BASE}/estimate/?utm_source=qr_card&utm_medium=print&utm_campaign=estimate_card&utm_content=qr`,
  'event-poster-front.png': `${BASE}/estimate/?utm_source=event_poster&utm_medium=print&utm_campaign=community_event&utm_content=qr`,
  'foam-board-front.png': `${BASE}/estimate/?utm_source=foam_board&utm_medium=print&utm_campaign=community_event&utm_content=qr`,
  'community-leave-behind-front.png': `${BASE}/estimate/?utm_source=community_leave_behind&utm_medium=print&utm_campaign=community&utm_content=qr`,
  'realtor-card-front.png': `${BASE}/move-in-move-out-cleaning/?utm_source=realtor&utm_medium=outreach&utm_campaign=moveout&utm_content=packet`,
};

let failures = 0;
for (const [file, expected] of Object.entries(EXPECTED)) {
  const full = path.join(PREVIEWS, file);
  if (!fs.existsSync(full)) {
    console.error(`MISSING ${file}`);
    failures += 1;
    continue;
  }
  const png = PNG.sync.read(fs.readFileSync(full));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!decoded) {
    console.error(`NO QR DECODED in ${file}`);
    failures += 1;
    continue;
  }
  if (decoded.data !== expected) {
    console.error(`MISMATCH ${file}\n  decoded:  ${decoded.data}\n  expected: ${expected}`);
    failures += 1;
    continue;
  }
  console.log(`✓ ${file}`);
}

if (failures > 0) {
  console.error(`\n${failures} QR verification failure(s) — do not print.`);
  process.exit(1);
}
console.log('\nAll print QRs decode to the exact tracked registry URLs.');
