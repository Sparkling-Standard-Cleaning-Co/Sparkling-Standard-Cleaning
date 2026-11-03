// Admin manual estimate and one-time booking creator (BOOK-09).
//
// This module is the single server-side path for an owner-created booking. It
// deliberately reuses the SAME calculators, pricing snapshot, availability
// engine, document gate and D1 tables as the public estimator. It never trusts
// a browser-supplied price, and a manual job is never confirmed unless the
// document gate, resource availability and provider calendar write all succeed.

import { bookingConfig, validResourceIds } from '../../config/booking.ts';
import { zipReference } from '../../config/geography.ts';
import type { PricingConfig } from '../../config/pricing.ts';
import type { D1Database, D1PreparedStatement } from './d1.ts';
import { AdminAuthError, audit, type AdminActor } from './operations.ts';
import { markBookingCommitment } from '../booking/commitments.ts';
import { requestPricingConfig } from '../pricing/server.ts';
import { calculateEstimate, type EstimateContext } from '../estimate/calculate.ts';
import {
  calculateFacilityPrice,
  calculateFacilityWorkload,
  type FacilityTraffic,
  type FacilityType,
  type FlooringType,
} from '../estimate/commercial.ts';
import { selectInstantAmount } from '../estimate/quote.ts';
import { validateEstimateInput } from '../estimate/validation.ts';
import type {
  Condition,
  EstimateInputDraft,
  Frequency,
  LastProfessionalClean,
  PricingBreakdown,
  PropertyType,
  PetSituation,
} from '../estimate/types.ts';
import { evaluateDocumentGate } from '../documents/service.ts';
import { availabilityForDate, type BookingEnv } from '../booking/service.ts';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarEventByReference,
  getCalendarEvent,
  updateCalendarEvent,
} from '../booking/google-calendar.ts';
import { loadStaffResources } from '../booking/resources.ts';
import { resolveAddress, type GeocodeEnv } from '../location/server-geocode.ts';
import {
  configuredReferenceGasPrice,
  gulfCoastGasPrice,
  parseLatLng,
  resolveRoute,
  type RoutingEnv,
} from '../travel/server-routing.ts';

export type ManualEngine = 'residential' | 'str' | 'commercial' | 'church';

export interface ManualFacilityInput {
  cleanableSqft?: number | undefined;
  restroomFixtures?: number | undefined;
  breakroom?: boolean | undefined;
  facilityType?: FacilityType | undefined;
  condition?: Condition | undefined;
  traffic?: FacilityTraffic | undefined;
  flooring?: FlooringType | undefined;
  firstClean?: boolean | undefined;
  specialty?: boolean | undefined;
  frequency?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'one_time' | undefined;
  otherDiscountApplied?: boolean | undefined;
}

export interface ManualEstimateInput {
  engine: ManualEngine;
  serviceType?: 'standard' | 'deep' | 'move_in_out' | 'str_turnover' | undefined;
  propertyType?: PropertyType | undefined;
  squareFeet?: number | undefined;
  bedrooms?: number | undefined;
  fullBaths?: number | undefined;
  halfBaths?: number | undefined;
  beds?: number | undefined;
  frequency?: Frequency | undefined;
  condition?: Condition | undefined;
  lastClean?: LastProfessionalClean | undefined;
  addonIds?: string[] | undefined;
  pets?: PetSituation | undefined;
  supportiveEligible?: boolean | undefined;
  promotionCode?: string | undefined;
  facility?: ManualFacilityInput | undefined;
}

export interface ManualQuoteTravel {
  oneWayMiles: number | null;
  durationMinutes: number | null;
  verified: boolean;
  provider: string;
  method: 'route' | 'straight_line_estimate' | 'zone' | 'none';
  destinationSource: 'property' | 'address_geocode' | 'zip_centroid' | 'none';
}

export interface ManualQuote {
  engine: ManualEngine;
  status: 'priced' | 'custom_confirmation_required' | 'pricing_disabled' | 'invalid';
  totalCents: number | null;
  range: { low: number; high: number } | null;
  laborHours: number | null;
  durationMinutes: number | null;
  breakdown: PricingBreakdown | null;
  cleaningSubtotalCents: number | null;
  travelAdjustmentCents: number | null;
  extrasSubtotalCents: number | null;
  discountAmountCents: number | null;
  discountLabel: string | null;
  ongoingPerVisitCents: number | null;
  ongoingFrequency: string | null;
  tier: 'A' | 'B' | 'C' | null;
  pricingVersion: string;
  serviceCode: string;
  travel: ManualQuoteTravel;
  message: string | null;
  fields: Record<string, string>;
  documentsRequired: Array<{ templateId: string; title: string; stage: string }>;
}

export interface ManualBookingContext {
  customerId: string;
  propertyId: string;
  branchId: string | null;
  customerName: string;
  customerEmail: string;
  propertyLabel: string;
  propertyAddress: string;
  property: Record<string, unknown>;
}

export interface ManualBookingEnv extends BookingEnv, GeocodeEnv, RoutingEnv {
  DB?: D1Database;
}

export interface ManualBookingDependencies {
  quote: typeof quoteManualBooking;
  availability: typeof availabilityForDate;
  findEvent: typeof findCalendarEventByReference;
  getEvent: typeof getCalendarEvent;
  createEvent: typeof createCalendarEvent;
  updateEvent: typeof updateCalendarEvent;
  deleteEvent: typeof deleteCalendarEvent;
}

const MAX_REFERENCE = 120;

function now(): string {
  return new Date().toISOString();
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'yes';
}

function cents(amount: number | null | undefined): number | null {
  return amount === null || amount === undefined ? null : Math.round(amount * 100);
}

function serviceCodeForEngine(engine: ManualEngine, serviceType: string): string {
  if (engine === 'commercial') return 'commercial-cleaning';
  if (engine === 'church') return 'church-cleaning';
  return serviceType;
}

function normalizedAddons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean))].slice(0, 30);
}

function engineIsFacility(engine: ManualEngine): boolean {
  return engine === 'commercial' || engine === 'church';
}

