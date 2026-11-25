// Customer-provided service instructions and access schedule.
//
// Approved agreement wording is never rewritten. These are factual customer
// choices and instructions that the approved documents already reference as the
// signed schedule. They are stored with the signing request and reproduced in
// the executed evidence.

export type SigningFieldType =
  | 'radio'
  | 'checkbox'
  | 'textarea'
  | 'text'
  | 'tel'
  | 'date'
  | 'time'
  | 'select';

export interface SigningFieldOption {
  value: string;
  label: string;
  description?: string;
}

export interface SigningFieldDefinition {
  key: string;
  label: string;
  type: SigningFieldType;
  required: boolean;
  options?: SigningFieldOption[];
  placeholder?: string;
  help?: string;
  maxLength?: number;
  summaryLabel: string;
}

export interface SigningFieldValues {
  [key: string]: string;
}

const RESIDENTIAL_BUNDLES = new Set([
  'customer.deep',
  'customer.residential',
  'customer.recurring',
  'customer.move_in_out',
  'customer.str',
  'customer.property_management',
  'customer.specialty_addons',
]);

const FACILITY_BUNDLES = new Set(['customer.commercial', 'customer.church']);

const accessFields = (facility: boolean): SigningFieldDefinition[] => [
  {
    key: 'access_method',
    label: facility ? 'How will Sparkling Standard access the facility?' : 'How will Sparkling Standard access the home?',
    type: 'radio',
    required: true,
    summaryLabel: 'Access method',
    options: facility
      ? [
          {
            value: 'on_site_contact',
            label: 'An on-site contact will let the team in',
            description: 'Provide the contact name below.',
          },
          {
            value: 'front_desk',
            label: 'Front desk, concierge, or building security',
            description: 'The team will check in at the front desk.',
          },
          {
            value: 'key_custody',
            label: 'A key, fob, or badge is already held under a separate authorization',
            description: 'Sparkling Standard will use only the device recorded in the approved key-custody authorization.',
          },
          {
            value: 'other',
            label: 'Another method described below',
            description: 'Describe the method and any building requirements.',
          },
        ]
      : [
          {
            value: 'customer_present',
            label: 'I will be present',
            description: 'You or another authorized adult will be at the property.',
          },
          {
            value: 'authorized_person',
            label: 'An authorized person will be present',
            description: "Provide that person's name and phone below.",
          },
          {
            value: 'lockbox',
            label: 'Customer-controlled lockbox',
            description: 'Provide the lockbox location. Change the code after service.',
          },
          {
            value: 'temporary_code',
            label: 'Temporary door or alarm code',
            description: 'Provide the temporary code through the approved secure channel before the visit. Do not enter a permanent master code here.',
          },
          {
            value: 'concierge',
            label: 'Building concierge or front desk',
            description: 'The team will check in at the front desk.',
          },
          {
            value: 'other',
            label: 'Another method described below',
            description: 'Describe the method and any building requirements.',
          },
        ],
  },
  {
    key: 'access_contact_same',
    label: 'Day-of-service contact',
    type: 'radio',
    required: false,
    summaryLabel: 'Access contact choice',
    options: [
      {
        value: 'same',
        label: 'Same as my booking contact',
        description: 'Use the verified name and phone from this booking. Nothing needs to be retyped.',
      },
      {
        value: 'different',
        label: 'Use a different day-of-service contact',
        description: 'A property manager, tenant, relative or another authorized person.',
      },
    ],
  },
  {
    key: 'access_contact_name',
    label: facility ? 'On-site contact name' : 'Day-of-service contact name',
    type: 'text',
    required: false,
    maxLength: 160,
    placeholder: 'Name of the person who can answer an access question',
    summaryLabel: 'Access contact',
  },
  {
    key: 'access_contact_phone',
    label: facility ? 'On-site contact phone' : 'Day-of-service contact phone',
    type: 'tel',
    required: false,
    maxLength: 40,
    placeholder: '(850) 555-0123',
    help: 'Used only for access or arrival questions.',
    summaryLabel: 'Access contact phone',
  },
  {
    key: 'access_instructions',
    label: 'Entry, parking, gate, building, or alarm instructions',
    type: 'textarea',
    required: false,
    maxLength: 1500,
    placeholder: 'Gate code process, parking location, alarm steps, restricted areas, or anything the team needs to know.',
    help: 'Do not enter a permanent master code, banking credential, or account password.',
    summaryLabel: 'Access and parking instructions',
  },
  {
    key: 'pets_present',
    label: 'Pets will be at the property',
    type: 'checkbox',
    required: false,
    help: 'Please secure aggressive or uncontrolled animals before the visit.',
    summaryLabel: 'Pets',
  },
  {
    key: 'pets_details',
    label: 'Pet details',
    type: 'textarea',
    required: false,
    maxLength: 600,
    placeholder: 'Type, name, where the pet will be, and anything the team should know.',
    summaryLabel: 'Pet details',
  },
  {
    key: 'restricted_areas',
    label: 'Restricted rooms, cameras, or areas',
    type: 'textarea',
    required: false,
    maxLength: 1200,
    placeholder: 'Rooms that should not be entered, cameras, fragile items, or privacy considerations.',
    summaryLabel: 'Restricted areas',
  },
  {
    key: 'special_instructions',
    label: 'Other instructions for this service',
    type: 'textarea',
    required: false,
    maxLength: 1500,
    placeholder: 'Anything else the team should know before arrival.',
    summaryLabel: 'Other instructions',
  },
];

