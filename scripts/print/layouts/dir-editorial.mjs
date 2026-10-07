// Direction A — "The Standard": editorial confidence.
// Purposeful typography, asymmetry, hairline rules, premium restraint.
import { F, crest, readQr, image, PHOTO } from './shared.mjs';

function lockup({ crestSize = '.34in', script = '.25in', caps = '.12in', descriptor = '.065in' } = {}) {
  return `<div class="a-lockup">${crest(crestSize)}
    <div>
      <div class="a-word"><span class="a-script" style="font-size:${script}">${F.script}</span><span class="a-caps" style="font-size:${caps}">${F.caps}</span></div>
      <div class="a-descriptor" style="font-size:${descriptor}">${F.descriptor}</div>
    </div>
  </div>`;
}

function qr(id, qrSize, capSize, caption = 'Scan for a free instant estimate') {
  return `<div class="a-qr" style="width:fit-content">
    <div class="a-qr-frame"><div style="width:${qrSize}">${readQr(id)}</div></div>
    <div class="a-qr-cap" style="font-size:${capSize};width:calc(${qrSize} + 0.16in)">${caption}</div>
  </div>`;
}

const cardFront = () => `
<div style="position:absolute;inset:0;padding:.17in .19in;display:flex;flex-direction:column">
  ${lockup()}
  <div style="margin-top:.15in">
    <div class="a-name" style="font-size:.38in">${F.founder}</div>
    <div class="a-role" style="font-size:.072in;margin-top:.03in">${F.role}</div>
  </div>
  <div style="margin-top:auto">
    <div class="a-rule" style="margin-bottom:.09in"></div>
    <div class="a-phone" style="font-size:.125in">${F.phone}</div>
    <div class="a-small" style="font-size:.083in;margin-top:.025in">${F.email}</div>
    <div class="a-small" style="font-size:.083in">${F.domain}</div>
  </div>
</div>`;

const cardBack = () => `
<div style="position:absolute;inset:0;padding:.17in .19in;display:flex;flex-direction:column">
  <div class="a-head" style="font-size:.185in;font-style:italic">${F.tagline}</div>
  <div style="display:flex;gap:.16in;margin-top:.12in;flex:1">
    <div style="flex:1.12;display:flex;flex-direction:column">
      <div class="a-body" style="font-size:.082in">Recurring house cleaning for homes in Pensacola and Cantonment.</div>
      <div style="margin-top:auto">
        <div class="a-row" style="padding:.045in 0"><span class="a-rowtext" style="font-size:.078in">Weekly, biweekly or monthly</span></div>
        <div class="a-row" style="padding:.045in 0"><span class="a-rowtext" style="font-size:.078in">The details most cleaners skip</span></div>
        <div class="a-row" style="padding:.045in 0"><span class="a-rowtext" style="font-size:.078in">Hayli confirms every request</span></div>
      </div>
    </div>
    <div style="flex:.88;display:flex;align-items:flex-start;justify-content:flex-end">
      ${qr('business-card', '.86in', '.058in', 'Free instant estimate')}
    </div>
  </div>
</div>`;

const doorHanger = () => `
<div style="position:absolute;inset:0;padding:.26in .25in .24in;display:flex;flex-direction:column">
  <div style="height:1.85in"></div>
  ${lockup({ crestSize: '.4in', script: '.3in', caps: '.14in', descriptor: '.072in' })}
  <div class="a-rule" style="margin:.2in 0 .22in"></div>
  <div class="a-head" style="font-size:.34in">A cleaning standard your neighbors can see.</div>
  <div class="a-body" style="margin-top:.14in;font-size:.115in">Recurring house cleaning in this neighborhood — with the details most cleaners skip.</div>
  <div style="margin-top:.22in">
    <div class="a-row" style="padding:.085in 0"><span class="a-num">01</span><span class="a-rowtext" style="font-size:.105in">Weekly, biweekly or monthly plans</span></div>
    <div class="a-row" style="padding:.085in 0"><span class="a-num">02</span><span class="a-rowtext" style="font-size:.105in">Honest estimates built from real labor hours</span></div>
    <div class="a-row" style="padding:.085in 0"><span class="a-num">03</span><span class="a-rowtext" style="font-size:.105in">Every request confirmed personally by ${F.founder}</span></div>
  </div>
  <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
    ${qr('door-hanger', '1.35in', '.075in')}
    <div style="text-align:right">
      <div class="a-label" style="font-size:.065in">Call or text</div>
      <div class="a-phone" style="font-size:.19in;margin-top:.05in">${F.phone}</div>
      <div class="a-small" style="font-size:.09in;margin-top:.04in">${F.domain}</div>
    </div>
  </div>
</div>`;

