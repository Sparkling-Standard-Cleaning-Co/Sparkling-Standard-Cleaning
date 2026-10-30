// Stripe SANDBOX (test-mode) verification for the administrative billing code.
//
// Usage:
//   1. Put a rotated TEST key in .env:        STRIPE_SECRET_KEY=sk_test_...
//   2. Optionally put the CLI webhook secret:  STRIPE_WEBHOOK_SECRET=whsec_...
//   3. npm run stripe:sandbox
//
// Safety:
//  - Refuses to run without a test-mode key (sk_test_ / rk_test_).
//  - Refuses live keys outright. No real money can move.
//  - Never prints the key or any credential.
//  - Creates only synthetic test-mode objects and deletes the test customers.
//  - Never touches the production D1 database: reconciliation is proved against
//    an in-memory SQLite database built from the committed migrations.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

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
const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || dotenv.STRIPE_WEBHOOK_SECRET || '').trim();
const base = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');

if (!key) {
  console.error('MISSING STRIPE TEST KEY');
  console.error('');
  console.error('Nothing was sent. Add a ROTATED sandbox secret key to:');
  console.error('  ' + process.cwd() + '\\.env');
  console.error('');
  console.error('  STRIPE_SECRET_KEY=sk_test_...');
  console.error('  STRIPE_WEBHOOK_SECRET=whsec_...   (optional, only for webhook replay)');
  console.error('');
  console.error('Use a key from the Stripe sandbox (test mode). Never a live key.');
  process.exit(2);
}

if (!/^(sk|rk)_test_/.test(key)) {
  console.error('REFUSED: the configured STRIPE_SECRET_KEY is not a test-mode key.');
  console.error('This script will not run against live Stripe. Nothing was sent.');
  process.exit(3);
}

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function form(values) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) params.set(name, String(value));
  }
  return params;
}

