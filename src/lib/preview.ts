// Preview-build detection shared by robots.txt and the page head.
//
// Two independent signals (either is enough):
//  1. PUBLIC_PREVIEW_MODE=true — the explicit build flag;
//  2. CF_PAGES_BRANCH set to anything other than the production branch
//     (Cloudflare Pages injects it for every deployment, so a branch preview
//     is noindex automatically even if the dashboard variable is missing).
//
// A local or production build (CF_PAGES_BRANCH unset or 'main') is never
// treated as a preview. PRODUCTION_BRANCH overrides the default 'main'.

export function isPreviewBuild(): boolean {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    if (env?.PUBLIC_PREVIEW_MODE === 'true') return true;
  } catch {
    // import.meta.env is unavailable outside the Astro/Vite build — fall through.
  }
  const branch = typeof process !== 'undefined' ? process.env.CF_PAGES_BRANCH?.trim() : '';
  if (!branch) return false;
  const productionBranch =
    (typeof process !== 'undefined' ? process.env.PRODUCTION_BRANCH?.trim() : '') || 'main';
  return branch !== productionBranch;
}
