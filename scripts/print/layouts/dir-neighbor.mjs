// Direction B — "From a Neighbor": personal, founder-led warmth.
// Script greetings, rounded panels, portrait-forward, checklist hospitality.
import { F, crest, readQr, image, PHOTO } from './shared.mjs';

function lockup({ crestSize = '.34in', script = '.25in', caps = '.115in', descriptor = '.062in', center = false } = {}) {
  return `<div class="b-lockup${center ? ' b-lockup--center' : ''}">${crest(crestSize)}
    <div>
      <div class="b-word"><span class="b-script" style="font-size:${script}">${F.script}</span><span class="b-caps" style="font-size:${caps}">${F.caps}</span></div>
      ${F.descriptor ? `<div class="b-descriptor" style="font-size:${descriptor}">${F.descriptor}</div>` : ''}
    </div>
  </div>`;
}

function check(size = '.09in') {
  return `<svg viewBox="0 0 12 12" style="width:${size};height:${size};flex:0 0 auto;margin-top:.015in"><path d="M1.5 6.2 4.4 9 10.5 2.8" fill="none" stroke="#b15a6f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function item(text, size = '.1in') {
  return `<div class="b-item"><span class="b-check">${check(size)}</span><span style="font-size:${size}">${text}</span></div>`;
}

function qr(id, qrSize, capSize, caption = 'Scan for your instant estimate') {
  return `<div class="b-qr" style="width:fit-content">
    <div class="b-qr-frame"><div style="width:${qrSize}">${readQr(id)}</div></div>
    <div class="b-qr-cap" style="font-size:${capSize};width:calc(${qrSize} + 0.2in)">${caption}</div>
  </div>`;
}

/** Directive §12A — the front is a beautiful presentation of the circular
 *  logo: centered mark, the official slogan, and a grounded contact rule. */
const cardFront = () => `
<div style="position:absolute;inset:0;padding:.18in .2in;display:flex;flex-direction:column;align-items:center;background:var(--cream-50)">
  <div style="margin-top:auto;display:flex;flex-direction:column;align-items:center">
    ${crest('0.92in')}
    <div style="font-family:var(--font-display);font-style:italic;font-size:.072in;color:var(--taupe-600);margin-top:.11in">${F.tagline}</div>
  </div>
  <div style="margin-top:auto;width:100%">
    <div style="height:.006in;background:var(--champagne-300);width:100%"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:.09in;width:100%">
      <div>
        <div class="b-name" style="font-size:.135in">${F.founder}</div>
        <div class="b-role" style="font-size:.058in">${F.role}</div>
      </div>
      <div class="b-phone" style="font-size:.135in">${F.phone}</div>
    </div>
  </div>
</div>`;

/** Directive §12A back — clear contacts, concise services, one estimate CTA. */
const cardBack = () => `
<div style="position:absolute;inset:0;padding:.16in .18in;display:flex;flex-direction:column;background:var(--cream-50)">
  <div class="b-script" style="font-size:.19in;color:var(--rose-700)">A note from ${F.founder}</div>
  <div class="b-body" style="font-size:.075in;margin-top:.02in">Recurring residential cleaning with the details most cleaners skip.</div>
  <div style="font-size:.06in;color:var(--taupe-600);margin-top:.07in;letter-spacing:.02in">${F.services.join(' · ')}</div>
  <div style="margin-top:auto;display:flex;align-items:flex-end;gap:.12in">
    <div style="flex:1">
      <div class="b-phone" style="font-size:.135in">${F.phone}</div>
      <div class="b-small" style="font-size:.068in;margin-top:.025in">${F.email}</div>
      <div class="b-small" style="font-size:.068in">${F.domain} · ${F.hours}</div>
    </div>
    ${qr('business-card', '.85in', '.055in', 'Scan for your instant estimate')}
  </div>
</div>`;

const doorHanger = () => `
<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--cream-50)">
  <div style="height:2.9in;background:var(--rose-100);position:relative;display:flex;align-items:flex-end;padding:.22in .24in">
    <div style="display:flex;align-items:center;gap:.18in;width:100%">
      <div style="flex:1">
        <div class="b-script" style="font-size:.44in;color:var(--rose-700);line-height:.9">Hello,<br>neighbor!</div>
      </div>
      <div style="width:.8in;height:.8in;border-radius:50%;overflow:hidden;border:.018in solid #fff;flex:0 0 auto">
        ${image(PHOTO, 'width:100%;height:100%;object-fit:cover;object-position:50% 18%;display:block')}
      </div>
    </div>
  </div>
  <div style="flex:1;padding:.26in .25in .24in;display:flex;flex-direction:column">
    <div class="b-head" style="font-size:.3in">Let me take care of your home.</div>
    <div class="b-body" style="font-size:.11in;margin-top:.12in">Recurring residential cleaning in this neighborhood — with the details most cleaners skip.</div>
    <div style="margin-top:.18in">
      ${item('Weekly, biweekly or monthly plans', '.1in')}
      ${item('Honest estimates built from real labor hours', '.1in')}
      ${item(`Every request confirmed by ${F.founder}`, '.1in')}
    </div>
    <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
      ${qr('door-hanger', '1.35in', '.068in', 'Scan for your instant estimate')}
      <div style="text-align:right">
        <div class="b-small" style="font-size:.075in">Call or text</div>
        <div class="b-phone" style="font-size:.185in;margin-top:.04in">${F.phone}</div>
        <div class="b-small" style="font-size:.085in;margin-top:.04in">${F.domain}</div>
      </div>
    </div>
  </div>
