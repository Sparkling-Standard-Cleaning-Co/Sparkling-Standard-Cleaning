/**
 * Owner-approved department email routing. These defaults are domain facts,
 * not secrets. The public contact address is customer service; owner@ is kept
 * for ownership, financial and critical security correspondence.
 */
export const EMAIL_ROUTING = {
  bookings: 'bookings@sparkling-standard.com',
  customerService: 'customer-service@sparkling-standard.com',
  billing: 'billing@sparkling-standard.com',
  hiring: 'hiring@sparkling-standard.com',
  admin: 'admin@sparkling-standard.com',
  owner: 'owner@sparkling-standard.com',
  customerServiceSenderName: 'Sparkling Standard Customer Service',
  hiringSenderName: 'Sparkling Standard | Hiring Team',
  notificationsSender: 'Sparkling Standard <notifications@sparkling-standard.com>',
} as const;

export type EmailRouting = typeof EMAIL_ROUTING;
