// Address finder — separated street/city/state/ZIP fields, debounced
// autocomplete, exact-address resolution and map-pin confirmation.
//
// Correctness rules for the rural-address defect:
//  - Autocomplete queries are composed from ALL entered address information.
//  - Saving a suggestion only counts as a precise destination when it carries
//    the entered house number. A street-level or POI suggestion triggers an
//    exact full-address resolution instead (MapMap exact-only → Census).
//  - When the exact address cannot be resolved, the customer's original
//    address is preserved, nothing is confirmed, and travel stays preliminary
//    (confirmed manually by Sparkling Standard).
//  - A confirmed location is the ONLY source of destination coordinates.

import {
  buildGeocodeQuery,
  formatLocationLine,
  houseNumberFromStreet,
  isPlausibleCoordinate,
  labelHasHouseNumber,
  streetLineFromLabel,
  zipFromLabel,
  type ConfirmedLocation,
  type GeocodeSuggestion,
} from '../lib/location/location';

const SUGGEST_DEBOUNCE_MS = 350;
const MIN_SUGGEST_LENGTH = 4;
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export interface AddressFinderOptions {
  form: HTMLFormElement;
  onChange: (location: ConfirmedLocation | null) => void;
}

export interface AddressFinderHandle {
  getLocation(): ConfirmedLocation | null;
  /** Clear any confirmed location and return to the editing state. */
  reset(): void;
  /** Re-focus the street input (used when a step is entered). */
  focus(): void;
}

interface ResolvedCandidate {
  label: string;
  lat: number;
  lng: number;
  zip?: string;
  city?: string;
  state?: string;
  source: 'mapmap' | 'census' | 'manual';
  adjusted: boolean;
}

interface ResolveResult {
  label?: string;
  lat?: number;
  lng?: number;
  zip?: string;
  city?: string;
  state?: string;
  source?: string;
  /** False when the provider could only manage a street-level match. */
  precise?: boolean;
}

