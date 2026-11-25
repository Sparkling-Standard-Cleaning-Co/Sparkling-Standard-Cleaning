import type { NotificationEventKey } from '../admin/communications.ts';

/**
 * Chooses the internal notification event for an inbound website submission.
 * Complaints escalate immediately; facility work routes to the commercial
 * inbox; ordinary contact and booking requests keep their existing routing.
 */
export function leadNotificationEvent(input: {
  requestType?: string;
  inquiryType?: string;
}): NotificationEventKey {
  const inquiry = String(input.inquiryType ?? '').trim().toLowerCase();
  if (inquiry === 'complaint') return 'customer_complaint';
  if (
    input.requestType === 'facility_estimate' ||
    inquiry === 'commercial_cleaning' ||
    inquiry === 'church_cleaning'
  ) {
    return 'commercial_inquiry';
  }
  return input.requestType === 'contact' ? 'contact_inquiry' : 'booking_request';
}
