import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  agreementActivationBlocked,
  agreementConfig,
  agreementDocuments,
  agreementsForService,
} from '../src/config/agreements.ts';

const ids = (service: Parameters<typeof agreementsForService>[0], options = {}) =>
  agreementsForService(service, options).map((document) => document.id);

test('the actual owner form library is cataloged by service', () => {
  assert.deepEqual(ids('residential'), ['RES-002', 'RES-006', 'RES-009', 'RES-011']);
  assert.deepEqual(ids('deep'), ['RES-002', 'RES-006', 'RES-009', 'RES-011']);
  assert.deepEqual(ids('recurring'), ['RES-002', 'RES-006', 'RES-009', 'RES-011']);
  assert.deepEqual(ids('str'), ['STR-001', 'STR-003']);
  assert.deepEqual(ids('commercial'), ['COM-009', 'COM-010', 'COM-012', 'COM-014']);
  assert.deepEqual(ids('church'), ['COM-009', 'COM-010', 'COM-012', 'COM-014']);
});

test('conditional forms are selected only for the matching scenario', () => {
  assert.ok(ids('residential', { customerProducts: true }).includes('RES-012'));
  assert.ok(!ids('residential').includes('RES-012'));
  assert.ok(!ids('residential', { accessAuthorization: false }).includes('RES-011'));
  assert.ok(ids('residential', { accessAuthorization: true }).includes('RES-011'));
});

test('every located agreement remains draft and mandatory signing is blocked', () => {
  assert.equal(agreementConfig.enabled, false);
  assert.equal(agreementConfig.electronicSignatureEnabled, false);
  assert.equal(agreementActivationBlocked(), true);
  assert.ok(agreementDocuments.length >= 10);
  for (const document of agreementDocuments) {
    assert.notEqual(document.status, 'approved', document.id);
    assert.equal(document.source, 'private business archive');
    assert.ok(document.version.length > 0);
    assert.ok(document.revisionDate.length > 0);
  }
});

test('agreements requiring owner/attorney completion are not treated as binding', () => {
  const legalReview = agreementDocuments.filter((document) =>
    document.status === 'draft-legal-review-required',
  );
  assert.ok(legalReview.some((document) => document.id === 'RES-006'));
  assert.ok(legalReview.some((document) => document.id === 'STR-003'));
  assert.ok(legalReview.some((document) => document.id === 'COM-009'));
});
