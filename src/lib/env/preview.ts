// Preview environments are for visual verification only. They must never use
// production APIs, storage, payments or provider credentials. The Cloudflare
// project should still have isolated preview bindings/secrets; this middleware
// is defense in depth against a shared configuration mistake.

const PRODUCTION_HOSTS = new Set(['sparkling-standard.com', 'www.sparkling-standard.com']);

export function isPreviewHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host || PRODUCTION_HOSTS.has(host)) return false;
  return host.endsWith('.pages.dev') || host.endsWith('.workers.dev');
}

export function previewApiBlocked(pathname: string): boolean {
  return pathname.startsWith('/api/');
}
