// Customer-facing live availability picker. The API decides whether booking is
// genuinely connected; this component never invents times. Selecting a slot
// creates a short-lived server hold, not a confirmed appointment.
import { bookingConfig } from '../config/booking.ts';

export interface BookingContext {
  durationMinutes: number;
  destination: { lat: number; lng: number };
  reference: string;
  location: string;
  preferredDate: string;
}

export interface BookingHoldFields {
  booking_hold_id: string;
  booking_slot_start: string;
  booking_slot_end: string;
  booking_hold_expires_at: string;
}

export interface BookingPickerHandle {
  activate(): Promise<void>;
  contextChanged(key: string): void;
  holdFields(): BookingHoldFields | null;
  reset(): void;
}

export function initBookingPicker(
  root: HTMLElement,
  getContext: () => BookingContext | null,
): BookingPickerHandle {
  const dateInput = root.querySelector<HTMLInputElement>('[data-booking-date]');
  const checkButton = root.querySelector<HTMLButtonElement>('[data-booking-check]');
  const slots = root.querySelector<HTMLElement>('[data-booking-slots]');
  const status = root.querySelector<HTMLElement>('[data-booking-status]');
  const holdNote = root.querySelector<HTMLElement>('[data-booking-hold]');
  let probed = false;
  let loading = false;
  let hold: BookingHoldFields | null = null;
  let contextKey = '';

  function setStatus(message: string, state: 'info' | 'error' | 'success' = 'info'): void {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function clearSelection(): void {
    hold = null;
    if (holdNote) {
      holdNote.hidden = true;
      holdNote.textContent = '';
    }
  }

  function renderSlots(list: Array<{ start: string; end: string; startLabel: string; endLabel: string }>): void {
    if (!slots) return;
    slots.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'small text-muted';
      empty.textContent = 'No online times are available for this date. Choose another date or send a reservation request.';
      slots.appendChild(empty);
      return;
    }
    for (const slot of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'booking-picker__slot';
      button.setAttribute('role', 'listitem');
      button.textContent = `${slot.startLabel} – ${slot.endLabel}`;
      button.addEventListener('click', () => void createHold(slot));
      slots.appendChild(button);
    }
  }

  async function load(): Promise<void> {
    if (loading) return;
    const context = getContext();
    if (!context) {
      root.hidden = true;
      return;
    }
    const date = dateInput?.value || context.preferredDate;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      root.hidden = false;
      setStatus('Choose a date to check available times.', 'info');
      return;
    }
    loading = true;
    if (checkButton) checkButton.disabled = true;
    setStatus('Checking the booking calendar…', 'info');
    try {
      const response = await fetch(
        `/api/availability?date=${encodeURIComponent(date)}&durationMinutes=${encodeURIComponent(
          String(context.durationMinutes),
        )}&lat=${encodeURIComponent(String(context.destination.lat))}&lng=${encodeURIComponent(
          String(context.destination.lng),
        )}`,
        { headers: { Accept: 'application/json' } },
      );
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        enabled?: boolean;
        reason?: string;
        slots?: Array<{ start: string; end: string; startLabel: string; endLabel: string }>;
        timeZoneLabel?: string;
      };
      if (!response.ok || data.ok !== true) {
        root.hidden = true;
        setStatus('Live scheduling is unavailable right now. Send a reservation request instead.', 'error');
        return;
      }
      if (data.enabled !== true) {
        root.hidden = true;
        return;
      }
      probed = true;
      root.hidden = false;
      if (dateInput) dateInput.value = date;
      renderSlots(data.slots ?? []);
      setStatus(
        (data.slots?.length ?? 0) > 0
          ? `Available times in ${data.timeZoneLabel ?? bookingConfig.timeZoneLabel}.`
          : 'No online times for this date.',
        (data.slots?.length ?? 0) > 0 ? 'info' : 'error',
      );
    } catch {
      root.hidden = true;
      setStatus('We could not reach the booking calendar. Send a reservation request instead.', 'error');
    } finally {
      loading = false;
      if (checkButton) checkButton.disabled = false;
    }
  }

  async function createHold(slot: { start: string; end: string }): Promise<void> {
    const context = getContext();
    if (!context) return;
    clearSelection();
    setStatus('Holding that time…', 'info');
    try {
      const response = await fetch('/api/booking-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          date: dateInput?.value || context.preferredDate,
          start: slot.start,
          end: slot.end,
          durationMinutes: context.durationMinutes,
          destination: context.destination,
          reference: context.reference,
          location: context.location,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        holdId?: string;
        expiresAt?: string;
      };
      if (!response.ok || data.ok !== true || !data.holdId || !data.expiresAt) {
        setStatus('That time could not be held. Please choose another time.', 'error');
        await load();
        return;
      }
      hold = {
        booking_hold_id: data.holdId,
        booking_slot_start: slot.start,
        booking_slot_end: slot.end,
        booking_hold_expires_at: data.expiresAt,
      };
      const expires = new Intl.DateTimeFormat('en-US', {
        timeZone: bookingConfig.timeZone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(data.expiresAt));
      if (holdNote) {
        holdNote.hidden = false;
        holdNote.textContent = `Temporary hold until ${expires} Central. This is not a confirmed appointment; Sparkling Standard will confirm it personally.`;
      }
      setStatus('Time held temporarily. Send your request to keep the confirmation process moving.', 'success');
    } catch {
      setStatus('That time could not be held. Please try again or send a reservation request.', 'error');
    }
  }

  checkButton?.addEventListener('click', () => void load());
  dateInput?.addEventListener('change', () => {
    clearSelection();
    void load();
  });

  return {
    activate: async () => {
      const context = getContext();
      if (context && dateInput && !dateInput.value) dateInput.value = context.preferredDate;
      if (probed) return;
      await load();
    },
    contextChanged: (key: string) => {
      if (key !== contextKey) {
        contextKey = key;
        clearSelection();
        probed = false;
        if (slots) slots.innerHTML = '';
      }
    },
    holdFields: () => hold,
    reset: () => {
      probed = false;
      clearSelection();
      if (slots) slots.innerHTML = '';
      root.hidden = true;
      if (status) status.textContent = '';
    },
  };
}
