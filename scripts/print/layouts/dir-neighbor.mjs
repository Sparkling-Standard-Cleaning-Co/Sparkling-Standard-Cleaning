// Direction B — "From a Neighbor": personal, founder-led warmth.
// Script greetings, rounded panels, portrait-forward, checklist hospitality.
import { F, crest, readQr, image, PHOTO } from './shared.mjs';

function lockup({ crestSize = '.34in', script = '.25in', caps = '.115in', descriptor = '.062in', center = false } = {}) {
  return `<div class="b-lockup${center ? ' b-lockup--center' : ''}">${crest(crestSize)}
    <div>
      <div class="b-word"><span class="b-script" style="font-size:${script}">${F.script}</span><span class="b-caps" style="font-size:${caps}">${F.caps}</span></div>
      <div class="b-descriptor" style="font-size:${descriptor}">${F.descriptor}</div>
    </div>
  </div>`;
}

function check(size = '.09in') {
  return `<svg viewBox="0 0 12 12" style="width:${size};height:${size};flex:0 0 auto;margin-top:.015in"><path d="M1.5 6.2 4.4 9 10.5 2.8" fill="none" stroke="#b15a6f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function item(text, size = '.1in') {
  return `<div class="b-item"><span class="b-check">${check(size)}</span><span style="font-size:${size}">${text}</span></div>`;
}

function qr(id, qrSize, capSize, caption = 'Scan me — your proposed price in about a minute') {
  return `<div class="b-qr" style="width:fit-content">
    <div class="b-qr-frame"><div style="width:${qrSize}">${readQr(id)}</div></div>
    <div class="b-qr-cap" style="font-size:${capSize};width:calc(${qrSize} + 0.2in)">${caption}</div>
  </div>`;
}

const cardFront = () => `
<div style="position:absolute;inset:0;padding:.16in .18in;display:flex;flex-direction:column;align-items:center">
  ${lockup({ center: true })}
  <div style="display:flex;align-items:center;gap:.14in;margin-top:.13in;width:100%">
    <div style="width:.6in;height:.6in;border-radius:50%;overflow:hidden;border:.014in solid var(--rose-300);flex:0 0 auto">
      ${image(PHOTO, 'width:100%;height:100%;object-fit:cover;object-position:50% 18%;display:block')}
    </div>
    <div>
      <div class="b-name" style="font-size:.3in">${F.founder}</div>
      <div class="b-role" style="font-size:.068in">${F.role}</div>
    </div>
  </div>
  <div style="margin-top:auto;text-align:center;width:100%">
    <div class="b-phone" style="font-size:.13in">${F.phone}</div>
    <div class="b-small" style="font-size:.078in;margin-top:.03in">${F.email} · ${F.domain}</div>
  </div>
</div>`;

const cardBack = () => `
<div style="position:absolute;inset:0;padding:.16in .18in;display:flex;flex-direction:column">
  <div class="b-script" style="font-size:.24in;color:var(--rose-700)">A note from ${F.founder}</div>
  <div class="b-body" style="font-size:.082in;margin-top:.03in">When your home needs a hand, I answer personally — and the details stay done.</div>
  <div style="display:flex;gap:.16in;margin-top:.1in;flex:1;align-items:flex-end">
    <div style="flex:1">
      ${item('Weekly, biweekly or monthly', '.078in')}
      ${item('The same careful standard', '.078in')}
      ${item(`${F.founder} confirms every request`, '.078in')}
    </div>
    <div style="flex:.85;display:flex;justify-content:flex-end">
      ${qr('business-card', '.85in', '.055in', 'Scan me')}
    </div>
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
    <div class="b-body" style="font-size:.11in;margin-top:.12in">Recurring house cleaning in this neighborhood — with the details most cleaners skip.</div>
    <div style="margin-top:.18in">
      ${item('Weekly, biweekly or monthly plans', '.1in')}
      ${item('Honest estimates built from real labor hours', '.1in')}
      ${item(`Every request confirmed by ${F.founder}`, '.1in')}
    </div>
    <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
      ${qr('door-hanger', '1.35in', '.068in', 'Scan me')}
      <div style="text-align:right">
        <div class="b-small" style="font-size:.075in">Call or text</div>
        <div class="b-phone" style="font-size:.185in;margin-top:.04in">${F.phone}</div>
        <div class="b-small" style="font-size:.085in;margin-top:.04in">${F.domain}</div>
      </div>
    </div>
  </div>
</div>`;

const quarterSheet = () => `
<div style="position:absolute;inset:0;padding:.3in;display:flex;flex-direction:column;background:var(--cream-50)">
  ${lockup({ crestSize: '.46in', script: '.34in', caps: '.155in', descriptor: '.08in' })}
  <div class="b-script" style="font-size:.4in;color:var(--rose-700);margin-top:.2in">A note from ${F.founder}</div>
  <div class="b-head" style="font-size:.38in;margin-top:.04in">A cleaner home. Less stress. More time.</div>
  <div class="b-body" style="font-size:.115in;margin-top:.12in">Recurring house cleaning planned around your home — not a route clock. Every request is confirmed personally before anything is scheduled.</div>
  <div style="margin-top:.18in">
    ${item('Estimates built from real labor hours', '.105in')}
    ${item('Weekly, biweekly or monthly — the details stay done', '.105in')}
    ${item(`${F.founder} personally confirms every request`, '.105in')}
  </div>
  <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
    ${qr('quarter-sheet', '1.05in', '.062in', 'Scan me')}
    <div style="text-align:right">
      <div class="b-phone" style="font-size:.18in">${F.phone}</div>
      <div class="b-small" style="font-size:.095in;margin-top:.05in">${F.email}</div>
      <div class="b-small" style="font-size:.095in">${F.domain}</div>
      <div class="b-small" style="font-size:.08in;margin-top:.05in;color:var(--taupe-600)">${F.hours}</div>
    </div>
  </div>
</div>`;

const qrCard = () => `
<div style="position:absolute;inset:0;padding:.3in;display:flex;flex-direction:column;align-items:center;background:var(--cream-50)">
  ${lockup({ crestSize: '.42in', script: '.31in', caps: '.14in', descriptor: '.075in', center: true })}
  <div class="b-script" style="font-size:.44in;color:var(--rose-700);margin-top:.26in">Let's get your price.</div>
  <div style="margin-top:.24in">${qr('qr-estimate-card', '2in', '.075in', 'Scan me')}</div>
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
      <div class="b-body" style="font-size:.24in;max-width:5.6in">Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
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
        ${qr('event-poster', '2.6in', '.13in', 'Scan me')}
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
      <div class="b-body" style="font-size:.52in;max-width:13in">Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
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
        ${qr('foam-board', '5.2in', '.3in', 'Scan me')}
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
    ${item('Recurring house cleaning', '.105in')}
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
    ${qr('community-leave-behind', '1.25in', '.06in', 'Scan me')}
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
