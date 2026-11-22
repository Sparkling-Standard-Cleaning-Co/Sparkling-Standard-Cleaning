// Accessible in-page viewer for the Terms and Privacy policies.
//
// The estimator must never lose a completed quote because a customer followed
// a policy link. Every trigger opens a native modal dialog instead of
// navigating. The full page remains available in a separate tab, and the
// acknowledgment checkbox is never changed by viewing a policy.

const cache = new Map<string, string>();

function policyLabel(trigger: HTMLElement): string {
  return trigger.dataset.legalPolicyLabel?.trim() || trigger.textContent?.trim() || 'Policy';
}

function prepareContent(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const main = parsed.querySelector('#main') ?? parsed.querySelector('main') ?? parsed.body;
  const content = main.cloneNode(true) as HTMLElement;
  content.querySelectorAll('script, style, template, .breadcrumbs').forEach((node) => node.remove());
  content.querySelectorAll('a[href]').forEach((anchor) => {
    const link = anchor as HTMLAnchorElement;
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

document.querySelectorAll<HTMLElement>('[data-terms-acceptance]').forEach(setup);