const quarterSheet = () => `
<div style="position:absolute;inset:0;padding:.3in;display:flex;flex-direction:column">
  ${lockup({ crestSize: '.5in', script: '.37in', caps: '.17in', descriptor: '.085in' })}
  <div class="a-rule" style="margin:.18in 0 .2in"></div>
  <div class="a-head" style="font-size:.42in">${F.tagline}</div>
  <div class="a-body" style="margin-top:.14in;font-size:.125in">Recurring house cleaning planned around your home — not a route clock.</div>
  <div style="margin-top:.24in">
    <div class="a-row" style="padding:.08in 0"><span class="a-num">01</span><span class="a-rowtext" style="font-size:.115in">Estimates built from real labor hours, not guesswork</span></div>
    <div class="a-row" style="padding:.08in 0"><span class="a-num">02</span><span class="a-rowtext" style="font-size:.115in">Weekly, biweekly or monthly — the details stay done</span></div>
    <div class="a-row" style="padding:.08in 0"><span class="a-num">03</span><span class="a-rowtext" style="font-size:.115in">${F.founder} personally confirms every request</span></div>
  </div>
  <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
    ${qr('quarter-sheet', '1.0in', '.068in', 'Scan to start your free estimate')}
    <div style="text-align:right">
      <div class="a-phone" style="font-size:.19in">${F.phone}</div>
      <div class="a-small" style="font-size:.1in;margin-top:.05in">${F.email}</div>
      <div class="a-small" style="font-size:.1in">${F.domain}</div>
      <div class="a-small" style="font-size:.085in;margin-top:.06in;color:var(--taupe-600)">${F.hours}</div>
    </div>
  </div>
</div>`;

const qrCard = () => `
<div style="position:absolute;inset:0;padding:.32in;display:flex;flex-direction:column;align-items:center">
  <div class="a-label" style="font-size:.075in">Instant estimate · ${F.domain}</div>
  <div style="margin-top:.3in">${qr('qr-estimate-card', '2.1in', '.085in', 'Scan me')}</div>
  <div class="a-head" style="font-size:.36in;text-align:center;margin-top:.34in">Your estimate in<br>about a minute.</div>
  <div class="a-body" style="font-size:.115in;text-align:center;margin-top:.16in;max-width:2.9in">Answer a few questions about your home and see your proposed price instantly.</div>
  <div class="a-rule" style="width:1.1in;margin:.26in 0"></div>
  <div style="text-align:center">
    <div class="a-phone" style="font-size:.2in">${F.phone}</div>
    <div class="a-small" style="font-size:.095in;margin-top:.06in">No obligation. ${F.founder} confirms every request personally before anything is scheduled.</div>
  </div>
</div>`;

