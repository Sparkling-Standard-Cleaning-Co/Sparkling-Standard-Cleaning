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
        'Request received — not booked yet. Our server was not available to verify the quote, so the owner will verify scope, travel and price with you before anything is scheduled.',
    };
  }

  switch (verification?.status) {
    case 'verified':
      return {
        state: 'success',
        message:
          'Reservation request received — our server verified this price for your confirmed address. The owner will confirm scope and date; nothing is booked yet.',
      };
    case 'preliminary':
      return {
        state: 'warning',
        message:
          'Reservation request received — the price calculation matches, but travel was still preliminary. The owner will verify the route and confirm the final travel-inclusive price before anything is scheduled.',
      };
    case 'mismatch':
      return {
        state: 'warning',
        message:
          'Reservation request received — our price check found a difference from the displayed price, so the owner will confirm the correct price with you before anything is scheduled. Nothing is booked yet.',
      };
    case 'unverifiable':
      return {
        state: 'warning',
        message:
          'Reservation request received — the owner will verify your quote personally before anything is scheduled. Nothing is booked yet.',
      };
    default:
      return {
        state: 'warning',
        message:
          'Request received — not booked yet. The owner will verify scope, travel and price with you before anything is scheduled.',
      };
  }
}
