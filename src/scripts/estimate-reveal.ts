/**
 * Shared final-estimate reveal. The calculation itself is already complete;
 * this only controls when the finished result becomes readable. It never
 * invents a percentage or delays a completed result for a long theatrical
 * sequence.
 */
export interface EstimateRevealElements {
  reveal: HTMLElement | null;
  target: HTMLElement | null;
}

let revealSequence = 0;

export function playEstimateReveal({ reveal, target }: EstimateRevealElements): Promise<void> {
  if (!reveal || !target) return Promise.resolve();
  const sequence = ++revealSequence;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduceMotion ? 120 : 850;

  reveal.hidden = false;
  target.dataset.revealing = 'true';

  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (sequence !== revealSequence) return;
      reveal.hidden = true;
      delete target.dataset.revealing;
      resolve();
    }, duration);
  });
}

export function cancelEstimateReveal(reveal: HTMLElement | null, target: HTMLElement | null): void {
  revealSequence += 1;
  if (reveal) reveal.hidden = true;
  if (target) delete target.dataset.revealing;
}
