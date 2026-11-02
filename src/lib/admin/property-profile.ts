// Shared property-profile input normalization.
//
// Property facts use the same option vocabularies and numeric limits as the
// public estimator (src/config/estimators/input-definitions.ts). The profile is
// optional where a fact is unknown; entered values must still be valid.
import {
  PET_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  RESIDENTIAL_INPUT_LIMITS,
} from '../../config/estimators/input-definitions.ts';
import { AdminAuthError } from './operations.ts';

const PROPERTY_TYPES = new Set<string>(PROPERTY_TYPE_OPTIONS.map((option) => option.value));
const PET_VALUES = new Set<string>(PET_OPTIONS.map((option) => option.value));

export interface NormalizedProperty {
  label: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  accessNotes: string;
  parkingNotes: string;
  propertyType: string;
  squareFeet: number | null;
  bedrooms: number | null;
  fullBaths: number | null;
  halfBaths: number | null;
  stories: number | null;
  beds: number | null;
  pets: string;
  internalNotes: string;
  isPrimary: boolean;
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'yes';
}

function optionalInteger(
  value: unknown,
  label: string,
  bounds: { min: number; max: number },
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < bounds.min || numeric > bounds.max) {
    throw new AdminAuthError(400, `property_${label}_invalid`);
  }
  return numeric;
}

export function normalizePropertyInput(
  input: Record<string, unknown>,
  options: { requireAddress?: boolean } = {},
): NormalizedProperty {
  const line1 = text(input.line1 ?? input.addressLine1, 200);
  if (options.requireAddress !== false && !line1) {
    throw new AdminAuthError(400, 'address_required');
  }
  const propertyType = text(input.propertyType, 30).toLowerCase();
  if (propertyType && !PROPERTY_TYPES.has(propertyType)) {
    throw new AdminAuthError(400, 'property_type_invalid');
  }
  const pets = text(input.pets, 30).toLowerCase();
  if (pets && !PET_VALUES.has(pets)) {
    throw new AdminAuthError(400, 'property_pets_invalid');
  }
  const state = text(input.state, 20).toUpperCase() || 'FL';
  if (state.length !== 2 || !/^[A-Z]{2}$/.test(state)) {
    throw new AdminAuthError(400, 'property_state_invalid');
  }
  const postalCode = text(input.postalCode ?? input.postal_code, 12);
  if (postalCode && !/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    throw new AdminAuthError(400, 'property_postal_code_invalid');
  }

  return {
    label: text(input.label ?? input.propertyLabel, 80) || 'Service property',
    line1,
    line2: text(input.line2 ?? input.addressLine2, 120),
    city: text(input.city, 80),
    state,
    postalCode,
    accessNotes: text(input.accessNotes ?? input.access_notes, 1000),
    parkingNotes: text(input.parkingNotes ?? input.parking_notes, 1000),
    propertyType,
    squareFeet: optionalInteger(
      input.squareFeet ?? input.square_feet,
      'square_feet',
      { min: RESIDENTIAL_INPUT_LIMITS.squareFeet.min, max: RESIDENTIAL_INPUT_LIMITS.squareFeet.max },
    ),
    bedrooms: optionalInteger(
      input.bedrooms,
      'bedrooms',
      { min: RESIDENTIAL_INPUT_LIMITS.bedrooms.min, max: RESIDENTIAL_INPUT_LIMITS.bedrooms.max },
    ),
    fullBaths: optionalInteger(
      input.fullBaths ?? input.full_baths,
      'full_baths',
      { min: RESIDENTIAL_INPUT_LIMITS.fullBaths.min, max: RESIDENTIAL_INPUT_LIMITS.fullBaths.max },
    ),
    halfBaths: optionalInteger(
      input.halfBaths ?? input.half_baths,
      'half_baths',
      { min: RESIDENTIAL_INPUT_LIMITS.halfBaths.min, max: RESIDENTIAL_INPUT_LIMITS.halfBaths.max },
    ),
    stories: optionalInteger(input.stories ?? input.floors, 'stories', { min: 0, max: 20 }),
    beds: optionalInteger(
      input.beds,
      'beds',
      { min: 0, max: RESIDENTIAL_INPUT_LIMITS.beds.max },
    ),
    pets,
    internalNotes: text(input.internalNotes ?? input.internal_notes ?? input.propertyNotes, 4000),
    isPrimary: flag(input.isPrimary),
  };
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** True when the submitted record contains property-specific data. */
export function hasPropertyInput(input: Record<string, unknown>): boolean {
  return Boolean(
    text(input.addressLine1 ?? input.line1, 200) ||
      text(input.propertyType, 30) ||
      present(input.squareFeet) ||
      present(input.bedrooms) ||
      present(input.fullBaths) ||
      present(input.halfBaths) ||
      present(input.stories) ||
      present(input.beds) ||
      text(input.pets, 30),
  );
}
