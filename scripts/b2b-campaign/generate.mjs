// Generate the commercial/institutional campaign launchpad in the owner's
// Windows master workspace. Source assets stay versioned here; output is
// intentionally written outside the product repository.
//
// Usage:
//   node --experimental-strip-types scripts/b2b-campaign/generate.mjs
//   B2B_OUTPUT="C:\path\to\master" node --experimental-strip-types scripts/b2b-campaign/generate.mjs

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import QRCode from 'qrcode';
import { marketingLinks } from '../../src/config/marketing-links.ts';

const OUTPUT = process.env.B2B_OUTPUT || 'C:\\Users\\thoma\\Downloads\\SPARKLING STANDARD - MASTER\\09 BUSINESS & INSTITUTIONAL SALES';
const SITE = 'https://sparkling-standard.com';
const phone = '(850) 426-8479';
const email = 'owner@sparkling-standard.com';
const logo = fs.readFileSync(path.join(process.cwd(), 'public/brand/logo-mark.svg'), 'utf8');
const brand = 'Sparkling Standard Cleaning Co.';
const slogan = 'Standards That Sparkle.';

const link = (id) => {
  const item = marketingLinks.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown marketing link: ${id}`);
  const params = new URLSearchParams({ utm_source: item.utm.source, utm_medium: item.utm.medium, utm_campaign: item.utm.campaign });
  if (item.utm.content) params.set('utm_content', item.utm.content);
  return `${SITE}${item.path}?${params.toString()}`;
};

const verticals = [
  {
    slug: 'churches',
    folder: '03_CHURCHES_AND_RELIGIOUS_FACILITIES',
    title: 'A cleaner church home, without adding work to your week.',
    eyebrow: 'Churches & religious facilities',
    lead: 'A walkthrough-based cleaning scope for the spaces your congregation actually uses: sanctuary, fellowship hall, classrooms, offices, restrooms and kitchens.',
    scope: ['Sanctuary seating and common touchpoints', 'Fellowship hall and event turnover', 'Classrooms and children’s areas', 'Offices, restrooms and breakrooms', 'Kitchen cleaning within an agreed food-safe scope'],
    process: ['Walk the facility with the person who knows its calendar.', 'Agree the rooms, frequency, access and event needs.', 'Receive a written scope and provisional quote.'],
    needs: ['Facility address and primary contact', 'Room list and approximate square footage', 'Service frequency and event calendar', 'Access instructions and any restricted areas'],
    honest: 'We do not claim biohazard, mold, regulated medical or specialist restoration work. Those needs are referred out honestly.',
    qr: 'church-outreach',
    utmId: 'church_outreach',
    cta: 'Request a church walkthrough',
  },
  {
    slug: 'offices',
    folder: '04_OFFICES_AND_COMMERCIAL_BUILDINGS',
    title: 'A dependable cleaning standard for the place your team works.',
    eyebrow: 'Professional offices & commercial buildings',
    lead: 'Recurring cleaning for offices, breakrooms, restrooms and shared areas, scoped around your actual traffic, hours and access rules.',
    scope: ['Workstations and shared surfaces', 'Conference and reception areas', 'Breakrooms and coffee areas', 'Restrooms and high-touch points', 'Floors and entryways within the agreed scope'],
    process: ['Walk the space and identify high-traffic areas.', 'Agree frequency, access and security requirements.', 'Receive a written scope and provisional quote.'],
    needs: ['Suite address and suite contact', 'Cleanable square footage and room list', 'Preferred days and access method', 'Security, alarm or after-hours rules'],
    honest: 'Specialty floor restoration, regulated medical waste and hazardous materials are outside the standard scope and are not promised.',
    qr: 'commercial-packet',
    utmId: 'commercial_walkthrough',
    cta: 'Request an office walkthrough',
  },
  {
    slug: 'property-managers',
    folder: '05_PROPERTY_MANAGERS_AND_APARTMENTS',
    title: 'One accountable cleaning partner for your property portfolio.',
    eyebrow: 'Property managers & apartments',
    lead: 'Common-area cleaning, unit turns and recurring portfolio support with a clear scope for each property rather than a one-size-fits-all promise.',
    scope: ['Lobbies, hallways and shared areas', 'Laundry rooms and amenity spaces', 'Unit turns and model units', 'Move-in/move-out support', 'Recurring common-area schedules'],
    process: ['Review one property or a small portfolio first.', 'Separate common-area and unit-turn scopes.', 'Agree reporting, access and approval steps before work.'],
    needs: ['Property list and addresses', 'Unit-turn volume and timing', 'Access, key and vendor rules', 'Primary manager and invoice contact'],
    honest: 'We confirm each property’s scope, insurance requirements and access rules before accepting work. No portfolio-wide promise is made from a single walkthrough.',
    qr: 'property-manager-packet',
    utmId: 'property_manager_commercial',
    cta: 'Request a portfolio conversation',
  },
  {
    slug: 'str-hosts',
    folder: '06_REALTORS_AND_STR_MANAGERS',
    title: 'Turnovers that respect the check-out and check-in clock.',
    eyebrow: 'Short-term rental hosts & managers',
    lead: 'Turnover cleaning built around the actual guest window, with the check-out, cleaning and check-in timing captured before the first booking.',
    scope: ['Kitchen and bathroom turnover', 'Bed and linen changes', 'Floors, surfaces and touchpoints', 'Trash and presentation reset', 'Optional linen and laundry preference'],
    process: ['Share the property and guest timing.', 'Agree the turnover checklist and access method.', 'Confirm the first turnover scope and provisional quote.'],
    needs: ['Property address and unit details', 'Typical check-out/check-in window', 'Bed, bath and linen counts', 'Access and supply storage instructions'],
    honest: 'We do not promise 24/7 coverage or same-day availability. Each turnover is confirmed against the real schedule.',
    qr: 'airbnb-host-packet',
    utmId: 'str_host_turnover',
    cta: 'Request an STR turnover walkthrough',
  },
  {
    slug: 'retail-salons-gyms',
    folder: '07_RETAIL_SALONS_GYMS_AND_OTHER',
    title: 'A clean first impression for customers and members.',
    eyebrow: 'Retail, salons, gyms & suitable facilities',
    lead: 'After-hours or agreed-window cleaning for customer-facing spaces, with high-touch surfaces and restrooms treated as operational priorities.',
    scope: ['Entrances, counters and display surfaces', 'Restrooms and changing areas', 'Breakrooms and staff areas', 'Floors and high-touch points', 'Recurring or event-based schedules'],
    process: ['Walk the customer-facing areas and back-of-house.', 'Agree hours, products and restricted areas.', 'Receive a written scope and provisional quote.'],
    needs: ['Address and facility contact', 'Open/close hours and access method', 'Cleanable areas and floor types', 'Any products, surfaces or areas to avoid'],
    honest: 'Regulated, biohazard, medical and specialist restoration work is excluded. We will say so before accepting a scope.',
    qr: 'commercial-packet',
    utmId: 'commercial_walkthrough',
    cta: 'Request a facility walkthrough',
  },
  {
    slug: 'realtors',
    folder: '06_REALTORS_AND_STR_MANAGERS',
    title: 'A reliable cleaning referral for your clients.',
    eyebrow: 'Realtors & move-out referrals',
    lead: 'Move-out, move-in and listing-preparation cleaning for clients who need a clear scope and a real appointment rather than a vague promise.',
    scope: ['Move-out and move-in cleaning', 'Listing preparation', 'Deep cleaning before occupancy', 'Appliance interiors when selected', 'Photo-ready presentation within the agreed scope'],
    process: ['Share the property and target date.', 'Confirm the scope and any access constraints.', 'Give your client a direct estimate and booking path.'],
    needs: ['Property address and target date', 'Occupancy and access status', 'Scope priorities and exclusions', 'Client contact and approval path'],
    honest: 'No referral fee, guarantee or closing-date promise is implied. Availability is confirmed against the real schedule.',
    qr: 'realtor-packet',
    utmId: 'realtor_moveout',
    cta: 'Request a realtor packet',
  },
];

const branchControl = [
  ['Pensacola', 'LIVE', 'Use these assets for active outreach in Pensacola, Cantonment and approved surrounding communities.'],
  ['Tampa Bay', 'PRELAUNCH', 'Do not promise Tampa service, pricing, booking or a local Google Business Profile. Use the prelaunch interest page only.'],
];

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const baseCss = `
  @page { size: Letter; margin: 0; }
  :root { --rose:#93475b; --rose-soft:#b15a6f; --ink:#302429; --muted:#6f5f57; --cream:#fbf7f2; --line:#e4d5c7; --gold:#c6a369; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#fff; color:var(--ink); font-family: 'Segoe UI', Arial, sans-serif; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 8.5in; min-height: 11in; padding: .55in .62in .5in; background:#fff; position:relative; overflow:hidden; }
  .page::before { content:''; position:absolute; inset:0; background: radial-gradient(circle at 92% 4%, rgba(198,163,105,.16), transparent 28%), radial-gradient(circle at 4% 96%, rgba(147,71,91,.08), transparent 30%); pointer-events:none; }
  .content { position:relative; z-index:1; }
  .top { display:flex; align-items:center; justify-content:space-between; gap:18px; border-bottom:1px solid var(--line); padding-bottom:14px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand svg { width:58px; height:58px; }
  .brand strong { display:block; font-family:Georgia,serif; font-size:18px; letter-spacing:.02em; }
  .brand span { display:block; color:var(--rose); font-size:11px; letter-spacing:.12em; text-transform:uppercase; margin-top:3px; }
  .tag { text-align:right; font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--rose); line-height:1.5; }
  .eyebrow { margin:34px 0 8px; color:var(--rose); font-size:11px; letter-spacing:.16em; text-transform:uppercase; font-weight:700; }
  h1 { margin:0; font-family:Georgia,serif; font-size:39px; line-height:1.06; letter-spacing:-.02em; max-width:6.8in; }
  .lead { margin:18px 0 0; font-size:15px; line-height:1.55; color:var(--muted); max-width:6.6in; }
  .rule { width:54px; height:3px; background:var(--gold); margin:22px 0 18px; }
  .grid { display:grid; grid-template-columns:1.1fr .9fr; gap:22px; margin-top:22px; }
  .box { border:1px solid var(--line); border-radius:12px; padding:16px 17px; background:rgba(255,255,255,.86); }
  .box h2 { margin:0 0 10px; font-family:Georgia,serif; font-size:16px; }
  ul { margin:0; padding-left:17px; }
  li { margin:0 0 7px; font-size:12px; line-height:1.38; }
  .steps { counter-reset: step; list-style:none; padding:0; }
  .steps li { counter-increment: step; position:relative; padding-left:28px; margin-bottom:10px; font-size:12px; line-height:1.4; }
  .steps li::before { content: counter(step); position:absolute; left:0; top:-2px; width:20px; height:20px; border-radius:50%; background:var(--rose); color:#fff; font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; }
  .bottom { display:flex; gap:18px; align-items:center; margin-top:22px; padding-top:16px; border-top:1px solid var(--line); }
  .qr { width:1.02in; height:1.02in; flex:0 0 auto; }
  .qr img { width:100%; height:100%; display:block; }
  .contact { font-size:11px; line-height:1.55; color:var(--muted); }
  .contact strong { color:var(--ink); font-size:12px; }
  .cta { display:inline-block; background:var(--rose); color:#fff; text-decoration:none; padding:10px 16px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:.04em; }
  .fine { font-size:9px; color:var(--muted); line-height:1.45; margin-top:12px; }
  .honest { margin-top:16px; padding:12px 14px; border-left:3px solid var(--gold); background:rgba(198,163,105,.09); font-size:11px; line-height:1.45; }
  @media screen { body { background:#efe8df; padding:24px; } .page { margin:0 auto; box-shadow:0 18px 60px rgba(48,36,41,.18); } }
`;

function onePager(v) {
  const finalUrl = link(v.utmId);
  const qrPath = path.join(process.cwd(), 'public/marketing/qr', `${v.qr}-print.png`);
  const qrData = fs.readFileSync(qrPath).toString('base64');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(v.title)} | ${brand}</title><style>${baseCss}</style></head><body><main class="page"><div class="content">
    <div class="top"><div class="brand">${logo}<div><strong>${brand}</strong><span>${slogan}</span></div></div><div class="tag">Pensacola operating branch<br>Commercial &amp; institutional</div></div>
    <p class="eyebrow">${esc(v.eyebrow)}</p>
    <h1>${esc(v.title)}</h1>
    <p class="lead">${esc(v.lead)}</p>
    <div class="rule"></div>
    <div class="grid">
      <div class="box"><h2>What we can scope</h2><ul>${v.scope.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
      <div class="box"><h2>How it starts</h2><ol class="steps">${v.process.map((item) => `<li>${esc(item)}</li>`).join('')}</ol></div>
      <div class="box"><h2>What we need from you</h2><ul>${v.needs.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
      <div class="box"><h2>Honest scope</h2><p style="font-size:12px;line-height:1.45;margin:0;color:var(--muted);">${esc(v.honest)}</p><p style="margin:12px 0 0;"><a class="cta" href="${esc(finalUrl)}">${esc(v.cta)}</a></p></div>
    </div>
    <div class="honest">Every quote is based on an actual walkthrough or verified scope. Pricing is provisional until the facility, frequency and access are confirmed.</div>
    <div class="bottom"><div class="qr"><img src="data:image/png;base64,${qrData}" alt="QR code for ${esc(v.cta)}"></div><div class="contact"><strong>${brand}</strong><br>${phone} &nbsp;|&nbsp; ${email}<br>${SITE}<br><span style="font-size:10px;">Scan the code or use the link above. Pensacola branch only.</span></div></div>
    <p class="fine">Sparkling Standard LLC · Standards That Sparkle. · No fake reviews, certifications or coverage claims are made in this material.</p>
  </div></main></body></html>`;
}

function tampaPage() {
  const url = `${SITE}/contact/?branch=tampa-bay`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tampa Bay Prelaunch Interest | ${brand}</title><style>${baseCss}</style></head><body><main class="page"><div class="content">
    <div class="top"><div class="brand">${logo}<div><strong>${brand}</strong><span>${slogan}</span></div></div><div class="tag">Tampa Bay prelaunch<br>Interest only</div></div>
    <p class="eyebrow">Tampa Bay prelaunch</p>
    <h1>We are preparing Tampa Bay the right way.</h1>
    <p class="lead">Sparkling Standard is one company with a live Pensacola branch. Tampa Bay is in setup, not open for booking, payment or published local pricing.</p>
    <div class="rule"></div>
    <div class="grid">
      <div class="box"><h2>What is not active</h2><ul><li>No Tampa Bay online estimate or booking.</li><li>No Tampa Bay payment or local phone number.</li><li>No local Google Business Profile.</li><li>No promise of a service date or price.</li></ul></div>
      <div class="box"><h2>What you can do</h2><ul><li>Register commercial or church interest.</li><li>Share facility information for planning.</li><li>Join the launch-contact list.</li></ul><p style="margin:12px 0 0;"><a class="cta" href="${esc(url)}">Register interest</a></p></div>
    </div>
    <div class="honest">We will only activate Tampa Bay after real staffing, licensing, insurance, tax, service capacity and an eligible local presence are verified. No booking or payment is accepted today.</div>
    <div class="bottom"><div class="contact"><strong>${brand}</strong><br>${phone} &nbsp;|&nbsp; ${email}<br>${SITE}</div></div>
  </div></main></body></html>`;
}

function launchpad() {
  const cards = verticals.map((v) => `<a class="card" href="../${v.folder}/${v.slug}-one-page.pdf"><strong>${esc(v.eyebrow)}</strong><span>${esc(v.title)}</span></a>`).join('');
  const branchRows = branchControl.map(([name, status, note]) => `<tr><td>${esc(name)}</td><td><b>${esc(status)}</b></td><td>${esc(note)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Business & Institutional Sales | ${brand}</title><style>
    :root{--rose:#93475b;--ink:#302429;--muted:#6f5f57;--cream:#fbf7f2;--line:#e4d5c7;--gold:#c6a369}
    *{box-sizing:border-box} body{margin:0;font-family:'Segoe UI',Arial,sans-serif;color:var(--ink);background:var(--cream)} main{max-width:1040px;margin:0 auto;padding:44px 22px 70px}
    h1{font-family:Georgia,serif;font-size:2.35rem;margin:0 0 8px} .lead{color:var(--muted);line-height:1.6;margin:0 0 28px;max-width:760px}
    .banner{display:flex;gap:14px;align-items:center;padding:16px 18px;border:1px solid var(--line);background:#fff;border-radius:14px;margin-bottom:22px}
    .banner strong{color:var(--rose)} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
    a.card{display:block;background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px;text-decoration:none;color:var(--ink)}
    a.card:hover{border-color:var(--rose)} a.card strong{display:block;color:var(--rose);margin-bottom:6px;font-size:.92rem;text-transform:uppercase;letter-spacing:.08em}
    a.card span{font-size:.9rem;line-height:1.45;color:var(--muted)} h2{font-family:Georgia,serif;margin:34px 0 10px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden} th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;font-size:.88rem;vertical-align:top} th{background:#f4ece3;text-transform:uppercase;letter-spacing:.06em;font-size:.7rem}
    ul{line-height:1.7} a{color:var(--rose)} .small{font-size:.82rem;color:var(--muted)}
  </style></head><body><main>
    <h1>Business &amp; Institutional Sales</h1>
    <p class="lead">A real operating launchpad for churches, offices, property managers, STR hosts, retail and referral partners. Pensacola is live. Tampa Bay is prelaunch and must not receive service, pricing or booking promises.</p>
    <div class="banner">${logo}<div><strong>Two branches, one company</strong><br><span class="small">Pensacola assets are approved for active outreach. Tampa Bay material is interest-only until the owner advances the branch.</span></div></div>
    <div class="grid">${cards}<a class="card" href="../08_SALES_PRESENTATIONS_AND_PRINT_MATERIALS/TAMPA-PRELAUNCH-INTEREST.pdf"><strong>Tampa Bay prelaunch</strong><span>Interest form and honest status. No booking, pricing or local profile claims.</span></a></div>
    <h2>Branch control</h2><table><thead><tr><th>Branch</th><th>Status</th><th>Sales rule</th></tr></thead><tbody>${branchRows}</tbody></table>
    <h2>How to use this workspace</h2><ul>
      <li>Start with the prospect research method in <code>02_PROSPECT_LISTS_PENSACOLA_AND_TAMPA</code>.</li>
      <li>Choose one vertical pack, read the call script, and use the matching one-page leave-behind.</li>
      <li>Record every contact in the pipeline CSV. Never invent a decision-maker or a referral.</li>
      <li>Use the walkthrough checklist and proposal template. Do not quote from the car or from memory.</li>
      <li>Assign every lead to Pensacola or Tampa Bay. Tampa remains interest-only.</li>
    </ul>
    <h2>Owner control</h2><ul><li>No paid ads or purchased lists.</li><li>No fake reviews, references, certifications or insurance claims.</li><li>No Tampa booking, Tampa pricing or second Google Business Profile until the launch gates pass.</li><li>Commercial and church pricing remains walkthrough-based and provisional.</li></ul>
  </main></body></html>`;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function writePdf(file, html) {
  return page.setContent(html, { waitUntil: 'networkidle' }).then(() => page.pdf({ path: file, format: 'Letter', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } }));
}

const modules = ['01_START_HERE_AND_CAMPAIGN_CONTROL','02_PROSPECT_LISTS_PENSACOLA_AND_TAMPA','03_CHURCHES_AND_RELIGIOUS_FACILITIES','04_OFFICES_AND_COMMERCIAL_BUILDINGS','05_PROPERTY_MANAGERS_AND_APARTMENTS','06_REALTORS_AND_STR_MANAGERS','07_RETAIL_SALONS_GYMS_AND_OTHER','08_SALES_PRESENTATIONS_AND_PRINT_MATERIALS','09_SCRIPTS_EMAILS_CALLS_AND_FOLLOW_UPS','10_WALKTHROUGHS_SCOPE_QUOTES_AND_PROPOSALS','11_CONTRACTS_ONBOARDING_AND_APPROVALS','12_PIPELINE_ANALYTICS_AND_SCORECARDS','13_MARKET_INTELLIGENCE_AND_COMPETITORS','14_ARCHIVE_AND_VERSIONS'];
for (const module of modules) fs.mkdirSync(path.join(OUTPUT, module), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });

write(path.join(OUTPUT, '01_START_HERE_AND_CAMPAIGN_CONTROL/START-HERE.html'), launchpad());
write(path.join(OUTPUT, '01_START_HERE_AND_CAMPAIGN_CONTROL/CAMPAIGN-CONTROL.md'), `# Business & Institutional Sales Control\n\n- **Pensacola:** live. Active outreach is allowed within approved services and capacity.\n- **Tampa Bay:** prelaunch. Interest only. No booking, payment, published pricing or local GBP claim.\n- **Pricing:** walkthrough-based and provisional. No public price list in these assets.\n- **Claims:** no invented reviews, references, certifications, coverage or staffing.\n- **Pipeline:** every entry must record branch, source, evidence and next action.\n- **Approval:** owner reviews any new vertical promise, discount or contract change.\n`);

write(path.join(OUTPUT, '02_PROSPECT_LISTS_PENSACOLA_AND_TAMPA/RESEARCH-METHOD.md'), `# Prospect research method\n\n1. Choose one branch and one vertical.\n2. Record only publicly available business information: business name, public address, public phone/website, public business contact channel, evidence URL, last checked date.\n3. Never invent a decision-maker name, email, mobile number or relationship.\n4. Deduplicate by business name + address.\n5. Mark Pensacola or Tampa Bay. Tampa Bay may be researched for planning but not contacted with a service promise.\n6. Record the next action and date. A lead with no next action is not a live lead.\n`);
const pipelineHeaders = ['business_name','branch','vertical','public_address','public_phone','website','public_contact_channel','contact_role_if_public','evidence_url','last_checked','priority','status','next_action','next_action_date','owner_notes'];
write(path.join(OUTPUT, '02_PROSPECT_LISTS_PENSACOLA_AND_TAMPA/PIPELINE.csv'), pipelineHeaders.join(',') + '\n');

for (const v of verticals) {
  const html = onePager(v);
  const folder = path.join(OUTPUT, v.folder);
  write(path.join(folder, `${v.slug}-one-page.html`), html);
  await writePdf(path.join(folder, `${v.slug}-one-page.pdf`), html);
  write(path.join(folder, `${v.slug}-intro-letter.md`), `# ${v.eyebrow} introduction letter\n\nHello,\n\nI am Hayli with ${brand}, an owner-operated cleaning company based in Cantonment and serving the Pensacola area. I am reaching out because ${v.lead.toLowerCase()}\n\nWe start with a walkthrough, agree the rooms and frequency in writing, and provide a provisional quote based on the actual scope. There is no pressure to accept a package on the first call.\n\nWould a 20-minute walkthrough be useful? You can reach me at ${phone} or ${email}.\n\nStandards That Sparkle.\nHayli, Founder & Owner-Operator\n${brand}\n`);
  write(path.join(folder, `${v.slug}-call-script.md`), `# ${v.eyebrow} call script\n\n**Opening:** "Hi, this is Hayli with ${brand}. We are a local, owner-operated cleaning company. Is this a good time for a 30-second question about who handles cleaning for your ${v.eyebrow.toLowerCase()}?"\n\n**If yes:** "We are not calling to sell a package sight unseen. We do a walkthrough, agree the scope in writing, and then give a provisional quote. Who is the right person to walk the space with me?"\n\n**Qualify:** facility address, rooms/square footage, current cleaning arrangement, frequency, access and decision process.\n\n**Close:** offer two specific walkthrough windows.\n\n**If no:** "No problem. Who should I follow up with, and may I send the one-page scope overview?"\n\n**Never:** invent a price, promise availability, claim a certification, or say yes to Tampa Bay service.\n`);
  write(path.join(folder, `${v.slug}-walkthrough-checklist.md`), `# ${v.eyebrow} walkthrough checklist\n\n- Confirm branch: Pensacola / Tampa Bay prelaunch.\n- Confirm facility contact and decision maker.\n- Measure or verify cleanable square footage.\n- List rooms, restrooms, breakrooms, flooring and high-touch areas.\n- Confirm frequency, preferred days and event calendar.\n- Confirm access, alarm, key and after-hours rules.\n- Identify restricted areas and excluded specialist work.\n- Record current pain points and quality priorities.\n- Confirm who approves the scope and who receives the invoice.\n- Set the proposal follow-up date.\n`);
}

write(path.join(OUTPUT, '08_SALES_PRESENTATIONS_AND_PRINT_MATERIALS/PRINT-GUIDE.md'), `# Print and digital guide\n\n- Use the PDFs in this folder for leave-behinds. Keep the QR code visible.\n- QR codes point to the canonical UTM links from the website registry.\n- The Pensacola branch is live. Tampa Bay is prelaunch interest only.\n- Print on white letter stock. Do not add testimonials, certifications or prices.\n- Replace any stale asset from 14_ARCHIVE_AND_VERSIONS; do not hand-edit generated HTML.\n`);
for (const v of verticals) {
  fs.copyFileSync(path.join(OUTPUT, v.folder, `${v.slug}-one-page.pdf`), path.join(OUTPUT, '08_SALES_PRESENTATIONS_AND_PRINT_MATERIALS', `${v.slug}-one-page.pdf`));
  const qr = path.join(process.cwd(), 'public/marketing/qr', `${v.qr}-print.png`);
  if (fs.existsSync(qr)) fs.copyFileSync(qr, path.join(OUTPUT, '08_SALES_PRESENTATIONS_AND_PRINT_MATERIALS', `${v.qr}-qr.png`));
}
const tampaHtml = tampaPage();
write(path.join(OUTPUT, '08_SALES_PRESENTATIONS_AND_PRINT_MATERIALS/TAMPA-PRELAUNCH-INTEREST.html'), tampaHtml);
await writePdf(path.join(OUTPUT, '08_SALES_PRESENTATIONS_AND_PRINT_MATERIALS/TAMPA-PRELAUNCH-INTEREST.pdf'), tampaHtml);
await QRCode.toFile(path.join(OUTPUT, '08_SALES_PRESENTATIONS_AND_PRINT_MATERIALS/tampa-prelaunch-qr.png'), `${SITE}/contact/?branch=tampa-bay`, { width: 900, margin: 1, color: { dark: '#302429', light: '#ffffff' } });

write(path.join(OUTPUT, '09_SCRIPTS_EMAILS_CALLS_AND_FOLLOW_UPS/EMAIL-TEMPLATES.md'), `# Email templates\n\n## First contact\nSubject: A cleaning walkthrough for [Business]\n\nHello [Name],\n\nI am Hayli with ${brand}, a local owner-operated cleaning company. We work with [vertical] in Pensacola and the surrounding area.\n\nWould a short walkthrough be useful? We agree the scope in writing before quoting, and there is no obligation to accept.\n\nThank you,\nHayli\n${phone} | ${email}\n\n## Follow-up after five business days\nSubject: Following up on the cleaning walkthrough\n\nHello [Name],\n\nI wanted to make sure my earlier note reached you. If cleaning is handled by someone else, would you point me to the right person? If the timing is not right, I will close the loop for now.\n\nThank you,\nHayli\n\n## After a walkthrough\nSubject: Your cleaning scope and next step\n\nHello [Name],\n\nThank you for the walkthrough. I have attached the scope summary for the areas we discussed. The next step is your review; pricing remains provisional until the scope, frequency and access are confirmed.\n\nThank you,\nHayli\n`);
write(path.join(OUTPUT, '09_SCRIPTS_EMAILS_CALLS_AND_FOLLOW_UPS/FOLLOW-UP-SEQUENCE.md'), `# Follow-up sequence\n\n- Day 0: call or email with a specific reason and a clear next step.\n- Day 5: one concise follow-up. Ask whether the timing or contact is wrong.\n- Day 14: final planned follow-up. Offer to close the loop and reconnect later.\n- After a walkthrough: send the scope summary within two business days, then follow up on the agreed date.\n- Record every touch and set the next action in the pipeline.\n- No mass sends, no purchased lists, no fake urgency.\n`);
write(path.join(OUTPUT, '10_WALKTHROUGHS_SCOPE_QUOTES_AND_PROPOSALS/WALKTHROUGH-AND-PROPOSAL.md'), `# Walkthrough and proposal standard\n\n1. Confirm the branch and service address.\n2. Complete the vertical walkthrough checklist.\n3. Separate recurring, one-time and event work.\n4. Record exclusions and specialist work.\n5. Price through the shared estimator or facility engine; do not invent a number.\n6. State that the quote is provisional until scope/frequency/access are confirmed.\n7. Include tax treatment only from the actual configured policy and service address.\n8. Send the proposal with the scope summary and next step.\n`);
write(path.join(OUTPUT, '11_CONTRACTS_ONBOARDING_AND_APPROVALS/ONBOARDING-CHECKLIST.md'), `# Onboarding and approval checklist\n\n- Signed scope and current agreement version.\n- Correct branch and service address.\n- Access, alarm and key handling confirmed.\n- Frequency, arrival window and first-service expectation confirmed.\n- Billing contact, terms and tax treatment confirmed.\n- Insurance/licensing requirements exchanged where the client requires proof.\n- Owner approval for any nonstandard term.\n- No work starts from a verbal promise alone.\n`);
write(path.join(OUTPUT, '12_PIPELINE_ANALYTICS_AND_SCORECARDS/30-60-90-DAY-PLAN.md'), `# 30/60/90-day B2B plan\n\n## First 30 days\n- Verify 40 named Pensacola prospects across churches, offices and property managers.\n- Deliver 20 one-page packets in person or by approved public business channel.\n- Book and complete at least 5 walkthroughs.\n- Send every proposal within two business days of the walkthrough.\n- Record every touch and next action in the pipeline.\n\n## Days 31-60\n- Add STR hosts, realtors, salons and gyms.\n- Follow up every prior packet once, then close the loop honestly.\n- Convert at least 2 recurring commercial/church accounts if scope and capacity support it.\n- Review objections and revise the script, not the facts.\n\n## Days 61-90\n- Build referral requests from completed commercial work.\n- Review branch capacity and margin before adding volume.\n- Decide whether Tampa Bay has a real staffed base; if not, keep it prelaunch.\n- Produce a written owner scorecard: conversations, walkthroughs, proposals, wins, recurring value and source attribution.\n\n## Rules\n- No purchased lists or mass sends.\n- No Tampa service promise before launch.\n- No invented prices, reviews, certifications or references.\n`);
write(path.join(OUTPUT, '12_PIPELINE_ANALYTICS_AND_SCORECARDS/WEEKLY-SCORECARD.md'), `# Weekly B2B scorecard\n\n- New verified prospects by branch and vertical.\n- Conversations completed.\n- Walkthroughs booked and completed.\n- Proposals sent and followed up.\n- Contracts won, deferred or lost with reason.\n- Recurring contract value and first-service revenue.\n- Pensacola vs Tampa prelaunch interest (not bookings).\n- Source/UTM and referral quality.\n`);
write(path.join(OUTPUT, '12_PIPELINE_ANALYTICS_AND_SCORECARDS/LEAD-LEDGER.csv'), pipelineHeaders.join(',') + '\n');
write(path.join(OUTPUT, '13_MARKET_INTELLIGENCE_AND_COMPETITORS/COMPETITOR-RESEARCH.md'), `# Competitor research template\n\n- Business name and public source.\n- Service area and stated specialty.\n- Publicly visible pricing (do not guess).\n- Reviews and recurring complaints (do not copy review text into ads).\n- Response time, booking method and contract transparency.\n- Local presence and Google Business Profile status.\n- Opportunity for Sparkling Standard.\n- Last checked date and researcher.\n`);
write(path.join(OUTPUT, '14_ARCHIVE_AND_VERSIONS/README.md'), `# Archive and versions\n\nMove superseded campaign assets here with a date and reason. Do not delete the prior version until the owner confirms the replacement. Generated PDFs can be regenerated from the repository generator.\n`);
write(path.join(OUTPUT, 'README.md'), `# Business & Institutional Sales\n\nGenerated launchpad for Pensacola (live) and Tampa Bay (prelaunch). Start at \`01_START_HERE_AND_CAMPAIGN_CONTROL/START-HERE.html\`.\n\nThese assets are operational drafts for owner review. They do not create a contract, a price, a service promise, a review or a certification.\n`);

await browser.close();
console.log(`Generated B2B campaign at ${OUTPUT}`);