function normalizeInput(raw: Record<string, unknown>): ManualEstimateInput {
  const engine = text(raw.engine, 20) as ManualEngine;
  if (!['residential', 'str', 'commercial', 'church'].includes(engine)) {
    throw new AdminAuthError(400, 'manual_engine_invalid');
  }
  const facilityRaw = (raw.facility ?? {}) as Record<string, unknown>;
  return {
    engine,
    serviceType: text(raw.serviceType, 20) as ManualEstimateInput['serviceType'] || (engine === 'str' ? 'str_turnover' : 'standard'),
    propertyType: text(raw.propertyType, 20) as PropertyType,
    squareFeet: numberOrUndefined(raw.squareFeet),
    bedrooms: numberOrUndefined(raw.bedrooms),
    fullBaths: numberOrUndefined(raw.fullBaths),
    halfBaths: numberOrUndefined(raw.halfBaths),
    beds: numberOrUndefined(raw.beds),
    frequency: text(raw.frequency, 20) as Frequency,
    condition: text(raw.condition, 30) as Condition,
    lastClean: text(raw.lastClean, 40) as LastProfessionalClean,
    addonIds: normalizedAddons(raw.addonIds),
    pets: text(raw.pets, 30) as PetSituation,
    supportiveEligible: flag(raw.supportiveEligible),
    promotionCode: text(raw.promotionCode, 40),
    facility: {
      cleanableSqft: numberOrUndefined(facilityRaw.cleanableSqft),
      restroomFixtures: numberOrUndefined(facilityRaw.restroomFixtures),
      breakroom: flag(facilityRaw.breakroom),
      facilityType: text(facilityRaw.facilityType, 30) as FacilityType,
      condition: (text(facilityRaw.condition, 30) || 'average') as Condition,
      traffic: (text(facilityRaw.traffic, 20) || 'average') as FacilityTraffic,
      flooring: (text(facilityRaw.flooring, 20) || 'mixed') as FlooringType,
      firstClean: flag(facilityRaw.firstClean),
      specialty: flag(facilityRaw.specialty),
      frequency: (text(facilityRaw.frequency, 20) || 'weekly') as ManualFacilityInput['frequency'],
      otherDiscountApplied: flag(facilityRaw.otherDiscountApplied),
    },
  };
}

async function scopedCustomerProperty(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  propertyId: string,
): Promise<ManualBookingContext> {
  const customerScope = actor.role === 'owner' ? { sql: '', bind: [] as unknown[] } : actor.branchId
    ? { sql: ' AND c.primary_branch_id = ?', bind: [actor.branchId] }
    : { sql: ' AND 1 = 0', bind: [] as unknown[] };
  const row = await db
    .prepare(
      `SELECT c.id AS customer_id, c.primary_branch_id, c.first_name, c.last_name, c.company_name,
              p.*
       FROM customers c
       JOIN properties p ON p.customer_id = c.id AND p.status = 'active'
       WHERE c.id = ? AND p.id = ? ${customerScope.sql} LIMIT 1`,
    )
    .bind(customerId, propertyId, ...customerScope.bind)
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'customer_property_not_found');
  const contact = await db
    .prepare("SELECT value FROM customer_contacts WHERE customer_id = ? AND kind = 'email' ORDER BY is_primary DESC LIMIT 1")
    .bind(customerId)
    .first<{ value: string }>();
  const propertyAddress = [row.line1, row.line2, row.city, row.state, row.postal_code]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(', ');
  return {
    customerId,
    propertyId,
    branchId: (row.primary_branch_id as string | null) ?? actor.branchId,
    customerName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || String(row.company_name ?? ''),
    customerEmail: contact?.value ?? '',
    propertyLabel: String(row.label ?? 'Service property'),
    propertyAddress,
    property: row,
  };
}

async function propertyDestination(
  env: ManualBookingEnv,
  property: Record<string, unknown>,
): Promise<{ lat: number; lng: number; source: ManualQuoteTravel['destinationSource'] } | null> {
  const savedLat = Number(property.latitude);
  const savedLng = Number(property.longitude);
  if (Number.isFinite(savedLat) && Number.isFinite(savedLng) && Math.abs(savedLat) <= 90 && Math.abs(savedLng) <= 180) {
    return { lat: savedLat, lng: savedLng, source: 'property' };
  }
  const address = [property.line1, property.line2, property.city, property.state, property.postal_code]
    .filter((value) => typeof value === 'string' && value.trim().length >= 2)
    .join(', ');
  if (text(property.line1, 200).length >= 5) {
    const resolved = await resolveAddress(env, address).catch(() => null);
    if (resolved) return { lat: resolved.lat, lng: resolved.lng, source: 'address_geocode' };
  }
  const zip = String(property.postal_code ?? '').match(/^(\d{5})/)?.[1];
  const reference = zip ? zipReference[zip] : null;
  if (reference) return { lat: reference.lat, lng: reference.lng, source: 'zip_centroid' };
  return null;
}

async function travelFor(
  env: ManualBookingEnv,
  destination: { lat: number; lng: number; source: ManualQuoteTravel['destinationSource'] } | null,
): Promise<{ travel: ManualQuoteTravel; routed: EstimateContext['travel']['routed'] }> {
  const fallback: ManualQuoteTravel = {
    oneWayMiles: null,
    durationMinutes: null,
    verified: false,
    provider: 'none',
    method: destination ? 'zone' : 'none',
    destinationSource: destination?.source ?? 'none',
  };
  if (!destination) return { travel: fallback, routed: undefined };
  const origin = parseLatLng(env.TRAVEL_ORIGIN);
  if (!origin) return { travel: fallback, routed: undefined };
  const route = await resolveRoute(env, origin, destination).catch(() => null);
  if (!route) return { travel: fallback, routed: undefined };
  const gas = await gulfCoastGasPrice(
    env.EIA_API_KEY?.trim(),
    configuredReferenceGasPrice(env),
  ).catch(() => ({ gasPrice: configuredReferenceGasPrice(env), gasPriceSource: 'configured_reference' as const }));
  return {
    travel: {
      oneWayMiles: Math.round(route.oneWayMiles * 10) / 10,
      durationMinutes: route.durationMinutes === null ? null : Math.round(route.durationMinutes),
      verified: route.verified,
      provider: route.provider,
      method: route.method,
      destinationSource: destination.source,
    },
    routed: {
      oneWayMiles: route.oneWayMiles,
      durationMinutes: route.durationMinutes,
      gasPrice: gas.gasPrice,
      gasPriceSource: gas.gasPriceSource,
      provider: route.provider,
      method: route.method,
      verified: route.verified,
    },
  };
}

function estimateContext(
  config: PricingConfig,
  routed: EstimateContext['travel']['routed'],
  promotionCode: string,
): EstimateContext {
  return {
    pricingConfig: config,
    travel: {
      ...(routed ? { routed } : {}),
      includedOneWayMiles: config.travel.includedOneWayMiles.value,
      mpg: config.travel.clientDefaults.mpg.value,
      wearPerMile: config.travel.perMileWearCost.value,
      referenceGasPrice: config.travel.fallbackGasPrice.value,
      zoneAdjustments: {
        core: config.travel.zoneAdjustments.core.value,
        surrounding: config.travel.zoneAdjustments.surrounding.value,
      },
      maxInstantDistanceMiles: config.travel.clientDefaults.maxInstantDistanceMiles.value,
      maxDrivingMinutes: config.drivingPolicy.maxDrivingMinutes.value,
      reviewBandMinutes: config.drivingPolicy.reviewBandMinutes.value,
    },
    promotions: {
      claimedCampaignCode: promotionCode.trim() || null,
    },
  };
}

