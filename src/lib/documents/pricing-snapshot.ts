/**
 * Persistent, server-authoritative pricing for a signing request.
 *
 * A signing request must display and preserve the exact amount the customer is
 * accepting. The snapshot is written once when the request is created from a
 * verified checkout or from the admin document composer. Signing never
 * recalculates it and never rewrites it after execution.
 */

export type PricingSnapshotSource = 'checkout_verified' | 'admin_entry' | 'booking_record';

export interface PricingSnapshotLine {
  label: string;
  amountCents: number;
  kind: 'charge' | 'discount' | 'tax' | 'tender';
}

export interface PricingSnapshot {
  version: 1;
  currency: 'USD';
  source: PricingSnapshotSource;
  capturedAt: string;
  serviceCode: string;
  serviceLabel: string;
  frequency: string;
  propertyAddress: string;
  serviceDate: string;
  arrivalWindow: string;
  scope: string;
  addOns: string;
  basePriceCents: number | null;
  travelCents: number | null;
  discountCents: number | null;
  discountLabel: string;
  taxCents: number | null;
  taxLabel: string;
  totalCents: number | null;
  amountDueNowCents: number | null;
  remainingBalanceCents: number | null;
  paymentTerms: string;
  lines: PricingSnapshotLine[];
  note: string;
}

const SERVICE_LABELS: Record<string, string> = {
  standard: 'Residential cleaning',
  'residential-cleaning': 'Residential cleaning',
  deep: 'Deep cleaning',
  'residential-deep': 'Deep cleaning',
  recurring: 'Recurring residential cleaning',
  'recurring-residential': 'Recurring residential cleaning',
  'move-in-move-out': 'Move-in / move-out cleaning',
  'str-turnover': 'Short-term rental turnover',
  commercial: 'Commercial cleaning',
  'commercial-cleaning': 'Commercial cleaning',
  church: 'Church / facility cleaning',
  'church-cleaning': 'Church / facility cleaning',
  'property-management': 'Property management cleaning',
  'specialty-addons': 'Specialty / add-on cleaning',
  'employee-onboarding': 'Employee onboarding',
};

function text(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function pricingServiceLabel(serviceCode: string, frequency = ''): string {
  const code = text(serviceCode, 80).toLowerCase();
  const direct = SERVICE_LABELS[code];
  if (direct) return direct;
  if (code.includes('church')) return 'Church / facility cleaning';
  if (code.includes('commercial') || code.includes('facility')) return 'Commercial cleaning';
  if (code.includes('move')) return 'Move-in / move-out cleaning';
  if (code.includes('turnover') || code.includes('str') || code.includes('rental')) {
    return 'Short-term rental turnover';
  }
  if (code.includes('property')) return 'Property management cleaning';
  if (code.includes('specialty') || code.includes('addon')) return 'Specialty / add-on cleaning';
  if (code.includes('deep')) return 'Deep cleaning';
  if (code.includes('recurring') || ['weekly', 'biweekly', 'monthly'].includes(frequency.toLowerCase())) {
    return 'Recurring residential cleaning';
  }
  return code ? code.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()) : 'Cleaning service';
}

