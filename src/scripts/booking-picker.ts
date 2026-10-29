// Customer-facing live availability picker for commercial/church facilities.
// The API decides whether booking is genuinely connected; this component never
// invents times. The owner correction (2026-10-29) replaces the long list of
// time buttons with a compact hour/minute picker. Commercial start times are
// not restricted to the residential morning/afternoon windows; any genuine
// available start returned by the scheduler may be selected.
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

interface Slot {
  start: string;
  end: string;
  startLabel: string;
  endLabel: string;
}

interface SlotTime {
  hour24: number;
  minute: number;
}

function parseSlotTime(slot: Slot): SlotTime | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(slot.startLabel.trim());
  if (!match) return null;
  const rawHour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = (match[3] ?? '').toUpperCase();
  if (!Number.isFinite(rawHour) || !Number.isFinite(minute)) return null;
  const hour24 = meridiem === 'PM' ? (rawHour % 12) + 12 : rawHour % 12;
  return { hour24, minute };
}

function hour12(hour24: number): number {
  return ((hour24 + 11) % 12) + 1;
}

export function initBookingPicker(
  root: HTMLElement,
  getContext: () => BookingContext | null,
): BookingPickerHandle {
  const dateInput = root.querySelector<HTMLInputElement>('[data-booking-date]');
  const checkButton = root.querySelector<HTMLButtonElement>('[data-booking-check]');
  const timePicker = root.querySelector<HTMLElement>('[data-booking-picker-time]');
  const hourSelect = root.querySelector<HTMLSelectElement>('[data-booking-hour]');
  const minuteSelect = root.querySelector<HTMLSelectElement>('[data-booking-minute]');
  const meridiemEl = root.querySelector<HTMLElement>('[data-booking-meridiem]');
  const selectedEl = root.querySelector<HTMLElement>('[data-booking-selected]');
  const holdButton = root.querySelector<HTMLButtonElement>('[data-booking-hold-selected]');
  const status = root.querySelector<HTMLElement>('[data-booking-status]');
  const holdNote = root.querySelector<HTMLElement>('[data-booking-hold]');
  let probed = false;
  let loading = false;
  let hold: BookingHoldFields | null = null;
  let contextKey = '';
  let slots: Slot[] = [];
  let selectedSlot: Slot | null = null;

  function setStatus(message: string, state: 'info' | 'error' | 'success' = 'info'): void {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function clearSelection(): void {
    hold = null;
    selectedSlot = null;
    if (holdNote) {
      holdNote.hidden = true;
      holdNote.textContent = '';
    }
    if (timePicker) timePicker.hidden = true;
    if (selectedEl) selectedEl.textContent = '';
  }

  function slotsForHour(hour24: number): Slot[] {
    return slots.filter((slot) => parseSlotTime(slot)?.hour24 === hour24);
  }

  function updateSelectedSlot(): void {
    if (!hourSelect || !minuteSelect) return;
    const hour = Number(hourSelect.value);
    const minute = Number(minuteSelect.value);
    selectedSlot =
      slots.find((slot) => {
        const parsed = parseSlotTime(slot);
        return parsed?.hour24 === hour && parsed.minute === minute;
      }) ?? null;
    if (meridiemEl) meridiemEl.textContent = hour >= 12 ? 'PM' : 'AM';
    if (selectedEl) {
      selectedEl.textContent = selectedSlot
        ? `Selected start: ${selectedSlot.startLabel} (${selectedSlot.endLabel} end)`
        : 'Choose an available start time.';
    }
    if (holdButton) holdButton.disabled = !selectedSlot;
  }

  function populateMinutes(hour24: number): void {
    if (!minuteSelect) return;
    const previous = Number(minuteSelect.value);
    const available = slotsForHour(hour24)
      .map((slot) => parseSlotTime(slot)?.minute ?? null)
      .filter((minute): minute is number => minute !== null);
    const unique = [...new Set(available)].sort((a, b) => a - b);
    minuteSelect.innerHTML = '';
    for (const minute of unique) {
      const option = document.createElement('option');
      option.value = String(minute);
      option.textContent = String(minute).padStart(2, '0');
      minuteSelect.appendChild(option);
    }
    if (unique.length > 0) {
      minuteSelect.value = String(unique.includes(previous) ? previous : unique[0]);
    }
    updateSelectedSlot();
  }

  function renderPicker(available: Slot[]): void {
    slots = available;
    selectedSlot = null;
    hold = null;
    if (holdNote) holdNote.hidden = true;
    if (available.length === 0) {
      if (timePicker) timePicker.hidden = true;
      if (selectedEl) selectedEl.textContent = '';
      setStatus('No online times are available for this date. Choose another date or send a reservation request.', 'error');
      return;
    }
    const timeSlots = available
      .map((slot) => ({ slot, parsed: parseSlotTime(slot) }))
      .filter((entry): entry is { slot: Slot; parsed: SlotTime } => entry.parsed !== null);
    if (timeSlots.length === 0) {
      if (timePicker) timePicker.hidden = true;
      setStatus('Available times could not be read. Send a reservation request instead.', 'error');
      return;
    }
    if (timePicker) timePicker.hidden = false;
    const hours = [...new Set(timeSlots.map((entry) => entry.parsed.hour24))].sort((a, b) => a - b);
    if (hourSelect) {
      const previous = Number(hourSelect.value);
      hourSelect.innerHTML = '';
      for (const hour of hours) {
        const option = document.createElement('option');
        option.value = String(hour);
        option.textContent = String(hour12(hour)).padStart(2, '0');
        hourSelect.appendChild(option);
      }
      hourSelect.value = String(hours.includes(previous) ? previous : hours[0]);
    }
    populateMinutes(Number(hourSelect?.value ?? hours[0]));
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
        slots?: Slot[];
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
      renderPicker(data.slots ?? []);
      if ((data.slots?.length ?? 0) > 0) {
        setStatus(`Available times in ${data.timeZoneLabel ?? bookingConfig.timeZoneLabel}.`);
      }
    } catch {
      root.hidden = true;
      setStatus('We could not reach the booking calendar. Send a reservation request instead.', 'error');
    } finally {
      loading = false;
      if (checkButton) checkButton.disabled = false;
    }
  }

  async function createHold(slot: Slot): Promise<void> {
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
        holdNote.textContent = `Temporary hold until ${expires} Central. This is not a confirmed appointment. After it expires, your submitted request remains pending owner review, but the time may be offered to another customer; Sparkling Standard will confirm the appointment or offer an alternative.`;
      }
      if (selectedEl) selectedEl.textContent = `Held start: ${slot.startLabel} (${slot.endLabel} end)`;
      setStatus('Time held temporarily. Send your request to keep the confirmation process moving.', 'success');
    } catch {
      setStatus('That time could not be held. Please try again or send a reservation request.', 'error');
    }
  }

  checkButton?.addEventListener('click', () => void load());
  holdButton?.addEventListener('click', () => {
    if (selectedSlot) void createHold(selectedSlot);
  });
  hourSelect?.addEventListener('change', () => {
    populateMinutes(Number(hourSelect.value));
  });
  minuteSelect?.addEventListener('change', updateSelectedSlot);
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
        probed = false;
        clearSelection();
        slots = [];
      }
    },
    holdFields: () => hold,
    reset: () => {
      probed = false;
      slots = [];
      clearSelection();
      if (hourSelect) hourSelect.innerHTML = '';
      if (minuteSelect) minuteSelect.innerHTML = '';
      root.hidden = true;
      if (status) status.textContent = '';
    },
  };
}
