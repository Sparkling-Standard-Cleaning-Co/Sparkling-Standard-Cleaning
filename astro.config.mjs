import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// ─────────────────────────────────────────────────────────────────────────────
// Site configuration.
//
// The production domain is owner-confirmed (October 2026). PUBLIC_SITE_URL
// overrides it in build environments (Cloudflare Pages); the default below
// keeps canonical URLs, the sitemap and generated marketing assets correct
// without environment setup. Preview deployments must set
// PUBLIC_PREVIEW_MODE=true so nothing is indexed. See docs/DEPLOYMENT.md and
// docs/launch/OWNER-INPUT-REQUIRED.md.
// ─────────────────────────────────────────────────────────────────────────────
const site = process.env.PUBLIC_SITE_URL || 'https://sparkling-standard.com';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/404') &&
        !page.includes('/thank-you') &&
        !page.includes('/leave-review') &&
        !page.includes('/brand-preview') &&
        !page.includes('/gift-certificates/success') &&
        !page.includes('/gift-certificates/redeem'),
    }),
  ],
});