function residentialDraft(input: ManualEstimateInput, property: Record<string, unknown>): EstimateInputDraft {
  const propertyType = input.propertyType || (text(property.property_type, 20) as PropertyType) || 'house';
  return {
    serviceType: input.serviceType ?? (input.engine === 'str' ? 'str_turnover' : 'standard'),
    propertyType,
    squareFeet: input.squareFeet ?? numberOrUndefined(property.square_feet),
    bedrooms: input.bedrooms ?? numberOrUndefined(property.bedrooms),
    fullBaths: input.fullBaths ?? numberOrUndefined(property.full_baths),
    halfBaths: input.halfBaths ?? numberOrUndefined(property.half_baths),
    beds: input.beds ?? numberOrUndefined(property.beds),
    frequency: input.frequency ?? (input.engine === 'str' ? 'one_time' : 'one_time'),
    condition: input.condition ?? 'maintained',
    lastClean: input.lastClean ?? 'within_month',
    addonIds: input.addonIds ?? [],
    zip: text(property.postal_code, 12),
    pets: input.pets ?? ((text(property.pets, 30) as PetSituation) || 'none'),
    supportiveEligible: input.supportiveEligible === true,
  };
}

function snapshotFields(
  input: ManualEstimateInput,
  context: ManualBookingContext,
  quote: Omit<ManualQuote, 'fields' | 'documentsRequired'>,
): Record<string, string> {
  const fields: Record<string, string> = {
    request_type: 'reservation_request',
    booking_source: 'admin_manual',
    service_type: input.serviceType ?? (input.engine === 'str' ? 'str_turnover' : 'standard'),
    service_address: text(context.property.line1, 200),
    address_city: text(context.property.city, 120),
    address_state: text(context.property.state, 20),
    zip: text(context.property.postal_code, 12),
    property_id: context.propertyId,
    customer_id: context.customerId,
    quote_reference: '',
    quote_config_version: quote.pricingVersion,
    quote_status: quote.status,
    admin_engine: input.engine,
    preferred_date: '',
    preferred_time: '',
  };
  if (input.engine === 'residential' || input.engine === 'str') {
    fields.property_type = String(input.propertyType ?? context.property.property_type ?? '');
    fields.square_feet = String(input.squareFeet ?? context.property.square_feet ?? '');
    fields.bedrooms = String(input.bedrooms ?? context.property.bedrooms ?? '');
    fields.full_baths = String(input.fullBaths ?? context.property.full_baths ?? '');
    fields.half_baths = String(input.halfBaths ?? context.property.half_baths ?? '');
    fields.beds = String(input.beds ?? context.property.beds ?? '');
    fields.frequency = String(input.frequency ?? 'one_time');
    fields.condition = String(input.condition ?? 'maintained');
    fields.last_cleaned = String(input.lastClean ?? 'within_month');
    fields.addon_ids = (input.addonIds ?? []).join(',');
    fields.pets = String(input.pets ?? context.property.pets ?? 'none');
    if (input.supportiveEligible) fields.supportive_eligible = 'yes';
    if (input.promotionCode) fields.promotion_code = input.promotionCode;
  } else {
    const facility = input.facility ?? {};
    fields.facility_type = String(facility.facilityType ?? (input.engine === 'church' ? 'church' : 'office'));
    fields.cleanable_sqft = String(facility.cleanableSqft ?? '');
    fields.restroom_fixtures = String(facility.restroomFixtures ?? '');
    fields.breakroom = facility.breakroom ? 'breakroom' : 'none';
    fields.condition = String(facility.condition ?? 'average');
    fields.traffic = String(facility.traffic ?? 'average');
    fields.flooring = String(facility.flooring ?? 'mixed');
    fields.first_clean = facility.firstClean ? 'yes' : 'no';
    fields.specialty_services = facility.specialty ? 'yes' : '';
    fields.frequency = String(facility.frequency ?? 'weekly');
  }
  if (quote.totalCents !== null) fields.quoted_price = (quote.totalCents / 100).toFixed(2);
  if (quote.laborHours !== null) fields.labor_hours = String(quote.laborHours);
  if (quote.ongoingPerVisitCents !== null) fields.ongoing_price_per_visit = (quote.ongoingPerVisitCents / 100).toFixed(2);
  if (quote.travel.oneWayMiles !== null) fields.travel_one_way_miles = String(quote.travel.oneWayMiles);
  return fields;
}

async function documentRequirements(
  db: D1Database,
  input: ManualEstimateInput,
  context: ManualBookingContext,
  reference: string,
): Promise<ManualQuote['documentsRequired']> {
  const gate = await evaluateDocumentGate(
    db,
    {
      subjectType: 'customer',
      customerId: context.customerId,
      propertyId: context.propertyId,
      serviceCode: serviceCodeForEngine(input.engine, input.serviceType ?? 'standard'),
      frequency: input.engine === 'residential' ? input.frequency ?? 'one_time' : input.facility?.frequency ?? input.frequency ?? '',
      bookingReference: reference,
      accessAuthorization: false,
      customerProducts: false,
    },
    'before_confirmation',
  );
  return gate.missing.map((item) => ({ templateId: item.templateId, title: item.title, stage: item.stage }));
}

/**
 * Produces an itemized manual quote using the active published pricing. No
 * booking, hold, invoice, email or calendar event is created here.
 */
