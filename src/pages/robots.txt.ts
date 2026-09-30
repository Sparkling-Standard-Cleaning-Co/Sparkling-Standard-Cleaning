// Environment-aware robots.txt.
//  - Preview builds (PUBLIC_PREVIEW_MODE=true): Disallow all.
//  - Production: allow everything, point at the sitemap.
// Never index a PENDING brand (directive §79).

import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const preview = import.meta.env.PUBLIC_PREVIEW_MODE === 'true';

  if (preview) {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const sitemap = new URL('sitemap-index.xml', site ?? 'https://pending-website-url.invalid').href;
  const body = ['User-agent: *', 'Allow: /', '', `Sitemap: ${sitemap}`, ''].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
