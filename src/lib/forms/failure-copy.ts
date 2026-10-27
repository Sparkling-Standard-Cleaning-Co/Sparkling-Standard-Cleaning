// Customer-facing failure copy for lead submissions.
//
// Pure and dependency-free so it can be unit-tested under `node --test` (the
// business config uses `import.meta.env` and cannot be imported there). Callers
// pass the confirmed contact facts from src/config/business.ts.
//
// Rules:
//  - Never claim success.
//  - Never suggest a channel that is not verified (SMS stays out until the
//    owner confirms the number can receive texts).
//  - Always offer at least one real alternative path.

export type FailureReason =
  | 'not_configured'
  | 'provider_error'
  | 'network_error'
  | 'server_error'
  | 'spam_rejected'
  | 'verification_failed'
  | 'invalid_request'
  | 'deep_clean_required'
  | 'terms_required'
  | 'terms_outdated'
  | 'acceptance_storage_failed';

export interface ContactFacts {
  /** Human-formatted phone, e.g. "(850) 426-8479". */
  phoneDisplay?: string | undefined;
  /** Public email address. */
  email?: string | undefined;
  /** True only after the owner verified SMS delivery. */
  smsEnabled?: boolean | undefined;
}

/** Builds the "please call … / email …" clause from confirmed facts only. */
export function contactAlternatives(contact: ContactFacts): string {
  const options: string[] = [];
  if (contact.phoneDisplay) options.push(`call ${contact.phoneDisplay}`);
  if (contact.smsEnabled && contact.phoneDisplay) options.push(`text ${contact.phoneDisplay}`);
  if (contact.email) options.push(`email ${contact.email}`);
  if (options.length === 0) return 'use the contact page';
  if (options.length === 1) return options[0] as string;
  return `${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}`;
}

/** Honest, channel-accurate message for every failed submission path. */
export function failureCopy(reason: FailureReason, contact: ContactFacts): string {
  const alternatives = contactAlternatives(contact);
  switch (reason) {
    case 'not_configured':
      return `Our message service is not connected yet — please ${alternatives} so we do not lose your request.`;
    case 'spam_rejected':
      return `Your request could not be verified. Please try again, or ${alternatives}.`;
    case 'verification_failed':
      return `We couldn't complete the security check before sending. Please try again — your answers are still here — or ${alternatives}.`;
    case 'invalid_request':
      return `Some of your details didn't come through. Please check the form and try again, or ${alternatives}.`;
    case 'deep_clean_required':
      return `A new recurring residential arrangement must begin with a Deep Cleaning. Please go back to the condition and frequency step and confirm the Deep Cleaning requirement, then send your request again.`;
    case 'terms_required':
      return `Please agree to the current Terms and Conditions and applicable Policies before sending your request.`;
    case 'terms_outdated':
      return `The terms changed while you were working. Please review the current Terms and Conditions and applicable Policies, then confirm your agreement again.`;
    case 'acceptance_storage_failed':
      return `We could not securely record your agreement just now, so your request was not sent. Please try again in a moment �?" your answers are still here �?" or ${alternatives}.`;
    case 'network_error':
      return `We could not reach the message service. Check your connection and try again, or ${alternatives}.`;
    case 'server_error':
      return `Something went wrong on our side. Please try again, or ${alternatives}.`;
    case 'provider_error':
    default:
      return `We could not send your request just now. Please try again, or ${alternatives}.`;
  }
}