</div>`;

/** Directive §12B — the door-knock quarter sheet: interest within seconds,
 *  with the centrally approved SPARKLE100 offer and its promotion QR. */
const quarterSheet = () => `
<div style="position:absolute;inset:0;padding:.24in .26in .2in;display:flex;flex-direction:column;background:var(--cream-50)">
  ${lockup({ crestSize: '.4in', script: '.3in', caps: '.135in' })}
  <div class="b-script" style="font-size:.19in;color:var(--rose-700);margin-top:.12in">Hello from your neighborhood cleaner</div>
  <div class="b-head" style="font-size:.28in;margin-top:.04in;line-height:1.06">Your Home Deserves a<br>Sparkling Standard.</div>
  <div class="b-body" style="font-size:.09in;margin-top:.08in">Recurring residential cleaning planned around your home — not a route clock. Every request is confirmed personally by ${F.founder}.</div>
  <div style="margin-top:.09in">
    ${item('Weekly, biweekly or monthly — the details stay done', '.085in')}
    ${item('Deep cleaning, move-in / move-out and more', '.085in')}
    ${item('Owner-operated — the same careful standard every visit', '.085in')}
  </div>
  <div class="b-panel" style="margin-top:.12in;padding:.13in .15in">
    <div style="font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:.052in;color:var(--champagne-700)">New-neighbor welcome offer</div>
    <div class="b-head" style="font-size:.128in;margin-top:.04in;line-height:1.15">${F.campaign.headline}</div>
    <div style="font-size:.054in;color:var(--ink-700);margin-top:.045in;line-height:1.4">${F.campaign.terms}</div>
    <div style="display:inline-flex;align-items:center;margin-top:.055in;border:.008in dashed var(--champagne-500);border-radius:99px;padding:.028in .1in;font-weight:800;font-size:.065in;letter-spacing:.1em">Code: ${F.campaign.code}</div>
  </div>
  <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
    ${qr('quarter-sheet-sparkle100', '.88in', '.06in', 'Scan to claim your $100')}
    <div style="text-align:right">
      <div class="b-phone" style="font-size:.15in">${F.phone}</div>
      <div class="b-small" style="font-size:.078in;margin-top:.03in">${F.email}</div>
      <div class="b-small" style="font-size:.078in">${F.domain}</div>
      <div class="b-small" style="font-size:.066in;margin-top:.03in;color:var(--taupe-600)">${F.hours}</div>
    </div>
  </div>
</div>`;

const qrCard = () => `
<div style="position:absolute;inset:0;padding:.3in;display:flex;flex-direction:column;align-items:center;background:var(--cream-50)">
  ${lockup({ crestSize: '.42in', script: '.31in', caps: '.14in', descriptor: '.075in', center: true })}
  <div class="b-script" style="font-size:.44in;color:var(--rose-700);margin-top:.26in">Let's get your price.</div>
  <div style="margin-top:.24in">${qr('qr-estimate-card', '2in', '.075in', 'Scan for your instant estimate')}</div>
  <div class="b-body" style="font-size:.11in;text-align:center;margin-top:.22in;max-width:2.9in">Answer a few questions about your home and see your proposed price instantly.</div>
  <div class="b-panel" style="margin-top:.24in;width:100%;text-align:center">
    <div style="font-size:.09in;color:var(--ink-700)">No obligation. ${F.founder} confirms every request personally before anything is scheduled.</div>
  </div>
  <div class="b-phone" style="font-size:.19in;margin-top:.2in">${F.phone}</div>