/** Parses a human money value into integer cents. Returns null when absent. */
export function parseMoneyCents(value: unknown): number | null {
  const raw = text(value, 200);
  if (!raw) return null;
  const matches = raw.match(/-?\$?\s*\d[\d,]*(?:\.\d{1,2})?/g);
  if (!matches?.length) return null;
  const candidate = matches[matches.length - 1]!.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const amount = Number(candidate);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export function formatPricingMoney(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return '';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function lineKind(label: string): PricingSnapshotLine['kind'] {
  const lower = label.toLowerCase();
  if (lower.includes('tax')) return 'tax';
  if (lower.includes('discount') || lower.includes('promotion') || lower.includes('credit') || lower.includes('gift')) {
    return 'discount';
  }
  return 'charge';
}

export function pricingLinesFromText(value: unknown): PricingSnapshotLine[] {
  const raw = text(value, 8000);
  if (!raw) return [];
  const lines: PricingSnapshotLine[] = [];
  for (const entry of raw.split(/\n|;\s*/)) {
    const item = entry.trim();
    if (!item) continue;
    const amount = parseMoneyCents(item);
    if (amount === null) continue;
    const label = item.replace(/-?\$?\s*\d[\d,]*(?:\.\d{1,2})?\s*$/, '').replace(/[:\-–—]\s*$/, '').trim();
    lines.push({
      label: label || 'Service',
      amountCents: kindAmount(item, amount),
      kind: lineKind(item),
    });
  }
  return lines;
}

function kindAmount(item: string, amount: number): number {
  if (lineKind(item) === 'discount') return -Math.abs(amount);
  return amount;
}

function sumBy(lines: PricingSnapshotLine[], kind: PricingSnapshotLine['kind']): number | null {
  const selected = lines.filter((line) => line.kind === kind);
  if (!selected.length) return null;
  return selected.reduce((total, line) => total + line.amountCents, 0);
}

function normalizeLines(lines: PricingSnapshotLine[]): PricingSnapshotLine[] {
  return lines
    .filter((line) => line && typeof line.label === 'string' && Number.isFinite(line.amountCents))
    .slice(0, 80)
    .map((line) => ({
      label: text(line.label, 300),
      amountCents: Math.round(Number(line.amountCents)),
      kind: ['charge', 'discount', 'tax', 'tender'].includes(line.kind) ? line.kind : 'charge',
    }));
}

export function createPricingSnapshot(input: Partial<PricingSnapshot>): PricingSnapshot {
  const lines = normalizeLines(Array.isArray(input.lines) ? input.lines : []);
  const chargeTotal = sumBy(lines, 'charge');
  const discountTotal = sumBy(lines, 'discount');
  const taxTotal = sumBy(lines, 'tax');
  const basePriceCents =
    typeof input.basePriceCents === 'number' && Number.isFinite(input.basePriceCents)
      ? Math.round(input.basePriceCents)
      : chargeTotal;
  const discountCents =
    typeof input.discountCents === 'number' && Number.isFinite(input.discountCents)
      ? Math.round(input.discountCents)
      : discountTotal === null
        ? null
        : Math.abs(discountTotal);
  const taxCents =
    typeof input.taxCents === 'number' && Number.isFinite(input.taxCents)
      ? Math.round(input.taxCents)
      : taxTotal;
  const totalCents =
    typeof input.totalCents === 'number' && Number.isFinite(input.totalCents)
      ? Math.round(input.totalCents)
      : basePriceCents === null || taxCents === null
        ? null
        : Math.max(0, basePriceCents - (discountCents ?? 0) + Math.max(0, taxCents));
  const amountDueNowCents =
    typeof input.amountDueNowCents === 'number' && Number.isFinite(input.amountDueNowCents)
      ? Math.round(input.amountDueNowCents)
      : totalCents;
  const remainingBalanceCents =
    typeof input.remainingBalanceCents === 'number' && Number.isFinite(input.remainingBalanceCents)
      ? Math.round(input.remainingBalanceCents)
      : 0;
  return {
    version: 1,
    currency: 'USD',
    source:
      input.source === 'checkout_verified' || input.source === 'booking_record'
        ? input.source
        : 'admin_entry',
    capturedAt: text(input.capturedAt, 40) || new Date().toISOString(),
    serviceCode: text(input.serviceCode, 80),
    serviceLabel: text(input.serviceLabel, 160) || pricingServiceLabel(String(input.serviceCode ?? '')),
    frequency: text(input.frequency, 40),
    propertyAddress: text(input.propertyAddress, 400),
    serviceDate: text(input.serviceDate, 40),
    arrivalWindow: text(input.arrivalWindow, 120),
    scope: text(input.scope, 8000),
    addOns: text(input.addOns, 4000),
    basePriceCents,
    travelCents:
      typeof input.travelCents === 'number' && Number.isFinite(input.travelCents)
        ? Math.round(input.travelCents)
        : null,
    discountCents,
    discountLabel: text(input.discountLabel, 300),
    taxCents,
    taxLabel: text(input.taxLabel, 1000),
    totalCents,
    amountDueNowCents,
    remainingBalanceCents,
    paymentTerms: text(input.paymentTerms, 4000),
    lines,
    note: text(input.note, 1000),
  };
}

/** Reads a stored snapshot defensively. Invalid or legacy data returns null. */
export function parsePricingSnapshot(raw: unknown): PricingSnapshot | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (Number(value.version) !== 1) return null;
    return createPricingSnapshot(value as Partial<PricingSnapshot>);
  } catch {
    return null;
  }
}

export function serializePricingSnapshot(snapshot: PricingSnapshot | null): string {
  return snapshot ? JSON.stringify(snapshot) : '{}';
}

export interface PricingFieldSource {
  fields: Record<string, string>;
  requestType?: string;
  serviceCode?: string;
  frequency?: string;
  propertyAddress?: string;
  paymentTerms?: string;
  source: PricingSnapshotSource;
}

