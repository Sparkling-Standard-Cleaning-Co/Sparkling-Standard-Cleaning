// Address finder — street-address autocomplete, manual fallback, and map-pin
// confirmation. Loaded only on the estimate page.
//
// Privacy / cost rules:
//  - Suggestions are debounced (350 ms) and every new keystroke aborts the
//    previous request, so free provider quotas are conserved.
//  - The interactive map (MapLibre GL + OpenFreeMap, both free) is imported
//    lazily — only after an address resolves, never on page load.
//  - No address, coordinate or ZIP is ever sent to analytics.
//  - A confirmed location is the ONLY source of destination coordinates.

import {
  buildGeocodeQuery,
  formatLocationLine,
  isPlausibleCoordinate,
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
  street: string;
  lat: number;
  lng: number;
  zip?: string;
  city?: string;
  state?: string;
  source: 'mapmap' | 'census' | 'manual';
  adjusted: boolean;
}

export function initAddressFinder(options: AddressFinderOptions): AddressFinderHandle | null {
  const { form, onChange } = options;
  const root = form.querySelector<HTMLElement>('[data-address-finder]');
  const streetInput = form.querySelector<HTMLInputElement>('#est-address');
  const unitInput = form.querySelector<HTMLInputElement>('#est-address-unit');
  const zipInput = form.querySelector<HTMLInputElement>('#est-zip');
  if (!root || !streetInput) return null;
  // Non-null aliases keep TypeScript narrowing inside the closures below.
  const finderRoot: HTMLElement = root;
  const streetField: HTMLInputElement = streetInput;

  const suggestionsList = root.querySelector<HTMLUListElement>('[data-address-suggestions]');
  const statusEl = root.querySelector<HTMLElement>('[data-address-status]');
  const manualToggle = root.querySelector<HTMLButtonElement>('[data-address-manual]');
  const manualPanel = root.querySelector<HTMLElement>('[data-address-manual-panel]');
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
    if (!confirmed) return;
    confirmed = null;
    candidate = null;
    if (confirmedCard) confirmedCard.hidden = true;
    if (mapCard) mapCard.hidden = true;
    setState('typing');
    onChange(null);
  }

  function fillZip(zip: string | undefined): void {
    if (!zipInput || !zip) return;
    if (zipInput.value.trim() === zip) return;
    zipInput.value = zip;
    zipInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function showCandidate(resolved: ResolvedCandidate, options: { manual?: boolean } = {}): void {
    candidate = resolved;
    if (resolved.zip) fillZip(resolved.zip);
    if (mapCard) mapCard.hidden = false;
    if (confirmedCard) confirmedCard.hidden = true;
    // The confirm action is available even before/without the map: the map is
    // an enhancement, never a requirement.
    setState(options.manual ? 'resolved_manual' : 'resolved');
    setStatus('Check the map pin and confirm this is the right location.', 'info');
    void showMap(resolved);
    confirmButton?.focus();
  }

  async function ensureMap(): Promise<MapLibreModule | null> {
    if (mapModule) return mapModule;
    if (!mapLoading) {
      mapLoading = (async () => {
        try {
          const [module] = await Promise.all([
            import('maplibre-gl'),
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
        });
        map.on('error', () => {
          if (!mapReady) mapFallback?.removeAttribute('hidden');
        });
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
            'Pin moved — we will verify travel to the corrected location when you confirm.',
          );
          setStatus(
            'Pin adjusted. Confirm to use this corrected destination.',
            'info',
          );
        });
      }
    } catch {
      mapFallback?.removeAttribute('hidden');
    }
  }

  /**
   * Enriches a directly-plotted suggestion with authoritative ZIP/city/state
   * data from the forward geocoder. It never overrides a newer choice or an
   * already-confirmed destination, and a failure keeps the provider's own
   * suggestion coordinates.
   */
  async function enrichCandidate(label: string, fallback: ResolvedCandidate): Promise<void> {
    try {
      confirmAbort?.abort();
      confirmAbort = new AbortController();
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'resolve', query: label.slice(0, 120) }),
        signal: confirmAbort.signal,
      });
      if (!response.ok) return;
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { label?: string; lat?: number; lng?: number; zip?: string; city?: string; state?: string };
      };
      if (!data.ok || !data.result) return;
      const { label: resolvedLabel, lat, lng, zip, city, state } = data.result;
      if (typeof lat !== 'number' || typeof lng !== 'number' || !isPlausibleCoordinate(lat, lng)) return;
      // The customer moved on (different input or a confirmation) — keep theirs.
      if (confirmed || streetField.value.trim() !== label) return;
      candidate = {
        label: resolvedLabel ?? label,
        street: streetLineFromLabel(resolvedLabel ?? label, city, state, zip),
        lat,
        lng,
        source: 'mapmap',
        adjusted: false,
        ...(zip ? { zip } : {}),
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
      };
      if (zip) fillZip(zip);
      setState('resolved');
      void showMap(candidate);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      // Keep the provider suggestion coordinates from the fallback candidate.
      void fallback;
    }
  }

  async function chooseSuggestion(index: number): Promise<void> {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    clearSuggestions();
    setState('resolving');
    setStatus('Looking up that address…', 'info');
    streetField.value = suggestion.label;

    // Preferred path: the provider already embedded coordinates, so the
    // destination can be plotted without a retrieve call (the retrieve
    // endpoint is not available on every gateway).
    if (
      typeof suggestion.lat === 'number' &&
      typeof suggestion.lng === 'number' &&
      isPlausibleCoordinate(suggestion.lat, suggestion.lng)
    ) {
      showCandidate({
        label: suggestion.label,
        street: streetLineFromLabel(suggestion.label),
        lat: suggestion.lat,
        lng: suggestion.lng,
        source: 'mapmap',
        adjusted: false,
      });
      void enrichCandidate(suggestion.label, {
        label: suggestion.label,
        street: streetLineFromLabel(suggestion.label),
        lat: suggestion.lat,
        lng: suggestion.lng,
        source: 'mapmap',
        adjusted: false,
      });
      return;
    }

    // Legacy/id-only providers: retrieve the document by id.
    try {
      confirmAbort?.abort();
      confirmAbort = new AbortController();
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'resolve-id', id: suggestion.id }),
        signal: confirmAbort.signal,
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { label?: string; lat?: number; lng?: number; zip?: string; city?: string; state?: string };
      };
      if (!response.ok || !data.ok || !data.result) throw new Error('not_found');
      const { label, lat, lng, zip, city, state } = data.result;
      if (
        typeof label !== 'string' ||
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !isPlausibleCoordinate(lat, lng)
      ) {
        throw new Error('not_found');
      }
      const resolved: ResolvedCandidate = {
        label,
        street: streetLineFromLabel(label, city, state, zip),
        lat,
        lng,
        source: 'mapmap',
        adjusted: false,
        ...(zip ? { zip } : {}),
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
      };
      if (!zipInput?.value.trim() && !zip) {
        const fromLabel = zipFromLabel(label);
        if (fromLabel) {
          resolved.zip = fromLabel;
          resolved.street = streetLineFromLabel(label, city, state, fromLabel);
        }
      }
      showCandidate(resolved);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setState('idle');
      setStatus(
        "We couldn't confirm that suggestion. Try the manual entry below or continue with your ZIP.",
        'error',
      );
    }
  }

  async function requestSuggestions(query: string): Promise<void> {
    suggestAbort?.abort();
    suggestAbort = new AbortController();
    setState('suggesting');
    try {
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'suggest', query }),
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
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; suggestions?: GeocodeSuggestion[] };
      if (!response.ok || !data.ok || !Array.isArray(data.suggestions)) {
        throw new Error('provider_failed');
      }
      suggestions = data.suggestions;
      activeIndex = -1;
      setState(suggestions.length > 0 ? 'suggestions' : 'idle');
      if (suggestions.length === 0) {
        setStatus('No matching addresses yet — keep typing, enter it manually, or use your ZIP.', 'info');
      } else {
        setStatus('Choose your address from the list.', 'info');
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
    const zip = zipInput?.value.trim() ?? '';
    if (street.length < 5) {
      setStatus('Enter your street address first.', 'error');
      streetField.focus();
      return;
    }
    setState('resolving');
    setStatus('Looking up that address…', 'info');
    try {
      confirmAbort?.abort();
      confirmAbort = new AbortController();
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          query: buildGeocodeQuery(street, unitInput?.value, zip || undefined),
        }),
        signal: confirmAbort.signal,
      });
      if (response.status === 503) {
        setState('unavailable');
        setStatus(
          'Address lookup is not connected right now — continue with your ZIP and we will verify travel personally.',
          'info',
        );
        return;
      }
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { label?: string; lat?: number; lng?: number; zip?: string; city?: string; state?: string; source?: string };
      };
      if (!response.ok || !data.ok || !data.result) throw new Error('not_found');
      const { label, lat, lng, zip: foundZip, city, state, source } = data.result;
      if (
        typeof label !== 'string' ||
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !isPlausibleCoordinate(lat, lng)
      ) {
        throw new Error('not_found');
      }
      showCandidate({
        label,
        street: streetLineFromLabel(label, city, state, foundZip),
        lat,
        lng,
        source: source === 'mapmap' ? 'mapmap' : 'census',
        adjusted: false,
        ...(foundZip ? { zip: foundZip } : {}),
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setState('idle');
      setStatus(
        "We couldn't find that exact address. Check the spelling, or continue with your ZIP — Sparkling Standard will confirm the location.",
        'error',
      );
    }
  }

  function confirmLocation(): void {
    if (!candidate) return;
    confirmed = {
      label: candidate.label,
      street: candidate.street || candidate.label,
      ...(unitInput?.value.trim() ? { unit: unitInput.value.trim() } : {}),
      lat: candidate.lat,
      lng: candidate.lng,
      ...(candidate.zip || zipInput?.value.trim()
        ? { zip: candidate.zip ?? zipInput?.value.trim() ?? '' }
        : {}),
      ...(candidate.city ? { city: candidate.city } : {}),
      ...(candidate.state ? { state: candidate.state } : {}),
      source: candidate.source,
      ...(candidate.adjusted ? { adjusted: true } : {}),
      confirmedAt: new Date().toISOString(),
    };
    if (mapCard) mapCard.hidden = false;
    if (confirmedCard) confirmedCard.hidden = false;
    if (confirmedLabel) confirmedLabel.textContent = formatLocationLine(confirmed);
    setTravelNote(
      'Travel will be calculated from our operating base to this confirmed pin when your price is prepared.',
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
    const query = streetField.value.trim();
    if (query.length < MIN_SUGGEST_LENGTH) {
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

  manualToggle?.addEventListener('click', () => {
    const expanded = manualToggle.getAttribute('aria-expanded') === 'true';
    manualToggle.setAttribute('aria-expanded', String(!expanded));
    if (manualPanel) manualPanel.hidden = expanded;
    if (!expanded) streetField.focus();
  });

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
      setStatus(
        'Start typing your street address — suggestions appear as you type.',
        'info',
      );
      onChange(null);
    },
    focus: () => streetField.focus(),
  };
}
