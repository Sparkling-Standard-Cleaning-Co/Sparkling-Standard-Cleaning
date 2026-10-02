// Customer-facing receipt copy for a submitted reservation request.
//
// Integrity rule: the browser must never imply that a price was accepted.
// Only a 'verified' server verdict may be described as verified; every other
// outcome wears its uncertainty openly. This module is pure so the wording is
// unit-testable.

import type { LeadVerification } from './submit';

export interface SubmissionReceipt {
  state: 'success' | 'warning';
  message: string;
}

export function reservationReceipt(
  verification: LeadVerification | null | undefined,
  via: 'relay' | 'provider',
): SubmissionReceipt {
  if (via === 'provider') {
    // Direct provider fallback: no server checked anything.
    return {
      state: 'warning',
      message:
        'Request received — not booked yet. We could not complete our usual check, so Sparkling Standard will confirm scope, travel and price with you before anything is scheduled.',
    };
  }

  switch (verification?.status) {
    case 'verified':
      return {
        state: 'success',
        message:
          'Reservation request received — we checked the proposed price for your confirmed address. Sparkling Standard will confirm the final price, scope and date; nothing is booked yet.',
      };
    case 'preliminary':
      return {
        state: 'warning',
        message:
          'Reservation request received — the proposed price is confirmed, but the drive time still needs a final check. Sparkling Standard will confirm the final travel-inclusive price before anything is scheduled.',
      };
    case 'mismatch':
      return {
        state: 'warning',
        message:
          'Reservation request received — the price needs a personal review, so Sparkling Standard will confirm the correct price with you before anything is scheduled. Nothing is booked yet.',
      };
    case 'unverifiable':
      return {
        state: 'warning',
        message:
          'Reservation request received — Sparkling Standard will review your estimate personally before anything is scheduled. Nothing is booked yet.',
      };
    default:
      return {
        state: 'warning',
        message:
          'Request received — not booked yet. Sparkling Standard will confirm scope, travel and price with you before anything is scheduled.',
      };
  }
}
