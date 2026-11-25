// Accessible in-page viewer for the Terms and Privacy policies.
//
// The estimator must never lose a completed quote because a customer followed
// a policy link. Every trigger opens a native modal dialog instead of
// navigating. The full page remains available in a separate tab, and the
// acknowledgment checkbox is never changed by viewing a policy.

import { EMAIL_ROUTING } from '../config/email-routing.ts';

const cache = new Map<string, string>();

function policyLabel(trigger: HTMLElement): string {
  return trigger.dataset.legalPolicyLabel?.trim() || trigger.textContent?.trim() || 'Policy';
}

/**
 * Cloudflare's Email Address Obfuscation rewrites plain addresses in served
 * HTML into an encoded `data-cfemail` placeholder and injects a decoder
 * script. This dialog removes scripts from the fetched policy fragment, so the
 * injected decoder never runs and the customer sees "[email protected]".
 * Decode the provider's own encoding locally and keep a working mailto link.
 */
export function decodeCloudflareEmail(encoded: string): string | null {
  const value = encoded.trim();
  if (!/^[a-f0-9]{4,}$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 2) {
    bytes.push(Number.parseInt(value.slice(index, index + 2), 16));
  }
  const key = bytes[0];
  if (key === undefined) return null;
  const decoded = bytes
    .slice(1)
    .map((byte) => byte ^ key)
    .map((code) => String.fromCharCode(code))
    .join('');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decoded) ? decoded : null;
}

export function prepareContent(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const main = parsed.querySelector('#main') ?? parsed.querySelector('main') ?? parsed.body;
  const content = main.cloneNode(true) as HTMLElement;
  content.querySelectorAll('[data-cfemail]').forEach((node) => {
    const email = decodeCloudflareEmail(node.getAttribute('data-cfemail') ?? '');
    if (!email) return;
    if (node.tagName === 'A') {
      const link = node as HTMLAnchorElement;
      link.href = `mailto:${email}`;
      link.textContent = email;
      link.target = '';
      link.rel = 'noopener noreferrer';
      return;
    }
    node.textContent = email;
  });
  content.querySelectorAll('a.__cf_email__, span.__cf_email__').forEach((node) => {
    const text = node.textContent?.trim() ?? '';
    if (text.includes('[email protected]') || /^\[email/i.test(text)) {
      const email = decodeCloudflareEmail(node.getAttribute('data-cfemail') ?? '');
      node.textContent = email ?? EMAIL_ROUTING.customerService;
    }
  });
  content.querySelectorAll('script, style, template, .breadcrumbs').forEach((node) => node.remove());
  content.querySelectorAll('a[href]').forEach((anchor) => {
    const link = anchor as HTMLAnchorElement;
    if (link.href.startsWith('mailto:')) {
      link.target = '';
      link.rel = 'noopener noreferrer';
      return;
    }
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  content.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  return content.innerHTML;
}

async function loadPolicy(path: string): Promise<string> {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`policy_http_${response.status}`);
  const html = prepareContent(await response.text());
  cache.set(path, html);
  return html;
}

function setup(group: HTMLElement): void {
  const dialog = group.querySelector<HTMLDialogElement>('[data-legal-policy-dialog]');
  if (!dialog) return;
  const title = dialog.querySelector<HTMLElement>('[data-legal-policy-title]');
  const body = dialog.querySelector<HTMLElement>('[data-legal-policy-body]');
  const fullLink = dialog.querySelector<HTMLAnchorElement>('[data-legal-policy-full]');
  const closeButtons = dialog.querySelectorAll<HTMLElement>('[data-legal-policy-close]');
  let lastTrigger: HTMLElement | null = null;
  let loadSequence = 0;

  const close = (): void => {
    if (dialog.open) dialog.close();
  };

  const open = async (trigger: HTMLElement): Promise<void> => {
    const href = trigger.getAttribute('href') ?? '';
    if (!href) return;
    lastTrigger = trigger;
    const label = policyLabel(trigger);
    if (title) title.textContent = label;
    if (fullLink) fullLink.href = href;
    if (body) {
      body.innerHTML = '<p class="legal-policy-dialog__loading" role="status">Loading the full policy…</p>';
      body.setAttribute('aria-busy', 'true');
    }
    if (!dialog.open) dialog.showModal();
    const sequence = ++loadSequence;
    try {
      const content = await loadPolicy(href);
      if (sequence !== loadSequence || !body) return;
      body.innerHTML = content;
      body.removeAttribute('aria-busy');
      body.scrollTop = 0;
      body.focus({ preventScroll: true });
    } catch {
      if (sequence !== loadSequence || !body) return;
      body.innerHTML = `<p class="legal-policy-dialog__error">The full policy could not be loaded here. <a href="${href}" target="_blank" rel="noopener noreferrer">Open it in a new tab</a> without losing your estimate.</p>`;
      body.removeAttribute('aria-busy');
    }
  };

  group.querySelectorAll<HTMLElement>('[data-legal-policy-trigger]').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      // Modified clicks keep the browser's normal new-tab behavior.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }
      event.preventDefault();
      void open(trigger);
    });
  });

  closeButtons.forEach((button) => button.addEventListener('click', close));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', () => {
    if (lastTrigger) lastTrigger.focus({ preventScroll: true });
  });
}

if (typeof document !== 'undefined') {
  document.querySelectorAll<HTMLElement>('[data-terms-acceptance]').forEach(setup);
}
