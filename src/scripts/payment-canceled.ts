export {};
// Payment-canceled recovery page. Never treats a cancel URL as proof of
// payment; it only displays a safe reference and returns the customer to an
// allowlisted estimator route.

const REFERENCE_PATTERN = /^(SS-\d{8}-[A-Z0-9]{6}|FAC-(?:CH|CO)-[A-Z0-9]{7,32}|EST-[A-Z0-9]{7,32})$/i;
const RETURN_PATHS = new Set([
  '/estimate/residential/',
  '/estimate/str/',
  '/estimate/commercial/',
  '/estimate/church/',
]);

const params = new URLSearchParams(window.location.search);
const reference = (params.get('reference') ?? '').trim();
const returnPath = (params.get('return') ?? '').trim();
const referenceEl = document.querySelector<HTMLElement>('[data-checkout-reference]');
const returnEl = document.querySelector<HTMLAnchorElement>('[data-return-estimate]');

if (referenceEl && REFERENCE_PATTERN.test(reference)) {
  referenceEl.hidden = false;
  referenceEl.textContent = `Estimate reference: ${reference.toUpperCase()}`;
}
if (returnEl && RETURN_PATHS.has(returnPath)) {
  returnEl.href = returnPath;
}
