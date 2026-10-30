// Owner-editable estimator input definitions.
//
// This file owns the option lists, labels and UI validation limits that shape
// what a customer can submit. It does NOT calculate a price. Pricing values
// live in `pricing-values.ts`; the typed pricing/policy model lives in
// `../pricing.ts`.
//
// Changing an option here changes the request and the calculator inputs. Run
// `npm run check` and `npm test` afterwards. Adding a NEW value that the
// calculation code does not understand requires engineering review.

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

export interface NumericLimit {
  min: number;
  max: number;
  step?: number;
}

// ── Residential / STR ──────────────────────────────────────────────────────

export const RESIDENTIAL_SERVICE_OPTIONS = [
  {
    value: 'standard',
    label: 'Residential Cleaning',
    description:
      'One-time or recurring cleaning for your home. New recurring customers begin with a required Deep Cleaning.',
  },
  {
    value: 'deep',
    label: 'Deep cleaning',
    description: 'Detail work — baseboards, frames, buildup and more.',
  },
  {
    value: 'move_in_out',
    label: 'Move-in / move-out',
    description: 'Empty-home cleaning built around a walkthrough.',
  },
  {
    value: 'str_turnover',
    label: 'Short-term rental turnover',
    description: 'Guest-ready resets for Airbnb / VRBO hosts.',
  },
] as const satisfies readonly SelectOption[];

export const PROPERTY_TYPE_OPTIONS = [
  { value: 'house', label: 'House' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhome', label: 'Townhome' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly SelectOption[];

export const TURNOVER_FREQUENCY_OPTIONS = [
  { value: 'per_stay', label: 'Between every stay' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'occasional', label: 'Occasional / backup cleaner' },
  { value: 'seasonal', label: 'Seasonal' },
] as const satisfies readonly SelectOption[];

export const LINEN_PREFERENCE_OPTIONS = [
  { value: 'host_provides', label: 'We provide fresh linens for each turnover' },
  { value: 'laundry_on_site', label: 'Please wash and dry the used linens on site' },
  { value: 'laundry_off_site', label: 'Please discuss off-site laundry with us' },
  { value: 'not_sure', label: 'Not sure yet — advise us' },
] as const satisfies readonly SelectOption[];

export const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'one_time', label: 'One-time' },
] as const satisfies readonly SelectOption[];

export const CONDITION_OPTIONS = [
  {
    value: 'maintained',
    label: 'Maintained',
    description: 'Cleaned regularly; generally in good shape.',
  },
  { value: 'average', label: 'Average', description: 'Normal lived-in buildup.' },
  {
    value: 'needs_attention',
    label: 'Needs attention',
    description: 'Overdue for a good clean.',
  },
  { value: 'heavy', label: 'Heavy buildup', description: 'A lot of catching up to do.' },
  {
    value: 'severe',
    label: 'Severe',
    description: 'Needs an in-person review before pricing.',
  },
] as const satisfies readonly SelectOption[];

export const LAST_CLEAN_OPTIONS = [
  { value: 'within_month', label: 'Within the last month' },
  { value: 'one_to_three_months', label: '1–3 months ago' },
  { value: 'three_to_twelve_months', label: '3–12 months ago' },
  { value: 'over_a_year', label: 'More than a year ago' },
  { value: 'never_professional', label: 'Never professionally cleaned' },
  { value: 'not_sure', label: 'Not sure' },
] as const satisfies readonly SelectOption[];

export const PET_OPTIONS = [
  { value: 'none', label: 'No pets' },
  { value: 'one', label: 'One pet' },
  { value: 'multiple_shedding', label: 'Multiple pets / heavy shedding' },
] as const satisfies readonly SelectOption[];

export const ARRIVAL_PREFERENCE_OPTIONS = [
  { value: 'first-appointment', label: 'First appointment of the day (exact time)' },
  { value: 'morning', label: 'Morning window' },
  { value: 'afternoon', label: 'Afternoon window' },
  { value: 'flexible', label: 'Flexible — any reasonable window' },
] as const satisfies readonly SelectOption[];

export const RESIDENTIAL_INPUT_LIMITS = {
  squareFeet: { min: 200, max: 20000, step: 50 },
  bedrooms: { min: 0, max: 12, step: 1 },
  fullBaths: { min: 0, max: 12, step: 1 },
  halfBaths: { min: 0, max: 12, step: 1 },
  rentalProperties: { min: 1, max: 50, step: 1 },
  beds: { min: 1, max: 30, step: 1 },
} as const satisfies Record<string, NumericLimit>;

