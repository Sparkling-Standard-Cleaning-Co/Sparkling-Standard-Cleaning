// Owner decision (2026-11-22): required customer agreements are signed before
// payment, and booking-specific documents are signed for each booking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_CUSTOMER_PACKET_CODES,
  PER_BOOKING_DOCUMENT_IDS,
  normalizeImport,
} from '../scripts/legal/packet-policy.mjs';

const data = normalizeImport({
  documents: [],
  packets: [
    {
      code: 'customer.deep',
      subjectType: 'customer',
      items: [
        { id: 'LEG-AB060020', required: 1, stage: 'before_confirmation', perBooking: 0 },
        { id: 'LEG-633AE35B', required: 1, stage: 'before_confirmation', perBooking: 0 },
        { id: 'LEG-6467D94C', required: 0, stage: 'optional', perBooking: 0 },
      ],
    },
    {
      code: 'customer.residential',
      subjectType: 'customer',
      items: [{ id: 'LEG-4A9FC934', required: 1, stage: 'before_confirmation', perBooking: 0 }],
    },
    {
      code: 'customer.recurring',
      subjectType: 'customer',
      items: [{ id: 'LEG-8EFF2E52', required: 1, stage: 'before_confirmation', perBooking: 0 }],
    },
    {
      code: 'customer.move_in_out',
      subjectType: 'customer',
      items: [{ id: 'LEG-6C749FA3', required: 1, stage: 'before_confirmation', perBooking: 0 }],
    },
    {
      code: 'customer.commercial',
      subjectType: 'customer',
      items: [{ id: 'LEG-D25F29B4', required: 1, stage: 'before_confirmation', perBooking: 0 }],
    },
    {
      code: 'employee.onboarding',
      subjectType: 'employee',
      items: [{ id: 'LEG-2E96A176', required: 1, stage: 'before_employee_activation', perBooking: 0 }],
    },
  ],
});

test('all required customer packet items are enforced before payment', () => {
  for (const packet of data.packets.filter((item: { subjectType: string }) => item.subjectType === 'customer')) {
    for (const item of packet.items.filter((entry: { required: number }) => entry.required === 1)) {
      assert.equal(item.stage, 'before_payment', `${packet.code}:${item.id}`);
    }
    for (const item of packet.items.filter((entry: { required: number }) => entry.required === 0)) {
      assert.equal(item.stage, 'optional', `${packet.code}:${item.id}`);
    }
  }
});

test('booking-specific customer documents require a signature for each booking', () => {
  const deep = data.packets.find((packet: { code: string }) => packet.code === 'customer.deep');
  assert.equal(deep.items.find((item: { id: string }) => item.id === 'LEG-633AE35B').perBooking, 1);
  assert.equal(deep.items.find((item: { id: string }) => item.id === 'LEG-AB060020').perBooking, 0);
  assert.ok(PER_BOOKING_DOCUMENT_IDS.has('LEG-4A9FC934'));
  assert.ok(PER_BOOKING_DOCUMENT_IDS.has('LEG-6C749FA3'));
});

test('only the four verified residential packets are active for this release', () => {
  const active = data.packets.filter((packet: { status: string }) => packet.status === 'active');
  assert.deepEqual(
    active.map((packet: { code: string }) => packet.code).sort(),
    [...ACTIVE_CUSTOMER_PACKET_CODES].sort(),
  );
  assert.equal(
    data.packets.find((packet: { code: string }) => packet.code === 'employee.onboarding').status,
    'inactive',
  );
});
