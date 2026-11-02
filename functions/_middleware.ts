import { isPreviewHost, previewApiBlocked } from '../src/lib/env/preview.ts';

interface PagesContext {
  request: Request;
  next(): Promise<Response>;
}

const PREVIEW_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url);
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