export async function quoteManualBooking(
  env: ManualBookingEnv,
  db: D1Database,
  actor: AdminActor,
  raw: Record<string, unknown>,
): Promise<ManualQuote> {
  const input = normalizeInput(raw);
  const customerId = text(raw.customerId, 100);
  const propertyId = text(raw.propertyId, 100);
  if (!customerId || !propertyId) throw new AdminAuthError(400, 'customer_property_required');
  const context = await scopedCustomerProperty(db, actor, customerId, propertyId);
  const config = await requestPricingConfig(db);
  const destination = await propertyDestination(env, context.property);
  const { travel, routed } = await travelFor(env, destination);
  const reference = text(raw.reference, MAX_REFERENCE) || 'ADMIN-DRAFT';
  const docs = await documentRequirements(db, input, context, reference);
  const serviceCode = serviceCodeForEngine(input.engine, input.serviceType ?? 'standard');
  const base = {
    engine: input.engine,
    serviceCode,
    travel,
    pricingVersion: engineIsFacility(input.engine)
      ? config.commercialPricing.configVersion.value
      : config.instantQuote.configVersion.value,
    documentsRequired: docs,
  };

  if (engineIsFacility(input.engine)) {
    const facility = input.facility ?? {};
    if (!facility.cleanableSqft || facility.cleanableSqft <= 0) {
      throw new AdminAuthError(400, 'manual_cleanable_sqft_required');
    }
    const workload = calculateFacilityWorkload(
      {
        cleanableSqft: facility.cleanableSqft,
        restroomFixtures: facility.restroomFixtures ?? 0,
        breakroom: facility.breakroom === true,
        facilityType: input.engine === 'church' ? 'church' : facility.facilityType ?? 'office',
        condition: facility.condition ?? 'average',
        traffic: facility.traffic ?? 'average',
        flooring: facility.flooring ?? 'mixed',
        firstClean: facility.firstClean === true,
        specialty: facility.specialty === true,
      },
      config,
    );
    const price = calculateFacilityPrice(workload, facility.frequency ?? 'weekly', {
      oneWayMiles: travel.oneWayMiles,
      church: input.engine === 'church',
      otherDiscountApplied: facility.otherDiscountApplied === true,
      pricingConfig: config,
    });
    const priced = price.priced && Number.isFinite(price.total);
    const totalCents = priced ? cents(price.total) : null;
    const quoteWithoutFields = {
      ...base,
      status: priced ? 'priced' as const : 'custom_confirmation_required' as const,
      totalCents,
      range: priced ? price.range : null,
      laborHours: workload.laborHours,
      durationMinutes: workload.laborHours > 0
        ? Math.min(bookingConfig.maximumJobMinutes, Math.max(bookingConfig.minimumJobMinutes, Math.ceil((workload.laborHours * 60) / bookingConfig.defaultCrewSize)))
        : null,
      breakdown: null,
      cleaningSubtotalCents: priced ? cents(price.cleaningSubtotal) : null,
      travelAdjustmentCents: priced ? cents(price.travelAdjustment) : null,
      extrasSubtotalCents: null,
      discountAmountCents: price.discount?.applied ? cents(price.discount.amount) : null,
      discountLabel: price.discount?.applied ? price.discount.label : null,
      ongoingPerVisitCents: null,
      ongoingFrequency: null,
      tier: workload.tier,
      message: priced ? null : 'This facility scope requires personal review.',
    };
    return {
      ...quoteWithoutFields,
      fields: snapshotFields(input, context, quoteWithoutFields),
    };
  }

  const draft = residentialDraft(input, context.property);
  const validation = validateEstimateInput(draft);
  if (!validation.ok) {
    const invalidQuote = {
      ...base,
      status: 'invalid' as const,
      totalCents: null,
      range: null,
      laborHours: null,
      durationMinutes: null,
      breakdown: null,
      cleaningSubtotalCents: null,
      travelAdjustmentCents: null,
      extrasSubtotalCents: null,
      discountAmountCents: null,
      discountLabel: null,
      ongoingPerVisitCents: null,
      ongoingFrequency: null,
      tier: null,
      message: validation.issues[0] ?? 'Complete the estimate inputs.',
    };
    return {
      ...invalidQuote,
      fields: snapshotFields(input, context, invalidQuote),
    };
  }
  const estimate = calculateEstimate(draft, estimateContext(config, routed, input.promotionCode ?? ''));
  const amount = selectInstantAmount(estimate, config.instantQuote.selection.value, config);
  const priced = estimate.status === 'estimated' && amount !== null;
  const durationMinutes = estimate.pricing.totalLaborHours > 0
    ? Math.min(
        bookingConfig.maximumJobMinutes,
        Math.max(
          bookingConfig.minimumJobMinutes,
          Math.ceil((estimate.pricing.totalLaborHours * 60) / bookingConfig.defaultCrewSize),
        ),
      )
    : null;
  const quoteWithoutFields = {
    ...base,
    status: priced ? 'priced' as const : 'custom_confirmation_required' as const,
    totalCents: priced ? cents(amount) : null,
    range: priced && estimate.low !== null && estimate.high !== null
      ? { low: estimate.low, high: estimate.high }
      : null,
    laborHours: estimate.laborHours,
    durationMinutes,
    breakdown: estimate.pricing,
    cleaningSubtotalCents: priced ? cents(estimate.pricing.basePrice) : null,
    travelAdjustmentCents: cents(estimate.pricing.travelAdjustment),
    extrasSubtotalCents: cents(estimate.pricing.extrasSubtotal),
    discountAmountCents: estimate.pricing.discount ? cents(estimate.pricing.discount.amount) : null,
    discountLabel: estimate.pricing.discount?.label ?? null,
    ongoingPerVisitCents: estimate.ongoing ? cents(estimate.ongoing.perVisitPrice) : null,
    ongoingFrequency: estimate.ongoing?.frequency ?? null,
    tier: null,
    message: priced ? null : estimate.message ?? 'This scope requires personal confirmation.',
  };
  return {
    ...quoteWithoutFields,
    fields: snapshotFields(input, context, quoteWithoutFields),
  };
}

function slotEnd(start: string, durationMinutes: number): string {
  return new Date(Date.parse(start) + durationMinutes * 60_000).toISOString();
}

async function staffResourceSelection(
  db: D1Database,
  teamMemberIds: string[],
): Promise<{ bookingResourceIds: string[]; teamRows: Array<Record<string, unknown>> }> {
  if (teamMemberIds.length === 0) return { bookingResourceIds: [], teamRows: [] };
  const unique = [...new Set(teamMemberIds)];
  if (unique.length !== teamMemberIds.length) throw new AdminAuthError(400, 'team_duplicate');
  if (unique.length > bookingConfig.maxCrewSize) throw new AdminAuthError(400, 'team_too_large');
  const rows = await db
    .prepare(
      `SELECT id, booking_resource_id, display_name, status, is_bookable, is_solo, is_lead
       FROM team_members WHERE id IN (${unique.map(() => '?').join(',')})`,
    )
    .bind(...unique)
    .all<Record<string, unknown>>();
  const resolved = rows.results ?? [];
  if (resolved.length !== unique.length) throw new AdminAuthError(400, 'team_member_invalid');
  for (const row of resolved) {
    if (String(row.status) !== 'active' || Number(row.is_bookable) !== 1) {
      throw new AdminAuthError(409, 'team_member_inactive');
    }
  }
  const bookingResourceIds = resolved.map((row) => String(row.booking_resource_id ?? '')).filter(Boolean);
  if (!validResourceIds(bookingResourceIds)) throw new AdminAuthError(400, 'team_assignment_invalid');
  return { bookingResourceIds, teamRows: resolved };
}