const poster = () => `
<div style="position:absolute;inset:0;padding:.7in;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    ${lockup({ crestSize: '.85in', script: '.62in', caps: '.28in', descriptor: '.13in' })}
    <div class="a-label" style="font-size:.11in;text-align:right;margin-top:.12in">Pensacola · Cantonment<br>Owner-operated</div>
  </div>
  <div class="a-rule" style="margin:.4in 0 .55in"></div>
  <div style="display:flex;gap:.8in;flex:1">
    <div style="flex:1.15;display:flex;flex-direction:column;justify-content:space-between">
      <div class="a-head" style="font-size:1.15in">${F.tagline}</div>
      <div class="a-body" style="font-size:.27in;max-width:5.6in">Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
      <div>
        <div class="a-row" style="padding:.18in 0"><span class="a-num" style="font-size:.22in">01</span><span class="a-rowtext" style="font-size:.24in">Estimates built from real labor hours</span></div>
        <div class="a-row" style="padding:.18in 0"><span class="a-num" style="font-size:.22in">02</span><span class="a-rowtext" style="font-size:.24in">The details most cleaners skip, every visit</span></div>
        <div class="a-row" style="padding:.18in 0"><span class="a-num" style="font-size:.22in">03</span><span class="a-rowtext" style="font-size:.24in">${F.founder} confirms every request personally</span></div>
      </div>
      <div>
        <div class="a-label" style="font-size:.13in">Now scheduling in your neighborhood</div>
        <div class="a-small" style="font-size:.13in;margin-top:.12in;color:var(--taupe-600)">Recurring house cleaning · Deep cleaning · Move-in / move-out · Short-term rentals · Commercial spaces · Churches</div>
      </div>
    </div>
    <div style="flex:.85;display:flex;flex-direction:column;justify-content:flex-end">
      <div style="border:.01in solid var(--sand-300);padding:.12in;background:#fff">
        ${image(PHOTO, 'width:100%;display:block')}
      </div>
      <div style="margin-top:.22in">
        <div class="a-head" style="font-size:.4in">${F.founder}</div>
        <div class="a-role" style="font-size:.14in;margin-top:.06in">${F.role}</div>
      </div>
    </div>
  </div>
  <div class="a-rule" style="margin:.5in 0 .35in"></div>
  <div style="display:flex;align-items:center;justify-content:space-between">
    ${qr('event-poster', '2.5in', '.13in', 'Scan for a free instant estimate')}
    <div style="text-align:right">
      <div class="a-phone" style="font-size:.36in">${F.phone}</div>
      <div class="a-small" style="font-size:.2in;margin-top:.1in">${F.email}</div>
      <div class="a-small" style="font-size:.2in">${F.domain}</div>
      <div class="a-small" style="font-size:.17in;margin-top:.1in;color:var(--taupe-600)">${F.hours}</div>
    </div>
  </div>
  <div class="a-rule-soft" style="margin:.35in 0 .2in"></div>
  <div class="a-small" style="font-size:.15in;color:var(--taupe-600)">${F.serviceArea}</div>
</div>`;

const foamBoard = () => `
<div style="position:absolute;inset:0;padding:1.3in;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    ${lockup({ crestSize: '1.9in', script: '1.35in', caps: '.6in', descriptor: '.28in' })}
    <div class="a-label" style="font-size:.24in;text-align:right;margin-top:.3in">Pensacola · Cantonment<br>Owner-operated</div>
  </div>
  <div class="a-rule" style="margin:1in 0 1.1in"></div>
  <div style="display:flex;gap:1.6in;flex:1">
    <div style="flex:1.25;display:flex;flex-direction:column;justify-content:space-between">
      <div class="a-head" style="font-size:2.35in">${F.tagline}</div>
      <div class="a-body" style="font-size:.55in;max-width:12.5in">Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.</div>
      <div>
        <div class="a-row" style="padding:.36in 0"><span class="a-num" style="font-size:.42in">01</span><span class="a-rowtext" style="font-size:.48in">Estimates built from real labor hours</span></div>
        <div class="a-row" style="padding:.36in 0"><span class="a-num" style="font-size:.42in">02</span><span class="a-rowtext" style="font-size:.48in">The details most cleaners skip, every visit</span></div>
        <div class="a-row" style="padding:.36in 0"><span class="a-num" style="font-size:.42in">03</span><span class="a-rowtext" style="font-size:.48in">${F.founder} confirms every request personally</span></div>
      </div>
      <div>
        <div class="a-label" style="font-size:.28in">Now scheduling in your neighborhood</div>
        <div class="a-small" style="font-size:.28in;margin-top:.25in;color:var(--taupe-600)">Recurring house cleaning · Deep cleaning · Move-in / move-out · Short-term rentals · Commercial spaces · Churches</div>
      </div>
    </div>
    <div style="flex:.7;display:flex;flex-direction:column;justify-content:flex-end">
      <div style="border:.02in solid var(--sand-300);padding:.2in;background:#fff">
        ${image(PHOTO, 'width:100%;display:block')}
      </div>
      <div style="margin-top:.5in">
        <div class="a-head" style="font-size:.85in">${F.founder}</div>
        <div class="a-role" style="font-size:.3in;margin-top:.12in">${F.role}</div>
      </div>
    </div>
  </div>
  <div class="a-rule" style="margin:1.1in 0 .8in"></div>
  <div style="display:flex;align-items:center;justify-content:space-between">
    ${qr('foam-board', '5in', '.3in', 'Scan for a free instant estimate')}
    <div style="text-align:right">
      <div class="a-phone" style="font-size:.8in">${F.phone}</div>
      <div class="a-small" style="font-size:.42in;margin-top:.22in">${F.email}</div>
      <div class="a-small" style="font-size:.42in">${F.domain}</div>
      <div class="a-small" style="font-size:.36in;margin-top:.22in;color:var(--taupe-600)">${F.hours}</div>
    </div>
  </div>
  <div class="a-rule-soft" style="margin:.8in 0 .45in"></div>
  <div class="a-small" style="font-size:.32in;color:var(--taupe-600)">${F.serviceArea}</div>
</div>`;

