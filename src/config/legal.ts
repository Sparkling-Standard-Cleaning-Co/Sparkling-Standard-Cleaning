/**
 * Transactional terms versions. Update the version ONLY when the published
 * terms or applicable policies materially change. A submitted acceptance is
 * recorded against these exact identifiers; never let the browser invent them.
 */
export const legalTerms = {
  termsVersion: '2026-10-27.terms.v1',
  policyVersion: '2026-10-27.policies.v1',
  termsPath: '/terms/',
  cancellationPath: '/terms/#cancellation-rescheduling',
  privacyPath: '/privacy/',
  acceptanceLabel:
    'I have read and agree to Sparkling Standard’s Terms and Conditions and applicable Policies.',
} as const;
