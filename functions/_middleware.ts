import { isPreviewHost, previewApiBlocked } from '../src/lib/env/preview.ts';
import {
  applyTampaVisibility,
  isProductionPublicHost,
  isTampaPublicPath,
  tampaEnabledFromRow,
} from '../src/lib/branches/public-visibility.ts';
import type { D1Database } from '../src/lib/admin/d1.ts';

interface PagesContext {
  request: Request;
  env: { DB?: D1Database };
  next(): Promise<Response>;
}

const PREVIEW_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};

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

  if (previewApiBlocked(url.pathname)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'preview_read_only' }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...PREVIEW_HEADERS,
        },
      },
    );
  }

  const response = await context.next();
  const output = new Response(response.body, response);
  for (const [name, value] of Object.entries(PREVIEW_HEADERS)) {
    output.headers.set(name, value);
  }
  return output;
}
