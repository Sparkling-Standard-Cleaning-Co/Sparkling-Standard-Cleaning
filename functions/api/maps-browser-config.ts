function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context: { request: Request; env: { PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY?: string } }): Promise<Response> {
  const key = context.env.PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY?.trim();
  if (!key) return json({ ok: false, error: 'maps_not_configured' }, 503);
  const origin = context.request.headers.get('Origin') ?? '';
  const allowed =
    origin === '' ||
    origin === 'https://sparkling-standard.com' ||
    origin === 'https://www.sparkling-standard.com' ||
    origin.endsWith('.sparkling-standard-cleaning.pages.dev') ||
    origin.startsWith('http://localhost:');
  if (!allowed) return json({ ok: false, error: 'origin_not_allowed' }, 403);
  return json({ ok: true, key, region: 'US', language: 'en' });
}
