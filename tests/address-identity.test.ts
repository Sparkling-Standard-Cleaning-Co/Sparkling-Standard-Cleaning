import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addressKey,
  normalizeAddressLine,
  phoneKey,
  samePropertyAddress,
} from '../src/lib/address/address-key.ts';

test('street suffix and punctuation variants identify the same property', () => {
  assert.equal(
    samePropertyAddress(
      { line1: '6360 Haupert Ln', line2: '', postalCode: '32577' },
      { line1: '6360 haupert lane', line2: '', postalCode: '' },
    ),
    true,
  );
  assert.equal(
    samePropertyAddress(
      { line1: '228 Promenade Lane', postalCode: '32533' },
      { line1: '228 promenade ln', postalCode: '32533' },
    ),
    true,
  );
});

test('different units and different streets are never merged', () => {
  assert.equal(
    samePropertyAddress(
      { line1: '12 Main St', line2: 'Apt 4', postalCode: '32502' },
      { line1: '12 Main St', line2: 'Apt 5', postalCode: '32502' },
    ),
    false,
  );
  assert.equal(
    samePropertyAddress(
      { line1: '12 Oak St', postalCode: '32502' },
      { line1: '12 Oak Ave', postalCode: '32502' },
    ),
    false,
  );
});

test('the same street in different ZIP codes stays distinct', () => {
  assert.equal(
    samePropertyAddress(
      { line1: '12 Main St', postalCode: '32502' },
      { line1: '12 Main St', postalCode: '32503' },
    ),
    false,
  );
});
test('an inline unit is separated from the street line', () => {
  assert.deepEqual(normalizeAddressLine('12 Main Street Apt 4', ''), { street: '12 main st', unit: '4' });
});

test('address keys retain locality and phone keys tolerate country codes', () => {
  assert.equal(addressKey({ line1: '1 Test Way', postalCode: '32502' }), '1 test way|32502');
  assert.notEqual(
    addressKey({ line1: '1 Test Way', postalCode: '32502' }),
    addressKey({ line1: '1 Test Way', postalCode: '32503' }),
  );
  assert.equal(phoneKey('+1 (850) 426-8479'), '8504268479');
  assert.equal(phoneKey('18504268479'), '8504268479');
});
