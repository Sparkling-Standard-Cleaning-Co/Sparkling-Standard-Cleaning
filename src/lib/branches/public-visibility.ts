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

function removeMarkedBlock(html: string, startAttribute: string, endAttribute: string): string {
  const pattern = new RegExp(
    '<div[^>]*' + startAttribute + '[^>]*>[\\s\\S]*?<div[^>]*' + endAttribute + '[^>]*>',
    'gi',
  );
  return html.replace(pattern, '');
}

export function applyTampaVisibility(html: string, enabled: boolean): string {
  if (enabled) {
    let output = html.replace(/<span([^>]*)data-tampa-off([^>]*)>[\s\S]*?<\/span>/gi, '');
    output = removeMarkedBlock(output, 'data-service-area-single-start', 'data-service-area-single-end');
    output = output.replace(
      /<template([^>]*)data-service-area-multi-template([^>]*)>([\s\S]*?)<\/template>/i,
      '<div data-service-area-multi>$3</div>',
    );
    if (output.includes('data-service-area-multi')) {
      output = output.replace(
        /(<h1[^>]*data-service-area-heading[^>]*>)[\s\S]*?(<\/h1>)/i,
        '$1Serving Northwest Florida and Tampa Bay$2',
      );
      output = output.replace(
        /(<p[^>]*data-service-area-lead[^>]*>)[\s\S]*?(<\/p>)/i,
        '$1Based in the Pensacola-Cantonment area, Sparkling Standard serves homes and businesses across Northwest Florida and approved Tampa Bay communities, with select nearby Alabama locations available by arrangement.$2',
      );
      output = output.replace(
        /<title>[^<]*<\/title>/i,
        '<title>Service Areas | Pensacola and Tampa Bay | Sparkling Standard</title>',
      );
      output = output.replace(
        /(<meta name="description" content=")[^"]*(")/i,
        '$1Sparkling Standard serves Pensacola, Cantonment and approved Northwest Florida communities, plus approved Tampa Bay areas in Pasco, Pinellas and Hillsborough Counties.$2',
      );
    }
    return output;
  }
  let output = removeMarked(html, 'data-tampa-public');
  output = removeMarkedBlock(output, 'data-service-area-multi-start', 'data-service-area-multi-end');
  output = output.replace(/(<span[^>]*data-tampa-off[^>]*)\shidden(?:="[^"]*")?/gi, '$1');
  return output;
}
