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
  publishCommercialProposal,
  sendCommercialProposal,
  syncProposalSigningStatus,
  updateCommercialProposal,
} from '../../../src/lib/commercial/service.ts';

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
      `SELECT p.id, p.customer_id, p.label, p.line1, p.city, p.state, p.postal_code,
              p.access_notes, p.parking_notes
       FROM properties p ${where}
       ORDER BY p.city, p.line1 LIMIT 500`,
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
    if (view === 'property') {
      const propertyId = text(url.searchParams.get('propertyId'), 100);
      if (!propertyId) return json({ ok: false, error: 'property_required' }, 400);
      const [contacts, walkthroughs] = await Promise.all([
        listPropertyContacts(db, propertyId),
        listWalkthroughs(db, propertyId),
      ]);
      return json({ ok: true, contacts, walkthroughs });
    }
    const [proposals, contracts, customers, properties] = await Promise.all([
      listCommercialProposals(db, actor),
      listCommercialContracts(db, actor),
      branchCustomers(db, scopeBranch),
      branchProperties(db, scopeBranch),
    ]);
    return json({ ok: true, proposals, contracts, customers, properties });
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
    if (action === 'add_contact') {
      return json({ ok: true, ...(await addPropertyContact(db, actor, body)) });
    }
    if (action === 'add_walkthrough') {
      return json({ ok: true, ...(await addWalkthrough(db, actor, body)) });
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