export function initAddressFinder(options: AddressFinderOptions): AddressFinderHandle | null {
  const { form, onChange } = options;
  const root = form.querySelector<HTMLElement>('[data-address-finder]');
  const streetInput = form.querySelector<HTMLInputElement>('#est-address');
  const unitInput = form.querySelector<HTMLInputElement>('#est-address-unit');
  const cityInput = form.querySelector<HTMLInputElement>('#est-address-city');
  const stateInput = form.querySelector<HTMLSelectElement>('#est-address-state');
  const zipInput = form.querySelector<HTMLInputElement>('#est-zip');
  if (!root || !streetInput) return null;
  // Non-null aliases keep TypeScript narrowing inside the closures below.
  const finderRoot: HTMLElement = root;
  const streetField: HTMLInputElement = streetInput;

  const suggestionsList = root.querySelector<HTMLUListElement>('[data-address-suggestions]');
  const statusEl = root.querySelector<HTMLElement>('[data-address-status]');
  const resolveButton = root.querySelector<HTMLButtonElement>('[data-address-resolve]');
  const mapCard = root.querySelector<HTMLElement>('[data-address-map]');
  const mapCanvas = root.querySelector<HTMLElement>('[data-address-map-canvas]');
  const mapFallback = root.querySelector<HTMLElement>('[data-address-map-fallback]');
  const confirmButton = root.querySelector<HTMLButtonElement>('[data-address-confirm]');
  const changeButton = root.querySelector<HTMLButtonElement>('[data-address-change]');
  const confirmedCard = root.querySelector<HTMLElement>('[data-address-confirmed]');
  const confirmedLabel = root.querySelector<HTMLElement>('[data-address-confirmed-label]');
  const confirmedTravel = root.querySelector<HTMLElement>('[data-address-confirmed-travel]');

  let suggestions: GeocodeSuggestion[] = [];
  let activeIndex = -1;
  let suggestTimer: number | undefined;
  let suggestAbort: AbortController | null = null;
  let confirmAbort: AbortController | null = null;
  let candidate: ResolvedCandidate | null = null;
  let confirmed: ConfirmedLocation | null = null;

  // MapLibre is imported lazily and only once per page.
  type MapLibreModule = typeof import('maplibre-gl');
  let mapModule: MapLibreModule | null = null;
  let mapLoading: Promise<MapLibreModule | null> | null = null;
  let map: import('maplibre-gl').Map | null = null;
  let marker: import('maplibre-gl').Marker | null = null;
  let mapReady = false;
  let resizeObserver: ResizeObserver | null = null;

  function setState(state: string): void {
    finderRoot.dataset.state = state;
  }

  function setStatus(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.kind = message ? kind : '';
  }

  function setTravelNote(message: string): void {
    if (confirmedTravel) confirmedTravel.textContent = message;
  }

  function clearSuggestions(): void {
    suggestions = [];
    activeIndex = -1;
    if (suggestionsList) {
      suggestionsList.innerHTML = '';
      suggestionsList.hidden = true;
    }
    streetField.setAttribute('aria-expanded', 'false');
    streetField.removeAttribute('aria-activedescendant');
  }

  function renderSuggestions(): void {
    if (!suggestionsList) return;
    suggestionsList.innerHTML = '';
    suggestions.forEach((suggestion, index) => {
      const item = document.createElement('li');
      item.id = `est-address-option-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === activeIndex));
      item.dataset.index = String(index);
      item.textContent = suggestion.label;
      item.addEventListener('mousedown', (event) => {
        // mousedown fires before the input blurs.
        event.preventDefault();
        void chooseSuggestion(index);
      });
      suggestionsList.appendChild(item);
    });
    suggestionsList.hidden = suggestions.length === 0;
    streetField.setAttribute('aria-expanded', String(suggestions.length > 0));
    if (activeIndex >= 0) {
      streetField.setAttribute('aria-activedescendant', `est-address-option-${activeIndex}`);
    } else {
      streetField.removeAttribute('aria-activedescendant');
    }
  }

  function invalidateConfirmation(): void {
    if (!confirmed) {
      setState('typing');
      return;
    }
    confirmed = null;
    candidate = null;
    if (confirmedCard) confirmedCard.hidden = true;
    if (mapCard) mapCard.hidden = true;
    setState('typing');
    onChange(null);
  }

  function composeQuery(): string {
    return buildGeocodeQuery(
      streetField.value,
      unitInput?.value,
      cityInput?.value,
      stateInput?.value,
      zipInput?.value,
    );
  }

  function fillField(input: HTMLInputElement | HTMLSelectElement | null, value: string | undefined): void {
    if (!input || !value) return;
    if (input instanceof HTMLSelectElement) {
      input.value = value.toUpperCase();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (input.value.trim() === value) return;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyResolvedAddress(resolved: ResolveResult): ResolvedCandidate | null {
    const { label, lat, lng } = resolved;
    if (
      typeof label !== 'string' ||
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !isPlausibleCoordinate(lat, lng)
    ) {
      return null;
    }
    // Fill authoritative city/state/ZIP from the resolved address.
    fillField(cityInput, resolved.city);
    fillField(stateInput, resolved.state);
    fillField(zipInput, resolved.zip ?? zipFromLabel(label) ?? undefined);
    return {
      label,
      lat,
      lng,
      source: resolved.source === 'mapmap' ? 'mapmap' : 'census',
      adjusted: false,
      ...(resolved.zip ? { zip: resolved.zip } : {}),
      ...(resolved.city ? { city: resolved.city } : {}),
      ...(resolved.state ? { state: resolved.state } : {}),
    };
  }

  function showCandidate(resolved: ResolvedCandidate, options: { manual?: boolean } = {}): void {
    candidate = resolved;
    if (resolved.zip) fillField(zipInput, resolved.zip);
    if (mapCard) mapCard.hidden = false;
    if (confirmedCard) confirmedCard.hidden = true;
    // The confirm action is available even before/without the map: the map is
    // an enhancement, never a requirement.
    setState(options.manual ? 'resolved_manual' : 'resolved');
    setStatus('Address found — confirm your location on the map.', 'success');
    void showMap(resolved);
    confirmButton?.focus();
  }

  /** Exact address could not be placed: preserve the address, confirm nothing. */
  function exactResolveFailed(): void {
    candidate = null;
    confirmed = null;
    if (confirmedCard) confirmedCard.hidden = true;
    if (mapCard) mapCard.hidden = true;
    setState('unresolved');
    setStatus(
      "We couldn't pinpoint this address. You can still request your cleaning, and we'll confirm the location.",
      'error',
    );
    onChange(null);
  }

  async function requestResolvedAddress(query: string): Promise<void> {
    setState('resolving');
    setStatus('Looking up that exact address…', 'info');
    try {
      confirmAbort?.abort();
      confirmAbort = new AbortController();
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'resolve', query: query.slice(0, 120) }),
        signal: confirmAbort.signal,
      });
      if (response.status === 503) {
        setState('unavailable');
        setStatus(
          'Address lookup is not connected right now — continue with your ZIP and we will confirm travel personally.',
          'info',
        );
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: ResolveResult };
      if (response.ok && data.ok && data.result) {
        const resolved = applyResolvedAddress(data.result);
        // Only an exact house-number match may become a confirmed destination.
        if (resolved && data.result.precise === true) {
          showCandidate(resolved);
          return;
        }
      }
      exactResolveFailed();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      exactResolveFailed();
    }
  }

  async function ensureMap(): Promise<MapLibreModule | null> {
    if (mapModule) return mapModule;
    if (!mapLoading) {
      mapLoading = (async () => {
        try {
          const [module, workerUrl] = await Promise.all([
            import('maplibre-gl'),
            // OpenFreeMap/MapLibre Vite guidance: point MapLibre at its own
            // emitted worker bundle. Without this the worker never loads in
            // production and the map renders blank.
            import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url')
              .then((workerModule) => workerModule.default)
              .catch(() => null),
            // The stylesheet is emitted as an asset and attached only when the
            // map actually initializes, never on page load.
            import('maplibre-gl/dist/maplibre-gl.css?url')
              .then(({ default: cssUrl }) => {
                if (cssUrl && !document.querySelector(`link[data-maplibre-css]`)) {
                  const link = document.createElement('link');
                  link.rel = 'stylesheet';
                  link.href = cssUrl;
                  link.dataset.maplibreCss = 'true';
                  document.head.appendChild(link);
                }
              })
              .catch(() => undefined),
          ]);
          if (workerUrl) module.setWorkerUrl(workerUrl);
          mapModule = module;
          return module;
        } catch {
          return null;
        }
      })();
    }
    return mapLoading;
  }

  async function showMap(resolved: ResolvedCandidate): Promise<void> {
    if (!mapCanvas) return;
    const module = await ensureMap();
    if (!module) {
      mapFallback?.removeAttribute('hidden');
      return;
    }
    try {
      if (!map) {
        map = new module.Map({
          container: mapCanvas,
          style: MAP_STYLE_URL,
          center: [resolved.lng, resolved.lat],
          zoom: 15,
          attributionControl: { compact: true, customAttribution: '© OpenStreetMap contributors' },
          cooperativeGestures: false,
          dragRotate: false,
        });
        map.on('load', () => {
          mapReady = true;
          mapFallback?.setAttribute('hidden', '');
          // The container may have been hidden or resized while loading.
          map?.resize();
        });
        map.on('error', () => {
          if (!mapReady) mapFallback?.removeAttribute('hidden');
        });
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver ??= new ResizeObserver(() => map?.resize());
          resizeObserver.observe(mapCanvas);
        }
      } else {
        map.setCenter([resolved.lng, resolved.lat]);
        map.resize();
      }
      if (marker) {
        marker.setLngLat([resolved.lng, resolved.lat]);
      } else {
        marker = new module.Marker({ draggable: true, color: '#b76e79' })
          .setLngLat([resolved.lng, resolved.lat])
          .addTo(map);
        marker.on('dragend', () => {
          if (!marker || !candidate) return;
          const position = marker.getLngLat();
          candidate = { ...candidate, lat: position.lat, lng: position.lng, adjusted: true };
          if (confirmed) {
            // Correcting a confirmed pin keeps the confirmation in sync.
            confirmed = { ...confirmed, lat: position.lat, lng: position.lng, adjusted: true };
            onChange(confirmed);
          }
          setTravelNote(
            'Pin moved — we will confirm travel to the corrected location when you request your cleaning.',
          );
          setStatus('Pin adjusted. Confirm to use this corrected destination.', 'info');
        });
      }
      // Ensure a fresh layout pass after the card becomes visible.
      window.requestAnimationFrame(() => map?.resize());
    } catch {
      mapFallback?.removeAttribute('hidden');
    }
  }

  async function chooseSuggestion(index: number): Promise<void> {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    clearSuggestions();
    const houseNumber = houseNumberFromStreet(streetField.value);
    const exactSuggestion =
      suggestion.kind === 'address' && labelHasHouseNumber(suggestion.label, houseNumber);

    if (exactSuggestion) {
      // Keep the customer's own street line; the provider coordinates are the
      // precise destination, and the confirmation card summarizes the address
      // from the separate fields.
      const resolved: ResolvedCandidate = {
        label: suggestion.label,
        lat: suggestion.lat ?? Number.NaN,
        lng: suggestion.lng ?? Number.NaN,
        source: 'mapmap',
        adjusted: false,
      };
      if (isPlausibleCoordinate(resolved.lat, resolved.lng)) {
        showCandidate(resolved);
        return;
      }
    }
    // Street-level/POI/local results are never treated as the precise
    // destination: resolve the full address (MapMap exact-only → Census).
    await requestResolvedAddress(composeQuery());
  }

  async function requestSuggestions(query: string): Promise<void> {
    suggestAbort?.abort();
    suggestAbort = new AbortController();
    setState('suggesting');
    try {
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'suggest',
          query: query.slice(0, 120),
          street: streetField.value.trim().slice(0, 80),
          city: cityInput?.value.trim().slice(0, 60) ?? '',
          state: stateInput?.value ?? 'FL',
          zip: zipInput?.value.trim() ?? '',
        }),
        signal: suggestAbort.signal,
      });
      if (response.status === 503) {
        clearSuggestions();
        setState('unavailable');
        setStatus(
          'Address suggestions are not connected right now — enter the address manually or continue with your ZIP.',
          'info',
        );
        return;
      }
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        suggestions?: GeocodeSuggestion[];
        needsLocation?: boolean;
      };
      if (!response.ok || !data.ok || !Array.isArray(data.suggestions)) {
        throw new Error('provider_failed');
      }
      // Never leave irrelevant results visible.
      clearSuggestions();
      if (data.needsLocation) {
        setState('needs_location');
        setStatus('Add your city or ZIP to narrow the search.', 'info');
        return;
      }
      suggestions = data.suggestions;
      activeIndex = -1;
      setState(suggestions.length > 0 ? 'suggestions' : 'idle');
      if (suggestions.length === 0) {
        setStatus('No matching addresses yet — press Find My Address or add your city or ZIP.', 'info');
      } else {
        setStatus('Choose your address from the list, or press Find My Address.', 'info');
      }
      renderSuggestions();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      clearSuggestions();
      setState('idle');
      setStatus(
        'Address lookup is unavailable right now — enter the address manually or continue with your ZIP.',
        'info',
      );
    }
  }

  async function manualResolve(): Promise<void> {
    const street = streetField.value.trim();
    if (street.length < 5) {
      setStatus('Enter your street address first, then press Find My Address.', 'error');
      streetField.focus();
      return;
    }
    await requestResolvedAddress(composeQuery());
  }

  function confirmLocation(): void {
    if (!candidate) return;
    const streetText = streetField.value.trim();
    confirmed = {
      label: candidate.label,
      street: streetText || streetLineFromLabel(candidate.label),
      ...(unitInput?.value.trim() ? { unit: unitInput.value.trim() } : {}),
      lat: candidate.lat,
      lng: candidate.lng,
      ...(candidate.zip || zipInput?.value.trim()
        ? { zip: candidate.zip ?? zipInput?.value.trim() ?? '' }
        : {}),
      ...(candidate.city || cityInput?.value.trim()
        ? { city: candidate.city ?? cityInput?.value.trim() ?? '' }
        : {}),
      ...(candidate.state || stateInput?.value
        ? { state: candidate.state ?? stateInput?.value ?? '' }
        : {}),
      source: candidate.source,
      ...(candidate.adjusted ? { adjusted: true } : {}),
      confirmedAt: new Date().toISOString(),
    };
    if (mapCard) mapCard.hidden = false;
    if (confirmedCard) confirmedCard.hidden = false;
    if (confirmedLabel) confirmedLabel.textContent = formatLocationLine(confirmed);
    setTravelNote(
      'Travel will be calculated from our base to this confirmed pin when your price is prepared.',
    );
    setState('confirmed');
    setStatus('Destination confirmed. We will calculate travel to this exact location.', 'success');
    onChange(confirmed);
  }

  function startChange(): void {
    invalidateConfirmation();
    if (mapCard) mapCard.hidden = true;
    setStatus('Edit the address or pick a different suggestion.', 'info');
    streetField.focus();
    streetField.select();
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  streetField.addEventListener('input', () => {
    invalidateConfirmation();
    window.clearTimeout(suggestTimer);
    const query = composeQuery();
    if (streetField.value.trim().length < MIN_SUGGEST_LENGTH) {
      clearSuggestions();
      setState('idle');
      setStatus(
        'Start typing your street address — or enter it manually below and continue with your ZIP.',
        'info',
      );
      return;
    }
    suggestTimer = window.setTimeout(() => void requestSuggestions(query), SUGGEST_DEBOUNCE_MS);
  });

  streetField.addEventListener('keydown', (event) => {
    if (suggestions.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex =
        event.key === 'ArrowDown'
          ? (activeIndex + 1) % suggestions.length
          : (activeIndex - 1 + suggestions.length) % suggestions.length;
      renderSuggestions();
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0) {
        event.preventDefault();
        void chooseSuggestion(activeIndex);
      }
    } else if (event.key === 'Escape') {
      clearSuggestions();
    }
  });

  streetField.addEventListener('blur', () => {
    // Let a suggestion mousedown win; otherwise close the list.
    window.setTimeout(() => clearSuggestions(), 150);
  });

  // Changing the city, state or ZIP changes the destination: confirmation and
  // suggestions are invalidated, and autocomplete is refreshed using ALL
  // available address information.
  for (const field of [cityInput, stateInput, zipInput]) {
    field?.addEventListener('change', () => {
      invalidateConfirmation();
      clearSuggestions();
      if (streetField.value.trim().length >= MIN_SUGGEST_LENGTH) {
        window.clearTimeout(suggestTimer);
        suggestTimer = window.setTimeout(() => void requestSuggestions(composeQuery()), SUGGEST_DEBOUNCE_MS);
      }
    });
  }

  resolveButton?.addEventListener('click', () => void manualResolve());
  confirmButton?.addEventListener('click', confirmLocation);
  changeButton?.addEventListener('click', startChange);

  unitInput?.addEventListener('change', () => {
    // Unit changes do not move the pin; they only update the confirmed label.
    if (confirmed) {
      const next: ConfirmedLocation = { ...confirmed };
      const unit = unitInput.value.trim();
      if (unit) next.unit = unit;
      else delete next.unit;
      confirmed = next;
      if (confirmedLabel) confirmedLabel.textContent = formatLocationLine(confirmed);
      onChange(confirmed);
    }
  });

  setState('idle');

  return {
    getLocation: () => confirmed,
    reset: () => {
      confirmed = null;
      candidate = null;
      clearSuggestions();
      if (confirmedCard) confirmedCard.hidden = true;
      if (mapCard) mapCard.hidden = true;
      if (mapFallback) mapFallback.setAttribute('hidden', '');
      setState('idle');
      setStatus('Start typing your street address — suggestions appear as you type.', 'info');
      onChange(null);
    },
    focus: () => streetField.focus(),
  };
}