</div>`;

const poster = () => `
<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--cream-50)">
  <div style="padding:.6in .7in .3in;display:flex;justify-content:space-between;align-items:flex-start">
    ${lockup({ crestSize: '.85in', script: '.62in', caps: '.28in', descriptor: '.13in' })}
    <div class="b-pill" style="margin-top:.15in">Owner-operated</div>
  </div>
  <div style="flex:1;display:flex;gap:.7in;padding:.15in .7in .5in">
    <div style="flex:.95;display:flex;flex-direction:column">
      <div style="border-radius:.22in;overflow:hidden;border:.02in solid var(--sand-300);background:var(--cream-200)">
        ${image(PHOTO, 'width:100%;display:block')}
      </div>
      <div style="text-align:center;margin-top:.2in">
        <div class="b-head" style="font-size:.38in">${F.founder}</div>
        <div class="b-role" style="font-size:.15in;margin-top:.05in">${F.role}</div>
      </div>
    </div>
    <div style="flex:1.1;display:flex;flex-direction:column;justify-content:space-between">
      <div class="b-script" style="font-size:.6in;color:var(--rose-700)">Hello, neighbor.</div>
      <div class="b-head" style="font-size:.82in">${F.tagline}</div>
      <div class="b-body" style="font-size:.24in;max-width:5.6in">Recurring residential cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
      <div>
        ${item('Estimates built from real labor hours', '.2in')}
        ${item('The details most cleaners skip, every visit', '.2in')}
        ${item(`${F.founder} confirms every request personally`, '.2in')}
      </div>
      <div class="b-panel">
        <div style="font-family:var(--font-display);font-style:italic;font-size:.3in;color:var(--ink-900)">A home is not a stop on a route.</div>
        <div style="font-size:.17in;color:var(--ink-700);margin-top:.08in">Recurring cleaning planned around your home — the details stay done.</div>
      </div>
      <div style="display:flex;align-items:center;gap:.5in">
        ${qr('event-poster', '2.6in', '.13in', 'Scan for your instant estimate')}
        <div>
          <div class="b-phone" style="font-size:.36in">${F.phone}</div>
          <div class="b-small" style="font-size:.16in;margin-top:.08in">${F.domain}</div>
          <div class="b-small" style="font-size:.14in;margin-top:.04in;color:var(--taupe-600)">${F.hours}</div>
        </div>
      </div>
    </div>
  </div>
  <div style="background:var(--rose-100);padding:.55in .7in;display:flex;justify-content:space-between;align-items:center">
    <span class="b-small" style="font-size:.16in;color:var(--ink-700)">${F.serviceArea}</span>
    <span class="b-script" style="font-size:.3in;color:var(--rose-700)">Now scheduling in your neighborhood</span>
  </div>
</div>`;

const foamBoard = () => `
<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--cream-50)">
  <div style="padding:1.1in 1.4in .5in;display:flex;justify-content:space-between;align-items:flex-start">
    ${lockup({ crestSize: '2in', script: '1.4in', caps: '.62in', descriptor: '.28in' })}
    <div class="b-pill" style="margin-top:.35in;font-size:.24in;padding:.09in .24in">Owner-operated</div>
  </div>
  <div style="flex:1;display:flex;gap:1.5in;padding:.3in 1.4in 1in">
    <div style="flex:.85;display:flex;flex-direction:column">
      <div style="border-radius:.5in;overflow:hidden;border:.04in solid var(--sand-300);background:var(--cream-200)">
        ${image(PHOTO, 'width:100%;display:block')}
      </div>
      <div style="text-align:center;margin-top:.45in">
        <div class="b-head" style="font-size:.8in">${F.founder}</div>
        <div class="b-role" style="font-size:.32in;margin-top:.12in">${F.role}</div>
      </div>
    </div>
    <div style="flex:1.15;display:flex;flex-direction:column;justify-content:space-between">
      <div class="b-script" style="font-size:1.35in;color:var(--rose-700);line-height:.95">Hello, neighbor.</div>
      <div class="b-head" style="font-size:1.8in">${F.tagline}</div>
      <div class="b-body" style="font-size:.52in;max-width:13in">Recurring residential cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
      <div>
        ${item('Estimates built from real labor hours', '.44in')}
        ${item('The details most cleaners skip, every visit', '.44in')}
        ${item(`${F.founder} confirms every request personally`, '.44in')}
      </div>
      <div class="b-panel">
        <div style="font-family:var(--font-display);font-style:italic;font-size:.7in;color:var(--ink-900)">A home is not a stop on a route.</div>
        <div style="font-size:.4in;color:var(--ink-700);margin-top:.2in">Recurring cleaning planned around your home — the details stay done.</div>
      </div>
      <div style="display:flex;align-items:center;gap:1.1in">
        ${qr('foam-board', '5.2in', '.3in', 'Scan for your instant estimate')}
        <div>
          <div class="b-phone" style="font-size:.8in">${F.phone}</div>
          <div class="b-small" style="font-size:.4in;margin-top:.2in">${F.email}</div>
          <div class="b-small" style="font-size:.4in">${F.domain}</div>
          <div class="b-small" style="font-size:.34in;margin-top:.14in;color:var(--taupe-600)">${F.hours}</div>
        </div>
      </div>
    </div>
  </div>
  <div style="background:var(--rose-100);padding:1.15in 1.4in;display:flex;justify-content:space-between;align-items:center">
    <span class="b-small" style="font-size:.36in;color:var(--ink-700)">${F.serviceArea}</span>
    <span class="b-script" style="font-size:.7in;color:var(--rose-700)">Now scheduling in your neighborhood</span>
  </div>