async function stripe(path, options = {}) {
  const { body, idempotencyKey, method = body ? 'POST' : 'GET' } = options;
  const headers = { Authorization: `Bearer ${key}` };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`${base}/v1/${path}`, {
    method,
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

const stamp = crypto.randomUUID().slice(0, 8);
const syntheticEmail = `sandbox+${stamp}@sparkling-standard.test`;
const stripeCustomerIds = new Set();
let customerId = '';
let setupIntentId = '';
let database = null;

try {
  console.log('Stripe SANDBOX verification (test mode only). Key: [hidden]');
  console.log(`Endpoint: ${base}`);
  console.log('');

  // 1. Customer -------------------------------------------------------------
  const customer = await stripe('customers', {
    body: form({
      email: syntheticEmail,
      name: `Sandbox Verification ${stamp}`,
      description: 'Sparkling Standard automated sandbox verification',
      'metadata[sandbox_verification]': stamp,
    }),
  });
  customerId = customer.id;
  stripeCustomerIds.add(customerId);
  record('test customer created', Boolean(customerId));

  const attached = await stripe('payment_methods/pm_card_visa/attach', {
    body: form({ customer: customerId }),
  });
  await stripe(`customers/${customerId}`, {
    body: form({ 'invoice_settings[default_payment_method]': attached.id }),
  });
  record('test card attached', Boolean(attached.id), `brand=${attached.card?.brand ?? '?'} last4=${attached.card?.last4 ?? '?'}`);

  // 2. Invoice creation, finalisation and payment ---------------------------
  await stripe('invoiceitems', {
    body: form({
      customer: customerId,
      amount: 100,
      currency: 'usd',
      description: 'Sandbox verification line item',
    }),
  });
  const invoice = await stripe('invoices', {
    body: form({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 1,
      auto_advance: 'false',
      pending_invoice_items_behavior: 'include',
      description: `Sandbox invoice ${stamp}`,
      'metadata[sandbox_verification]': stamp,
    }),
  });
  const finalized = await stripe(`invoices/${invoice.id}/finalize`, { body: form({}) });
  record('invoice finalized', finalized.status === 'open', `status=${finalized.status}`);

  // pm_card_visa is a documented Stripe TEST payment method token.
  const paidInvoice = finalized.status === 'paid'
    ? finalized
    : await stripe(`invoices/${invoice.id}/pay`, {
        body: form({ payment_method: attached.id }),
      });
  let invoicePaymentIntent = String(paidInvoice.payment_intent ?? '');
  if (!invoicePaymentIntent) {
    // Newer Stripe API versions do not return payment_intent on the invoice
    // object; locate the succeeded $1 card charge for this synthetic customer.
    const intents = await stripe(`payment_intents?customer=${encodeURIComponent(customerId)}&limit=10`);
    invoicePaymentIntent = String(
      (intents.data ?? []).find(
        (intent) =>
          Number(intent.amount) === 100 &&
          intent.status === 'succeeded' &&
          !intent.metadata?.sandbox_verification,
      )?.id ?? '',
    );
  }
  record(
    'invoice paid with the test card',
    paidInvoice.status === 'paid' && Number(paidInvoice.amount_paid) === 100,
    `status=${paidInvoice.status} amount_paid=${paidInvoice.amount_paid}`,
  );

  // 3. Refund ---------------------------------------------------------------
  if (invoicePaymentIntent) {
    const refund = await stripe('refunds', {
      body: form({ payment_intent: invoicePaymentIntent }),
      idempotencyKey: `sbx-refund-${stamp}`,
    });
    record('test refund created', Boolean(refund.id), `status=${refund.status}`);
  } else {
    record('test refund created', false, 'no payment intent returned');
  }

  // 4. Saved-card setup (SetupIntent) --------------------------------------
  const setup = await stripe('setup_intents', {
    body: form({
      customer: customerId,
      payment_method: 'pm_card_visa',
      confirm: 'true',
      usage: 'off_session',
      'payment_method_types[0]': 'card',
      'metadata[sandbox_verification]': stamp,
    }),
  });
  setupIntentId = setup.id;
  const savedPaymentMethodId = String(setup.payment_method ?? '');
  record(
    'saved card setup intent',
    setup.status === 'succeeded' && Boolean(savedPaymentMethodId),
    `status=${setup.status}`,
  );

  if (savedPaymentMethodId) {
    const method = await stripe(`payment_methods/${savedPaymentMethodId}`);
    record(
      'saved card details retrieved',
      method.card?.brand === 'visa' && method.card?.last4 === '4242',
      `${method.card?.brand ?? '?'} •••• ${method.card?.last4 ?? '?'}`,
    );

    // 5. Off-session charge + refund ---------------------------------------
    const charge = await stripe('payment_intents', {
      body: form({
        amount: 100,
        currency: 'usd',
        customer: customerId,
        payment_method: savedPaymentMethodId,
        off_session: 'true',
        confirm: 'true',
        'metadata[sandbox_verification]': stamp,
      }),
      idempotencyKey: `sbx-offs-${stamp}`,
    });
    record('off-session charge', charge.status === 'succeeded', `status=${charge.status}`);
    if (charge.status === 'succeeded') {
      await stripe('refunds', {
        body: form({ payment_intent: charge.id }),
        idempotencyKey: `sbx-offs-refund-${stamp}`,
      });
      record('off-session charge refunded', true);
    }
  }

  // 6. Our administrative billing functions against real Stripe ------------
  const { createInvoicePaymentLink, refundStripePayment, chargeInvoiceWithAuthorization } = await import(
    '../src/lib/admin/stripe-billing.ts'
  );
  const { createCustomer } = await import('../src/lib/admin/crm.ts');
  const { createInvoice, getInvoice, recordPayment } = await import('../src/lib/admin/billing.ts');
  const { applyInvoiceCheckoutPayment } = await import('../src/lib/admin/stripe-reconcile.ts');
  const { verifyStripeSignature } = await import('../src/lib/gift/stripe-signature.ts');
  const { enrollOwner } = await import('../src/lib/admin/operations.ts');

  database = buildMigratedDatabase();
  const owner = await enrollOwner(database, {
    email: `sandbox-owner+${stamp}@sparkling-standard.test`,
    name: 'Sandbox Owner',
    password: 'Sandbox!2026',
  });
  const actor = {
    id: owner.id,
    email: owner.email,
    name: owner.name,
    role: 'owner',
    branchId: null,
    csrf: '',
    permissions: ['*'],
    mfaEnabled: false,
  };
  const localCustomer = await createCustomer(database, actor, {
    firstName: 'Sandbox',
    lastName: 'Verification',
    email: syntheticEmail,
    addressLine1: '100 S Baylen St',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
  });
  const localInvoice = await createInvoice(database, actor, {
    customerId: localCustomer.id,
    dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    lines: [
      {
        kind: 'service',
        description: 'Sandbox verification invoice',
        quantity: 1,
        unitAmountCents: 100,
        totalCents: 100,
      },
    ],
  });

  const env = {
    STRIPE_SECRET_KEY: key,
    PUBLIC_SITE_URL: 'https://sparkling-standard.com',
    ADMIN_STRIPE_BILLING_ENABLED: 'true',
    ADMIN_STRIPE_REFUNDS_ENABLED: 'true',
    ADMIN_STRIPE_SAVED_CARDS_ENABLED: 'true',
    ADMIN_STRIPE_OFF_SESSION_ENABLED: 'false',
  };
  const link = await createInvoicePaymentLink(database, actor, localInvoice.id, env);
  record(
    'administrative checkout link',
    Boolean(link.url && link.sessionId),
    link.url.startsWith('https://checkout.stripe.com/') ? 'checkout.stripe.com' : 'unexpected host',
  );

  const reusedCustomer = await database
    .prepare('SELECT stripe_customer_id FROM customers WHERE id = ? LIMIT 1')
    .bind(localCustomer.id)
    .first();
  if (reusedCustomer?.stripe_customer_id) {
    stripeCustomerIds.add(String(reusedCustomer.stripe_customer_id));
    record('customer mapping stored', true);
  } else {
    record('customer mapping stored', false);
  }

  const session = await stripe(`checkout/sessions/${link.sessionId}`);
  record(
    'checkout session readable',
    session.mode === 'payment' && Number(session.amount_total) === 100,
    `mode=${session.mode} amount_total=${session.amount_total}`,
  );

  // Settle the local invoice with a real test-mode card charge so the
  // reconciliation and refund helpers receive a genuine payment intent.
  const settlement = await stripe('payment_intents', {
    body: form({
      amount: 100,
      currency: 'usd',
      customer: String(session.customer ?? customerId),
      payment_method: 'pm_card_visa',
      confirm: 'true',
      'payment_method_types[0]': 'card',
      'metadata[invoice_id]': localInvoice.id,
      'metadata[sandbox_verification]': stamp,
    }),
    idempotencyKey: `sbx-settle-${stamp}`,
  });
  record('settlement charge', settlement.status === 'succeeded', `status=${settlement.status}`);

  const sessionPayload = {
    id: link.sessionId,
    payment_intent: settlement.id,
    customer: String(session.customer ?? ''),
    amount_total: 100,
    metadata: { invoice_id: localInvoice.id },
  };
  const reconciled = await applyInvoiceCheckoutPayment(database, sessionPayload);
  const duplicate = await applyInvoiceCheckoutPayment(database, sessionPayload);
  const paidDetail = await getInvoice(database, actor, localInvoice.id);
  record(
    'webhook reconciliation into D1',
    reconciled.applied === true &&
      duplicate.duplicate === true &&
      Number((paidDetail?.invoice ?? {}).balance_cents) === 0,
    `duplicate=${duplicate.duplicate}`,
  );

  const paidPayment = await database
    .prepare("SELECT id FROM payments WHERE invoice_id = ? AND provider = 'stripe' LIMIT 1")
    .bind(localInvoice.id)
    .first();
  if (paidPayment?.id) {
    const refunded = await refundStripePayment(database, actor, String(paidPayment.id), 100, env);
    record('administrative refund', Boolean(refunded.refundId), 'test-mode refund recorded');
  } else {
    record('administrative refund', false, 'no reconciled payment found');
  }

  const cashInvoice = await createInvoice(database, actor, {
    customerId: localCustomer.id,
    dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    lines: [
      { kind: 'service', description: 'Cash recording check', quantity: 1, unitAmountCents: 500, totalCents: 500 },
    ],
  });
  await recordPayment(database, actor, {
    invoiceId: cashInvoice.id,
    provider: 'cash',
    amount: 5,
    idempotencyKey: `sbx-cash-${stamp}`,
  });
  const cashDetail = await getInvoice(database, actor, cashInvoice.id);
  record('cash payment recording', Number((cashDetail?.invoice ?? {}).balance_cents) === 0);

  // 7. Webhook signature verification --------------------------------------
  const signedSecret = webhookSecret || `whsec_sandbox_${stamp}`;
  const payload = JSON.stringify({
    id: `evt_sandbox_${stamp}`,
    type: 'checkout.session.completed',
    data: { object: { id: link.sessionId, payment_status: 'paid' } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', signedSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  const signatureHeader = `t=${timestamp},v1=${signature}`;
  const accepted = await verifyStripeSignature(payload, signatureHeader, signedSecret);
  record('webhook signature accepted', accepted.ok === true, accepted.reason ?? '');
  const tampered = await verifyStripeSignature(`${payload} `, signatureHeader, signedSecret);
  record('tampered webhook rejected', tampered.ok === false, tampered.reason ?? '');
  const wrongSecret = await verifyStripeSignature(payload, signatureHeader, `${signedSecret}x`);
  record('wrong-secret webhook rejected', wrongSecret.ok === false, wrongSecret.reason ?? '');

  // 8. Authorization gates -------------------------------------------------
  const missingAuthorization = await chargeInvoiceWithAuthorization(
    database,
    actor,
    cashInvoice.id,
    'authorization_that_does_not_exist',
    { ...env, ADMIN_STRIPE_OFF_SESSION_ENABLED: 'true' },
  ).then(
    () => ({ rejected: false, why: 'unexpectedly charged' }),
    (error) => ({ rejected: true, why: String(error?.code ?? error?.message ?? error) }),
  );
  record('missing authorization rejected', missingAuthorization.rejected, missingAuthorization.why);

  const liveGate = await chargeInvoiceWithAuthorization(database, actor, localInvoice.id, 'x', env).then(
    () => false,
    (error) => String(error?.code) === 'off_session_disabled',
  );
  record('live administrative charging stays disabled', liveGate);
} catch (error) {
  record('sandbox run', false, error instanceof Error ? error.message : String(error));
} finally {
  if (setupIntentId) {
    await stripe(`setup_intents/${setupIntentId}/cancel`, { body: form({}), method: 'POST' }).catch(() => undefined);
  }
  for (const id of stripeCustomerIds) {
    const deleted = await stripe(`customers/${id}`, { method: 'DELETE' }).catch(() => null);
    record('synthetic test customer deleted', Boolean(deleted?.deleted), id);
  }
  const failed = results.filter((entry) => !entry.ok);
  console.log('');
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log('Failures:');
    for (const entry of failed) console.log(`  - ${entry.name}: ${entry.detail}`);
    process.exitCode = 1;
  }
}

function buildMigratedDatabase() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const files = fs
    .readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of files) {
    raw.exec(fs.readFileSync(`migrations/${name}`, 'utf8'));
  }
  return {
    prepare(query) {
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        async first() {
          return raw.prepare(query).get(...values) ?? null;
        },
        async all() {
          return { success: true, results: raw.prepare(query).all(...values) };
        },
        async run() {
          raw.prepare(query).run(...values);
          return { success: true };
        },
      };
    },
  };
}
