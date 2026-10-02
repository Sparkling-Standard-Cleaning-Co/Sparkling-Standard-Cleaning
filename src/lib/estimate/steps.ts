// ─────────────────────────────────────────────────────────────────────────────
// The six estimate steps — ONE shared definition.
//
// The progress navigator, the progress bar, each section heading in the
// wizard, the wizard's step labels and the estimate page's "what to expect"
// section all derive from this list. Change the journey here and every
// surface follows.
// ─────────────────────────────────────────────────────────────────────────────

export interface EstimateStepDefinition {
  /** Stable id used by tests and analytics. */
  id: 'service-address' | 'home' | 'condition' | 'extras' | 'scheduling' | 'estimate';
  /** Full title shown in the navigator and section headings. */
  title: string;
  /** One-line explanation used on the page's "what to expect" section. */
  blurb: string;
}

export const ESTIMATE_STEPS: readonly EstimateStepDefinition[] = [
  {
    id: 'service-address',
    title: 'Service & Address',
    blurb: 'Choose your cleaning and confirm your address on the map.',
  },
  {
    id: 'home',
    title: 'Your Home',
    blurb: 'Size, bedrooms and bathrooms — the facts that actually move labor time.',
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
    id: 'scheduling',
    title: 'Scheduling',
    blurb: 'Your preferred date and the arrival window that works for you.',
  },
  {
    id: 'estimate',
    title: 'Your Estimate',
    blurb: 'Your proposed price, the full scope and your reservation request.',
  },
] as const;

export const ESTIMATE_STEP_COUNT = ESTIMATE_STEPS.length;
