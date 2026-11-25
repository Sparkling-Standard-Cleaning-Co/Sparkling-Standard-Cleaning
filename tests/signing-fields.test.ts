import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyBookingContactChoice,
  normalizeSigningFieldValues,
  signingFieldSummary,
  signingFieldsForRequest,
} from '../src/lib/documents/signing-fields.ts';

test('residential and facility packets expose context-specific access fields', () => {
  const residential = signingFieldsForRequest({
    bundleCode: 'customer.deep',
    subjectType: 'customer',
  });
  assert.ok(residential.some((field) => field.key === 'access_method' && field.required));
  assert.ok(residential.some((field) => field.key === 'access_instructions'));
  assert.equal(
    residential
      .find((field) => field.key === 'access_method')
      ?.options?.some((option) => option.value === 'temporary_code'),
    true,
  );

  const facility = signingFieldsForRequest({
    bundleCode: 'customer.church',
    subjectType: 'customer',
  });
  assert.ok(facility.some((field) => field.key === 'access_method'));
  assert.equal(
    facility
      .find((field) => field.key === 'access_method')
      ?.options?.some((option) => option.value === 'key_custody'),
    true,
  );

  assert.deepEqual(
    signingFieldsForRequest({ bundleCode: 'employee.onboarding', subjectType: 'employee' }),
    [],
  );
  assert.deepEqual(
    signingFieldsForRequest({ bundleCode: 'packet.unknown', subjectType: 'customer' }),
    [],
  );
});

test('required access choices fail closed and unknown keys are discarded', () => {
  const fields = signingFieldsForRequest({
    bundleCode: 'customer.residential',
    subjectType: 'customer',
  });
  const missing = normalizeSigningFieldValues(fields, {
    access_instructions: 'Gate code will be provided securely.',
    secret_admin_key: 'must not be stored',
  });
  assert.equal(missing.errors.includes('required:access_method'), true);
  assert.equal('secret_admin_key' in missing.values, false);
  assert.equal(missing.values.access_instructions, 'Gate code will be provided securely.');

  const invalid = normalizeSigningFieldValues(fields, { access_method: 'front_door_master_key' });
  assert.equal(invalid.errors.includes('invalid:access_method'), true);

  const valid = normalizeSigningFieldValues(fields, {
    access_method: 'customer_present',
    pets_present: true,
    pets_details: 'One friendly dog.',
    access_instructions: 'Park in the driveway.',
  });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.values.access_method, 'customer_present');
  assert.equal(valid.values.pets_present, 'yes');

  const summary = signingFieldSummary(fields, valid.values);
  assert.ok(summary.some((row) => row.label === 'Access method' && row.value.includes('I will be present')));
  assert.ok(summary.some((row) => row.label === 'Pet details' && row.value === 'One friendly dog.'));
});

test('same booking contact is derived from the authorized customer, never from submitted values', () => {
  const fields = signingFieldsForRequest({
    bundleCode: 'customer.deep',
    subjectType: 'customer',
  });
  const same = applyBookingContactChoice(fields, {
    access_method: 'customer_present',
    access_contact_same: 'same',
    access_contact_name: 'Someone Else',
    access_contact_phone: '555-999-0000',
  }, { name: 'Jordan Example', phone: '(850) 555-0100' });
  assert.equal(same.error, null);
  assert.equal(same.values.access_contact_name, 'Jordan Example');
  assert.equal(same.values.access_contact_phone, '(850) 555-0100');

  const missing = applyBookingContactChoice(fields, {
    access_method: 'customer_present',
    access_contact_same: 'same',
  }, { name: 'Jordan Example' });
  assert.equal(missing.error, 'booking_contact_phone_missing');
  assert.equal(missing.values.access_contact_phone, undefined);
});

test('a different access contact requires both a name and phone', () => {
  const fields = signingFieldsForRequest({
    bundleCode: 'customer.deep',
    subjectType: 'customer',
  });
  const missingName = applyBookingContactChoice(fields, {
    access_method: 'customer_present',
    access_contact_same: 'different',
    access_contact_phone: '850-555-0101',
  }, { name: 'Jordan Example', phone: '(850) 555-0100' });
  assert.equal(missingName.error, 'access_contact_name_missing');

  const missingPhone = applyBookingContactChoice(fields, {
    access_method: 'customer_present',
    access_contact_same: 'different',
    access_contact_name: 'Alex Alternate',
  }, { name: 'Jordan Example', phone: '(850) 555-0100' });
  assert.equal(missingPhone.error, 'access_contact_phone_missing');

  const valid = applyBookingContactChoice(fields, {
    access_method: 'customer_present',
    access_contact_same: 'different',
    access_contact_name: 'Alex Alternate',
    access_contact_phone: '850-555-0101',
  }, { name: 'Jordan Example', phone: '(850) 555-0100' });
  assert.equal(valid.error, null);
  assert.equal(valid.values.access_contact_name, 'Alex Alternate');
  assert.equal(valid.values.access_contact_phone, '850-555-0101');
});

test('pet details disappear from the schedule when none are provided', () => {
  const fields = signingFieldsForRequest({
    bundleCode: 'customer.deep',
    subjectType: 'customer',
  });
  const summary = signingFieldSummary(fields, {
    access_method: 'lockbox',
    pets_present: 'no',
  });
  assert.equal(summary.some((row) => row.label === 'Pet details'), false);
});