// ── Facility engines (commercial / church) ─────────────────────────────────

export const COMMERCIAL_FACILITY_TYPES = [
  { value: 'office', label: 'Office' },
  { value: 'professional', label: 'Professional office / suite' },
  { value: 'retail', label: 'Retail' },
  { value: 'salon', label: 'Salon / barbershop' },
  { value: 'gym', label: 'Gym / fitness studio' },
  { value: 'apartment', label: 'Apartment community / common areas' },
  { value: 'property-management', label: 'Property management portfolio' },
  { value: 'small-business', label: 'Other small business facility' },
] as const satisfies readonly SelectOption[];

export const FACILITY_CONDITION_OPTIONS = [
  { value: 'maintained', label: 'Maintained — cleaned regularly' },
  { value: 'average', label: 'Average — normal use' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'heavy', label: 'Heavy buildup' },
] as const satisfies readonly SelectOption[];

export const FACILITY_FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'one-time', label: 'One-time / project' },
  { value: 'not-sure', label: 'Not sure yet — advise us' },
] as const satisfies readonly SelectOption[];

export const FLOORING_OPTIONS = [
  { value: 'mixed', label: 'Mixed carpet and hard floors' },
  { value: 'carpet', label: 'Mostly carpet' },
  { value: 'hard', label: 'Mostly hard floors' },
] as const satisfies readonly SelectOption[];

export const FIRST_CLEAN_OPTIONS = [
  { value: 'no', label: 'No — routine maintenance clean' },
  { value: 'yes', label: 'Yes — first clean / overdue detail reset' },
] as const satisfies readonly SelectOption[];

export const COMMERCIAL_BREAKROOM_OPTIONS = [
  { value: 'none', label: 'No kitchen or breakroom' },
  { value: 'breakroom', label: 'Small breakroom' },
  { value: 'kitchen', label: 'Full kitchen' },
] as const satisfies readonly SelectOption[];

export const CHURCH_BREAKROOM_OPTIONS = [
  { value: 'none', label: 'No kitchen or fellowship hall' },
  { value: 'breakroom', label: 'Fellowship hall / small kitchen' },
  { value: 'kitchen', label: 'Full kitchen' },
] as const satisfies readonly SelectOption[];

export const TRAFFIC_OPTIONS = [
  { value: 'average', label: 'Ordinary' },
  { value: 'low', label: 'Light' },
  { value: 'high', label: 'High / customer-facing' },
] as const satisfies readonly SelectOption[];

export const SPECIALTY_OPTIONS = [
  { value: 'post_construction', label: 'Post-construction cleanup' },
  { value: 'floor_resurfacing', label: 'Floor stripping / resurfacing' },
  { value: 'industrial_kitchen', label: 'Commercial kitchen deep clean' },
  { value: 'high_rise', label: 'Multi-floor / elevator building' },
  { value: 'other', label: 'Other — describe in notes' },
] as const satisfies readonly SelectOption[];

export const SERVICE_WINDOW_OPTIONS = [
  { value: 'early-morning', label: 'Early morning (from 7:00 a.m.)' },
  { value: 'daytime', label: 'Daytime' },
  { value: 'evening', label: 'Evening (until 7:00 p.m.)' },
  { value: 'after-hours', label: 'After hours (discuss access)' },
  { value: 'flexible', label: 'Flexible / discuss' },
] as const satisfies readonly SelectOption[];

export const CHURCH_PARTNERSHIP_OPTIONS = [
  {
    value: 'partnership_volunteering',
    label: 'Open to discussing community volunteering',
  },
  {
    value: 'partnership_initiatives',
    label: 'Explore future community initiatives together',
  },
  {
    value: 'partnership_congregation',
    label: 'Discuss introducing Sparkling Standard to our congregation',
  },
  {
    value: 'partnership_contact',
    label: 'Please contact us about potential partnerships',
  },
  { value: 'partnership_none', label: 'Not at this time' },
] as const;

export const FACILITY_INPUT_LIMITS = {
  sanctuarySeats: { min: 0, max: 5000, step: 1 },
  restroomFixtures: { min: 0, max: 40, step: 1 },
  classrooms: { min: 0, max: 60, step: 1 },
  workstations: { min: 0, max: 500, step: 1 },
} as const satisfies Record<string, NumericLimit>;
