/**
 * Server-owned values for a customer-specific agreement.
 *
 * The booking request payload is written by the lead relay after server
 * verification. These helpers turn those verified facts into the variables a
 * document template may use. They never trust a browser-supplied total,
 * discount, tax or travel figure at signing time: only the stored request is
 * read.
 */

export interface BookingVariableSource {
  fields: Record<string, string>;
  requestedDate?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  timeZone?: string;
  agreementVersion?: string;
  now?: Date;
}

const DEFAULT_TIME_ZONE = 'America/Chicago';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function money(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function normalizedService(serviceCode: string, frequency = ''): string {
  const raw = serviceCode.toLowerCase();
  const rhythm = frequency.toLowerCase();
  if (raw.includes('church')) return 'church';
  if (raw.includes('commercial') || raw.includes('office') || raw.includes('facility')) return 'commercial';
  if (raw.includes('property') || raw.includes('real estate') || raw.includes('real-estate') || raw.includes('hoa')) return 'property_management';
  if (raw.includes('str') || raw.includes('turnover') || raw.includes('rental') || raw.includes('airbnb')) return 'str';
  if (raw.includes('move')) return 'move_in_out';
  if (raw.includes('deep')) return 'deep';
  if (raw.includes('recurring')) return 'recurring';
  if (['weekly', 'biweekly', 'monthly'].includes(rhythm)) return 'recurring';
  return 'deep';
}

export function agreementScopeFor(serviceCode: string, frequency = ''): string {
  switch (normalizedService(serviceCode, frequency)) {
    case 'recurring':
      return 'Ongoing residential maintenance uses the approved recurring checklist: light tidying and organization; dusting high and low; wiping and disinfecting reachable surfaces; baseboard dusting; wall spot-cleaning; blinds, window frames and sills; vacuuming and mopping floors; replacing trash liners; glass doors and designated focal windows; kitchen and bathroom maintenance. The signed schedule controls the frequency and any selected additions.';
    case 'move_in_out':
      return 'Every room cleaned top to bottom to an empty-home standard; inside cabinets, drawers and closets; inside refrigerator and oven; baseboards, door frames and doors detailed; bathrooms detailed from shower corners to behind fixtures; window sills and interior glass reachable from the floor; floors vacuumed and mopped throughout including edges; light fixtures and switch plates wiped; final empty-home walkthrough. The signed schedule controls any selected additions.';
    case 'str':
      return 'Every room reset to the guest-ready standard in the listing photos; bed reset with fresh linens; towel reset and placement; laundry plan confirmed per property; bathroom reset and presentation; kitchen reset including guest-used appliances; consumable inventory check against the host list; floors vacuumed and mopped throughout; visual property check for damage or issues; completion documentation and photos when required by the host workflow; issue report and host notification. The signed schedule controls any selected additions.';
    case 'commercial':
      return 'The signed scope of work controls the facility areas, tasks, frequency, access window, supplies, equipment, pricing and term. Any change requires written authorization. Work not listed in the signed scope is excluded.';
    case 'church':
      return 'The signed scope of work controls the sanctuary, seating, floors, rails, high-touch surfaces, aisles, fellowship areas, restrooms, nursery, classrooms, offices, corridors, entryways, glass and floor care. Sparkling Standard may clean sacramental items and carefully move candles when the church authorizes it within the agreed scope and insurance. Any change requires written authorization.';
    case 'property_management':
      return 'The property schedule controls each managed property, unit or common area; the approved scope and frequency for each property; the authorized agent and responsible payer; the access method and key or credential custody; and the reporting and approval process. Any added property, unit, common area or service requires a written authorization. Work not listed in the signed property schedule is excluded.';
    default:
      return 'Full standard cleaning scope; baseboards hand-wiped rather than dry-dusted; doors, door frames and jambs detailed; switch plates and outlet covers wiped; wall spot-cleaning where the finish allows; damp dusting where surfaces call for it; blinds and window sills detailed; cabinet fronts cleaned with detail attention; kitchen and bathroom deep detail including corners, grout lines and fixtures; high-touch points throughout the home; final detailed walkthrough. The signed schedule controls any selected additions.';
  }
}

export function agreementExclusions(): string {
  return 'Only the services itemized in this agreement and its signed schedule are included. Work not listed, custom-quoted work, and excluded or hazardous work described in the applicable service terms are not included.';
}

function serviceDate(source: BookingVariableSource): string {
  const preferred = text(source.fields.preferred_date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(preferred)) return preferred;
  const start = text(source.startAt);
  if (/^\d{4}-\d{2}-\d{2}/.test(start)) return start.slice(0, 10);
  return text(source.requestedDate).slice(0, 10);
}

function timeLabel(iso: string, timeZone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return '';
  }
}

function arrivalWindow(source: BookingVariableSource, timeZone: string): string {
  const preferred = text(source.fields.preferred_time);
  const start = timeLabel(text(source.startAt), timeZone);
  const end = timeLabel(text(source.endAt), timeZone);
  if (start && end) return `${start} to ${end}`;
  if (preferred) return preferred;
  return 'The arrival window confirmed in the signed schedule.';
}

