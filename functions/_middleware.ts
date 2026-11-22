import { isPreviewHost, previewApiBlocked } from '../src/lib/env/preview.ts';
import {
  E2E_SESSION_ENDPOINT,
  authorizeE2ERequest,
  e2eConfigured,
} from '../src/lib/env/preview-e2e.ts';
import {
  applyTampaVisibility,
  isProductionPublicHost,
  isTampaPublicPath,
  tampaEnabledFromRow,
} from '../src/lib/branches/public-visibility.ts';
import type { D1Database } from '../src/lib/admin/d1.ts';

interface PagesContext {
  request: Request;
  env: {
    DB?: D1Database;
    E2E_ALLOWED_HOSTS?: string;
    E2E_AUTH_TOKEN?: string;
  };
  next(): Promise<Response>;
}

const PREVIEW_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};

function previewResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...PREVIEW_HEADERS,
    },
  });
}

async function tampaPubliclyEnabled(context: PagesContext): Promise<boolean> {
  if (!context.env.DB) return false;
  try {
    const row = await context.env.DB
      .prepare('SELECT lifecycle_status, status FROM branches WHERE id = ? LIMIT 1')
      .bind('branch_tampa')
      .first<{ lifecycle_status?: string; status?: string }>();
    return tampaEnabledFromRow(row ?? null);
  } catch {
    return false;
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url);
  if (isProductionPublicHost(url.hostname)) {
    const tampaEnabled = await tampaPubliclyEnabled(context);
    if (isTampaPublicPath(url.pathname) && !tampaEnabled) {
      return new Response('<!doctype html><title>Page not available</title><h1>Page not available</h1><p>This service area is not currently published.</p>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
      });
    }
    if (url.pathname === '/service-area/' || url.pathname === '/service-area') {
      const response = await context.next();
      const html = await response.text();
      return new Response(applyTampaVisibility(html, tampaEnabled), {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), 'Cache-Control': 'no-store' },
      });
    }
  }
  if (!isPreviewHost(url.hostname)) return context.next();

  const e2eHost = e2eConfigured(context.env, url.hostname);
  const isSessionExchange = url.pathname === E2E_SESSION_ENDPOINT;

  if (isSessionExchange) {
    if (!e2eHost) return previewResponse(503, JSON.stringify({ ok: false, error: 'preview_read_only' }));
    const response = await context.next();
    const output = new Response(response.body, response);
    for (const [name, value] of Object.entries(PREVIEW_HEADERS)) {
      output.headers.set(name, value);
    }
    return output;
  }

  if (previewApiBlocked(url.pathname)) {
    const authorized = e2eHost
      ? await authorizeE2ERequest({
          hostname: url.hostname,
          pathname: url.pathname,
          method: context.request.method,
          env: context.env,
          tokenHeader: context.request.headers.get('x-e2e-token'),
          cookieHeader: context.request.headers.get('Cookie'),
          origin: context.request.headers.get('Origin'),
        })
      : null;
    if (!authorized) {
      return previewResponse(503, JSON.stringify({ ok: false, error: 'preview_read_only' }));
    }
  }

  const response = await context.next();
  const output = new Response(response.body, response);
  for (const [name, value] of Object.entries(PREVIEW_HEADERS)) {
    output.headers.set(name, value);
  }
  return output;
}