/**
 * Returns the fields that apply to one signing request. Unknown or employee
 * packets receive no customer service fields.
 */
export function signingFieldsForRequest(input: {
  bundleCode?: string;
  subjectType?: string;
}): SigningFieldDefinition[] {
  if (input.subjectType === 'employee') return [];
  const code = String(input.bundleCode ?? '');
  if (FACILITY_BUNDLES.has(code)) return accessFields(true);
  if (RESIDENTIAL_BUNDLES.has(code)) return accessFields(false);
  return [];
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export interface SigningBookingContact {
  name: string;
  phone: string;
}

/**
 * Applies the day-of-service contact choice against the server-derived booking
 * contact. "Same as booking" never trusts a client-supplied name or phone.
 */
export function applyBookingContactChoice(
  definitions: SigningFieldDefinition[],
  values: SigningFieldValues,
  contact: SigningBookingContact,
): { values: SigningFieldValues; error: string | null } {
  if (!definitions.some((field) => field.key === 'access_contact_same')) {
    return { values, error: null };
  }
  const choice = values.access_contact_same === 'different' ? 'different' : 'same';
  const normalized: SigningFieldValues = { ...values, access_contact_same: choice };
  if (choice === 'different') {
    if (!clip(normalized.access_contact_name, 160)) {
      return { values: normalized, error: 'access_contact_name_missing' };
    }
    if (!clip(normalized.access_contact_phone, 40)) {
      return { values: normalized, error: 'access_contact_phone_missing' };
    }
    return { values: normalized, error: null };
  }
  const name = clip(contact.name, 160);
  const phone = clip(contact.phone, 40);
  if (!name) return { values: normalized, error: 'booking_contact_name_missing' };
  if (!phone) return { values: normalized, error: 'booking_contact_phone_missing' };
  return {
    values: {
      ...normalized,
      access_contact_name: name,
      access_contact_phone: phone,
    },
    error: null,
  };
}

/**
 * Validates and normalizes submitted values against the schema. Unknown keys
 * are discarded; required fields fail closed.
 */
export function normalizeSigningFieldValues(
  definitions: SigningFieldDefinition[],
  input: unknown,
): { values: SigningFieldValues; errors: string[] } {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const values: SigningFieldValues = {};
  const errors: string[] = [];
  for (const field of definitions) {
    if (field.type === 'checkbox') {
      values[field.key] = raw[field.key] === true || raw[field.key] === 'yes' ? 'yes' : '';
      continue;
    }
    const value = clip(raw[field.key], field.maxLength ?? 500);
    if (field.type === 'radio' || field.type === 'select') {
      if (value) {
        const allowed = new Set((field.options ?? []).map((option) => option.value));
        if (!allowed.has(value)) {
          errors.push(`invalid:${field.key}`);
          continue;
        }
      }
      if (field.required && !value) errors.push(`required:${field.key}`);
      values[field.key] = value;
      continue;
    }
    if (field.required && !value) errors.push(`required:${field.key}`);
    values[field.key] = value;
  }
  return { values, errors };
}

/** Customer-facing summary rows, omitting empty optional values. */
export function signingFieldSummary(
  definitions: SigningFieldDefinition[],
  values: SigningFieldValues,
): Array<{ key: string; label: string; value: string }> {
  const rows: Array<{ key: string; label: string; value: string }> = [];
  for (const field of definitions) {
    const value = String(values[field.key] ?? '').trim();
    if (!value) continue;
    if (field.type === 'checkbox') {
      rows.push({ key: field.key, label: field.summaryLabel, value: value === 'yes' ? 'Yes' : 'No' });
      continue;
    }
    if (field.type === 'radio' || field.type === 'select') {
      const option = (field.options ?? []).find((entry) => entry.value === value);
      rows.push({ key: field.key, label: field.summaryLabel, value: option?.label ?? value });
      continue;
    }
    rows.push({ key: field.key, label: field.summaryLabel, value });
  }
  return rows;
}
