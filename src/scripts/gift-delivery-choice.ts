// Gift delivery choice: delivery is immediate; valid-from only controls when
// redemption begins. Server validation remains authoritative.

export {};

const method = document.querySelector<HTMLSelectElement>('[data-gift-delivery-method]');
const recipientEmail = document.querySelector<HTMLInputElement>('#gift-recipient-email');
const recipientNote = document.querySelector<HTMLElement>('[data-gift-recipient-email-note]');
const validFrom = document.querySelector<HTMLInputElement>('[data-gift-valid-from]');
const note = document.querySelector<HTMLElement>('[data-gift-delivery-note]');

function centralToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}

function sync(): void {
  const emailDelivery = method?.value === 'recipient_email';
  if (recipientEmail) recipientEmail.required = emailDelivery;
  if (recipientNote) {
    recipientNote.textContent = emailDelivery
      ? '(required for email delivery)'
      : '(optional unless emailing the certificate)';
  }
  if (validFrom && !validFrom.min) validFrom.min = centralToday();
  if (note) {
    note.textContent = emailDelivery
      ? 'The purchaser receives a receipt and certificate copy; the recipient receives a branded certificate by email immediately after verified payment.'
      : 'The purchaser receives a printable certificate immediately after verified payment and can share the code or QR.';
  }
}

method?.addEventListener('change', sync);
sync();
