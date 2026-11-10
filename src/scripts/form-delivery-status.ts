// Runtime request-delivery status for Customer forms.
//
// The static Astro build cannot see Cloudflare's server-side provider secret,
// so build-time configuration must never declare delivery "disconnected".
// This controller asks the Pages Function for its readiness and only reveals
// a warning when the server explicitly reports no delivery path (or when the
// relay is not deployed at all and no direct fallback exists).
//
// It never blocks a submission. The submission path keeps its own honest
// failure handling; this only prevents a false preview warning in production.

import { business } from '../config/business';
import {
  directFallbackAvailable,
  resolveDeliveryStatus,
} from '../lib/forms/delivery-readiness';

const warnings = [
  ...document.querySelectorAll<HTMLElement>('[data-delivery-warning]'),
];

if (warnings.length > 0) {
  const direct = directFallbackAvailable(business.forms.web3formsAccessKey);

  const unavailableMessage = (relayMissing: boolean): string => {
    const contact = direct
      ? 'Please use the contact options on this page.'
      : 'Please call or text us using the contact options on this page.';
    if (relayMissing) {
      return `Online request delivery is not connected on this deployment. Your estimate still works. ${contact}`;
    }
    return `Online request delivery is temporarily unavailable. Your estimate still works. ${contact}`;
  };

  const apply = (status: string, relayMissing = false): void => {
    document.documentElement.dataset.deliveryStatus = status;
    for (const warning of warnings) {
      if (status === 'unavailable') {
        warning.textContent = unavailableMessage(relayMissing);
        warning.dataset.state = 'info';
        warning.hidden = false;
      } else {
        warning.textContent = '';
        delete warning.dataset.state;
        warning.hidden = true;
      }
    }
  };

  const check = async (): Promise<void> => {
    let serverReady: boolean | null = null;
    let probeFailed = false;
    let relayMissing = false;
    try {
      const response = await fetch(business.forms.readinessPath, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { ok?: boolean; ready?: boolean }
          | null;
        if (data?.ok === true && typeof data.ready === 'boolean') {
          serverReady = data.ready;
        } else {
          probeFailed = true;
        }
      } else if ([404, 405, 501].includes(response.status)) {
        // The relay is genuinely absent (for example a static preview).
        relayMissing = true;
        serverReady = false;
      } else {
        probeFailed = true;
      }
    } catch {
      probeFailed = true;
    }

    const status = resolveDeliveryStatus({ serverReady, direct, probeFailed });
    // A transient probe failure is inconclusive. Keep the warning hidden
    // rather than falsely telling a customer that delivery is disconnected.
    apply(status, relayMissing);
  };

  void check();
}
