// Direction C — "The Detail Standard": crisp order, scanability, practical proof.
// Visible grid, micro-labels, checklists, numbered steps, ticked QR frames.
import { F, crest, readQr, image, PHOTO } from './shared.mjs';

function lockup({ crestSize = '.34in', script = '.25in', caps = '.115in', descriptor = '.06in' } = {}) {
  return `<div class="c-lockup">${crest(crestSize)}
    <div>
      <div class="c-word"><span class="c-script" style="font-size:${script}">${F.script}</span><span class="c-caps" style="font-size:${caps}">${F.caps}</span></div>
      <div class="c-descriptor" style="font-size:${descriptor}">${F.descriptor}</div>
    </div>
  </div>`;
}

function qr(id, qrSize, capSize, caption = 'SCAN TO START') {
  return `<div class="c-qr" style="width:fit-content">
    <div class="c-qr-box">
      <span class="c-tick c-tick--tl"></span><span class="c-tick c-tick--tr"></span>
      <span class="c-tick c-tick--bl"></span><span class="c-tick c-tick--br"></span>
      <div class="c-qr-inner" style="width:${qrSize}">${readQr(id)}</div>
    </div>
    <div class="c-qr-cap" style="font-size:${capSize};width:calc(${qrSize} + 0.145in)">${caption}</div>
  </div>`;
}

function checkItem(text, size = '.1in') {
  return `<div class="c-check"><span class="c-box"></span><span style="font-size:${size}">${text}</span></div>`;
}

function step(n, text, size = '.1in') {
  return `<div class="c-step"><span class="c-step-num" style="font-size:${size}">${n}</span><span style="font-size:${size}">${text}</span></div>`;
}

const cardFront = () => `
<div style="position:absolute;inset:0;padding:.16in .18in;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:center">
    ${lockup()}
    <div class="c-tag" style="font-size:.055in">Owner-operated</div>
  </div>
  <div style="margin-top:.11in">
    <div class="c-name" style="font-size:.34in">${F.founder}</div>
    <div class="c-role" style="font-size:.065in">${F.role}</div>
  </div>
  <div style="margin-top:auto">
    <div class="c-rule"></div>
    <div class="c-grid2" style="margin-top:.07in">
      <div class="c-lab">Phone</div><div class="c-val" style="font-size:.09in">${F.phone}</div>
      <div class="c-lab">Email</div><div class="c-val" style="font-size:.075in">${F.email}</div>
      <div class="c-lab">Web</div><div class="c-val" style="font-size:.075in">${F.domain}</div>
    </div>
  </div>
</div>`;

const cardBack = () => `
<div style="position:absolute;inset:0;padding:.16in .18in;display:flex;flex-direction:column">
  <div class="c-label" style="font-size:.065in">3 steps to your estimate</div>
  <div style="display:flex;gap:.16in;margin-top:.08in;flex:1">
    <div style="flex:1;display:flex;flex-direction:column">
      ${step(1, 'Scan the code', '.078in')}
      ${step(2, 'Answer a few questions', '.078in')}
      ${step(3, 'See your proposed price', '.078in')}
      <div style="margin-top:auto">
        <div class="c-body" style="font-size:.068in">No obligation. ${F.founder} confirms every request personally.</div>
        <div class="c-val" style="font-size:.1in;margin-top:.05in">${F.phone}</div>
      </div>
    </div>
    <div style="flex:0 0 auto">${qr('business-card', '.85in', '.055in', 'FREE ESTIMATE')}</div>
  </div>
</div>`;

