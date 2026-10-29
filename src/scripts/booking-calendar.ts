// Owner-approved premium appointment calendar (2026-10-28).
//
// The customer chooses a preferred date and start time before the property
// details (and therefore the real job duration) are known. This controller:
//  - renders a branded month calendar with accessible date buttons;
//  - loads genuine owner-calendar availability when a service address context
//    is available, using a provisional duration;
//  - keeps the choice provisional and revalidates it at the final step with
//    the real duration and destination;
//  - creates the temporary hold only after revalidation, and offers real
//    alternatives when the choice is no longer available.
//
// It never invents a confirmed appointment and never presents a fallback
// preferred window as guaranteed availability.
import { zipReference } from '../config/geography';

export interface BookingContext {
  lat?: number;
  lng?: number;
  zip?: string;
}

export interface BookingCalendarSelection {
  date: string;
  timeLabel: string;
  start: string;
  end: string;
  live: boolean;
}

export interface BookingFinalizeInput {
  durationMinutes: number;
  destination: { lat: number; lng: number };
  reference: string;
  location: string;
}

export interface BookingAlternative {
  start: string;
  end: string;
  startLabel: string;
  endLabel: string;
}

export interface BookingFinalizeResult {
  status: 'held' | 'preferred' | 'alternatives' | 'none' | 'unavailable';
  message: string;
  alternatives: BookingAlternative[];
}

export interface BookingCalendarHandle {
  setContext(context: BookingContext): void;
  selection(): BookingCalendarSelection | null;
  /** Apply an alternative chosen in the final step. */
  selectSlot(start: string, end: string, startLabel: string): void;
  finalize(input: BookingFinalizeInput): Promise<BookingFinalizeResult>;
  reset(): void;
}

interface Slot {
  start: string;
  end: string;
  startLabel: string;
  endLabel: string;
}

const PREFERRED_STARTS = ['07:00', '07:15', '07:30', '07:45', '08:00', '08:15', '08:30'];
const PROVISIONAL_DURATION = 120;

function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days, 12));
  return date.toISOString().slice(0, 10);
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month, 1, 12)));
}

function shortDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1, 12)));
}