/**
 * Builds a snapshot from a stored booking/lead field map. The map is written
 * only by the server after quote verification, never by the signing page.
 */
export function pricingSnapshotFromFields(source: PricingFieldSource): PricingSnapshot {
  const fields = source.fields;
  const basePrice =
    parseMoneyCents(fields.base_price) ??
    parseMoneyCents(fields.cleaning_amount) ??
    parseMoneyCents(fields.verified_price) ??
    parseMoneyCents(fields.quoted_price) ??
    parseMoneyCents(fields.proposed_total);
  const travel = parseMoneyCents(fields.travel_adjustment);
  const discount =
    parseMoneyCents(fields.discount_amount) ??
    parseMoneyCents(fields.automatic_discount_amount) ??
    null;
  const tax = parseMoneyCents(fields.tax_amount);
  const total =
    parseMoneyCents(fields.total_due) ??
    parseMoneyCents(fields.first_visit_total) ??
    parseMoneyCents(fields.verified_price) ??
    parseMoneyCents(fields.quoted_price) ??
    parseMoneyCents(fields.proposed_total);
  const extraLines = pricingLinesFromText(fields.extras_detail);
  const receiptLines: PricingSnapshotLine[] = [];
  if (basePrice !== null) receiptLines.push({ label: 'Cleaning service', amountCents: basePrice, kind: 'charge' });
  for (const line of extraLines) receiptLines.push(line);
  if (travel !== null && travel !== 0) {
    receiptLines.push({ label: 'Travel', amountCents: travel, kind: 'charge' });
  }
  if (discount !== null && discount > 0) {
    receiptLines.push({
      label: fields.discount_label || 'Discount',
      amountCents: -Math.abs(discount),
      kind: 'discount',
    });
  }
  if (tax !== null && tax > 0) {
    receiptLines.push({ label: 'Sales tax', amountCents: tax, kind: 'tax' });
  }
  const address = source.propertyAddress || [
    fields.service_address,
    fields.address_city,
    fields.address_state,
    fields.zip,
  ].filter(Boolean).join(', ');
  return createPricingSnapshot({
    version: 1,
    currency: 'USD',
    source: source.source,
    capturedAt: new Date().toISOString(),
    serviceCode: source.serviceCode || fields.service_type || fields.engine_type || '',
    serviceLabel: pricingServiceLabel(
      source.serviceCode || fields.service_type || fields.engine_type || '',
      source.frequency || fields.frequency || '',
    ),
    frequency: source.frequency || fields.frequency || fields.ongoing_frequency || '',
    propertyAddress: address,
    serviceDate: fields.preferred_date || fields.booking_slot_start?.slice(0, 10) || '',
    arrivalWindow: fields.preferred_time || '',
    scope: fields.service_scope || '',
    addOns: fields.addons || fields.extras_detail || '',
    basePriceCents: basePrice,
    travelCents: travel,
    discountCents: discount,
    discountLabel: fields.discount_label || '',
    taxCents: tax === null ? 0 : tax,
    taxLabel: fields.tax_note || (tax && tax > 0 ? 'Sales tax' : 'No sales tax applies'),
    totalCents: total,
    amountDueNowCents: total,
    remainingBalanceCents: 0,
    paymentTerms: source.paymentTerms || fields.payment_terms || 'Payment is due as stated in the signed agreement.',
    lines: receiptLines,
    note: fields.verification_note || '',
  });
}