const doorHanger = () => `
<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--cream-50)">
  <div style="height:2.85in;background:var(--ink-900);display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:.24in">
    <div style="height:1.9in"></div>
    ${lockup({ crestSize: '.42in', script: '.31in', caps: '.145in', descriptor: '.075in' })}
    <div class="c-label c-label--light" style="font-size:.065in;margin-top:.08in">Recurring house cleaning</div>
  </div>
  <div style="flex:1;padding:.26in .25in .24in;display:flex;flex-direction:column">
    <div class="c-label" style="font-size:.07in">How it works</div>
    <div style="margin-top:.09in">
      ${step(1, 'Scan the code on this hanger', '.098in')}
      ${step(2, 'Answer a few questions about your home', '.098in')}
      ${step(3, `${F.founder} confirms scope, date and price`, '.098in')}
    </div>
    <div class="c-label" style="font-size:.07in;margin-top:.22in">What's included</div>
    <div style="margin-top:.09in">
      ${checkItem('Weekly, biweekly or monthly plans', '.095in')}
      ${checkItem('Estimates built from real labor hours', '.095in')}
      ${checkItem('The details most cleaners skip', '.095in')}
    </div>
    <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
      ${qr('door-hanger', '1.55in', '.065in')}
      <div style="text-align:right">
        <div class="c-lab">Call or text</div>
        <div class="c-phone" style="font-size:.175in;margin-top:.04in">${F.phone}</div>
        <div class="c-body" style="font-size:.08in;margin-top:.04in">${F.domain}</div>
      </div>
    </div>
  </div>
</div>`;

const quarterSheet = () => `
<div style="position:absolute;inset:0;padding:.3in;display:flex;flex-direction:column;background:var(--cream-50)">
  <div style="display:flex;justify-content:space-between;align-items:center">
    ${lockup({ crestSize: '.46in', script: '.34in', caps: '.155in', descriptor: '.08in' })}
    <div class="c-tag" style="font-size:.06in">Recurring plans</div>
  </div>
  <div class="c-head" style="font-size:.38in;margin-top:.2in">${F.tagline}</div>
  <div class="c-body" style="font-size:.115in;margin-top:.12in">Recurring house cleaning planned around your home — not a route clock.</div>
  <div class="c-label" style="font-size:.07in;margin-top:.18in">What's included</div>
  <div class="c-grid2" style="margin-top:.08in;column-gap:.24in">
    ${checkItem('Weekly, biweekly or monthly', '.1in')}
    ${checkItem('Real labor-hour estimates', '.1in')}
    ${checkItem('The details most cleaners skip', '.1in')}
    ${checkItem(`${F.founder} confirms every request`, '.1in')}
  </div>
  <div class="c-label" style="font-size:.07in;margin-top:.16in">How it works</div>
  <div style="margin-top:.08in">
    ${step(1, 'Scan the code', '.095in')}
    ${step(2, 'Answer a few questions', '.095in')}
    ${step(3, 'See your proposed price', '.095in')}
  </div>
  <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
    ${qr('quarter-sheet', '1.0in', '.06in')}
    <div style="text-align:right">
      <div class="c-phone" style="font-size:.175in">${F.phone}</div>
      <div class="c-body" style="font-size:.09in;margin-top:.04in">${F.email}</div>
      <div class="c-body" style="font-size:.09in">${F.domain}</div>
    </div>
  </div>
</div>`;

const qrCard = () => `
<div style="position:absolute;inset:0;padding:.3in;display:flex;flex-direction:column;align-items:center;background:var(--cream-50)">
  <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
    ${lockup({ crestSize: '.42in', script: '.31in', caps: '.14in', descriptor: '.075in' })}
    <div class="c-tag" style="font-size:.06in">Instant estimate</div>
  </div>
  <div style="margin-top:.3in">${qr('qr-estimate-card', '2.05in', '.075in')}</div>
  <div class="c-head" style="font-size:.34in;text-align:center;margin-top:.28in">Your estimate in<br>about a minute.</div>
  <div style="margin-top:.24in;width:100%">
    ${step(1, 'Scan the code', '.1in')}
    ${step(2, 'Answer a few questions about your home', '.1in')}
    ${step(3, 'See your proposed price instantly', '.1in')}
  </div>
  <div style="margin-top:auto;text-align:center">
    <div class="c-body" style="font-size:.085in">No obligation. ${F.founder} confirms every request personally.</div>
    <div class="c-phone" style="font-size:.19in;margin-top:.1in">${F.phone}</div>
  </div>
</div>`;

