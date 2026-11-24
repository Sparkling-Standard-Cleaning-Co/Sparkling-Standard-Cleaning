import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  DEPARTMENT_KEYS,
  DEPARTMENT_LABELS,
  EVENT_DEFINITIONS,
  NOTIFICATION_EVENTS,
  REPLY_TO_KEYS,
  REPLY_TO_LABELS,
  TEMPLATE_DEFINITIONS,
  TEMPLATE_KEYS,
  communicationProviderStatus,
  defaultCommunicationSettings,
  deliveryHealth,
  listCommunicationVersions,
  previewTemplate,
  readCommunicationSettings,
  saveCommunicationSettings,
  sendTestNotification,
  validateCommunicationSettings,
  type DepartmentKey,
  type TemplateKey,
} from '../../../src/lib/admin/communications.ts';

interface Env extends AdminDbEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  RESEND_BILLING_REPLY_TO?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function metadata(): Record<string, unknown> {
  return {
    departments: DEPARTMENT_KEYS.map((key) => ({ key, label: DEPARTMENT_LABELS[key] })),
    events: NOTIFICATION_EVENTS.map((key) => ({ key, ...EVENT_DEFINITIONS[key] })),
    replyTo: REPLY_TO_KEYS.map((key) => ({ key, label: REPLY_TO_LABELS[key] })),
    templates: TEMPLATE_KEYS.map((key) => ({ key: key as TemplateKey, label: TEMPLATE_DEFINITIONS[key].label, variables: TEMPLATE_DEFINITIONS[key].variables })),
  };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    await requireActor(db, context.request, 'settings.write');
    const url = new URL(context.request.url);
    const view = url.searchParams.get('view') ?? 'all';
    if (view === 'settings') {
      const state = await readCommunicationSettings(db);
      return json({ ok: true, ...state, metadata: metadata() });
    }
    if (view === 'versions') {
      return json({ ok: true, versions: await listCommunicationVersions(db, Number(url.searchParams.get('limit') ?? 20)) });
    }
    if (view === 'health') {
      return json({ ok: true, health: await deliveryHealth(db), provider: communicationProviderStatus(context.env) });
    }
    if (view === 'defaults') {
      return json({ ok: true, settings: defaultCommunicationSettings(), metadata: metadata() });
    }
    const [state, versions, health] = await Promise.all([
      readCommunicationSettings(db),
      listCommunicationVersions(db, 20),
      deliveryHealth(db),
    ]);
    return json({
      ok: true,
      ...state,
      versions,
      health,
      provider: communicationProviderStatus(context.env),
      metadata: metadata(),
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'communications_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'settings.write');
    requireCsrf(context.request, actor);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'save') {
      const validation = validateCommunicationSettings(body.settings);
      if (!validation.ok) return json({ ok: false, error: 'invalid_settings', details: validation.errors }, 400);
      const result = await saveCommunicationSettings(db, actor, body.settings, String(body.note ?? ''));
      return json({ ok: true, ...result });
    }
    if (action === 'preview') {
      const templateKey = String(body.templateKey ?? '') as TemplateKey;
      if (!TEMPLATE_KEYS.includes(templateKey)) return json({ ok: false, error: 'template_key_invalid' }, 400);
      const validation = validateCommunicationSettings(body.settings);
      if (!validation.ok) return json({ ok: false, error: 'invalid_settings', details: validation.errors }, 400);
      return json({ ok: true, preview: previewTemplate(validation.settings, templateKey) });
    }
    if (action === 'send_test') {
      const department = String(body.department ?? '') as DepartmentKey;
      if (!DEPARTMENT_KEYS.includes(department)) return json({ ok: false, error: 'department_invalid' }, 400);
      const result = await sendTestNotification(db, actor, context.env, department);
      return json({ ok: result.status === 'sent', ...result }, result.status === 'sent' ? 200 : result.status === 'not_configured' ? 503 : 502);
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'communications_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
