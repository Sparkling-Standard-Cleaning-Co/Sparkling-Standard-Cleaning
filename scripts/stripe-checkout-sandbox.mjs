// Controlled Stripe SANDBOX (test-mode) Checkout API verification.
//
// Safety:
//  - Refuses any key that is not sk_test_ / rk_test_.
//  - Creates only a synthetic test customer and an UNPAID Checkout Session.
//  - No card is entered, no charge is created, no live-mode request is made.
//  - Expires the session and deletes the synthetic customer.
//  - Never prints the key, customer email, session URL or full IDs.
//
// This does not prove the Sparkling Standard quote/hold/D1 path. It proves that
// a test-mode key can create and manage the same Checkout Session primitive used
// by the site. The full site checkout path still requires a configured preview
// environment with D1/R2 and a synthetic quote.

import fs from 'node:fs';

function loadDotEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

const dotenv = loadDotEnv('.env');
const key = (process.env.STRIPE_SECRET_KEY || dotenv.STRIPE_SECRET_KEY || '').trim();
const base = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
const cents = Math.max(50, Math.min(10_000, Number(process.env.STRIPE_SANDBOX_AMOUNT_CENTS || 100)));

if (!key) {
  console.error('MISSING STRIPE TEST KEY');
  console.error('Add a ROTATED test-mode key to .env: STRIPE_SECRET_KEY=sk_test_...');
  console.error('Nothing was sent. Never paste a live key here.');
  process.exit(2);
}
if (!/^(sk|rk)_test_/.test(key)) {
  console.error('REFUSED: STRIPE_SECRET_KEY is not a test-mode key. Nothing was sent.');
  process.exit(3);
}

const stamp = crypto.randomUUID().slice(0, 8);
const syntheticEmail = `sandbox-checkout+${stamp}@sparkling-standard.test`;
let customerId = '';
let sessionId = '';

async function stripe(path, { body, idempotencyKey, method } = {}) {
  const headers = { Authorization: `Bearer ${key}` };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`${base}/v1/${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers,
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data.error ?? {};
    throw new Error(`${path}: ${error.code ?? error.message ?? response.status}`);
  }
  return data;
}

function form(values) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) params.set(name, String(value));
  }
  return params;
}

function pass(name, detail = '') {
  console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`);
}

try {
  console.log('Stripe SANDBOX Checkout verification (test mode only). Key: [hidden]');
  console.log(`Endpoint: ${base}`);
  console.log('');

  const customer = await stripe('customers', {
    body: form({
      email: syntheticEmail,
      name: `Sandbox Checkout ${stamp}`,
      description: 'Sparkling Standard synthetic checkout verification',
      'metadata[sandbox_verification]': stamp,
    }),
  });
  customerId = customer.id;
  pass('synthetic customer created');

  const sessionBody = form({
    mode: 'payment',
    customer: customerId,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': cents,
    'line_items[0][price_data][product_data][name]': 'Sandbox checkout verification',
    'line_items[0][price_data][product_data][description]': 'Unpaid synthetic Checkout Session. No charge is created.',
    success_url: 'https://sparkling-standard.com/estimate/payment-success/?sandbox=1',
    cancel_url: 'https://sparkling-standard.com/estimate/payment-canceled/?sandbox=1',
    'metadata[sandbox_verification]': stamp,
    'metadata[checkout_kind]': 'estimate_payment',
    'payment_intent_data[metadata][sandbox_verification]': stamp,
  });
  const idempotencyKey = `ss-sandbox-checkout-${stamp}`;
  const first = await stripe('checkout/sessions', { body: sessionBody, idempotencyKey });
  sessionId = first.id;
  pass('test-mode Checkout Session created', `status=${first.status} amount=${cents}`);
  if (first.status !== 'open' || !String(first.url ?? '').startsWith('https://')) {
    throw new Error('checkout_session_not_open');
  }
  pass('hosted Checkout URL returned');

  const replay = await stripe('checkout/sessions', { body: sessionBody, idempotencyKey });
  if (replay.id !== first.id) throw new Error('idempotency_replay_created_a_second_session');
  pass('idempotent replay returned the same session');

  const retrieved = await stripe(`checkout/sessions/${encodeURIComponent(first.id)}`);
  pass('session retrieved', `status=${retrieved.status} payment_status=${retrieved.payment_status || 'unpaid'}`);
  if (retrieved.status !== 'open') throw new Error('session_not_open_on_retrieval');

  const expired = await stripe(`checkout/sessions/${encodeURIComponent(first.id)}/expire`, {
    body: form({}),
  });
  pass('session expired without payment', `status=${expired.status}`);
  sessionId = '';
} catch (error) {
  console.error(`FAIL  ${String(error.message || error)}`);
  process.exitCode = 1;
} finally {
  if (sessionId) {
    await stripe(`checkout/sessions/${encodeURIComponent(sessionId)}/expire`, { body: form({}) }).catch(() => {});
  }
  if (customerId) {
    await stripe(`customers/${encodeURIComponent(customerId)}`, { method: 'DELETE' }).catch(() => {});
    console.log('Cleanup: synthetic customer deleted.');
  }
  console.log('');
  console.log('No card was entered and no charge was created. This is test-mode evidence only.');
}