const poster = () => `
<div style="position:absolute;inset:0;padding:.7in;display:flex;flex-direction:column;background:var(--cream-50)">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    ${lockup({ crestSize: '.85in', script: '.62in', caps: '.28in', descriptor: '.13in' })}
    <div class="c-tag" style="font-size:.12in;margin-top:.15in">Owner-operated · Pensacola &amp; Cantonment</div>
  </div>
  <div class="c-rule" style="margin:.4in 0 .5in"></div>
  <div class="c-head" style="font-size:1.2in">${F.tagline}</div>
  <div class="c-body" style="font-size:.27in;margin-top:.28in;max-width:7in">Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
  <div style="display:flex;gap:.8in;margin-top:.5in;flex:1">
    <div style="flex:1.1;display:flex;flex-direction:column;justify-content:space-between">
      <div class="c-label" style="font-size:.13in">What's included</div>
      <div style="margin-top:.16in">
        ${checkItem('Estimates built from real labor hours', '.22in')}
        ${checkItem('The details most cleaners skip, every visit', '.22in')}
        ${checkItem(`${F.founder} confirms every request personally`, '.22in')}
      </div>
      <div>
        <div class="c-label" style="font-size:.13in">How it works</div>
        <div style="margin-top:.14in">
          ${step(1, 'Scan the code', '.2in')}
          ${step(2, 'Answer a few questions', '.2in')}
          ${step(3, 'See your proposed price', '.2in')}
        </div>
      </div>
      <div>
        <div class="c-label" style="font-size:.13in">Services</div>
        <div class="c-panel" style="margin-top:.14in">
          <div class="c-body" style="font-size:.17in;line-height:1.6">Recurring house cleaning · Deep cleaning · Move-in / move-out · Short-term rentals · Commercial spaces · Churches</div>
        </div>
      </div>
    </div>
    <div style="flex:.75">
      <div style="border:.015in solid var(--sand-300);background:#fff;padding:.12in">
        ${image(PHOTO, 'width:100%;display:block')}
      </div>
      <div style="margin-top:.18in">
        <div class="c-name" style="font-size:.36in">${F.founder}</div>
        <div class="c-role" style="font-size:.13in;margin-top:.05in">${F.role}</div>
      </div>
      <div class="c-panel" style="margin-top:.3in">
        <div class="c-label" style="font-size:.1in">Now scheduling</div>
        <div class="c-body" style="font-size:.15in;margin-top:.05in">in your neighborhood</div>
      </div>
    </div>
  </div>
  <div class="c-rule" style="margin:.45in 0 .35in"></div>
  <div style="display:flex;align-items:center;justify-content:space-between">
    ${qr('event-poster', '2.4in', '.13in')}
    <div style="text-align:right">
      <div class="c-phone" style="font-size:.34in">${F.phone}</div>
      <div class="c-body" style="font-size:.18in;margin-top:.08in">${F.email}</div>
      <div class="c-body" style="font-size:.18in">${F.domain}</div>
      <div class="c-body" style="font-size:.15in;margin-top:.08in;color:var(--taupe-600)">${F.hours}</div>
    </div>
  </div>
</div>`;

