/**
 * Customer agreement catalog, sourced from the owner's existing form library
 * in the private Business HQ archive (2026-10-20, version 1.0).
 *
 * CRITICAL: every agreement below is currently marked draft / legal review
 * required by the source document. `enabled` must remain false until the owner
 * supplies final approved wording and a qualified Florida attorney has reviewed
 * the agreement, disclosures and signature requirements.
 *
 * No agreement text is reproduced in this public repository. Approved templates
 * must be uploaded to private R2 through the owner-controlled workflow.
 */
export type AgreementService =
  | 'residential'
  | 'deep'
  | 'move_in_out'
  | 'recurring'
  | 'str'
  | 'commercial'
  | 'church';

export interface AgreementDocument {
  id: string;
  title: string;
  version: string;
  revisionDate: string;
  status: 'draft-legal-review-required' | 'draft-owner-review-required' | 'approved';
  services: ReadonlyArray<AgreementService>;
  required: boolean;
  countersignatureRequired: boolean;
  /** Conditional forms are selected by the intake answers. */
  condition?: 'access_authorization' | 'customer_products';
  /** Key fields collected in the signing workflow, never invented content. */
  fields: ReadonlyArray<string>;
  initialsRequired: boolean;
  source: 'private business archive';
}

export const agreementConfig = {
  /** Do not flip until final approved templates and legal review exist. */
  enabled: false,

  /** Version of the catalog itself, separate from each document version. */
  catalogVersion: '2026-10-28.agreements.catalog.v1',

  /** Every current document remains draft. */
  legalReviewStatus: 'draft' as 'draft' | 'attorney_reviewed',

  /** Electronic signatures are not legally activated yet. */
  electronicSignatureEnabled: false,

  /** Required consent language must be attorney-approved before use. */
  esignConsentVersion: '2026-10-28.esign-consent.draft.v1',

  /** Owner-controlled private storage prefix for approved templates. */
  templatePrefix: 'agreements/templates',
  signedPrefix: 'agreements/signed',
  auditPrefix: 'agreements/audit',
} as const;

const residentialDocuments: AgreementDocument[] = [
  {
    id: 'RES-002',
    title: 'Residential Customer Intake',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-owner-review-required',
    services: ['residential', 'deep', 'move_in_out', 'recurring'],
    required: true,
    countersignatureRequired: false,
    fields: ['customer_name', 'phone', 'email', 'service_address', 'property_profile', 'consent'],
    initialsRequired: false,
    source: 'private business archive',
  },
  {
    id: 'RES-006',
    title: 'Residential Service Agreement',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-legal-review-required',
    services: ['residential', 'deep', 'move_in_out', 'recurring'],
    required: true,
    countersignatureRequired: true,
    fields: ['customer_legal_name', 'service_address', 'scope', 'frequency', 'start_date'],
    initialsRequired: true,
    source: 'private business archive',
  },
  {
    id: 'RES-009',
    title: 'Customer Cleaning Preferences',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-owner-review-required',
    services: ['residential', 'deep', 'move_in_out', 'recurring'],
    required: true,
    countersignatureRequired: false,
    fields: ['room_priorities', 'product_preferences', 'restricted_areas', 'pet_instructions'],
    initialsRequired: false,
    source: 'private business archive',
  },
  {
    id: 'RES-011',
    title: 'Home Access / Key Authorization',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-legal-review-required',
    services: ['residential', 'deep', 'move_in_out', 'recurring'],
    required: true,
    countersignatureRequired: true,
    condition: 'access_authorization',
    fields: ['access_method', 'access_record_id', 'parking', 'pets', 'lockup_expectation'],
    initialsRequired: true,
    source: 'private business archive',
  },
  {
    id: 'RES-012',
    title: 'Customer-Supplied Product Request',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-owner-review-required',
    services: ['residential', 'deep', 'move_in_out', 'recurring', 'str'],
    required: false,
    countersignatureRequired: true,
    condition: 'customer_products',
    fields: ['product_name', 'manufacturer', 'sds', 'label', 'requested_use'],
    initialsRequired: true,
    source: 'private business archive',
  },
];

const strDocuments: AgreementDocument[] = [
  {
    id: 'STR-001',
    title: 'STR Property Owner / Manager Intake',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-owner-review-required',
    services: ['str'],
    required: true,
    countersignatureRequired: false,
    fields: ['property', 'owner_manager', 'bedrooms', 'bathrooms', 'checkout_checkin', 'linen'],
    initialsRequired: false,
    source: 'private business archive',
  },
  {
    id: 'STR-003',
    title: 'STR Turnover Service Agreement',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-legal-review-required',
    services: ['str'],
    required: true,
    countersignatureRequired: true,
    fields: ['owner_manager_legal_name', 'property', 'term', 'linen_terms', 'fees', 'cancellation'],
    initialsRequired: true,
    source: 'private business archive',
  },
];

const commercialDocuments: AgreementDocument[] = [
  {
    id: 'COM-009',
    title: 'Commercial Service Agreement',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-legal-review-required',
    services: ['commercial', 'church'],
    required: true,
    countersignatureRequired: true,
    fields: ['client_legal_name', 'facility_address', 'scope', 'schedule', 'price', 'term'],
    initialsRequired: true,
    source: 'private business archive',
  },
  {
    id: 'COM-010',
    title: 'Commercial Cleaning Schedule and Frequency Agreement',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-owner-review-required',
    services: ['commercial', 'church'],
    required: true,
    countersignatureRequired: true,
    fields: ['service_schedule', 'frequency', 'access_window'],
    initialsRequired: true,
    source: 'private business archive',
  },
  {
    id: 'COM-012',
    title: 'Commercial Site Access and Security Authorization',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-legal-review-required',
    services: ['commercial', 'church'],
    required: true,
    countersignatureRequired: true,
    condition: 'access_authorization',
    fields: ['access_method', 'secure_access_record', 'escort', 'contacts', 'off_limits'],
    initialsRequired: true,
    source: 'private business archive',
  },
  {
    id: 'COM-014',
    title: 'Commercial Client Onboarding',
    version: '1.0',
    revisionDate: '2026-10-20',
    status: 'draft-owner-review-required',
    services: ['commercial', 'church'],
    required: true,
    countersignatureRequired: false,
    fields: ['client_contacts', 'billing', 'service_expectations'],
    initialsRequired: false,
    source: 'private business archive',
  },
];

export const agreementDocuments: ReadonlyArray<AgreementDocument> = [
  ...residentialDocuments,
  ...strDocuments,
  ...commercialDocuments,
];

export function agreementsForService(
  service: AgreementService,
  options: { accessAuthorization?: boolean; customerProducts?: boolean } = {},
): AgreementDocument[] {
  return agreementDocuments.filter((document) => {
    if (!document.services.includes(service)) return false;
    if (document.condition === 'access_authorization' && options.accessAuthorization === false) return false;
    if (document.condition === 'customer_products' && options.customerProducts !== true) return false;
    return true;
  });
}

/** No document may be presented as binding while the catalog is draft. */
export function agreementActivationBlocked(): boolean {
  return (
    !agreementConfig.enabled ||
    !agreementConfig.electronicSignatureEnabled ||
    agreementConfig.legalReviewStatus !== 'attorney_reviewed' ||
    agreementDocuments.some((document) => document.status !== 'approved')
  );
}