</div>`;

const leaveBehind = () => `
<div style="position:absolute;inset:0;padding:.4in;display:flex;flex-direction:column;background:var(--cream-50)">
  ${lockup({ crestSize: '.5in', script: '.37in', caps: '.165in', descriptor: '.082in' })}
  <div class="b-script" style="font-size:.4in;color:var(--rose-700);margin-top:.22in">Keep this note.</div>
  <div class="b-head" style="font-size:.4in;margin-top:.03in">Ways I can help your home.</div>
  <div style="margin-top:.16in">
    ${item('Recurring residential cleaning', '.105in')}
    ${item('Deep cleaning', '.105in')}
    ${item('Move-in / move-out', '.105in')}
    ${item('Short-term rentals', '.105in')}
    ${item('Commercial spaces · Churches', '.105in')}
  </div>
  <div class="b-panel" style="margin-top:.2in">
    <div class="b-head" style="font-size:.17in">Owner-operated by ${F.founder}</div>
    <div style="font-size:.105in;color:var(--ink-700);margin-top:.04in;line-height:1.4">Every request is confirmed personally, and the details stay done visit after visit.</div>
  </div>
  <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
    ${qr('community-leave-behind', '1.25in', '.06in', 'Scan for your instant estimate')}
    <div style="text-align:right">
      <div class="b-phone" style="font-size:.18in">${F.phone}</div>
      <div class="b-small" style="font-size:.095in;margin-top:.05in">${F.email}</div>
      <div class="b-small" style="font-size:.095in">${F.domain}</div>
    </div>
  </div>
</div>`;

const realtorCard = () => `
<div style="position:absolute;inset:0;padding:.15in .17in;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:center">
    ${lockup({ crestSize: '.29in', script: '.215in', caps: '.1in', descriptor: '.055in' })}
    <div class="b-pill" style="font-size:.055in;padding:.03in .08in">For realtors</div>
  </div>
  <div style="display:flex;gap:.14in;margin-top:.09in;flex:1">
    <div style="flex:1.15;display:flex;flex-direction:column">
      <div class="b-script" style="font-size:.2in;color:var(--rose-700);line-height:1">For your clients.</div>
      <div class="b-head" style="font-size:.2in;margin-top:.02in">Move-in / move-out cleaning</div>
      <div class="b-body" style="font-size:.075in;margin-top:.03in">Scheduled around closings, confirmed personally.</div>
      <div style="margin-top:auto">
        <div class="b-phone" style="font-size:.115in">${F.phone}</div>
        <div class="b-small" style="font-size:.072in;margin-top:.02in">${F.email}</div>
        <div class="b-small" style="font-size:.072in">${F.domain}</div>
      </div>
    </div>
    <div style="flex:.85;display:flex;justify-content:flex-end">
      ${qr('realtor-packet', '.85in', '.05in', 'Move-out page')}
    </div>
  </div>
</div>`;

export const pieces = [
  { slug: 'business-card-front', name: 'Business card — front', width: 3.5, height: 2, html: cardFront },
  { slug: 'business-card-back', name: 'Business card — back', width: 3.5, height: 2, html: cardBack },
  { slug: 'door-hanger-front', name: 'Door hanger', width: 3.5, height: 8.5, html: doorHanger },
  { slug: 'quarter-sheet-front', name: 'Quarter sheet', width: 4.25, height: 5.5, html: quarterSheet },
  { slug: 'qr-estimate-card-front', name: 'QR estimate card', width: 4, height: 6, html: qrCard },
  { slug: 'event-poster-front', name: 'Event poster', width: 11, height: 17, html: poster },
  { slug: 'foam-board-front', name: 'Foam board', width: 24, height: 36, html: foamBoard },
  { slug: 'community-leave-behind-front', name: 'Community leave-behind', width: 5, height: 7, html: leaveBehind },
  { slug: 'realtor-card-front', name: 'Realtor referral card', width: 3.5, height: 2, html: realtorCard },
];
