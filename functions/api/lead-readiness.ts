// GET /api/lead-readiness — runtime request-delivery readiness.
//
// The static site cannot observe Cloudflare's server-side Web3Forms secret at
// build time. Customer forms probe this endpoint before showing any delivery
// warning. Only booleans are returned; no key, token or customer data is ever
// exposed.

import { buildLeadReadiness } from '../../src/lib/forms/delivery-readiness.ts';

interface Env {
  WEB3FORMS_ACCESS_KEY?: string;
  DB?: unknown;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  PHOTOS_BUCKET?: unknown;
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const readiness = buildLeadReadiness({
    owner_email: Boolean(context.env.WEB3FORMS_ACCESS_KEY?.trim()),
    database: Boolean(context.env.DB),
    customer_email: Boolean(context.env.RESEND_API_KEY?.trim()),
    turnstile: Boolean(context.env.TURNSTILE_SECRET_KEY?.trim()),
    photo_storage: Boolean(context.env.PHOTOS_BUCKET),
  });
  return new Response(JSON.stringify(readiness), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
