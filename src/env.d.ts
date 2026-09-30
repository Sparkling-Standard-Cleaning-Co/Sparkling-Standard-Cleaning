/// <reference types="astro/client" />

interface ImportMetaEnv {
  // Site identity
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_PREVIEW_MODE?: string;

  // Business facts (only set values approved by the owner)
  readonly PUBLIC_BUSINESS_NAME?: string;
  readonly PUBLIC_BUSINESS_LEGAL_NAME?: string;
  readonly PUBLIC_BUSINESS_PHONE?: string;
  readonly PUBLIC_BUSINESS_EMAIL?: string;

  // Forms
  readonly PUBLIC_WEB3FORMS_ACCESS_KEY?: string;

  // Analytics (public client identifiers; empty disables)
  readonly PUBLIC_UMAMI_WEBSITE_ID?: string;
  readonly PUBLIC_GTM_CONTAINER_ID?: string;

  // Spam protection (public site key only — the secret stays server-side)
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Consent API installed by src/scripts/consent-controller.ts */
  pccConsent?: {
    granted(): boolean;
    choice(): boolean | null;
    allow(): void;
    deny(): void;
  };
  /** GTM data layer (only used after analytics consent). */
  dataLayer?: unknown[];
  umami?: { track(name: string, data?: Record<string, unknown>): void };
  gtag?: (...args: unknown[]) => void;
  /** Set by the consent controller to stop GA4 collection on withdrawal. */
  [key: `ga-disable-${string}`]: boolean | undefined;
}
