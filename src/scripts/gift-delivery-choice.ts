// Gift delivery choice: keeps the recipient email required only when the
// purchaser asks us to email the certificate or schedule a future delivery.
// Server validation remains authoritative.

export {};

const method = document.querySelector<HTMLSelectElement>('[data-gift-delivery-method]');
const timing = document.querySelector<HTMLSelectElement>('[data-gift-delivery-timing]');
const recipientEmail = document.querySelector<HTMLInputElement>('#gift-recipient-email');
const recipientNote = document.querySelector<HTMLElement>('[data-gift-recipient-email-note]');
const dateField = document.querySelector<HTMLElement>('[data-gift-delivery-date-field]');
const dateInput = document.querySelector<HTMLInputElement>('[data-gift-delivery-date]');
const note = document.querySelector<HTMLElement>('[data-gift-delivery-note]');

function sync(): void {
  if (!method || !timing) return;
  const emailDelivery = method.value === 'recipient_email' || timing.value === 'scheduled';
  const scheduled = timing.value === 'scheduled';
  if (recipientEmail) recipientEmail.required = emailDelivery;
  if (recipientNote) {
    recipientNote.textContent = emailDelivery
      ? '(required for email or scheduled delivery)'
      : '(optional unless emailing the certificate)';
  }
  if (dateField) dateField.hidden = !scheduled;
  if (dateInput) {
    dateInput.required = scheduled;
    if (scheduled && !dateInput.min) {
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
        today.getDate(),
      ).padStart(2, '0')}`;
      dateInput.min = iso;
    }
  }
  if (note) {
    note.textContent = emailDelivery
      ? 'The purchaser receives a receipt and certificate copy; the recipient receives a branded certificate by email.'
      : 'The purchaser receives a printable certificate and can share the code or QR.';
  }
}

method?.addEventListener('change', sync);
timing?.addEventListener('change', sync);
sync();