export function initBookingCalendar(
  root: HTMLElement,
  onChange?: (selection: BookingCalendarSelection | null) => void,
): BookingCalendarHandle | null {
  const timeZone = root.dataset.timezone || 'America/Chicago';
  const maxAdvance = Math.max(1, Number(root.dataset.maxAdvance) || 60);
  const grid = root.querySelector<HTMLElement>('[data-calendar-grid]');
  const monthEl = root.querySelector<HTMLElement>('[data-calendar-month]');
  const prevButton = root.querySelector<HTMLButtonElement>('[data-calendar-prev]');
  const nextButton = root.querySelector<HTMLButtonElement>('[data-calendar-next]');
  const timesEl = root.querySelector<HTMLElement>('[data-calendar-times]');
  const selectedLabel = root.querySelector<HTMLElement>('[data-calendar-selected-label]');
  const statusEl = root.querySelector<HTMLElement>('[data-calendar-status]');
  const timeNote = root.querySelector<HTMLElement>('[data-calendar-time-note]');
  const dateInput = root.querySelector<HTMLInputElement>('[data-calendar-date-input]');
  const timeInput = root.querySelector<HTMLInputElement>('[data-calendar-time-input]');
  const slotStartInput = root.querySelector<HTMLInputElement>('[data-calendar-slot-start]');
  const slotEndInput = root.querySelector<HTMLInputElement>('[data-calendar-slot-end]');
  if (!grid || !monthEl) return null;
  const gridEl: HTMLElement = grid;
  const monthLabelEl: HTMLElement = monthEl;

  const today = localDateKey(new Date(), timeZone);
  const latest = addDays(today, maxAdvance);
  let context: BookingContext = {};
  let viewYear = Number(today.slice(0, 4));
  let viewMonth = Number(today.slice(5, 7)) - 1;
  let selectedDate = '';
  let selectedTime: BookingCalendarSelection | null = null;
  let timesSeq = 0;

  function setStatus(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.state = kind;
  }

  function setTimesNote(message: string): void {
    if (timeNote) timeNote.textContent = message;
  }

  function setInputs(): void {
    if (dateInput) dateInput.value = selectedDate;
    if (timeInput) timeInput.value = selectedTime?.timeLabel ?? '';
    if (slotStartInput) slotStartInput.value = selectedTime?.start ?? '';
    if (slotEndInput) slotEndInput.value = selectedTime?.end ?? '';
  }

  function clearHoldInputs(): void {
    for (const input of root.querySelectorAll(
      'input[name="booking_hold_id"], input[name="booking_hold_expires_at"]',
    )) {
      input.remove();
    }
  }

  function notify(): void {
    clearHoldInputs();
    setInputs();
    onChange?.(selectedTime);
  }

  function clearTimes(message = 'Select a date to see preferred start times.'): void {
    if (timesEl) timesEl.innerHTML = '';
    setStatus(message);
  }

  function renderTimes(slots: Slot[], live: boolean): void {
    if (!timesEl) return;
    timesEl.innerHTML = '';
    if (slots.length === 0) {
      clearTimes('No online times are available for this date. Choose another date.');
      if (selectedLabel) selectedLabel.textContent = shortDateLabel(selectedDate);
      return;
    }
    for (const slot of slots) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'booking-calendar__time';
      button.dataset.start = slot.start;
      button.dataset.end = slot.end;
      button.dataset.label = slot.startLabel;
      button.setAttribute('aria-pressed', 'false');
      button.textContent = slot.startLabel;
      button.addEventListener('click', () => {
        selectedTime = {
          date: selectedDate,
          timeLabel: slot.startLabel,
          start: slot.start,
          end: slot.end,
          live,
        };
        for (const other of timesEl.querySelectorAll<HTMLElement>('.booking-calendar__time')) {
          other.setAttribute('aria-pressed', String(other === button));
          other.classList.toggle('is-selected', other === button);
        }
        if (selectedLabel) {
          selectedLabel.textContent = `${shortDateLabel(selectedDate)} at ${slot.startLabel}`;
        }
        setStatus(
          live
            ? 'Preferred time selected. We will recheck it with your final details.'
            : 'Preferred time saved. Our team confirms the exact available time.',
          'success',
        );
        notify();
      });
      timesEl.appendChild(button);
    }
    setTimesNote(
      live
        ? 'Live times from the Sparkling Standard booking calendar in Central Time.'
        : 'These are preferred start windows. Our team confirms the exact available time.',
    );
    setStatus(
      live
        ? 'Choose the start time that works best for you.'
        : 'Live times are unavailable right now. Choose a preferred start and we will confirm it.',
    );
  }

  function fallbackSlots(): Slot[] {
    return PREFERRED_STARTS.map((time) => {
      const [hour, minute] = time.split(':').map(Number);
      return {
        // A preferred window has no server-verified ISO interval. The final
        // revalidation matches it by label against a real available slot.
        start: '',
        end: '',
        startLabel: `${((hour! + 11) % 12) + 1}:${String(minute!).padStart(2, '0')} ${hour! >= 12 ? 'PM' : 'AM'}`,
        endLabel: '',
      };
    });
  }

  function coordinates(): { lat: number; lng: number } | null {
    if (Number.isFinite(context.lat) && Number.isFinite(context.lng)) {
      return { lat: context.lat as number, lng: context.lng as number };
    }
    if (context.zip) {
      const reference = zipReference[context.zip];
      if (reference) return { lat: reference.lat, lng: reference.lng };
    }
    return null;
  }

  async function refreshTimes(): Promise<void> {
    if (!selectedDate) {
      clearTimes();
      return;
    }
    if (selectedLabel) selectedLabel.textContent = shortDateLabel(selectedDate);
    const seq = ++timesSeq;
    const point = coordinates();
    if (!point) {
      renderTimes(fallbackSlots(), false);
      setStatus('Enter your address below to see live availability.');
      return;
    }
    setStatus('Checking available times…');
    try {
      const params = new URLSearchParams({
        date: selectedDate,
        durationMinutes: String(PROVISIONAL_DURATION),
        lat: String(point.lat),
        lng: String(point.lng),
      });
      const response = await fetch(`/api/availability?${params}`, {
        headers: { Accept: 'application/json' },
      });
      if (seq !== timesSeq) return;
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        enabled?: boolean;
        slots?: Slot[];
        reason?: string;
      };
      if (!response.ok || data.ok !== true) {
        renderTimes(fallbackSlots(), false);
        setStatus('Live times are unavailable right now. Choose a preferred start.');
        return;
      }
      if (data.enabled !== true) {
        renderTimes(fallbackSlots(), false);
        setStatus('Live scheduling is not connected yet. Choose a preferred start.');
        return;
      }
      renderTimes(data.slots ?? [], true);
    } catch {
      if (seq !== timesSeq) return;
      renderTimes(fallbackSlots(), false);
      setStatus('We could not reach the booking calendar. Choose a preferred start.');
    }
  }

  function renderCalendar(): void {
    monthLabelEl.textContent = monthLabel(viewYear, viewMonth);
    const first = new Date(Date.UTC(viewYear, viewMonth, 1, 12));
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0, 12)).getUTCDate();
    const leading = first.getUTCDay();
    gridEl.innerHTML = '';
    for (let index = 0; index < leading; index += 1) {
      const blank = document.createElement('span');
      blank.className = 'booking-calendar__day booking-calendar__day--empty';
      blank.setAttribute('aria-hidden', 'true');
      gridEl.appendChild(blank);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'booking-calendar__day';
      button.dataset.date = dateKey;
      button.textContent = String(day);
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-selected', String(dateKey === selectedDate));
      const disabled = dateKey < today || dateKey > latest;
      if (disabled) {
        button.disabled = true;
        button.classList.add('is-disabled');
        button.setAttribute('aria-disabled', 'true');
      }
      if (dateKey === selectedDate) button.classList.add('is-selected');
      if (dateKey === today) button.classList.add('is-today');
      button.addEventListener('click', () => {
        selectedDate = dateKey;
        selectedTime = null;
        renderCalendar();
        notify();
        void refreshTimes();
      });
      gridEl.appendChild(button);
    }
    const showingCurrent = viewYear === Number(today.slice(0, 4)) && viewMonth === Number(today.slice(5, 7)) - 1;
    if (prevButton) prevButton.disabled = showingCurrent;
    if (nextButton) {
      const maxYear = Number(latest.slice(0, 4));
      const maxMonth = Number(latest.slice(5, 7)) - 1;
      nextButton.disabled = viewYear > maxYear || (viewYear === maxYear && viewMonth >= maxMonth);
    }
  }

  prevButton?.addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    renderCalendar();
  });
  nextButton?.addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    renderCalendar();
  });

  if (dateInput) {
    dateInput.min = today;
    dateInput.max = latest;
    const syncFromLegacyDate = () => {
      const value = dateInput.value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < today || value > latest) return;
      if (value === selectedDate) return;
      selectedDate = value;
      selectedTime = null;
      renderCalendar();
      notify();
      void refreshTimes();
    };
    dateInput.addEventListener('change', syncFromLegacyDate);
    dateInput.addEventListener('input', syncFromLegacyDate);
  }

  renderCalendar();
  clearTimes();

  return {
    setContext(next) {
      const changed =
        next.lat !== context.lat ||
        next.lng !== context.lng ||
        (next.zip ?? '') !== (context.zip ?? '');
      context = next;
      if (changed && selectedDate) void refreshTimes();
    },
    selection() {
      return selectedTime;
    },
    selectSlot(start, end, startLabel) {
      if (!selectedDate) return;
      selectedTime = {
        date: selectedDate,
        timeLabel: startLabel,
        start,
        end,
        live: true,
      };
      setInputs();
      if (selectedLabel) {
        selectedLabel.textContent = `${shortDateLabel(selectedDate)} at ${startLabel}`;
      }
      setStatus('Preferred time updated. Send your request to continue.', 'success');
      notify();
    },
    async finalize(input) {
      if (!selectedDate) {
        return { status: 'none', message: 'Choose a preferred date to continue.', alternatives: [] };
      }
      if (!selectedTime) {
        return {
          status: 'preferred',
          message: 'Your preferred date is saved. We will confirm an available start time with you.',
          alternatives: [],
        };
      }
      if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
        return {
          status: 'preferred',
          message: 'Your preferred time is saved. We will confirm the final schedule with you.',
          alternatives: [],
        };
      }
      try {
        const params = new URLSearchParams({
          date: selectedDate,
          durationMinutes: String(Math.round(input.durationMinutes)),
          lat: String(input.destination.lat),
          lng: String(input.destination.lng),
        });
        const response = await fetch(`/api/availability?${params}`, {
          headers: { Accept: 'application/json' },
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          enabled?: boolean;
          slots?: Slot[];
        };
        if (!response.ok || data.ok !== true || data.enabled !== true) {
          return {
            status: 'preferred',
            message:
              'Your preferred time is saved. Live scheduling is unavailable right now, so our team will confirm the exact time with you.',
            alternatives: [],
          };
        }
        const slots = data.slots ?? [];
        const exact = slots.find(
          (slot) =>
            (selectedTime?.start && slot.start === selectedTime.start) ||
            slot.startLabel === selectedTime?.timeLabel,
        );
        if (!exact) {
          return {
            status: 'alternatives',
            message:
              slots.length > 0
                ? 'That start time is no longer available with your final details. Choose one of these real alternatives, or send your request and we will help.'
                : 'No online times remain for that date with your final details. Send your request and we will offer the closest available time.',
            alternatives: slots.slice(0, 8),
          };
        }
        clearHoldInputs();
        const hold = await fetch('/api/booking-hold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            date: selectedDate,
            start: exact.start,
            end: exact.end,
            durationMinutes: Math.round(input.durationMinutes),
            destination: input.destination,
            reference: input.reference,
            location: input.location,
          }),
        });
        const holdData = (await hold.json().catch(() => ({}))) as {
          ok?: boolean;
          holdId?: string;
          expiresAt?: string;
        };
        if (!hold.ok || holdData.ok !== true || !holdData.holdId || !holdData.expiresAt) {
          return {
            status: 'alternatives',
            message:
              'That time could not be held. Please choose another available time, or send your request and we will help.',
            alternatives: slots.slice(0, 8).filter((slot) => slot.start !== exact.start),
          };
        }
        selectedTime = {
          ...selectedTime!,
          start: exact.start,
          end: exact.end,
          timeLabel: exact.startLabel,
          live: true,
        };
        setInputs();
        // The wizard reads these hidden fields; the hold remains a temporary
        // capacity reservation, not a confirmed appointment.
        const holdIdInput = document.createElement('input');
        holdIdInput.type = 'hidden';
        holdIdInput.name = 'booking_hold_id';
        holdIdInput.value = holdData.holdId;
        for (const inputEl of root.querySelectorAll('input[name="booking_hold_id"]')) inputEl.remove();
        root.appendChild(holdIdInput);
        const expiryInput = document.createElement('input');
        expiryInput.type = 'hidden';
        expiryInput.name = 'booking_hold_expires_at';
        expiryInput.value = holdData.expiresAt;
        for (const inputEl of root.querySelectorAll('input[name="booking_hold_expires_at"]')) inputEl.remove();
        root.appendChild(expiryInput);
        setStatus('Time held temporarily. Send your request to continue.', 'success');
        return {
          status: 'held',
          message:
            'Your preferred time is temporarily held while you send the request. It is not a confirmed appointment until Sparkling Standard approves it.',
          alternatives: [],
        };
      } catch {
        return {
          status: 'preferred',
          message:
            'Your preferred time is saved. We could not reach the booking calendar, so our team will confirm the exact time with you.',
          alternatives: [],
        };
      }
    },
    reset() {
      selectedDate = '';
      selectedTime = null;
      viewYear = Number(today.slice(0, 4));
      viewMonth = Number(today.slice(5, 7)) - 1;
      setInputs();
      renderCalendar();
      clearTimes();
    },
  };
}