/** Builds a snapshot from the admin composer's explicit customer-facing fields. */
export function pricingSnapshotFromAdmin(
  fields: Record<string, string>,
  options: {
    serviceCode?: string;
    frequency?: string;
    propertyAddress?: string;
    serviceDate?: string;
    arrivalWindow?: string;
    scope?: string;
    addOns?: string;
    paymentTerms?: string;
  } = {},
): PricingSnapshot {
  const lineItems = pricingLinesFromText(fields['price.line_items']);
  const summaryTotal = parseMoneyCents(fields['price.summary']);
  const tax = parseMoneyCents(fields['price.tax']) ?? 0;
  const discountRaw = parseMoneyCents(fields['price.discount']) ?? 0;
  const base =
    lineItems.find((line) => line.kind === 'charge')?.amountCents ??
    (summaryTotal !== null ? Math.max(0, summaryTotal - Math.max(0, tax) + Math.abs(discountRaw)) : null);
  const lines = [...lineItems];
  if (!lines.some((line) => line.kind === 'tax') && tax > 0) {
    lines.push({ label: 'Sales tax', amountCents: tax, kind: 'tax' });
  }
  if (!lines.some((line) => line.kind === 'discount') && discountRaw > 0) {
    lines.push({ label: 'Discount', amountCents: -Math.abs(discountRaw), kind: 'discount' });
  }
  if (summaryTotal !== null && !lines.length) {
    lines.push({ label: 'Cleaning service', amountCents: summaryTotal, kind: 'charge' });
  }
  return createPricingSnapshot({
    version: 1,
    currency: 'USD',
    source: 'admin_entry',
    capturedAt: new Date().toISOString(),
    serviceCode: options.serviceCode || '',
    serviceLabel: pricingServiceLabel(options.serviceCode || '', options.frequency || ''),
    frequency: options.frequency || '',
    propertyAddress: options.propertyAddress || fields['property.address'] || '',
    serviceDate: options.serviceDate || fields['service.date'] || '',
    arrivalWindow: options.arrivalWindow || fields['service.arrival_window'] || '',
    scope: options.scope || fields['service.scope'] || '',
    addOns: options.addOns || fields['service.additions'] || '',
    basePriceCents: base,
    travelCents: null,
    discountCents: Math.abs(discountRaw),
    discountLabel: fields['price.discount'] ? 'Discount' : '',
    taxCents: tax,
    taxLabel: fields['price.tax'] || 'No sales tax applies',
    totalCents: summaryTotal,
    amountDueNowCents: summaryTotal,
    remainingBalanceCents: 0,
    paymentTerms: options.paymentTerms || fields['payment.terms'] || 'Payment is due as stated in the signed agreement.',
    lines,
    note: fields['price.summary'] ? 'Amount confirmed by the owner in the document composer.' : '',
  });
}

/**
 * Overrides the legacy document variables so an approved template that still
 * references price variables receives the same persistent snapshot.
 */
export function pricingDocumentVariables(snapshot: PricingSnapshot): Record<string, string> {
  const total = formatPricingMoney(snapshot.totalCents);
  const due = formatPricingMoney(snapshot.amountDueNowCents);
  const priceLines = snapshot.lines
    .map((line) => `${line.label}: ${formatPricingMoney(line.amountCents)}`)
    .join('\n');
  const summary = total
    ? `${total} total due under this agreement.${due && due !== total ? ` Amount due now: ${due}.` : ''}`
    : 'The price is stated in the signed schedule.';
  return {
    'price.summary': summary,
    'price.line_items': priceLines || summary,
    'price.tax': snapshot.taxCents && snapshot.taxCents > 0
      ? `${formatPricingMoney(snapshot.taxCents)}. ${snapshot.taxLabel}`.trim()
      : snapshot.taxLabel || 'No sales tax applies.',
    'price.discount': snapshot.discountCents && snapshot.discountCents > 0
      ? `${snapshot.discountLabel || 'Discount'}: ${formatPricingMoney(snapshot.discountCents)}.`
      : 'No discount applies unless the signed schedule states one.',
    'payment.terms': snapshot.paymentTerms || 'Payment is due as stated in the signed agreement.',
  };
}

/** Plain-text pricing section used by the executed copy. */
export function pricingSnapshotText(snapshot: PricingSnapshot): string[] {
  const rows: string[] = [];
  if (snapshot.serviceLabel) rows.push(`Service: ${snapshot.serviceLabel}`);
  if (snapshot.propertyAddress) rows.push(`Property: ${snapshot.propertyAddress}`);
  if (snapshot.serviceDate) rows.push(`Service date: ${snapshot.serviceDate}`);
  if (snapshot.arrivalWindow) rows.push(`Arrival window: ${snapshot.arrivalWindow}`);
  for (const line of snapshot.lines) {
    rows.push(`${line.label}: ${formatPricingMoney(line.amountCents)}`);
  }
  const total = formatPricingMoney(snapshot.totalCents);
  if (total) rows.push(`Total: ${total}`);
  const due = formatPricingMoney(snapshot.amountDueNowCents);
  if (due && due !== total) rows.push(`Amount due now: ${due}`);
  const remaining = formatPricingMoney(snapshot.remainingBalanceCents);
  if (remaining && snapshot.remainingBalanceCents) rows.push(`Remaining balance: ${remaining}`);
  if (snapshot.paymentTerms) rows.push(`Payment terms: ${snapshot.paymentTerms}`);
  if (snapshot.note) rows.push(snapshot.note);
  return rows;
}
