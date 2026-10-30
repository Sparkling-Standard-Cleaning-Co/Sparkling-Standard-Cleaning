import type { D1Database } from './d1.ts';
import type { AdminActor } from './operations.ts';
import { AdminAuthError, audit } from './operations.ts';
import { hashToken, randomToken } from './auth.ts';
import { legalTerms } from '../../config/legal.ts';

export const PAYMENT_AUTHORIZATION_VERSION = '2026-10-30.payment-authorization.v1';
export const ESIGN_CONSENT_VERSION = '2026-10-30.esign-consent.v1';

export interface PaymentAuthorizationInput {
  customerId: string;
  propertyId?: string;
  serviceCode: string;
  amountCents: number;
  maxAmountCents: number;
  chargeAfterService: boolean;
  signerName?: string;
  signerEmail?: string;
}

export interface PaymentAuthorizationView {
  id: string;
  agreementId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  propertyId: string | null;
  propertyAddress: string;
  serviceCode: string;
  amountCents: number;
  maxAmountCents: number;
  chargeAfterService: boolean;
  status: string;
  termsVersion: string;
  content: string;
  signedAt: string | null;
  expiresAt: string | null;
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function paymentAuthorizationText(input: {
  customerName: string;
  customerEmail: string;
  propertyAddress: string;
  serviceCode: string;
  amountCents: number;
  maxAmountCents: number;
  chargeAfterService: boolean;
}): string {
  const timing = input.chargeAfterService
    ? 'The saved payment method may be charged after the cleaning is completed, only for the service described here and only up to the maximum stated below.'
    : 'The saved payment method may be charged only after a separate customer-approved invoice or payment request is issued for the service described here.';
  return `SPARKLING STANDARD — PAYMENT METHOD AUTHORIZATION
Document version: ${PAYMENT_AUTHORIZATION_VERSION}
Terms version: ${legalTerms.termsVersion}
Electronic-signature consent version: ${ESIGN_CONSENT_VERSION}

Customer: ${input.customerName}
Email: ${input.customerEmail}
Service address: ${input.propertyAddress}
Service: ${input.serviceCode}

Authorization: The customer authorizes Sparkling Standard to save a payment method with Stripe and to charge that payment method for the service described above, up to ${money(input.maxAmountCents)}. The expected service amount is ${money(input.amountCents)}.

Timing: ${timing}

A charge above the maximum, a materially different service, or a materially different property requires a new signed authorization before charging. A saved card by itself does not authorize any charge.

Cancellation and withdrawal: The Sparkling Standard Terms and Conditions apply, including the cancellation and rescheduling terms at ${legalTerms.cancellationPath} (version ${legalTerms.termsVersion}). The customer may withdraw this authorization before a charge by contacting Sparkling Standard and requesting revocation of the saved payment method.

Electronic signature: By signing below, the customer confirms that they reviewed this authorization, consent to use an electronic signature and electronic records for this transaction, and agree that typing their legal name constitutes their signature.

Signature: ______________________________
Date and time: recorded by the server in UTC
`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function customerRecord(db: D1Database, actor: AdminActor, customerId: string): Promise<Record<string, unknown>> {
  const scope = actor.role === 'owner' ? '' : actor.branchId ? ' AND primary_branch_id = ?' : ' AND 1 = 0';
  const row = await db
    .prepare(`SELECT * FROM customers WHERE id = ? ${scope} LIMIT 1`)
    .bind(customerId, ...(scope ? [actor.branchId] : []))
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'customer_not_found');
  return row;
}

export async function createPaymentAuthorization(
  db: D1Database,
  actor: AdminActor,
  input: PaymentAuthorizationInput,
): Promise<{ id: string; token: string; expiresAt: string }> {
  const customer = await customerRecord(db, actor, input.customerId);
  const amount = Math.max(0, Math.round(input.amountCents));
  const max = Math.max(amount, Math.round(input.maxAmountCents));
  if (amount <= 0 || max <= 0) throw new AdminAuthError(400, 'authorization_amount_invalid');
  let propertyAddress = '';
  if (input.propertyId) {
    const property = await db
      .prepare('SELECT * FROM properties WHERE id = ? AND customer_id = ? LIMIT 1')
      .bind(input.propertyId, input.customerId)
      .first<Record<string, unknown>>();
    if (!property) throw new AdminAuthError(404, 'property_not_found');
    propertyAddress = [property.line1, property.city, property.state, property.postal_code].filter(Boolean).join(', ');
  }
  const email = await db
    .prepare("SELECT value FROM customer_contacts WHERE customer_id = ? AND kind = 'email' ORDER BY is_primary DESC LIMIT 1")
    .bind(input.customerId)
    .first<{ value: string }>();
  const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || String(customer.company_name ?? '') || 'Customer';
  const content = paymentAuthorizationText({
    customerName,
    customerEmail: email?.value ?? '',
    propertyAddress,
    serviceCode: input.serviceCode,
    amountCents: amount,
    maxAmountCents: max,
    chargeAfterService: input.chargeAfterService,
  });
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const agreementId = `agreement_${crypto.randomUUID()}`;
  const authorizationId = `payauth_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO agreements
       (id, customer_id, property_id, template_version, status, document_id, document_title,
        service_code, signer_name, signer_email, signed_content_sha256, metadata_json, signed_content_text)
       VALUES (?, ?, ?, ?, 'sent', 'PAY-AUTH-001', 'Payment Method Authorization',
        ?, '', '', ?, ?, ?)`,
    )
    .bind(
      agreementId,
      input.customerId,
      input.propertyId ?? null,
      PAYMENT_AUTHORIZATION_VERSION,
      input.serviceCode,
      await sha256(content),
      JSON.stringify({ amountCents: amount, maxAmountCents: max, chargeAfterService: input.chargeAfterService }),
      content,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO payment_authorizations
       (id, agreement_id, customer_id, property_id, service_code, amount_cents, max_amount_cents,
        charge_after_service, terms_version, status, signing_token_hash, token_expires_at,
        created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_signature', ?, ?, ?)`,
    )
    .bind(
      authorizationId,
      agreementId,
      input.customerId,
      input.propertyId ?? null,
      input.serviceCode,
      amount,
      max,
      input.chargeAfterService ? 1 : 0,
      legalTerms.termsVersion,
      await hashToken(token),
      expiresAt,
      actor.id,
    )
    .run();
  await audit(db, { actorUserId: actor.id, action: 'payment_authorization.created', entityType: 'payment_authorization', entityId: authorizationId });
  return { id: authorizationId, token, expiresAt };
}

export async function getPaymentAuthorization(
  db: D1Database,
  token: string,
): Promise<PaymentAuthorizationView | null> {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT pa.*, a.document_title, a.signed_content_text, a.signed_content_sha256,
              c.first_name, c.last_name, c.company_name,
              p.line1, p.city, p.state, p.postal_code
       FROM payment_authorizations pa
       JOIN agreements a ON a.id = pa.agreement_id
       JOIN customers c ON c.id = pa.customer_id
       LEFT JOIN properties p ON p.id = pa.property_id
       WHERE pa.signing_token_hash = ? LIMIT 1`,
    )
    .bind(await hashToken(token))
    .first<Record<string, unknown>>();
  if (!row) return null;
  if (row.token_expires_at && Date.parse(String(row.token_expires_at)) <= Date.now()) return null;
  const email = await db
    .prepare("SELECT value FROM customer_contacts WHERE customer_id = ? AND kind = 'email' ORDER BY is_primary DESC LIMIT 1")
    .bind(row.customer_id)
    .first<{ value: string }>();
  return {
    id: String(row.id),
    agreementId: String(row.agreement_id),
    customerId: String(row.customer_id),
    customerName: [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.company_name ?? '') || 'Customer',
    customerEmail: email?.value ?? '',
    propertyId: row.property_id ? String(row.property_id) : null,
    propertyAddress: [row.line1, row.city, row.state, row.postal_code].filter(Boolean).join(', '),
    serviceCode: String(row.service_code),
    amountCents: Number(row.amount_cents),
    maxAmountCents: Number(row.max_amount_cents),
    chargeAfterService: Number(row.charge_after_service) === 1,
    status: String(row.status),
    termsVersion: String(row.terms_version),
    content: String(row.signed_content_text || ''),
    signedAt: row.signed_at ? String(row.signed_at) : null,
    expiresAt: row.token_expires_at ? String(row.token_expires_at) : null,
  };
}

export async function signPaymentAuthorization(
  db: D1Database,
  token: string,
  input: { signerName: string; consent: boolean },
  request: Request,
): Promise<{ authorizationId: string }> {
  if (!input.consent) throw new AdminAuthError(400, 'esign_consent_required');
  const signerName = input.signerName.trim().slice(0, 160);
  if (signerName.length < 2) throw new AdminAuthError(400, 'signer_name_required');
  const row = await db
    .prepare('SELECT * FROM payment_authorizations WHERE signing_token_hash = ? LIMIT 1')
    .bind(await hashToken(token))
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'authorization_not_found');
  if (row.status !== 'pending_signature') throw new AdminAuthError(409, 'authorization_not_signable');
  if (row.token_expires_at && Date.parse(String(row.token_expires_at)) <= Date.now()) {
    throw new AdminAuthError(409, 'authorization_expired');
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const ua = request.headers.get('User-Agent') ?? '';
  const agreement = await db
    .prepare('SELECT signed_content_text, signed_content_sha256 FROM agreements WHERE id = ? LIMIT 1')
    .bind(row.agreement_id)
    .first<{ signed_content_text: string; signed_content_sha256: string }>();
  if (!agreement) throw new AdminAuthError(404, 'agreement_not_found');
  const signature = { type: 'typed', value: signerName, esignVersion: ESIGN_CONSENT_VERSION };
  const signedAt = new Date().toISOString();
  await db
    .prepare(
      `UPDATE agreements SET status = 'signed', signed_at = ?, signer_name = ?, signature_json = ?,
         signed_ip_hash = ?, signed_user_agent_hash = ?, sha256 = ? WHERE id = ?`,
    )
    .bind(
      signedAt,
      signerName,
      JSON.stringify(signature),
      ip ? await hashToken(ip) : null,
      ua ? await hashToken(ua) : null,
      agreement.signed_content_sha256,
      row.agreement_id,
    )
    .run();
  await db
    .prepare(
      `UPDATE payment_authorizations SET status = 'pending_card', signed_at = ?,
         signing_token_hash = NULL, token_expires_at = NULL, updated_at = ? WHERE id = ?`,
    )
    .bind(signedAt, signedAt, row.id)
    .run();
  await db
    .prepare(
      `INSERT INTO payment_method_consents (id, customer_id, version, accepted_at, ip_hash)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(`consent_${crypto.randomUUID()}`, row.customer_id, ESIGN_CONSENT_VERSION, signedAt, ip ? await hashToken(ip) : null)
    .run();
  return { authorizationId: String(row.id) };
}

export async function listPaymentAuthorizations(
  db: D1Database,
  customerId: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      `SELECT pa.*, a.signed_at, a.sha256, a.signature_json
       FROM payment_authorizations pa JOIN agreements a ON a.id = pa.agreement_id
       WHERE pa.customer_id = ? ORDER BY pa.created_at DESC LIMIT 50`,
    )
    .bind(customerId)
    .all();
  return result.results ?? [];
}
