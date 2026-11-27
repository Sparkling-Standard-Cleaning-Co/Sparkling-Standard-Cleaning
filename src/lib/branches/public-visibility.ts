import type { D1Database } from '../admin/d1.ts';

const PUBLIC_HOSTS = new Set(['sparkling-standard.com', 'www.sparkling-standard.com']);

export function isProductionPublicHost(hostname: string): boolean {
  return PUBLIC_HOSTS.has(hostname.trim().toLowerCase());
}

export function isTampaPublicPath(pathname: string): boolean {
  return pathname === '/locations/tampa-bay' || pathname === '/locations/tampa-bay/';
}

export function isCareersPublicPath(pathname: string): boolean {
  return pathname === '/careers' || pathname === '/careers/';
}

export function tampaEnabledFromRow(row: { lifecycle_status?: unknown; status?: unknown } | null): boolean {
  return row?.lifecycle_status === 'live' && row?.status === 'active';
}

/**
 * Single server-side authority for the Tampa public branch switch. A missing
 * database, missing row or query failure is treated as not public.
 */
export async function tampaPubliclyEnabled(db: D1Database | null | undefined): Promise<boolean> {
  if (!db) return false;
  try {
    const row = await db
      .prepare('SELECT lifecycle_status, status FROM branches WHERE id = ? LIMIT 1')
      .bind('branch_tampa')
      .first<{ lifecycle_status?: string; status?: string }>();
    return tampaEnabledFromRow(row ?? null);
  } catch {
    return false;
  }
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

const CAREERS_MARKED_TAGS = 'div|section|span|p|a|li|option';

function removeCareersMarked(html: string, attribute: string): string {
  const pattern = new RegExp(
    '<(' + CAREERS_MARKED_TAGS + ')\\b[^>]*\\b' + attribute + '\\b[^>]*>[\\s\\S]*?<\\/\\1>',
    'gi',
  );
  return html.replace(pattern, '');
}

function revealCareersMarked(html: string, attribute: string): string {
  const pattern = new RegExp(
    '<(' + CAREERS_MARKED_TAGS + ')\\b[^>]*\\b' + attribute + '\\b[^>]*>',
    'gi',
  );
  return html.replace(pattern, (tag) => tag.replace(/\s+hidden(?:="[^"]*")?/i, ''));
}

/**
 * Delivers the public Careers presentation for the branch state recorded in
 * D1. The static build contains both variants; production middleware removes
 * the inactive one on every request so activation and deactivation need no
 * deployment. Application eligibility is separately enforced by the API.
 */
export function applyCareersBranchVisibility(html: string, tampaEnabled: boolean): string {
  if (!tampaEnabled) return removeCareersMarked(html, 'data-careers-tampa-public');
  let output = removeCareersMarked(html, 'data-careers-pensacola-only');
  output = revealCareersMarked(output, 'data-careers-tampa-public');
  output = output.replace(
    /<title>[^<]*<\/title>/i,
    '<title>Cleaning Careers in Pensacola and Tampa Bay | Sparkling Standard</title>',
  );
  output = output.replace(
    /(<meta name="description" content=")[^"]*(")/i,
    '$1Build your future with Sparkling Standard. Apply for residential, commercial, vacation rental or lead cleaning work in Pensacola, Tampa Bay and surrounding communities.$2',
  );
  output = output.replace(
    /(<meta property="og:title" content=")[^"]*(")/i,
    '$1Cleaning Careers in Pensacola and Tampa Bay | Sparkling Standard$2',
  );
  output = output.replace(
    /(<meta property="og:description" content=")[^"]*(")/i,
    '$1Build your future with Sparkling Standard. Apply for residential, commercial, vacation rental or lead cleaning work in Pensacola, Tampa Bay and surrounding communities.$2',
  );
  return output;
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
