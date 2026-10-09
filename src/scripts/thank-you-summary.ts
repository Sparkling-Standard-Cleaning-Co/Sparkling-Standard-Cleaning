// Thank-you page: render the single-use request summary.
//
// The summary is read once from session storage (then removed) and rebuilt
// with the same pure builder the customer confirmation email uses, so the
// on-page and emailed wording can never drift apart. If nothing is stored
// (e.g. the page was opened directly), the summary card simply stays hidden.

import { takeSubmissionSummary } from '../lib/forms/submission-receipt';
import { buildRequestSummary } from '../lib/forms/request-summary';

const root = document.querySelector<HTMLElement>('[data-request-summary]');
if (root) {
  const fields = takeSubmissionSummary();
  if (fields) {
    const summary = buildRequestSummary(fields);

    const kind = root.querySelector<HTMLElement>('[data-request-summary-kind]');
    if (kind) kind.textContent = summary.title;

    const rows = root.querySelector<HTMLElement>('[data-request-summary-rows]');
    if (rows && summary.rows.length > 0) {
      for (const row of summary.rows) {
        const dt = document.createElement('dt');
        dt.textContent = row.label;
        const dd = document.createElement('dd');
        dd.textContent = row.value;
        rows.append(dt, dd);
      }
    } else if (rows) {
      rows.hidden = true;
    }

    const estimate = root.querySelector<HTMLElement>('[data-request-summary-estimate]');
    if (estimate && summary.estimate) {
      const label = estimate.querySelector<HTMLElement>('[data-request-summary-estimate-label]');
      const value = estimate.querySelector<HTMLElement>('[data-request-summary-estimate-value]');
      const note = estimate.querySelector<HTMLElement>('[data-request-summary-estimate-note]');
      if (label) label.textContent = summary.estimate.label;
      if (value) value.textContent = summary.estimate.value;
      if (note) note.textContent = summary.estimate.note;
      estimate.hidden = false;
    }

    const reference = root.querySelector<HTMLElement>('[data-request-summary-reference]');
    if (reference && summary.reference) {
      reference.textContent = `Reference: ${summary.reference}`;
      reference.hidden = false;
    }

    root.hidden = false;
  }
}
