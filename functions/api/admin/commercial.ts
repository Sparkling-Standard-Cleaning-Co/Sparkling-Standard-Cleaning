// Commercial accounts, proposals, agreements and contract billing API.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  addPropertyContact,
  addWalkthrough,
  createCommercialContract,
  createCommercialProposal,
  createProposalRevision,
  generateContractInvoice,
  getCommercialProposal,
  listCommercialContracts,
  listCommercialProposals,
  listPropertyContacts,
  listWalkthroughs,
  calculateProposalTotals,
  publishCommercialProposal,
  renderProposalHtml,
  sendCommercialProposal,
  syncProposalSigningStatus,
  updateCommercialProposal,
} from '../../../src/lib/commercial/service.ts';
import {
  approveCommercialSchedule,
  contractSchedulingContext,
  previewCommercialSchedule,
  setCommercialScheduleStatus,
  type CommercialScheduleEnv,
  type CommercialScheduleInput,
} from '../../../src/lib/commercial/scheduling.ts';
import { samePropertyAddress } from '../../../src/lib/address/address-key.ts';

interface Env extends AdminDbEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function scheduleInput(body: Record<string, unknown>): CommercialScheduleInput {
  return {
    contractId: text(body.contractId, 100),
    propertyId: text(body.propertyId, 100),
    frequency: text(body.frequency, 20),
    startDate: text(body.startDate, 10),
    window: text(body.window, 20),
    startTime: text(body.startTime, 10),
    durationMinutes: Math.round(Number(body.durationMinutes) || 0),
    firstDurationMinutes: Math.round(Number(body.firstDurationMinutes) || 0),
    crewSize: Math.round(Number(body.crewSize) || 0),
    scopeNotes: text(body.scopeNotes, 2000),
    accessInstructions: text(body.accessInstructions, 2000),
    requiredQualifications: text(body.requiredQualifications, 1000),
  };
}

