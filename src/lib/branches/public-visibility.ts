const PUBLIC_HOSTS = new Set(['sparkling-standard.com', 'www.sparkling-standard.com']);

export function isProductionPublicHost(hostname: string): boolean {
  return PUBLIC_HOSTS.has(hostname.trim().toLowerCase());
}

export function isTampaPublicPath(pathname: string): boolean {
  return pathname === '/locations/tampa-bay' || pathname === '/locations/tampa-bay/';
}

export function tampaEnabledFromRow(row: { lifecycle_status?: unknown; status?: unknown } | null): boolean {
  return row?.lifecycle_status === 'live' && row?.status === 'active';
}

function removeMarked(html: string, attribute: string): string {
  const pattern = new RegExp(
    '<(div|section|span|p|a|li)[^>]*' + attribute + '[^>]*>[\\s\\S]*?<\\/\\1>',
    'gi',
  );
  return html.replace(pattern, '');
}

export function applyTampaVisibility(html: string, enabled: boolean): string {
  if (enabled) {
    return html.replace(/<span([^>]*)data-tampa-off([^>]*)>[\s\S]*?<\/span>/gi, '');
  }
  let output = removeMarked(html, 'data-tampa-public');
  output = output.replace(/(<span[^>]*data-tampa-off[^>]*)\shidden(?:="[^"]*")?/gi, '$1');
  return output;
}
