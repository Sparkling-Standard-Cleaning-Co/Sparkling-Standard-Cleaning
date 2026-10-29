// Owner-approved premium appointment calendar (2026-10-28).
//
// Residential/STR rules: the customer first chooses First Appointment
// (7:00–8:30 AM) or Afternoon Appointment (12:30–2:30 PM), then a compact
// hour-and-minute start in 15-minute increments. No large list of time buttons.
//
// The choice is provisional. The final step revalidates the real duration and
// destination against the two-resource scheduler, creates the temporary hold,
// and offers real alternatives when the time is no longer available.
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

type Period = 'first' | 'afternoon';

const PERIODS: Record<Period, { label: string; startMinutes: number; endMinutes: number }> = {
  first: { label: 'First Appointment', startMinutes: 7 * 60, endMinutes: 8 * 60 + 30 },
  afternoon: { label: 'Afternoon Appointment', startMinutes: 12 * 60 + 30, endMinutes: 14 * 60 + 30 },
};

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

function minutesToLabel(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`;
}

function periodMinutes(period: Period): number[] {
  const { startMinutes, endMinutes } = PERIODS[period];
  const values: number[] = [];
  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 15) values.push(minutes);
  return values;
}

function hour12(hour24: number): number {
  return ((hour24 + 11) % 12) + 1;
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
  const periodEl = root.querySelector<HTMLElement>('[data-calendar-period]');
  const periodButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-period]')];
  const picker = root.querySelector<HTMLElement>('[data-calendar-picker]');
  const hourSelect = root.querySelector<HTMLSelectElement>('[data-time-hour]');
  const minuteSelect = root.querySelector<HTMLSelectElement>('[data-time-minute]');
  const meridiemEl = root.querySelector<HTMLElement>('[data-time-meridiem]');
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
  let selectedPeriod: Period | null = null;
  let availableSlots: Slot[] = [];
  let liveAvailability = false;
  let timesSeq = 0;

  function setStatus(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.state = kind;
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

  function slotForMinutes(minutes: number): Slot | null {
    const label = minutesToLabel(minutes);
    return availableSlots.find((slot) => slot.startLabel === label) ?? null;
  }

  function timeIsEnabled(minutes: number): boolean {
    if (!liveAvailability) return true;
    return Boolean(slotForMinutes(minutes));
  }

  function setPeriod(period: Period): void {
    selectedPeriod = period;
    for (const button of periodButtons) {
      const pressed = button.dataset.period === period;
      button.setAttribute('aria-pressed', String(pressed));
      button.classList.toggle('is-selected', pressed);
    }
    populatePicker();
  }

  function populatePicker(): void {
    if (!selectedPeriod || !picker || !hourSelect || !minuteSelect) return;
    const times = periodMinutes(selectedPeriod).filter(timeIsEnabled);
    if (times.length === 0) {
      picker.hidden = true;
      selectedTime = null;
      if (selectedLabel && selectedDate) selectedLabel.textContent = shortDateLabel(selectedDate);
      setStatus('No online times are available in that window. Choose another window or date.', 'error');
      notify();
      return;
    }
    picker.hidden = false;
    const hours = [...new Set(times.map((minutes) => Math.floor(minutes / 60)))];
    const previousHour = Number(hourSelect.value);
    const targetHour = hours.includes(previousHour) ? previousHour : hours[0]!;
    hourSelect.innerHTML = '';
    for (const hour of hours) {
      const option = document.createElement('option');
      option.value = String(hour);
      option.textContent = String(hour12(hour)).padStart(2, '0');
      hourSelect.appendChild(option);
    }
    hourSelect.value = String(targetHour);
    populateMinutes(targetHour);
    updateSelectedTime();
  }

  function populateMinutes(hour: number): void {
    if (!minuteSelect || !selectedPeriod) return;
    const times = periodMinutes(selectedPeriod).filter(
      (minutes) => Math.floor(minutes / 60) === hour && timeIsEnabled(minutes),
    );
    const previousMinute = Number(minuteSelect.value);
    minuteSelect.innerHTML = '';
    for (const minutes of times) {
      const minute = minutes % 60;
      const option = document.createElement('option');
      option.value = String(minute);
      option.textContent = String(minute).padStart(2, '0');
      minuteSelect.appendChild(option);
    }
    if (times.length === 0) return;
    const previousAvailable = times.some((minutes) => minutes % 60 === previousMinute);
    minuteSelect.value = String(
      previousAvailable ? previousMinute : times[0]! % 60,
    );
  }

  function updateSelectedTime(): void {
    if (!selectedPeriod || !hourSelect || !minuteSelect || !selectedDate) return;
    const hour = Number(hourSelect.value);
    const minute = Number(minuteSelect.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
    const minutes = hour * 60 + minute;
    const label = minutesToLabel(minutes);
    if (meridiemEl) meridiemEl.textContent = hour >= 12 ? 'PM' : 'AM';
    const slot = slotForMinutes(minutes);
    selectedTime = {
      date: selectedDate,
      timeLabel: label,
      start: slot?.start ?? '',
      end: slot?.end ?? '',
      live: Boolean(slot),
    };
    if (selectedLabel) {
      selectedLabel.textContent = `${shortDateLabel(selectedDate)} at ${label}`;
    }
    setStatus(slot ? 'Preferred time selected.' : 'Preferred start saved.', 'success');
    notify();
  }

  function renderPeriods(): void {
    if (!periodEl) return;
    if (!selectedDate) {
      periodEl.hidden = true;
      if (picker) picker.hidden = true;
      return;
    }
    periodEl.hidden = false;
    for (const button of periodButtons) {
      const period = button.dataset.period as Period | undefined;
      if (!period) continue;
      const available = periodMinutes(period).some(timeIsEnabled);
      button.disabled = liveAvailability && !available;
      button.classList.toggle('is-unavailable', liveAvailability && !available);
    }
    if (selectedPeriod && liveAvailability) {
      const stillAvailable = periodMinutes(selectedPeriod).some(timeIsEnabled);
      if (!stillAvailable) {
        selectedPeriod = null;
        selectedTime = null;
        for (const button of periodButtons) {
          button.setAttribute('aria-pressed', 'false');
          button.classList.remove('is-selected');
        }
        if (picker) picker.hidden = true;
        if (selectedLabel) selectedLabel.textContent = shortDateLabel(selectedDate);
      }
    }
    if (selectedPeriod) populatePicker();
  }

  function clearTimes(message = 'Select a date to see preferred start times.'): void {
    availableSlots = [];
    liveAvailability = false;
    selectedPeriod = null;
    selectedTime = null;
    if (periodEl) periodEl.hidden = true;
    if (picker) picker.hidden = true;
    setStatus(message);
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
      availableSlots = [];
      liveAvailability = false;
      setStatus('Enter your address above to see live availability. Choose a preferred start below.');
      renderPeriods();
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
      };
      if (!response.ok || data.ok !== true || data.enabled !== true) {
        availableSlots = [];
        liveAvailability = false;
        setStatus('Live scheduling is unavailable right now. Choose a preferred start.');
        renderPeriods();
        return;
      }
      availableSlots = data.slots ?? [];
      liveAvailability = true;
      if (timeNote) {
        timeNote.textContent =
          'Live times from the Sparkling Standard booking calendar in Central Time.';
      }
      setStatus('Choose First Appointment or Afternoon Appointment.');
      renderPeriods();
    } catch {
      if (seq !== timesSeq) return;
      availableSlots = [];
      liveAvailability = false;
      setStatus('We could not reach the booking calendar. Choose a preferred start.');
      renderPeriods();
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
        selectedPeriod = null;
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

  for (const button of periodButtons) {
    button.addEventListener('click', () => {
      const period = button.dataset.period as Period | undefined;
      if (!period || button.disabled) return;
      setPeriod(period);
    });
  }
  hourSelect?.addEventListener('change', () => {
    populateMinutes(Number(hourSelect.value));
    updateSelectedTime();
  });
  minuteSelect?.addEventListener('change', () => {
    updateSelectedTime();
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
      selectedPeriod = null;
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
        const holdIdInput = document.createElement('input');
        holdIdInput.type = 'hidden';
        holdIdInput.name = 'booking_hold_id';
        holdIdInput.value = holdData.holdId;
        root.appendChild(holdIdInput);
        const expiryInput = document.createElement('input');
        expiryInput.type = 'hidden';
        expiryInput.name = 'booking_hold_expires_at';
        expiryInput.value = holdData.expiresAt;
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
      selectedPeriod = null;
      availableSlots = [];
      liveAvailability = false;
      viewYear = Number(today.slice(0, 4));
      viewMonth = Number(today.slice(5, 7)) - 1;
      setInputs();
      renderCalendar();
      clearTimes();
    },
  };
}