const leaveBehind = () => `
<div style="position:absolute;inset:0;padding:.4in;display:flex;flex-direction:column">
  ${lockup({ crestSize: '.52in', script: '.38in', caps: '.175in', descriptor: '.085in' })}
  <div class="a-rule" style="margin:.24in 0 .28in"></div>
  <div class="a-head" style="font-size:.44in">A home company, built one detail at a time.</div>
  <div class="a-body" style="margin-top:.14in;font-size:.12in">Keep this card. When your home needs a hand, ${F.founder} answers personally.</div>
  <div class="a-label" style="font-size:.075in;margin-top:.3in">Services</div>
  <div style="margin-top:.1in;display:grid;grid-template-columns:1fr 1fr;column-gap:.3in">
    <div class="a-row" style="padding:.08in 0"><span class="a-rowtext" style="font-size:.105in">Recurring house cleaning</span></div>
    <div class="a-row" style="padding:.08in 0"><span class="a-rowtext" style="font-size:.105in">Deep cleaning</span></div>
    <div class="a-row" style="padding:.08in 0"><span class="a-rowtext" style="font-size:.105in">Move-in / move-out</span></div>
    <div class="a-row" style="padding:.08in 0"><span class="a-rowtext" style="font-size:.105in">Short-term rentals</span></div>
    <div class="a-row" style="padding:.08in 0"><span class="a-rowtext" style="font-size:.105in">Commercial spaces</span></div>
    <div class="a-row" style="padding:.08in 0"><span class="a-rowtext" style="font-size:.105in">Churches</span></div>
  </div>
  <div style="margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between">
    ${qr('community-leave-behind', '1.3in', '.062in', 'Scan for your free estimate')}
    <div style="text-align:right">
      <div class="a-phone" style="font-size:.185in">${F.phone}</div>
      <div class="a-small" style="font-size:.1in;margin-top:.05in">${F.email}</div>
      <div class="a-small" style="font-size:.1in">${F.domain}</div>
    </div>
  </div>
</div>`;

const realtorCard = () => `
<div style="position:absolute;inset:0;padding:.16in .18in;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:center">
    ${lockup({ crestSize: '.3in', script: '.22in', caps: '.105in', descriptor: '.058in' })}
    <div class="a-label" style="font-size:.06in">For realtors</div>
  </div>
  <div style="display:flex;gap:.14in;margin-top:.1in;flex:1">
    <div style="flex:1.2;display:flex;flex-direction:column">
      <div class="a-head" style="font-size:.21in">For your move-out clients.</div>
      <div class="a-body" style="font-size:.08in;margin-top:.04in">Move-in / move-out cleaning, scheduled around closings.</div>
      <div style="margin-top:auto">
        <div class="a-phone" style="font-size:.12in">${F.phone}</div>
        <div class="a-small" style="font-size:.078in;margin-top:.03in">${F.email}</div>
        <div class="a-small" style="font-size:.078in">${F.domain}</div>
      </div>
    </div>
    <div style="flex:.8;display:flex;justify-content:flex-end">
      ${qr('realtor-packet', '.85in', '.055in', 'Move-out page')}
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
