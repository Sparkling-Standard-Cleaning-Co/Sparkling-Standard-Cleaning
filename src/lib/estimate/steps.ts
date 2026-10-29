// ─────────────────────────────────────────────────────────────────────────────
// The five estimate steps — ONE shared definition.
//
// The progress navigator, the progress bar, each section heading in the
// wizard, the wizard's step labels and the estimate page's "what to expect"
// section all derive from this list. Change the journey here and every
// surface follows.
//
// Owner-approved sequence (2026-10-28): When & Where → Service & Home →
// Condition & Frequency → Optional Extras → Your Estimate.
// ─────────────────────────────────────────────────────────────────────────────

export interface EstimateStepDefinition {
  /** Stable id used by tests and analytics. */
  id: 'when-where' | 'service-home' | 'condition' | 'extras' | 'estimate';
  /** Full title shown in the navigator and section headings. */
  title: string;
  /** One-line explanation used on the page's "what to expect" section. */
  blurb: string;
}

export const ESTIMATE_STEPS: readonly EstimateStepDefinition[] = [
  {
    id: 'when-where',
    title: 'When & Where',
    blurb: 'Choose your preferred date and time, then tell us where to clean.',
  },
  {
    id: 'service-home',
    title: 'Service & Home',
    blurb: 'Choose your cleaning and tell us about the home.',
  },
  {
    id: 'condition',
    title: 'Condition & Frequency',
    blurb: 'How the home has been kept, and how often you would like it cleaned.',
  },
  {
    id: 'extras',
    title: 'Optional Extras',
    blurb: 'Focused extras with the price shown beside each one before you choose.',
  },
  {
    id: 'estimate',
    title: 'Your Estimate',
    blurb: 'Your proposed price, the full scope and your reservation request.',
  },
] as const;

export const ESTIMATE_STEP_COUNT = ESTIMATE_STEPS.length;
