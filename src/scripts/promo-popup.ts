/**
 * Welcome-offer popup controller (SPARKLE100) — first-party, no PII.
 *
 * Storage (strictly necessary offer-state, not analytics; contains no
 * personal data):
 *  - localStorage  `pcc-promo-state`  { state, at } — 'seen' | 'dismissed' |
 *    'claimed' | 'redeemed'. Dismissed earns a cooldown; claimed/redeemed
 *    never triggers again.
 *  - sessionStorage `pcc-promo-active-ms` — accumulated time the tab is
 *    VISIBLE (not total time open) this tab session.
 *  - sessionStorage `pcc-promo-shown-session` — shown-once guard per session.
 *
 * Suppression: form/checkout surfaces (/estimate/, /gift-certificates/,
 * /thank-you/, /contact/, /commercial/, /privacy/, /leave-review/) and while
 * the analytics consent banner is waiting for a choice.
 */
import { track } from '../lib/analytics/events';

const STATE_KEY = 'pcc-promo-state';
const ACTIVE_KEY = 'pcc-promo-active-ms';
const SHOWN_KEY = 'pcc-promo-shown-session';

const EXCLUDED_PATHS = new Set([
  '/estimate/',
  '/gift-certificates/',
  '/thank-you/',
  '/contact/',
  '/commercial/',
  '/privacy/',
  '/leave-review/',
]);

type PromoState = 'seen' | 'dismissed' | 'claimed' | 'redeemed';

interface StoredState {
  state: PromoState;
  at: string;
}

function readStoredState(): StoredState | null {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (
      parsed &&
      typeof parsed.at === 'string' &&
      (parsed.state === 'seen' ||
        parsed.state === 'dismissed' ||
        parsed.state === 'claimed' ||
        parsed.state === 'redeemed')
    ) {
      return { state: parsed.state, at: parsed.at };
    }
  } catch {
    // Storage is best-effort; a broken entry behaves like no entry.
  }
  return null;
}

function writeStoredState(state: PromoState): void {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify({ state, at: new Date().toISOString() }));
  } catch {
    // Best-effort; the offer still works within this page view.
  }
}

function readActiveMs(): number {
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeActiveMs(ms: number): void {
  try {
    window.sessionStorage.setItem(ACTIVE_KEY, String(ms));
  } catch {
    // Best-effort.
  }
}

function readShownThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

function markShownThisSession(): void {
  try {
    window.sessionStorage.setItem(SHOWN_KEY, '1');
  } catch {
    // Best-effort.
  }
}

function pathExcluded(): boolean {
  try {
    return EXCLUDED_PATHS.has(new URL(window.location.href).pathname);
  } catch {
    return false;
  }
}

function consentBannerAwaitingChoice(): boolean {
  const banner = document.querySelector<HTMLElement>('[data-consent-banner]');
  return Boolean(banner && banner.dataset.visible === 'true');
}

/**
 * Returns null when the popup is allowed to show, otherwise a short reason.
 * A 'dismissed' state whose cooldown has fully elapsed becomes eligible again
 * (a fresh reminder, at most one per session).
 */
function suppressionReason(cooldownDays: number): 'path' | 'state' | 'session' | 'consent' | null {
  if (pathExcluded()) return 'path';
  const stored = readStoredState();
  if (stored) {
    if (stored.state === 'claimed' || stored.state === 'redeemed') return 'state';
    if (stored.state === 'dismissed') {
      const shownAt = Date.parse(stored.at);
      const elapsedDays = Number.isFinite(shownAt) ? (Date.now() - shownAt) / 86_400_000 : cooldownDays;
      if (elapsedDays < cooldownDays) return 'state';
    }
  }
  if (readShownThisSession()) return 'session';
  if (consentBannerAwaitingChoice()) return 'consent';
  return null;
}

export function initPromoPopup(): void {
  const root = document.querySelector<HTMLElement>('[data-promo-popup]');
  if (!root) return; // Campaign disabled or markup absent.
  const popupRoot: HTMLElement = root;

  const dialog = popupRoot.querySelector<HTMLElement>('[data-promo-dialog]');
  if (!dialog) return;
  const dialogEl: HTMLElement = dialog;

  const activeSeconds = Number.parseInt(popupRoot.dataset.activeSeconds ?? '', 10);
  const cooldownDays = Number.parseInt(popupRoot.dataset.cooldownDays ?? '', 10);
  const triggerMs = (Number.isFinite(activeSeconds) && activeSeconds > 0 ? activeSeconds : 3) * 1000;
  const cooldown = Number.isFinite(cooldownDays) && cooldownDays >= 0 ? cooldownDays : 30;

  const promoCode = popupRoot.dataset.promoCode;
  const code = promoCode ? { code: promoCode } : {};
  let open = false;
  let previousFocus: HTMLElement | null = null;

  const focusable = (): HTMLElement[] =>
    [...dialogEl.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );

  function show(): void {
    if (open) return;
    open = true;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    markShownThisSession();
    writeStoredState('seen');
    popupRoot.hidden = false;
    window.requestAnimationFrame(() => {
      popupRoot.dataset.open = 'true';
    });
    track('promotion_displayed', code);
    const first = focusable()[0];
    if (first) first.focus();
  }

  function close(): void {
    if (!open) return;
    open = false;
    popupRoot.dataset.open = 'false';
    const finish = (): void => {
      popupRoot.hidden = true;
    };
    // Match the CSS exit transition, then fully remove from the a11y tree.
    const styles = window.getComputedStyle(popupRoot);
    const duration = Number.parseFloat(styles.transitionDuration || '0') * 1000;
    if (duration > 0) {
      window.setTimeout(finish, duration + 40);
    } else {
      finish();
    }
    if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    previousFocus = null;
  }

  function dismiss(): void {
    close();
    writeStoredState('dismissed');
    track('promotion_dismissed', code);
  }

  function claim(): void {
    // Record the claim synchronously, then let the link navigate to the
    // estimate with ?promo=… — the wizard reads the URL (and the stored
    // state) and the server re-verifies every rule itself.
    writeStoredState('claimed');
    track('promotion_claimed', code);
  }

  for (const el of popupRoot.querySelectorAll<HTMLElement>('[data-promo-dismiss]')) {
    el.addEventListener('click', dismiss);
  }
  for (const el of popupRoot.querySelectorAll<HTMLElement>('[data-promo-claim]')) {
    el.addEventListener('click', claim);
  }

  document.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === 'Tab') {
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogEl.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // Active-time accumulator: counts only while the tab is visible, persists
  // across same-tab navigation, and checks eligibility every tick so the
  // consent-banner wait resolves as soon as the choice is made.
  let elapsed = readActiveMs();
  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    elapsed += 1000;
    writeActiveMs(elapsed);
    if (elapsed >= triggerMs && !readShownThisSession() && !open) {
      if (suppressionReason(cooldown) === null) {
        show();
      }
    }
  }, 1000);
}

initPromoPopup();