async function branchCustomers(
  db: NonNullable<ReturnType<typeof adminDb>>,
  branchId: string | null,
): Promise<Array<Record<string, unknown>>> {
  const where = branchId ? 'WHERE c.status = \'active\' AND c.primary_branch_id = ?' : "WHERE c.status = 'active'";
  const result = await db
    .prepare(
      `SELECT c.id, c.first_name, c.last_name, c.company_name, c.primary_branch_id,
              (SELECT value FROM customer_contacts WHERE customer_id = c.id AND kind = 'email' ORDER BY is_primary DESC LIMIT 1) AS email
       FROM customers c ${where}
       ORDER BY COALESCE(NULLIF(c.company_name,''), c.last_name, c.first_name) LIMIT 500`,
    )
    .bind(...(branchId ? [branchId] : []))
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

async function branchProperties(
  db: NonNullable<ReturnType<typeof adminDb>>,
  branchId: string | null,
): Promise<Array<Record<string, unknown>>> {
  const where = branchId ? 'WHERE p.status = \'active\' AND p.branch_id = ?' : "WHERE p.status = 'active'";
  const result = await db
    .prepare(
      `SELECT p.id, p.customer_id, p.label, p.line1, p.line2, p.city, p.state, p.postal_code,
              p.access_notes, p.parking_notes, p.usage_type
       FROM properties p ${where}
       ORDER BY p.city, p.line1 LIMIT 500`,
    )
    .bind(...(branchId ? [branchId] : []))
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

async function branchFacilities(
  db: NonNullable<ReturnType<typeof adminDb>>,
  branchId: string | null,
): Promise<Array<Record<string, unknown>>> {
  const branch = branchId ? ' AND p.branch_id = ?' : '';
  const result = await db
    .prepare(
      `SELECT p.id, p.customer_id, p.label, p.line1, p.line2, p.city, p.state, p.postal_code,
              p.access_notes, p.parking_notes, p.usage_type, p.created_at,
              c.first_name, c.last_name, COALESCE(c.company_name,'') AS company_name,
              (SELECT COUNT(*) FROM commercial_proposals cp WHERE cp.property_id = p.id) AS proposal_count,
              (SELECT COUNT(*) FROM commercial_contracts cc WHERE cc.property_id = p.id) AS contract_count,
              (SELECT COUNT(*) FROM property_contacts pc WHERE pc.property_id = p.id) AS contact_count,
              (SELECT COUNT(*) FROM commercial_walkthroughs cw WHERE cw.property_id = p.id) AS walkthrough_count,
              (SELECT COUNT(*) FROM appointments a WHERE a.property_id = p.id
                 AND a.status IN ('pending','confirmed','in_progress','completed')) AS job_count
       FROM properties p JOIN customers c ON c.id = p.customer_id
       WHERE p.status = 'active' AND c.status = 'active'${branch}
         AND (
           p.usage_type = 'facility'
           OR TRIM(COALESCE(c.company_name,'')) NOT IN ('','N/A','n/a','NA','na','None','none','-')
           OR EXISTS (SELECT 1 FROM commercial_proposals cp WHERE cp.property_id = p.id)
           OR EXISTS (SELECT 1 FROM commercial_contracts cc WHERE cc.property_id = p.id)
           OR EXISTS (SELECT 1 FROM property_contacts pc WHERE pc.property_id = p.id)
           OR EXISTS (SELECT 1 FROM commercial_walkthroughs cw WHERE cw.property_id = p.id)
           OR EXISTS (SELECT 1 FROM commercial_contract_schedules cs WHERE cs.property_id = p.id)
           OR EXISTS (
             SELECT 1 FROM appointments a JOIN estimates e ON e.id = a.estimate_id
             WHERE a.property_id = p.id
               AND (e.service_code LIKE '%commercial%' OR e.service_code LIKE '%church%')
           )
         )
       ORDER BY COALESCE(NULLIF(c.company_name,''), c.last_name, c.first_name), p.city, p.line1
       LIMIT 500`,
    )
    .bind(...(branchId ? [branchId] : []))
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'booking.read');
    const url = new URL(context.request.url);
    const view = text(url.searchParams.get('view'), 30) || 'all';
    const scopeBranch = actor.role === 'owner' ? null : actor.branchId;
    if (view === 'proposal_preview') {
      const id = text(url.searchParams.get('id'), 100);
      const proposal = await getCommercialProposal(db, actor, id);
      const scope = (proposal.scope ?? {}) as never;
      const totals = calculateProposalTotals({
        scope,
        taxRateBps: Number(proposal.tax_rate_bps) || 0,
        discountCents: Number(proposal.discount_cents) || 0,
      });
      const html = renderProposalHtml({
        proposalNumber: String(proposal.proposal_number),
        title: String(proposal.title),
        customerName:
          String(proposal.company_name ?? '').trim() ||
          [proposal.first_name, proposal.last_name].filter(Boolean).join(' '),
        propertyLine: [proposal.property_label, proposal.line1, proposal.city, proposal.state, proposal.postal_code]
          .filter(Boolean)
          .join(', '),
        billingFrequency: String(proposal.billing_frequency) as never,
        paymentTerms: String(proposal.payment_terms),
        expirationDate: String(proposal.expiration_date ?? ''),
        notes: String(proposal.notes ?? ''),
        terms: String(proposal.terms ?? ''),
        scope,
        totals,
      });
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    if (view === 'proposal') {
      const id = text(url.searchParams.get('id'), 100);
      if (!id) return json({ ok: false, error: 'proposal_required' }, 400);
      const proposal = await getCommercialProposal(db, actor, id);
      const revisions = await db
        .prepare(
          'SELECT id, version, note, created_at FROM commercial_proposal_revisions WHERE proposal_id = ? ORDER BY version DESC LIMIT 50',
        )
        .bind(id)
        .all<Record<string, unknown>>();
      const signing = proposal.signing_request_id
        ? await db
            .prepare(
              `SELECT sr.id, sr.status, sr.packet_name, sr.signer_email, sr.created_at,
                      (SELECT COUNT(*) FROM document_signatures ds WHERE ds.signing_request_id = sr.id) AS signed_documents
               FROM signing_requests sr WHERE sr.id = ? LIMIT 1`,
            )
            .bind(String(proposal.signing_request_id))
            .first<Record<string, unknown>>()
        : null;
      return json({ ok: true, proposal, revisions: revisions.results ?? [], signing });
    }
    if (view === 'contract_schedule') {
      const contractId = text(url.searchParams.get('contractId'), 100);
      if (!contractId) return json({ ok: false, error: 'contract_required' }, 400);
      const context = await contractSchedulingContext(db, actor, contractId);
      return json({ ok: true, ...context });
    }
    if (view === 'property') {
      const propertyId = text(url.searchParams.get('propertyId'), 100);
      if (!propertyId) return json({ ok: false, error: 'property_required' }, 400);
      if (actor.role !== 'owner') {
        const property = await db
          .prepare('SELECT branch_id FROM properties WHERE id = ? LIMIT 1')
          .bind(propertyId)
          .first<{ branch_id: string | null }>();
        if (!property || !actor.branchId || property.branch_id !== actor.branchId) {
          return json({ ok: false, error: 'branch_scope_denied' }, 403);
        }
      }
      const [contacts, walkthroughs] = await Promise.all([
        listPropertyContacts(db, propertyId),
        listWalkthroughs(db, propertyId),
      ]);
      return json({ ok: true, contacts, walkthroughs });
    }
    const [proposals, contracts, customers, properties, facilities] = await Promise.all([
      listCommercialProposals(db, actor),
      listCommercialContracts(db, actor),
      branchCustomers(db, scopeBranch),
      branchProperties(db, scopeBranch),
      branchFacilities(db, scopeBranch),
    ]);
    return json({ ok: true, proposals, contracts, customers, properties, facilities });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'commercial_load_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    const needsFinance = action === 'generate_invoice';
    const actor = await requireActor(db, context.request, needsFinance ? 'finance.write' : 'booking.write');
    requireCsrf(context.request, actor);
    if (action === 'create_proposal') {
      const result = await createCommercialProposal(db, actor, body);
      return json({ ok: true, ...result });
    }
    if (action === 'update_proposal') {
      await updateCommercialProposal(db, actor, text(body.id, 100), body);
      return json({ ok: true });
    }
    if (action === 'publish_proposal') {
      await publishCommercialProposal(db, actor, text(body.id, 100));
      return json({ ok: true });
    }
    if (action === 'revision') {
      return json({ ok: true, ...(await createProposalRevision(db, actor, text(body.id, 100))) });
    }
    if (action === 'send_proposal') {
      const result = await sendCommercialProposal(
        db,
        actor,
        text(body.id, 100),
        context.env,
      );
      return json({ ok: true, ...result });
    }
    if (action === 'sync_signing') {
      const status = await syncProposalSigningStatus(db, text(body.id, 100));
      return json({ ok: true, status });
    }
    if (action === 'create_contract') {
      const result = await createCommercialContract(db, actor, text(body.proposalId, 100), {
        ...(text(body.startDate, 10) ? { startDate: text(body.startDate, 10) } : {}),
        ...(text(body.notes, 1000) ? { notes: text(body.notes, 1000) } : {}),
      });
      return json({ ok: true, ...result });
    }
    if (action === 'generate_invoice') {
      const invoice = await generateContractInvoice(db, actor, text(body.contractId, 100));
      await audit(db, {
        actorUserId: actor.id,
        action: 'commercial.invoice_generated',
        entityType: 'invoice',
        entityId: invoice.invoiceId,
        detail: text(body.contractId, 100),
      });
      return json({ ok: true, invoice });
    }
    if (action === 'preview_schedule') {
      const preview = await previewCommercialSchedule(
        context.env as unknown as CommercialScheduleEnv,
        db,
        actor,
        scheduleInput(body),
      );
      return json({ ok: true, preview });
    }
    if (action === 'approve_schedule') {
      const approved = await approveCommercialSchedule(
        context.env as unknown as CommercialScheduleEnv,
        db,
        actor,
        scheduleInput(body),
      );
      return json({ ok: true, ...approved });
    }
    if (action === 'schedule_status') {
      const status = text(body.status, 20);
      if (!['active', 'paused', 'cancelled'].includes(status)) {
        return json({ ok: false, error: 'schedule_status_invalid' }, 400);
      }
      const result = await setCommercialScheduleStatus(
        context.env as unknown as CommercialScheduleEnv,
        db,
        actor,
        text(body.scheduleId, 100),
        status as 'active' | 'paused' | 'cancelled',
      );
      return json({ ok: true, ...result });
    }
    if (action === 'add_contact' || action === 'add_walkthrough') {
      const propertyId = text(body.propertyId, 100);
      if (actor.role !== 'owner') {
        const property = await db
          .prepare('SELECT branch_id FROM properties WHERE id = ? LIMIT 1')
          .bind(propertyId)
          .first<{ branch_id: string | null }>();
        if (!property || !actor.branchId || property.branch_id !== actor.branchId) {
          return json({ ok: false, error: 'branch_scope_denied' }, 403);
        }
      }
    }
    if (action === 'add_contact') {
      return json({ ok: true, ...(await addPropertyContact(db, actor, body)) });
    }
    if (action === 'add_walkthrough') {
      return json({ ok: true, ...(await addWalkthrough(db, actor, body)) });
    }
    if (action === 'create_facility') {
      const customerId = text(body.customerId, 100);
      const line1 = text(body.line1, 300);
      const line2 = text(body.line2, 60);
      const city = text(body.city, 120);
      const state = (text(body.state, 2) || 'FL').toUpperCase();
      const postalCode = text(body.postalCode, 10);
      if (!customerId || !line1) return json({ ok: false, error: 'facility_address_required' }, 400);
      if (!['FL', 'AL'].includes(state)) return json({ ok: false, error: 'facility_state_invalid' }, 400);
      if (postalCode && !/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
        return json({ ok: false, error: 'facility_postal_code_invalid' }, 400);
      }
      const customer = await db
        .prepare("SELECT id, primary_branch_id FROM customers WHERE id = ? AND status = 'active' LIMIT 1")
        .bind(customerId)
        .first<{ id: string; primary_branch_id: string | null }>();
      if (!customer) return json({ ok: false, error: 'customer_not_found' }, 404);
      if (actor.role !== 'owner' && customer.primary_branch_id !== actor.branchId) {
        return json({ ok: false, error: 'branch_scope_denied' }, 403);
      }
      const existing = await db
        .prepare(
          `SELECT id, label, line1, line2, city, state, postal_code FROM properties
           WHERE customer_id = ? AND status = 'active' LIMIT 200`,
        )
        .bind(customerId)
        .all<Record<string, unknown>>();
      const match = (existing.results ?? []).find((row) =>
        samePropertyAddress(
          { line1: row.line1, line2: row.line2, postalCode: row.postal_code },
          { line1, line2, postalCode },
        ),
      );
      if (match) {
        await db
          .prepare("UPDATE properties SET usage_type = 'facility', updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), match.id)
          .run();
        return json({ ok: true, id: String(match.id), reused: true });
      }
      const id = `prop_${crypto.randomUUID()}`;
      await db
        .prepare(
          `INSERT INTO properties
           (id, customer_id, branch_id, label, line1, line2, city, state, postal_code,
            access_notes, parking_notes, usage_type, is_primary, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'facility', 0, 'active')`,
        )
        .bind(
          id,
          customerId,
          customer.primary_branch_id,
          text(body.label, 120) || 'Facility',
          line1,
          line2,
          city,
          state,
          postalCode,
          text(body.accessNotes, 1000),
          text(body.parkingNotes, 1000),
        )
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'commercial.facility_created',
        entityType: 'property',
        entityId: id,
        detail: `${customerId}:${line1.slice(0, 120)}`,
      });
      return json({ ok: true, id, reused: false });
    }
    if (action === 'set_property_usage') {
      const propertyId = text(body.propertyId, 100);
      const usage = text(body.usageType, 20);
      if (!propertyId || !['residential', 'facility'].includes(usage)) {
        return json({ ok: false, error: 'property_usage_invalid' }, 400);
      }
      const property = await db
        .prepare('SELECT branch_id FROM properties WHERE id = ? LIMIT 1')
        .bind(propertyId)
        .first<{ branch_id: string | null }>();
      if (!property) return json({ ok: false, error: 'property_not_found' }, 404);
      if (actor.role !== 'owner' && property.branch_id !== actor.branchId) {
        return json({ ok: false, error: 'branch_scope_denied' }, 403);
      }
      await db
        .prepare('UPDATE properties SET usage_type = ?, updated_at = ? WHERE id = ?')
        .bind(usage, new Date().toISOString(), propertyId)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'commercial.property_usage_changed',
        entityType: 'property',
        entityId: propertyId,
        detail: usage,
      });
      return json({ ok: true });
    }
    if (action === 'archive_proposal') {
      const id = text(body.id, 100);
      await db
        .prepare(
          "UPDATE commercial_proposals SET status = 'archived', updated_at = ? WHERE id = ? AND status IN ('draft','published','sent','declined','expired')",
        )
        .bind(new Date().toISOString(), id)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'commercial.proposal_archived',
        entityType: 'commercial_proposal',
        entityId: id,
      });
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'commercial_action_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
