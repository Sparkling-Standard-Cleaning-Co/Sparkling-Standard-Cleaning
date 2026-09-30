// Human labels for estimator enums — shared by the wizard UI, summaries and
// server-side relay validation messages.

import type { Condition, Frequency, LastProfessionalClean, PropertyType, PetSituation, ServiceType } from './types.ts';

export const SERVICE_LABELS: Record<ServiceType, string> = {
  standard: 'Standard / one-time house cleaning',
  deep: 'Deep cleaning',
  move_in_out: 'Move-in / move-out cleaning',
  str_turnover: 'Short-term rental turnover',
};

export const SERVICE_SHORT: Record<ServiceType, string> = {
  standard: 'Standard clean',
  deep: 'Deep clean',
  move_in_out: 'Move-out clean',
  str_turnover: 'Rental turnover',
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
  one_time: 'One-time',
};

export const CONDITION_LABELS: Record<Condition, string> = {
  maintained: 'Maintained — cleaned regularly',
  average: 'Average — normal lived-in buildup',
  needs_attention: 'Needs attention — overdue for a good clean',
  heavy: 'Heavy buildup — a lot of catching up to do',
  severe: 'Severe — needs an in-person review',
};

export const LAST_CLEAN_LABELS: Record<LastProfessionalClean, string> = {
  within_month: 'Within the last month',
  one_to_three_months: '1–3 months ago',
  three_to_twelve_months: '3–12 months ago',
  over_a_year: 'More than a year ago',
  never_professional: 'Never professionally cleaned',
  not_sure: 'Not sure',
};

export const PROPERTY_LABELS: Record<PropertyType, string> = {
  house: 'House',
  apartment: 'Apartment',
  condo: 'Condo',
  townhome: 'Townhome',
  other: 'Other',
};

export const PET_LABELS: Record<PetSituation, string> = {
  none: 'No pets',
  one: 'One pet',
  multiple_shedding: 'Multiple pets / heavy shedding',
};