export function agreementLineItems(source: BookingVariableSource): string {
  const fields = source.fields;
  const lines: string[] = [];
  const base = money(text(fields.base_price));
  if (base) lines.push(`Cleaning service: ${base}`);
  const extras = text(fields.extras_detail);
  if (extras && !/^none$/i.test(extras)) {
    for (const extra of extras.split(';').map((item) => item.trim()).filter(Boolean)) {
      lines.push(`Additional service: ${extra}`);
    }
  }
  const discount = money(text(fields.discount_amount));
  if (discount && Number(text(fields.discount_amount)) > 0) {
    lines.push(`Discount${text(fields.discount_label) ? ` (${text(fields.discount_label)})` : ''}: -${discount}`);
  }
  const churchDiscount = money(text(fields.church_discount_amount));
  if (churchDiscount && Number(text(fields.church_discount_amount)) > 0) {
    lines.push(`Church cleaning discount: -${churchDiscount}`);
  }
  const travel = money(text(fields.travel_adjustment));
  if (travel && Number(text(fields.travel_adjustment)) > 0) {
    lines.push(`Travel adjustment: ${travel}`);
  }
  const tax = money(text(fields.tax_amount));
  if (tax && Number(text(fields.tax_amount)) > 0) {
    lines.push(`Sales tax: ${tax}`);
  }
  const total = money(
    text(fields.total_due) ||
      text(fields.first_visit_total) ||
      text(fields.quoted_price) ||
      text(fields.proposed_total) ||
      text(fields.verified_price),
  );
  if (total) lines.push(`Total due: ${total}`);
  const ongoing = money(text(fields.ongoing_price_per_visit));
  if (ongoing) {
  const frequency = text(fields.ongoing_frequency) || text(fields.frequency);
    lines.push(`Ongoing visits${frequency ? ` (${frequency})` : ''}: ${ongoing} per visit`);
  }
  return lines.length ? lines.join('\n') : 'The price and payment terms are stated in the signed schedule.';
}

export function agreementPriceSummary(source: BookingVariableSource): string {
  const fields = source.fields;
  const total = money(
    text(fields.total_due) ||
      text(fields.first_visit_total) ||
      text(fields.quoted_price) ||
      text(fields.proposed_total) ||
      text(fields.verified_price),
  );
  const ongoing = money(text(fields.ongoing_price_per_visit));
  if (total && ongoing) {
    return `${total} for the first visit. Ongoing visits are ${ongoing} per visit at the signed frequency.`;
  }
  if (total) return `${total} total due under this agreement.`;
  return 'The price is stated in the signed schedule.';
}

export function agreementTaxSummary(source: BookingVariableSource): string {
  const fields = source.fields;
  const amount = money(text(fields.tax_amount));
  if (amount && Number(text(fields.tax_amount)) > 0) {
    const rate = text(fields.tax_rate);
    return `${amount}${rate ? ` at ${rate}%` : ''}. ${text(fields.tax_note)}`.trim();
  }
  return text(fields.tax_note) || 'No sales tax is added to this service unless the signed schedule states otherwise.';
}

export function agreementDiscountSummary(source: BookingVariableSource): string {
  const fields = source.fields;
  const amount = money(text(fields.discount_amount));
  if (amount && Number(text(fields.discount_amount)) > 0) {
    return `${text(fields.discount_label) || 'Discount'}: ${amount}.`;
  }
  const church = money(text(fields.church_discount_amount));
  if (church && Number(text(fields.church_discount_amount)) > 0) {
    return `Church cleaning discount: ${church}.`;
  }
  return 'No discount applies unless the signed schedule states one.';
}

export function buildBookingDocumentVariables(source: BookingVariableSource): Record<string, string> {
  const fields = source.fields;
  const timeZone = source.timeZone || DEFAULT_TIME_ZONE;
  const frequency = text(fields.frequency) || text(fields.ongoing_frequency);
  const serviceCode = text(fields.service_type) || text(fields.engine_type) || 'residential-cleaning';
  const today = (source.now ?? new Date()).toISOString().slice(0, 10);
  return {
    'customer.legal_name': text(fields.name),
    'service.scope': agreementScopeFor(serviceCode, frequency),
    'service.additions': text(fields.addons) || 'No optional add-ons selected.',
    'service.exclusions': agreementExclusions(),
    'service.date': serviceDate(source),
    'service.arrival_window': arrivalWindow(source, timeZone),
    'price.summary': agreementPriceSummary(source),
    'price.line_items': agreementLineItems(source),
    'price.tax': agreementTaxSummary(source),
    'price.discount': agreementDiscountSummary(source),
    'payment.terms':
      'Payment is due as stated in this agreement and the signed schedule. No stored payment method is charged automatically.',
    'cancellation.terms':
      'The cancellation and rescheduling terms separately provided by Sparkling Standard apply. Nothing in this agreement limits a right that cannot lawfully be waived.',
    'agreement.version': source.agreementVersion || '2026-11-22.legal-policy.v1',
    'agreement.effective_date': today,
    'document.date': today,
  };
}
