import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// ─────────────────────────────────────────────────────────────────────────────
// Site configuration.
//
// The production domain is not final (business name + domain are PENDING).
// Set PUBLIC_SITE_URL in the production build environment once the domain is
// approved. Preview deployments must also set PUBLIC_PREVIEW_MODE=true so
// nothing is indexed. See docs/DEPLOYMENT.md and docs/launch/OWNER-INPUT-REQUIRED.md.
//
// The placeholder origin below is intentionally NOT a real domain: canonical
// URLs and the sitemap built without PUBLIC_SITE_URL are invalid by design and
// fail scripts/validate-production-env.mjs and scripts/check-pending-facts.mjs.
// ─────────────────────────────────────────────────────────────────────────────
const site = process.env.PUBLIC_SITE_URL || 'https://pending-website-url.invalid';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/404') && !page.includes('/thank-you') && !page.includes('/leave-review'),
    }),
  ],
});