const foamBoard = () => `
<div style="position:absolute;inset:0;padding:1.3in;display:flex;flex-direction:column;justify-content:space-between;background:var(--cream-50)">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    ${lockup({ crestSize: '1.9in', script: '1.35in', caps: '.6in', descriptor: '.28in' })}
    <div class="c-tag" style="font-size:.26in;margin-top:.35in">Owner-operated · Pensacola &amp; Cantonment</div>
  </div>
  <div class="c-rule"></div>
  <div class="c-head" style="font-size:2.5in;max-width:19in">${F.tagline}</div>
  <div class="c-body" style="font-size:.6in;max-width:14in">Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
  <div style="max-width:17in">
    ${checkItem('Estimates built from real labor hours', '.52in')}
    ${checkItem('The details most cleaners skip, every visit', '.52in')}
    ${checkItem(`${F.founder} confirms every request personally`, '.52in')}
  </div>
  <div class="c-panel" style="max-width:17in">
    <div class="c-body" style="font-size:.4in;line-height:1.5">Recurring house cleaning · Deep cleaning · Move-in / move-out · Short-term rentals · Commercial spaces · Churches</div>
  </div>
  <div style="display:flex;align-items:flex-end;justify-content:space-between">
    ${qr('foam-board', '5in', '.3in')}
    <div style="text-align:right">
      <div class="c-phone" style="font-size:.8in">${F.phone}</div>
      <div class="c-body" style="font-size:.4in;margin-top:.2in">${F.domain}</div>
      <div class="c-body" style="font-size:.34in;margin-top:.12in;color:var(--taupe-600)">${F.hours}</div>
    </div>
  </div>
</div>`;

const leaveBehind = () => `
<div style="position:absolute;inset:0;padding:.4in;display:flex;flex-direction:column;background:var(--cream-50)">
  <div style="display:flex;justify-content:space-between;align-items:center">
    ${lockup({ crestSize: '.5in', script: '.37in', caps: '.165in', descriptor: '.082in' })}
    <div class="c-tag" style="font-size:.065in">Owner-operated</div>
  </div>
  <div class="c-head" style="font-size:.42in;margin-top:.26in">A home company, built one detail at a time.</div>
  <div class="c-body" style="font-size:.115in;margin-top:.12in">Keep this card. When your home needs a hand, ${F.founder} answers personally.</div>
  <div class="c-label" style="font-size:.075in;margin-top:.26in">Services</div>
  <div class="c-matrix" style="margin-top:.1in">
    <div class="c-matrix-row"><span>Recurring house cleaning</span><span>Weekly · biweekly · monthly</span></div>
    <div class="c-matrix-row"><span>Deep cleaning</span><span>Detail-first reset</span></div>
    <div class="c-matrix-row"><span>Move-in / move-out</span><span>Scheduled around closings</span></div>
    <div class="c-matrix-row"><span>Short-term rentals</span><span>Turnover cleaning</span></div>
    <div class="c-matrix-row"><span>Commercial spaces · Churches</span><span>Day or evening scheduling</span></div>
  </div>
  <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
    ${qr('community-leave-behind', '1.25in', '.058in')}
    <div style="text-align:right">
      <div class="c-phone" style="font-size:.175in">${F.phone}</div>
      <div class="c-body" style="font-size:.09in;margin-top:.04in">${F.email}</div>
      <div class="c-body" style="font-size:.09in">${F.domain}</div>
    </div>
  </div>
</div>`;

const realtorCard = () => `
<div style="position:absolute;inset:0;padding:.15in .17in;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:center">
    ${lockup({ crestSize: '.29in', script: '.215in', caps: '.1in', descriptor: '.055in' })}
    <div class="c-tag" style="font-size:.052in">For realtors</div>
  </div>
  <div style="display:flex;gap:.14in;margin-top:.07in;flex:1">
    <div style="flex:1;display:flex;flex-direction:column">
      <div class="c-head" style="font-size:.185in">Move-out cleaning, scheduled around closings.</div>
      <div style="margin-top:.05in">
        ${checkItem('Move-in / move-out cleaning', '.068in')}
        ${checkItem('Confirmed personally by ' + F.founder, '.068in')}
      </div>
      <div style="margin-top:auto">
        <div class="c-phone" style="font-size:.11in">${F.phone}</div>
        <div class="c-body" style="font-size:.065in;margin-top:.02in">${F.email} · ${F.domain}</div>
      </div>
    </div>
    <div style="flex:0 0 auto">
      ${qr('realtor-packet', '.85in', '.05in', 'MOVE-OUT PAGE')}
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
