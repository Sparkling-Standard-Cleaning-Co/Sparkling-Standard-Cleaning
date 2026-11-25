// Owner-approved packet enforcement policy (2026-11-22).
//
// The owner decided that every required customer agreement is executed before
// Stripe checkout and that documents containing booking-specific material
// terms are signed for each booking. This module is the single import policy
// used by staging verification and the controlled production import.

export const PER_BOOKING_DOCUMENT_IDS = new Set([
  'LEG-4A9FC934', // Residential Deep Cleaning Agreement
  'LEG-633AE35B', // Deep Cleaning Scope and Terms
  'LEG-8EFF2E52', // Residential Recurring Cleaning Agreement
  'LEG-6C749FA3', // Move-In / Move-Out Cleaning Agreement
  'LEG-B329F61E', // Vacation Rental / STR Turnover Agreement
  'LEG-D25F29B4', // Commercial Cleaning Service Agreement
  'LEG-9F30E030', // Church and Facility Cleaning Agreement
  'LEG-PM-2026-11', // Property Manager / Real Estate Master Service Agreement
  'LEG-A636DDB4', // Residential Access Authorization
  'LEG-75D90DBB', // Additional Service and Add-On Authorization
  'SS-CUST-COM-KEY-2026-11', // Commercial Key Custody and Access Authorization
]);

export const ACTIVE_CUSTOMER_PACKET_CODES = new Set([
  'customer.deep',
  'customer.residential',
  'customer.recurring',
  'customer.move_in_out',
]);

function booleanFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'yes';
}

/**
 * Normalizes one packet item to the owner-approved enforcement model.
 * Required customer documents are always `before_payment`; optional documents
 * remain optional. Booking-specific documents are marked per booking.
 */
export function normalizePacketItem(item) {
  const required = booleanFlag(item.required);
  return {
    ...item,
    required: required ? 1 : 0,
    stage: required ? 'before_payment' : 'optional',
    perBooking: PER_BOOKING_DOCUMENT_IDS.has(String(item.id)) ? 1 : 0,
  };
}

export function normalizePacket(packet) {
  const subjectType = packet.subjectType === 'employee' ? 'employee' : 'customer';
  const items = (packet.items ?? []).map((item) => {
    if (subjectType === 'employee') {
      return {
        ...item,
        required: booleanFlag(item.required) ? 1 : 0,
        perBooking: 0,
      };
    }
    return normalizePacketItem(item);
  });
  return {
    ...packet,
    subjectType,
    items,
    // Employee onboarding is imported for the admin composer but stays
    // inactive until its own production acceptance run. Only the four
    // residential service packets are active in this release.
    status:
      subjectType === 'customer' && ACTIVE_CUSTOMER_PACKET_CODES.has(String(packet.code))
        ? 'active'
        : 'inactive',
  };
}

export function normalizeImport(data) {
  return {
    ...data,
    packets: (data.packets ?? []).map(normalizePacket),
  };
}