async function resolveCrew(
  db: D1Database,
  teamMemberIds: string[],
  availabilityResourceIds: string[],
): Promise<string[]> {
  if (teamMemberIds.length > 0) return teamMemberIds;
  if (availabilityResourceIds.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT id, booking_resource_id FROM team_members
       WHERE status = 'active' AND is_bookable = 1
         AND booking_resource_id IN (${availabilityResourceIds.map(() => '?').join(',')})`,
    )
    .bind(...availabilityResourceIds)
    .all<{ id: string; booking_resource_id: string }>();
  const byResource = new Map((rows.results ?? []).map((row) => [row.booking_resource_id, row.id]));
  return availabilityResourceIds.map((resourceId) => byResource.get(resourceId)).filter((id): id is string => Boolean(id));
}

export interface CreateManualBookingInput extends ManualEstimateInput {
  customerId: string;
  propertyId: string;
  date: string;
  start: string;
  crewSize?: number;
  teamMemberIds?: string[];
  notes?: string;
}

export interface CreateManualBookingResult {
  requestId: string;
  holdId: string;
  reference: string;
  quote: ManualQuote;
  appointmentId: null;
}

/** Creates a durable PENDING manual request. It never blocks calendar capacity. */
export async function createManualBooking(
  env: ManualBookingEnv,
  db: D1Database,
  actor: AdminActor,
  raw: Record<string, unknown>,
  overrides: Partial<ManualBookingDependencies> = {},
): Promise<CreateManualBookingResult> {
  const deps: ManualBookingDependencies = {
    quote: quoteManualBooking,
    availability: availabilityForDate,
    findEvent: findCalendarEventByReference,
    getEvent: getCalendarEvent,
    createEvent: createCalendarEvent,
    updateEvent: updateCalendarEvent,
    deleteEvent: deleteCalendarEvent,
    ...overrides,
  };
  const input = normalizeInput(raw) as CreateManualBookingInput;
  input.customerId = text(raw.customerId, 100);
  input.propertyId = text(raw.propertyId, 100);
  input.date = text(raw.date, 10);
  input.start = text(raw.start, 40);
  input.crewSize = Math.min(bookingConfig.maxCrewSize, Math.max(1, Math.round(Number(raw.crewSize) || 1)));
  input.teamMemberIds = Array.isArray(raw.teamMemberIds)
    ? [...new Set(raw.teamMemberIds.filter((value): value is string => typeof value === 'string'))].slice(0, bookingConfig.maxCrewSize)
    : [];
  input.notes = text(raw.notes, 2000);
  if (!input.customerId || !input.propertyId) throw new AdminAuthError(400, 'customer_property_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new AdminAuthError(400, 'date_required');
  if (!Number.isFinite(Date.parse(input.start))) throw new AdminAuthError(400, 'start_required');

  const context = await scopedCustomerProperty(db, actor, input.customerId, input.propertyId);
  const quote = await deps.quote(env, db, actor, { ...raw, reference: 'ADMIN-DRAFT' });
  if (quote.status !== 'priced' || quote.totalCents === null || quote.durationMinutes === null) {
    throw new AdminAuthError(409, 'quote_not_priced');
  }
  const destination = await propertyDestination(env, context.property);
  if (!destination) throw new AdminAuthError(400, 'property_destination_missing');
  const crew = await staffResourceSelection(db, input.teamMemberIds ?? []);
  const crewSize = Math.max(1, input.teamMemberIds?.length || input.crewSize || 1);
  const duration = Math.min(
    bookingConfig.maximumJobMinutes,
    Math.max(
      bookingConfig.minimumJobMinutes,
      Math.ceil((quote.laborHours ?? 1) * 60 / crewSize),
    ),
  );
  const end = slotEnd(input.start, duration);
  const availability = await deps.availability(env, {
    date: input.date,
    durationMinutes: duration,
    destination,
    crewSize,
    ...(crew.bookingResourceIds.length > 0 ? { requiredResourceIds: crew.bookingResourceIds } : {}),
  });
  if (!availability.ok) throw new AdminAuthError(409, availability.reason);
  const exact = availability.availability.slots.find(
    (slot) => slot.start === new Date(input.start).toISOString() && slot.end === end,
  );
  if (!exact) throw new AdminAuthError(409, 'slot_unavailable');
  const teamMemberIds = await resolveCrew(db, input.teamMemberIds ?? [], exact.resourceIds);
  if (teamMemberIds.length === 0) throw new AdminAuthError(409, 'crew_unresolved');

  const reference = `MB-${input.date.replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  quote.fields.preferred_date = input.date;
  quote.fields.preferred_time = new Intl.DateTimeFormat('en-US', {
    timeZone: bookingConfig.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(exact.start));
  quote.fields.booking_slot_start = exact.start;
  quote.fields.booking_slot_end = exact.end;
  quote.fields.booked_crew_size = String(teamMemberIds.length);
  quote.fields.admin_team_member_ids = teamMemberIds.join(',');
  quote.fields.admin_notes = input.notes ?? '';
  quote.fields.quote_reference = reference;

  const requestId = `request_admin_${crypto.randomUUID()}`;
  const holdId = `manual_${crypto.randomUUID()}`;
  const estimateId = `est_${crypto.randomUUID()}`;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO estimates
         (id, customer_id, property_id, branch_id, service_code, status, source, quote_reference,
          input_snapshot_json, pricing_version, labor_hours, subtotal_cents, discount_cents, tax_cents,
          total_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'quoted', 'admin_manual', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .bind(
        estimateId,
        context.customerId,
        context.propertyId,
        context.branchId,
        quote.serviceCode,
        reference,
        JSON.stringify(quote.fields),
        quote.pricingVersion,
        quote.laborHours,
        quote.totalCents,
        quote.discountAmountCents ?? 0,
        quote.totalCents,
        now(),
        now(),
      ),
    db
      .prepare(
        `INSERT INTO booking_requests
         (id, hold_id, branch_id, customer_id, property_id, status, quote_reference, requested_date,
          start_at, end_at, duration_minutes, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        requestId,
        holdId,
        context.branchId,
        context.customerId,
        context.propertyId,
        reference,
        input.date,
        exact.start,
        exact.end,
        duration,
        JSON.stringify(quote.fields),
        now(),
        now(),
      ),
    db
      .prepare(
        `INSERT INTO booking_holds
         (id, request_id, status, quote_reference, start_at, end_at, expires_at, payload_json, created_at)
         VALUES (?, ?, 'held', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        holdId,
        requestId,
        reference,
        exact.start,
        exact.end,
        new Date(Date.parse(exact.end) + 30 * 60_000).toISOString(),
        JSON.stringify(quote.fields),
        now(),
      ),
    db
      .prepare(
        `INSERT INTO booking_commitments
         (id, booking_request_id, reference, state, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .bind(
        `commit_${crypto.randomUUID()}`,
        requestId,
        reference,
        JSON.stringify({ fields: quote.fields, teamMemberIds, resourceIds: exact.resourceIds }),
        now(),
        now(),
      ),
  ];
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'booking.manual_created',
    entityType: 'booking_request',
    entityId: requestId,
    detail: `${reference}:${quote.totalCents}:${teamMemberIds.join(',')}`,
  });
  return { requestId, holdId, reference, quote, appointmentId: null };
}

export interface ConfirmManualBookingResult {
  appointmentId: string;
  eventId: string;
  reference: string;
  resources: string[];
}

/** Confirms a pending manual request after re-validating every requirement. */
export async function confirmManualBooking(
  env: ManualBookingEnv,
  db: D1Database,
  actor: AdminActor,
  requestId: string,
  teamMemberIdsInput: string[] = [],
  overrides: Partial<ManualBookingDependencies> = {},
): Promise<ConfirmManualBookingResult> {
  const deps: ManualBookingDependencies = {
    quote: quoteManualBooking,
    availability: availabilityForDate,
    findEvent: findCalendarEventByReference,
    getEvent: getCalendarEvent,
    createEvent: createCalendarEvent,
    updateEvent: updateCalendarEvent,
    deleteEvent: deleteCalendarEvent,
    ...overrides,
  };
  const row = await db
    .prepare(
      `SELECT r.*, a.id AS existing_appointment, a.status AS existing_status,
              e.pricing_version, e.total_cents AS estimate_total, e.service_code
       FROM booking_requests r
       LEFT JOIN appointments a ON a.booking_request_id = r.id
       LEFT JOIN estimates e ON e.quote_reference = r.quote_reference
       WHERE r.id = ? LIMIT 1`,
    )
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'request_not_found');
  const branchId = (row.branch_id as string | null) ?? actor.branchId;
  if (actor.role !== 'owner' && branchId && actor.branchId && branchId !== actor.branchId) {
    throw new AdminAuthError(403, 'forbidden');
  }
  const status = String(row.status ?? '');
  if (status !== 'pending') throw new AdminAuthError(409, 'request_not_pending');
  if (!row.customer_id || !row.property_id) throw new AdminAuthError(400, 'request_customer_incomplete');
  const context = await scopedCustomerProperty(
    db,
    actor,
    String(row.customer_id),
    String(row.property_id),
  );
  const fields = parseFields(row.payload_json);
  const gate = await evaluateDocumentGate(
    db,
    {
      subjectType: 'customer',
      customerId: context.customerId,
      propertyId: context.propertyId,
      serviceCode: String(row.service_code ?? fields.service_type ?? 'residential-cleaning'),
      frequency: fields.frequency ?? '',
      bookingReference: String(row.quote_reference ?? ''),
      bookingRequestId: requestId,
      accessAuthorization: fields.access_authorization === 'yes',
      customerProducts: fields.customer_products === 'yes',
    },
    'before_confirmation',
  );
  if (!gate.satisfied) {
    throw new AdminAuthError(409, 'documents_required');
  }
  const startAt = String(row.start_at ?? '');
  const endAt = String(row.end_at ?? '');
  const duration = Number(row.duration_minutes) || Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000);
  const destination = await propertyDestination(env, context.property);
  if (!destination) throw new AdminAuthError(400, 'property_destination_missing');
  const storedTeamMembers = (fields.admin_team_member_ids ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const teamMemberIds = Array.isArray(teamMemberIdsInput) && teamMemberIdsInput.length > 0
    ? [...new Set(teamMemberIdsInput.filter((value) => typeof value === 'string'))].slice(0, bookingConfig.maxCrewSize)
    : storedTeamMembers.slice(0, bookingConfig.maxCrewSize);
  const crew = await staffResourceSelection(db, teamMemberIds);
  const availability = await deps.availability(env, {
    date: startAt.slice(0, 10),
    durationMinutes: duration,
    destination,
    crewSize: Math.max(1, teamMemberIds.length || Number(fields.booked_crew_size) || 1),
    ...(crew.bookingResourceIds.length > 0 ? { requiredResourceIds: crew.bookingResourceIds } : {}),
  });
  if (!availability.ok) throw new AdminAuthError(409, availability.reason);
  const exact = availability.availability.slots.find(
    (slot) => slot.start === new Date(startAt).toISOString() && slot.end === new Date(endAt).toISOString(),
  );
  if (!exact) throw new AdminAuthError(409, 'slot_unavailable');
  const assigned = teamMemberIds.length > 0
    ? teamMemberIds
    : await resolveCrew(db, [], exact.resourceIds);
  if (assigned.length === 0) throw new AdminAuthError(409, 'crew_unresolved');

  const reference = String(row.quote_reference ?? '').trim();
  if (!reference) throw new AdminAuthError(400, 'reference_required');
  const commitment = await db
    .prepare('SELECT * FROM booking_commitments WHERE reference = ? LIMIT 1')
    .bind(reference)
    .first<Record<string, unknown>>();
  const commitmentId = commitment?.id ? String(commitment.id) : `commit_${crypto.randomUUID()}`;
  if (!commitment) {
    await db
      .prepare(
        `INSERT INTO booking_commitments
         (id, booking_request_id, reference, state, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .bind(commitmentId, requestId, reference, JSON.stringify({ fields, assigned }), now(), now())
      .run();
  }

  let eventId = await deps.findEvent(env, reference);
  let eventOwned = false;
  if (eventId) {
    const event = await deps.getEvent(env, eventId).catch(() => null);
    if (!event || event.status === 'cancelled') eventId = null;
  }
  const oldAppointmentId = String(row.existing_appointment ?? '');
  if (!eventId) {
    const created = await deps.createEvent(env, {
      summary: `Sparkling Standard Cleaning - ${reference}`,
      description: `Owner-created booking ${reference}. Resources: ${exact.resourceIds.join(', ')}.`,
      location: context.propertyAddress,
      start: exact.start,
      end: exact.end,
      timeZone: bookingConfig.timeZone,
      reference,
      resourceIds: exact.resourceIds,
    });
    if (!created.ok || !created.eventId) {
      await markBookingCommitment(db, commitmentId, 'failed', {
        error: created.reason ?? 'calendar_write_failed',
        attempts: Number(commitment?.attempts ?? 0) + 1,
      }).catch(() => undefined);
      throw new AdminAuthError(502, created.reason ?? 'calendar_write_failed');
    }
    eventId = created.eventId;
    eventOwned = true;
    await markBookingCommitment(db, commitmentId, 'calendar_created', {
      eventId,
      owned: true,
      attempts: Number(commitment?.attempts ?? 0) + 1,
    }).catch(() => undefined);
  }

  const appointmentId = oldAppointmentId || `appt_${crypto.randomUUID()}`;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO appointments
         (id, branch_id, customer_id, property_id, booking_request_id, status, start_at, end_at,
          timezone, duration_minutes, crew_size, source, reference, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, 'admin_manual', ?, ?, ?, ?)
         ON CONFLICT(reference) DO UPDATE SET
           status = 'confirmed', start_at = excluded.start_at, end_at = excluded.end_at,
           duration_minutes = excluded.duration_minutes, crew_size = excluded.crew_size,
           cancelled_at = NULL, updated_at = excluded.updated_at`,
      )
      .bind(
        appointmentId,
        branchId,
        context.customerId,
        context.propertyId,
        requestId,
        exact.start,
        exact.end,
        bookingConfig.timeZone,
        duration,
        assigned.length,
        reference,
        fields.admin_notes ?? '',
        now(),
        now(),
      ),
    db.prepare('DELETE FROM appointment_resources WHERE appointment_id = ?').bind(appointmentId),
    ...assigned.map((memberId) =>
      db
        .prepare(
          `INSERT INTO appointment_resources (appointment_id, team_member_id, role)
           VALUES (?, ?, (SELECT CASE WHEN is_solo = 1 THEN 'solo' WHEN is_lead = 1 THEN 'lead' ELSE 'cleaner' END
                           FROM team_members WHERE id = ?))`,
        )
        .bind(appointmentId, memberId, memberId),
    ),
    db
      .prepare(
        `INSERT INTO calendar_links (id, appointment_id, provider, provider_event_id, sync_status, last_synced_at)
         VALUES (?, ?, 'google', ?, 'synced', ?)
         ON CONFLICT(provider, provider_event_id) DO UPDATE SET
           appointment_id = excluded.appointment_id, sync_status = 'synced',
           last_synced_at = excluded.last_synced_at, error_detail = ''`,
      )
      .bind(`cal_${crypto.randomUUID()}`, appointmentId, eventId, now()),
    db
      .prepare("UPDATE booking_requests SET status = 'confirmed', updated_at = ? WHERE id = ?")
      .bind(now(), requestId),
    db
      .prepare("UPDATE booking_holds SET status = 'confirmed' WHERE request_id = ?")
      .bind(requestId),
    db
      .prepare("UPDATE estimates SET status = 'accepted', updated_at = ? WHERE quote_reference = ?")
      .bind(now(), reference),
    db
      .prepare(
        `UPDATE booking_commitments
         SET appointment_id = ?, calendar_event_id = ?, calendar_owned = ?, state = 'confirmed',
             last_error = '', updated_at = ?
         WHERE id = ?`,
      )
      .bind(appointmentId, eventId, eventOwned ? 1 : 0, now(), commitmentId),
  ];
  try {
    if (db.batch) await db.batch(statements);
    else for (const statement of statements) await statement.run();
  } catch (error) {
    let compensated = false;
    if (eventOwned && eventId) {
      compensated = await deps.deleteEvent(env, eventId).then((result) => result.ok).catch(() => false);
    }
    await markBookingCommitment(db, commitmentId, compensated ? 'compensated' : 'failed', {
      eventId,
      owned: eventOwned,
      error: (error as Error).message,
    }).catch(() => undefined);
    throw new AdminAuthError(502, compensated ? 'appointment_write_failed' : 'booking_recovery_required');
  }
  await audit(db, {
    actorUserId: actor.id,
    action: 'booking.manual_confirmed',
    entityType: 'appointment',
    entityId: appointmentId,
    detail: `${reference}:${eventId}:${assigned.join(',')}`,
  });
  return { appointmentId, eventId, reference, resources: exact.resourceIds };
}

function parseFields(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, entry]) => typeof entry === 'string'),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

export interface ManualAvailability {
  ok: boolean;
  reason?: string;
  date: string;
  durationMinutes: number;
  crewSize: number;
  slots: Array<{ start: string; end: string; label: string; resourceIds: string[] }>;
  staff: Array<{ id: string; name: string; resourceId: string; isSolo: boolean; isLead: boolean }>;
}

/** Returns real server-side availability for the admin scheduler. */
export async function manualAvailability(
  env: ManualBookingEnv,
  db: D1Database,
  actor: AdminActor,
  raw: Record<string, unknown>,
  overrides: Partial<ManualBookingDependencies> = {},
): Promise<ManualAvailability> {
  const availability = overrides.availability ?? availabilityForDate;
  const customerId = text(raw.customerId, 100);
  const propertyId = text(raw.propertyId, 100);
  const date = text(raw.date, 10);
  if (!customerId || !propertyId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AdminAuthError(400, 'availability_fields_required');
  }
  const context = await scopedCustomerProperty(db, actor, customerId, propertyId);
  const destination = await propertyDestination(env, context.property);
  if (!destination) throw new AdminAuthError(400, 'property_destination_missing');
  const duration = Math.min(
    bookingConfig.maximumJobMinutes,
    Math.max(bookingConfig.minimumJobMinutes, Math.round(Number(raw.durationMinutes) || 120)),
  );
  const crewSize = Math.min(bookingConfig.maxCrewSize, Math.max(1, Math.round(Number(raw.crewSize) || 1)));
  const teamMemberIds = Array.isArray(raw.teamMemberIds)
    ? raw.teamMemberIds.filter((value): value is string => typeof value === 'string')
    : [];
  const crew = await staffResourceSelection(db, teamMemberIds);
  const result = await availability(env, {
    date,
    durationMinutes: duration,
    destination,
    crewSize: Math.max(1, crew.bookingResourceIds.length || crewSize),
    ...(crew.bookingResourceIds.length > 0 ? { requiredResourceIds: crew.bookingResourceIds } : {}),
  });
  const staffRows = await loadStaffResources(db, date);
  const staff = staffRows.map((member) => ({
    id: member.teamMemberId,
    name: member.displayName,
    resourceId: member.bookingResourceId,
    isSolo: member.isSolo,
    isLead: member.isLead,
  }));
  if (!result.ok) {
    return { ok: false, reason: result.reason, date, durationMinutes: duration, crewSize, slots: [], staff };
  }
  return {
    ok: true,
    date,
    durationMinutes: result.durationMinutes,
    crewSize: result.crewSize,
    slots: result.availability.slots.map((slot) => ({
      start: slot.start,
      end: slot.end,
      label: new Intl.DateTimeFormat('en-US', {
        timeZone: bookingConfig.timeZone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(slot.start)),
      resourceIds: slot.resourceIds,
    })),
    staff,
  };
}

export interface CancelManualBookingResult {
  ok: boolean;
  calendarEventId: string | null;
  appointmentId: string | null;
}

/** Cancels a manual booking, removing the provider event before local state. */
export async function cancelManualBooking(
  env: ManualBookingEnv,
  db: D1Database,
  actor: AdminActor,
  requestId: string,
  reason: string,
  overrides: Partial<ManualBookingDependencies> = {},
): Promise<CancelManualBookingResult> {
  const deps: ManualBookingDependencies = {
    quote: quoteManualBooking,
    availability: availabilityForDate,
    findEvent: findCalendarEventByReference,
    getEvent: getCalendarEvent,
    createEvent: createCalendarEvent,
    updateEvent: updateCalendarEvent,
    deleteEvent: deleteCalendarEvent,
    ...overrides,
  };
  const row = await db
    .prepare('SELECT * FROM booking_requests WHERE id = ? LIMIT 1')
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'request_not_found');
  if (actor.role !== 'owner' && row.branch_id && actor.branchId && row.branch_id !== actor.branchId) {
    throw new AdminAuthError(403, 'forbidden');
  }
  const appointment = await db
    .prepare('SELECT id FROM appointments WHERE booking_request_id = ? LIMIT 1')
    .bind(requestId)
    .first<{ id: string }>();
  const link = appointment
    ? await db
        .prepare("SELECT provider_event_id FROM calendar_links WHERE appointment_id = ? AND provider = 'google' ORDER BY last_synced_at DESC LIMIT 1")
        .bind(appointment.id)
        .first<{ provider_event_id: string }>()
    : null;
  const eventId = link?.provider_event_id ?? '';
  if (eventId) {
    const deleted = await deps.deleteEvent(env, eventId);
    if (!deleted.ok) throw new AdminAuthError(502, deleted.reason ?? 'calendar_delete_failed');
  }
  const statements: D1PreparedStatement[] = [
    db
      .prepare("UPDATE booking_requests SET status = 'released', decline_reason = ?, updated_at = ? WHERE id = ?")
      .bind(text(reason, 500), now(), requestId),
    db.prepare("UPDATE booking_holds SET status = 'released' WHERE request_id = ?").bind(requestId),
    db
      .prepare("UPDATE estimates SET status = 'void', updated_at = ? WHERE quote_reference = ?")
      .bind(now(), String(row.quote_reference ?? '')),
    db
      .prepare("UPDATE booking_commitments SET state = 'cancelled', last_error = '', updated_at = ? WHERE reference = ?")
      .bind(now(), String(row.quote_reference ?? '')),
  ];
  if (appointment) {
    statements.splice(
      1,
      0,
      db
        .prepare("UPDATE appointments SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?")
        .bind(now(), now(), appointment.id),
      db
        .prepare("UPDATE calendar_links SET sync_status = 'deleted', last_synced_at = ? WHERE appointment_id = ?")
        .bind(now(), appointment.id),
    );
  }
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'booking.manual_cancelled',
    entityType: 'booking_request',
    entityId: requestId,
    detail: `${eventId}:${text(reason, 300)}`,
  });
  return { ok: true, calendarEventId: eventId || null, appointmentId: appointment?.id ?? null };
}

export interface RescheduleManualBookingResult {
  ok: boolean;
  start: string;
  end: string;
  calendarEventId: string | null;
}

/** Reschedules a manual booking calendar-first with compensating rollback. */
export async function rescheduleManualBooking(
  env: ManualBookingEnv,
  db: D1Database,
  actor: AdminActor,
  requestId: string,
  input: { date: string; start: string; end: string; durationMinutes?: number; teamMemberIds?: string[] },
  overrides: Partial<ManualBookingDependencies> = {},
): Promise<RescheduleManualBookingResult> {
  const deps: ManualBookingDependencies = {
    quote: quoteManualBooking,
    availability: availabilityForDate,
    findEvent: findCalendarEventByReference,
    getEvent: getCalendarEvent,
    createEvent: createCalendarEvent,
    updateEvent: updateCalendarEvent,
    deleteEvent: deleteCalendarEvent,
    ...overrides,
  };
  const row = await db
    .prepare(
      `SELECT r.*, a.id AS appointment_id FROM booking_requests r
       LEFT JOIN appointments a ON a.booking_request_id = r.id WHERE r.id = ? LIMIT 1`,
    )
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'request_not_found');
  if (actor.role !== 'owner' && row.branch_id && actor.branchId && row.branch_id !== actor.branchId) {
    throw new AdminAuthError(403, 'forbidden');
  }
  if (String(row.status) !== 'pending' && String(row.status) !== 'confirmed') {
    throw new AdminAuthError(409, 'request_not_reschedulable');
  }
  if (!row.customer_id || !row.property_id) throw new AdminAuthError(400, 'request_customer_incomplete');
  const context = await scopedCustomerProperty(db, actor, String(row.customer_id), String(row.property_id));
  const destination = await propertyDestination(env, context.property);
  if (!destination) throw new AdminAuthError(400, 'property_destination_missing');
  const oldStart = String(row.start_at ?? '');
  const oldEnd = String(row.end_at ?? '');
  const duration = Number(input.durationMinutes) || Number(row.duration_minutes) || Math.round((Date.parse(oldEnd) - Date.parse(oldStart)) / 60_000);
  const teamMemberIds = Array.isArray(input.teamMemberIds)
    ? [...new Set(input.teamMemberIds.filter((value) => typeof value === 'string'))].slice(0, bookingConfig.maxCrewSize)
    : [];
  const crew = await staffResourceSelection(db, teamMemberIds);
  const calendarEventId = row.appointment_id
    ? (await db
        .prepare("SELECT provider_event_id FROM calendar_links WHERE appointment_id = ? AND provider = 'google' ORDER BY last_synced_at DESC LIMIT 1")
        .bind(String(row.appointment_id))
        .first<{ provider_event_id: string }>())?.provider_event_id ?? ''
    : '';
  const availability = await deps.availability(env, {
    date: input.date,
    durationMinutes: duration,
    destination,
    crewSize: Math.max(1, teamMemberIds.length || Number(parseFields(row.payload_json).booked_crew_size) || 1),
    ...(crew.bookingResourceIds.length > 0 ? { requiredResourceIds: crew.bookingResourceIds } : {}),
    ...(calendarEventId ? { excludeEventIds: [calendarEventId] } : {}),
  });
  if (!availability.ok) throw new AdminAuthError(409, availability.reason);
  const exact = availability.availability.slots.find(
    (slot) => slot.start === new Date(input.start).toISOString() && slot.end === new Date(input.end).toISOString(),
  );
  if (!exact) throw new AdminAuthError(409, 'slot_unavailable');
  const assigned = teamMemberIds.length > 0
    ? teamMemberIds
    : await resolveCrew(db, [], exact.resourceIds);
  if (assigned.length === 0) throw new AdminAuthError(409, 'crew_unresolved');

  if (calendarEventId) {
    const updated = await deps.updateEvent(env, calendarEventId, {
      start: exact.start,
      end: exact.end,
      timeZone: bookingConfig.timeZone,
      resourceIds: exact.resourceIds,
    });
    if (!updated.ok) throw new AdminAuthError(502, updated.reason ?? 'calendar_write_failed');
  }
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE booking_requests SET requested_date = ?, start_at = ?, end_at = ?, duration_minutes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.date, exact.start, exact.end, duration, now(), requestId),
    db
      .prepare('UPDATE booking_holds SET start_at = ?, end_at = ?, expires_at = ? WHERE request_id = ?')
      .bind(exact.start, exact.end, new Date(Date.parse(exact.end) + 30 * 60_000).toISOString(), requestId),
  ];
  if (row.appointment_id) {
    statements.push(
      db
        .prepare(
          `UPDATE appointments SET start_at = ?, end_at = ?, duration_minutes = ?, crew_size = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(exact.start, exact.end, duration, assigned.length, now(), String(row.appointment_id)),
      db.prepare('DELETE FROM appointment_resources WHERE appointment_id = ?').bind(String(row.appointment_id)),
      ...assigned.map((memberId) =>
        db
          .prepare(
            `INSERT INTO appointment_resources (appointment_id, team_member_id, role)
             VALUES (?, ?, (SELECT CASE WHEN is_solo = 1 THEN 'solo' WHEN is_lead = 1 THEN 'lead' ELSE 'cleaner' END
                             FROM team_members WHERE id = ?))`,
          )
          .bind(String(row.appointment_id), memberId, memberId),
      ),
    );
  }
  try {
    if (db.batch) await db.batch(statements);
    else for (const statement of statements) await statement.run();
  } catch (error) {
    if (calendarEventId) {
      await deps.updateEvent(env, calendarEventId, {
        start: oldStart,
        end: oldEnd,
        timeZone: bookingConfig.timeZone,
      }).catch(() => undefined);
    }
    throw new AdminAuthError(502, 'reschedule_recovery_required');
  }
  await audit(db, {
    actorUserId: actor.id,
    action: 'booking.manual_rescheduled',
    entityType: 'booking_request',
    entityId: requestId,
    detail: `${oldStart} -> ${exact.start}`,
  });
  return { ok: true, start: exact.start, end: exact.end, calendarEventId: calendarEventId || null };
}
