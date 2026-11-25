import { test } from 'node:test';
import assert from 'node:assert/strict';

import { leadNotificationEvent } from '../src/lib/forms/lead-routing.ts';

test('complaints escalate, facility work routes commercially and ordinary requests keep their routing', () => {
  assert.equal(
    leadNotificationEvent({ requestType: 'contact', inquiryType: 'complaint' }),
    'customer_complaint',
  );
  assert.equal(
    leadNotificationEvent({ requestType: 'facility_estimate' }),
    'commercial_inquiry',
  );
  assert.equal(
    leadNotificationEvent({ requestType: 'contact', inquiryType: 'church_cleaning' }),
    'commercial_inquiry',
  );
  assert.equal(
    leadNotificationEvent({ requestType: 'contact', inquiryType: 'general_question' }),
    'contact_inquiry',
  );
  assert.equal(
    leadNotificationEvent({ requestType: 'reservation_request' }),
    'booking_request',
  );
});
