// Address finder — GPS-first address selection with an explicit manual mode.
//
// MODE SEPARATION (the old bug): the selected method is the ONLY source of the
// submitted destination.
//  - 'gps'    : the device pin plus ONLY the address information returned by
//               the current reverse-geocoding request. Stale manual fields are
//               never merged into the GPS confirmation, calculator, SMS or
//               owner notification.
//  - 'manual' : the typed street/city/state/ZIP fields plus a resolved or
//               unresolved manual candidate. Selecting GPS never deletes the
//               typed values, but they are ignored while GPS is active.
//
// Other rules preserved: exact house-number matching (MapMap exact-only →
// Census), geographic filtering on the server, the autocomplete/resolution
// race guards, MapLibre worker configuration and lazy loading.

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
/** GPS readings below this accuracy (metres) may fill the address fields. */
const GPS_ACCURACY_LIMIT_METERS = 150;

export type AddressMethod = 'manual' | 'gps';

export interface AddressSubmission {
  method: AddressMethod;
  location: ConfirmedLocation | null;
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
}

export interface AddressFinderOptions {
  form: HTMLFormElement;
  onChange: (location: ConfirmedLocation | null) => void;
}

export interface AddressFinderHandle {
  getLocation(): ConfirmedLocation | null;
  /** The method-isolated address used for submission and validation. */
  getSubmission(): AddressSubmission;
  /** Clear everything and return to the initial manual state. */
  reset(): void;
  /** Re-focus the street input (used when a step is entered). */
  focus(): void;
  /** Open and focus the manual-entry section. */
  focusManual(): void;
}

interface ResolvedCandidate {
  label: string;
  lat: number;
  lng: number;
  zip?: string;
  city?: string;
  state?: string;
  source: 'mapmap' | 'census' | 'manual' | 'gps';
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

type PermissionReason = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

const emptyParts = (): { street: string; unit: string; city: string; state: string; zip: string } => ({
  street: '',
  unit: '',
  city: '',
  state: '',
  zip: '',
});

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
  const gpsButton = root.querySelector<HTMLButtonElement>('[data-address-gps]');
  const gpsRetryButton = root.querySelector<HTMLButtonElement>('[data-address-gps-retry]');
  const manualOpenButton = root.querySelector<HTMLButtonElement>('[data-address-manual-open]');
  const manualDetails = root.querySelector<HTMLDetailsElement>('[data-address-manual-details]');
  const permissionPanel = root.querySelector<HTMLElement>('[data-address-permission]');
  const permissionTitle = root.querySelector<HTMLElement>('[data-permission-title]');
  const permissionMessage = root.querySelector<HTMLElement>('[data-permission-message]');
  const permissionSteps = root.querySelector<HTMLOListElement>('[data-permission-steps]');
  const permissionRetryNote = root.querySelector<HTMLElement>('[data-permission-retry-note]');
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
  let method: AddressMethod = 'manual';
  let manualCandidate: ResolvedCandidate | null = null;
  let manualConfirmed: ConfirmedLocation | null = null;
  let gpsCandidate: ResolvedCandidate | null = null;
  let gpsConfirmed: ConfirmedLocation | null = null;
  let gpsParts = emptyParts();
  /** Bumped whenever a resolution/GPS lookup starts, discarding late suggestions. */
  let searchSeq = 0;
  /** True while resolved values are written programmatically into fields. */
  let applyingResolved = false;

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

  function setMethod(next: AddressMethod): void {
    method = next;
    finderRoot.dataset.method = next;
  }

  /** Read through a function so async guards always see the CURRENT method. */
  function methodIsGps(): boolean {
    return method === 'gps';
  }

  function setStatus(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.kind = message ? kind : '';
  }

  function setTravelNote(message: string): void {
    if (confirmedTravel) confirmedTravel.textContent = message;
  }

  function activeConfirmed(): ConfirmedLocation | null {
    return methodIsGps() ? gpsConfirmed : manualConfirmed;
  }

  function emit(): void {
    onChange(activeConfirmed());
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

  function cancelSuggestions(): void {
    searchSeq += 1;
    window.clearTimeout(suggestTimer);
    suggestAbort?.abort();
    clearSuggestions();
  }

  function renderSuggestions(): void {
    if (!suggestionsList) return;
    const houseNumber = houseNumberFromStreet(streetField.value);
    suggestionsList.innerHTML = '';
    suggestions.forEach((suggestion, index) => {
      const item = document.createElement('li');
      item.id = `est-address-option-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === activeIndex));
      item.dataset.index = String(index);
      const exact = suggestion.kind === 'address' && labelHasHouseNumber(suggestion.label, houseNumber);
      const label = document.createElement('span');
      label.className = 'address-suggestions__label';
      label.textContent = suggestion.label;
      const badge = document.createElement('span');
      badge.className = `address-suggestions__badge ${exact ? 'address-suggestions__badge--exact' : ''}`;
      badge.textContent = exact ? 'Exact address' : 'Street match';
      item.append(label, badge);
      item.addEventListener('pointerdown', (event) => {
        // Pointer-down covers touch and mouse; firing before the input blurs
        // means the tap reliably selects the suggestion on mobile.
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

  // ── Method isolation ──────────────────────────────────────────────────────
  function invalidateManual(): void {
    manualCandidate = null;
    manualConfirmed = null;
    if (method === 'manual') {
      if (confirmedCard) confirmedCard.hidden = true;
      if (mapCard) mapCard.hidden = true;
    }
  }

  function invalidateGps(): void {
    gpsCandidate = null;
    gpsConfirmed = null;
    gpsParts = emptyParts();
  }

  /** Any manual interaction switches the active method back to manual. */
  function ensureManualMode(): void {
    if (methodIsGps()) {
      cancelSuggestions();
      invalidateGps();
      hidePermissionPanel();
    }
    setMethod('manual');
    if (mapCard) mapCard.hidden = true;
    if (confirmedCard) confirmedCard.hidden = true;
    setState('typing');
    emit();
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
    applyingResolved = true;
    try {
      fillField(cityInput, resolved.city);
      fillField(stateInput, resolved.state);
      fillField(zipInput, resolved.zip ?? zipFromLabel(label) ?? undefined);
    } finally {
      applyingResolved = false;
    }
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

  function showManualCandidate(resolved: ResolvedCandidate): void {
    setMethod('manual');
    manualCandidate = resolved;
    clearSuggestions();
    if (resolved.zip) fillField(zipInput, resolved.zip);
    settleDestinationValues();
    if (mapCard) mapCard.hidden = false;
    if (confirmedCard) confirmedCard.hidden = true;
    setState('resolved');
    setStatus('Address found — confirm your location on the map.', 'success');
    void showMap(resolved);
    confirmButton?.focus();
  }

  function exactResolveFailed(): void {
    manualCandidate = null;
    manualConfirmed = null;
    if (confirmedCard) confirmedCard.hidden = true;
    if (mapCard) mapCard.hidden = true;
    setState('unresolved');
    setStatus(
      "We couldn't pinpoint this address. You can still request your cleaning, and we'll confirm the location.",
      'error',
    );
    emit();
  }

  // ── GPS permission guidance ───────────────────────────────────────────────
  function hidePermissionPanel(): void {
    if (permissionPanel) permissionPanel.hidden = true;
  }

  function showPermissionHelp(reason: PermissionReason): void {
    if (!permissionPanel) return;
    const copy: Record<PermissionReason, { title: string; message: string; steps: string[]; retryNote: boolean }> = {
      denied: {
        title: 'Location access is off.',
        message:
          'Your browser blocked location for this page. Turn it back on in your settings, then return here and try again.',
        steps: [
          'iPhone Safari: Settings → Privacy & Security → Location Services → Safari Websites → Allow. Also allow Location Services itself.',
          'Android Chrome: tap the lock icon next to the address bar → Permissions → Location → Allow. Make sure Location is on in your device quick settings.',
          'Desktop browsers: click the lock/tune icon next to the address and allow Location, then reload if asked.',
        ],
        retryNote: true,
      },
      unavailable: {
        title: "We couldn't get your location.",
        message: 'Device location services may be turned off, or your signal may be too weak right now.',
        steps: [
          'iPhone: Settings → Privacy & Security → Location Services → turn on Location Services.',
          'Android: swipe down and turn on Location, then check Settings → Location.',
          'Move near a window or outside for a clearer signal, then try again.',
        ],
        retryNote: false,
      },
      timeout: {
        title: 'Location is taking too long.',
        message: "We couldn't get a location fix in time. Move somewhere with a clearer signal and try again, or enter your address manually.",
        steps: [],
        retryNote: false,
      },
      unsupported: {
        title: "Location sharing isn't supported here.",
        message: 'This browser cannot share your location. Enter your address manually and we will confirm the property with you.',
        steps: [],
        retryNote: false,
      },
    };
    const entry = copy[reason];
    if (permissionTitle) permissionTitle.textContent = entry.title;
    if (permissionMessage) permissionMessage.textContent = entry.message;
    if (permissionSteps) {
      permissionSteps.innerHTML = '';
      for (const step of entry.steps) {
        const item = document.createElement('li');
        item.textContent = step;
        permissionSteps.appendChild(item);
      }
      permissionSteps.hidden = entry.steps.length === 0;
    }
    if (permissionRetryNote) permissionRetryNote.hidden = !entry.retryNote;
    permissionPanel.hidden = false;
  }

  function openManualSection(): void {
    if (manualDetails) manualDetails.open = true;
    ensureManualMode();
    streetField.focus();
  }

  async function handleGpsPosition(position: GeolocationPosition): Promise<void> {
    const { latitude, longitude, accuracy } = position.coords;
    const poorAccuracy = Number.isFinite(accuracy) && accuracy > GPS_ACCURACY_LIMIT_METERS;

    // GPS mode: the manual destination is invalidated and its values stay
    // isolated. Only this device pin (and the fresh reverse result below) can
    // become the submitted destination.
    setMethod('gps');
    cancelSuggestions();
    invalidateManual();
    hidePermissionPanel();
    gpsParts = emptyParts();
    if (confirmedCard) confirmedCard.hidden = true;

    gpsCandidate = {
      label: 'Current location from your device',
      lat: latitude,
      lng: longitude,
      source: 'gps',
      adjusted: false,
    };
    if (mapCard) mapCard.hidden = false;
    setState('gps');
    void showMap(gpsCandidate);
    setStatus(
      poorAccuracy
        ? `Your location is only accurate to about ${Math.round(accuracy)} m — check the pin and add the address if needed.`
        : 'We found your location — looking up the address…',
      'info',
    );

    try {
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'reverse', lat: latitude, lng: longitude }),
      });
      if (method !== 'gps') return; // a manual edit superseded this lookup
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: ResolveResult };
      if (response.ok && data.ok && data.result) {
        const result = data.result;
        gpsParts = {
          street:
            result.precise === true && !poorAccuracy
              ? streetLineFromLabel(result.label ?? '', result.city, result.state, result.zip ?? undefined)
              : '',
          unit: '',
          city: result.city ?? '',
          state: result.state ?? '',
          zip: result.zip ?? zipFromLabel(result.label) ?? '',
        };
        if (gpsCandidate) {
          gpsCandidate = {
            ...gpsCandidate,
            label: gpsParts.street ? result.label ?? 'Current location from your device' : 'Current location from your device',
            ...(gpsParts.zip ? { zip: gpsParts.zip } : {}),
            ...(gpsParts.city ? { city: gpsParts.city } : {}),
            ...(gpsParts.state ? { state: gpsParts.state } : {}),
          };
        }
        if (gpsParts.street) {
          setStatus('We found this address — confirm this is the property you want cleaned.', 'info');
        } else {
          setStatus(
            poorAccuracy
              ? 'Your location is approximate — check the pin, add the address if needed, then confirm.'
              : "We couldn't match your location to an exact street address — check the pin, add the address if needed, then confirm.",
            'info',
          );
        }
        confirmButton?.focus();
        return;
      }
      setStatus(
        "We couldn't look up the address from your location — check the pin, then confirm your map location.",
        'info',
      );
    } catch {
      if (method !== 'gps') return;
      setStatus(
        'We found your location, but the address lookup is unavailable — check the pin, then confirm your map location.',
        'info',
      );
    }
  }

  // ── GPS permission ────────────────────────────────────────────────────────
  /**
   * Progressive enhancement: when the Permissions API is available, check the
   * CURRENT geolocation permission before asking. A browser that already
   * reports 'denied' cannot show its native prompt again, so the recovery
   * panel is shown immediately instead of a request that is guaranteed to
   * fail. Unsupported browsers fall back to the plain Geolocation API call,
   * which is the only universally supported behavior.
   */
  async function geolocationPermission(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
    try {
      const permissions = navigator.permissions;
      if (!permissions?.query) return 'unknown';
      const status = await permissions.query({ name: 'geolocation' as PermissionName });
      return status.state === 'granted' || status.state === 'prompt' || status.state === 'denied'
        ? status.state
        : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function beginLocationRequest(): void {
    hidePermissionPanel();
    setState('locating');
    setStatus('Getting your location…', 'info');
    navigator.geolocation.getCurrentPosition(
      (position) => void handleGpsPosition(position),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) showPermissionHelp('denied');
        else if (error.code === error.POSITION_UNAVAILABLE) showPermissionHelp('unavailable');
        else showPermissionHelp('timeout');
        setState('permission');
        setStatus(
          error.code === error.PERMISSION_DENIED
            ? 'Location access is off — see the steps below, or enter your address manually.'
            : "We couldn't get your location — see the steps below, or enter your address manually.",
          'info',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function useCurrentLocation(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      showPermissionHelp('unsupported');
      setStatus('Your browser does not support location sharing — enter your address manually.', 'info');
      return;
    }
    void (async () => {
      const permission = await geolocationPermission();
      if (permission === 'denied') {
        showPermissionHelp('denied');
        setState('permission');
        setStatus('Location access is off — see the steps below, or enter your address manually.', 'info');
        return;
      }
      beginLocationRequest();
    })();
  }

  // ── Manual resolution ─────────────────────────────────────────────────────
  async function requestResolvedAddress(query: string): Promise<void> {
    cancelSuggestions();
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
      if (methodIsGps()) return; // manual entry was abandoned mid-flight
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
        if (resolved && data.result.precise === true) {
          showManualCandidate(resolved);
          return;
        }
      }
      exactResolveFailed();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      if (methodIsGps()) return;
      exactResolveFailed();
    }
  }

  async function chooseSuggestion(index: number): Promise<void> {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    clearSuggestions();
    ensureManualMode();
    const houseNumber = houseNumberFromStreet(streetField.value);
    const exactSuggestion =
      suggestion.kind === 'address' && labelHasHouseNumber(suggestion.label, houseNumber);

    if (exactSuggestion) {
      const candidate: ResolvedCandidate = {
        label: suggestion.label,
        lat: suggestion.lat ?? Number.NaN,
        lng: suggestion.lng ?? Number.NaN,
        source: 'mapmap',
        adjusted: false,
      };
      if (isPlausibleCoordinate(candidate.lat, candidate.lng)) {
        showManualCandidate(candidate);
        return;
      }
    }
    // Street-level/POI results are never precise: resolve the full address.
    await requestResolvedAddress(composeQuery());
  }

  async function requestSuggestions(query: string): Promise<void> {
    suggestAbort?.abort();
    suggestAbort = new AbortController();
    const seq = searchSeq;
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
      if (seq !== searchSeq || methodIsGps()) return;
      if (response.status === 503) {
        clearSuggestions();
        setState('unavailable');
        setStatus(
          'Address suggestions are not connected right now — press Find My Address or continue with your ZIP.',
          'info',
        );
        return;
      }
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        suggestions?: GeocodeSuggestion[];
        needsLocation?: boolean;
      };
      if (seq !== searchSeq || methodIsGps()) return;
      if (!response.ok || !data.ok || !Array.isArray(data.suggestions)) {
        throw new Error('provider_failed');
      }
      if (manualCandidate || manualConfirmed) return; // never clobber a resolved choice
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
      if (seq !== searchSeq || methodIsGps()) return;
      clearSuggestions();
      setState('idle');
      setStatus(
        'Address lookup is unavailable right now — press Find My Address or continue with your ZIP.',
        'info',
      );
    }
  }

  async function manualResolve(): Promise<void> {
    ensureManualMode();
    const street = streetField.value.trim();
    if (street.length < 5) {
      setStatus('Enter your street address first, then press Find My Address.', 'error');
      streetField.focus();
      return;
    }
    await requestResolvedAddress(composeQuery());
  }

  // ── Map + confirmation ────────────────────────────────────────────────────
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
          if (!marker) return;
          const position = marker.getLngLat();
          const active = methodIsGps() ? gpsCandidate : manualCandidate;
          if (!active) return;
          const updated = { ...active, lat: position.lat, lng: position.lng, adjusted: true };
          if (methodIsGps()) gpsCandidate = updated;
          else manualCandidate = updated;
          const confirmed = activeConfirmed();
          if (confirmed) {
            const nextConfirmed = { ...confirmed, lat: position.lat, lng: position.lng, adjusted: true };
            if (methodIsGps()) gpsConfirmed = nextConfirmed;
            else manualConfirmed = nextConfirmed;
            emit();
          }
          setTravelNote('Pin moved — travel will use this corrected destination.');
          setStatus('Pin adjusted. Confirm to use this corrected destination.', 'info');
        });
      }
      window.requestAnimationFrame(() => map?.resize());
    } catch {
      mapFallback?.removeAttribute('hidden');
    }
  }

  function confirmLocation(): void {
    if (methodIsGps()) {
      if (!gpsCandidate) return;
      // A reliable ZIP from reverse geocoding is preserved automatically; when
      // there is none, coverage and travel use the confirmed coordinates and
      // the address is confirmed personally. No ZIP is ever fabricated.
      const zip = gpsParts.zip;
      gpsConfirmed = {
        label: gpsCandidate.label || 'Current location from your device',
        street: gpsParts.street,
        lat: gpsCandidate.lat,
        lng: gpsCandidate.lng,
        ...(zip ? { zip } : {}),
        ...(gpsParts.city ? { city: gpsParts.city } : {}),
        ...(gpsParts.state ? { state: gpsParts.state } : {}),
        source: 'gps',
        ...(gpsCandidate.adjusted ? { adjusted: true } : {}),
        confirmedAt: new Date().toISOString(),
      };
      if (mapCard) mapCard.hidden = false;
      if (confirmedCard) confirmedCard.hidden = false;
      if (confirmedLabel) confirmedLabel.textContent = formatLocationLine(gpsConfirmed);
      setTravelNote(
        gpsParts.street
          ? 'Travel will be calculated from our base to this confirmed pin when your price is prepared.'
          : 'Travel and coverage use this confirmed map location; we will confirm the exact street address personally.',
      );
      setState('confirmed');
      setStatus('Destination confirmed. We will calculate travel to this exact location.', 'success');
      emit();
      return;
    }

    if (!manualCandidate) return;
    const streetText = streetField.value.trim();
    manualConfirmed = {
      label: manualCandidate.label,
      street: streetText || streetLineFromLabel(manualCandidate.label),
      ...(unitInput?.value.trim() ? { unit: unitInput.value.trim() } : {}),
      lat: manualCandidate.lat,
      lng: manualCandidate.lng,
      ...(manualCandidate.zip || zipInput?.value.trim()
        ? { zip: manualCandidate.zip ?? zipInput?.value.trim() ?? '' }
        : {}),
      ...(manualCandidate.city || cityInput?.value.trim()
        ? { city: manualCandidate.city ?? cityInput?.value.trim() ?? '' }
        : {}),
      ...(manualCandidate.state || stateInput?.value
        ? { state: manualCandidate.state ?? stateInput?.value ?? '' }
        : {}),
      source: manualCandidate.source,
      ...(manualCandidate.adjusted ? { adjusted: true } : {}),
      confirmedAt: new Date().toISOString(),
    };
    settleDestinationValues();
    if (mapCard) mapCard.hidden = false;
    if (confirmedCard) confirmedCard.hidden = false;
    if (confirmedLabel) confirmedLabel.textContent = formatLocationLine(manualConfirmed);
    setTravelNote('Travel will be calculated from our base to this confirmed pin when your price is prepared.');
    setState('confirmed');
    setStatus('Destination confirmed. We will calculate travel to this exact location.', 'success');
    emit();
  }

  function startChange(): void {
    if (methodIsGps()) {
      invalidateGps();
      if (mapCard) mapCard.hidden = true;
      if (confirmedCard) confirmedCard.hidden = true;
      openManualSection();
      setStatus('Edit the address or pick a different suggestion.', 'info');
      return;
    }
    invalidateManual();
    if (mapCard) mapCard.hidden = true;
    setStatus('Edit the address or pick a different suggestion.', 'info');
    streetField.focus();
    streetField.select();
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  const lastFieldValues = new WeakMap<HTMLInputElement | HTMLSelectElement, string>();
  function settleDestinationValues(): void {
    for (const field of [cityInput, stateInput, zipInput]) {
      if (field) lastFieldValues.set(field, field.value);
    }
  }
  function watchDestinationField(field: HTMLInputElement | HTMLSelectElement | null): void {
    if (!field) return;
    lastFieldValues.set(field, field.value);
    field.addEventListener('change', () => {
      const previous = lastFieldValues.get(field) ?? '';
      lastFieldValues.set(field, field.value);
      if (previous === field.value) return;
      if (applyingResolved) return;
      if (method === 'manual') {
        if (manualCandidate || manualConfirmed) {
          invalidateManual();
          emit();
        }
        if (streetField.value.trim().length >= MIN_SUGGEST_LENGTH) {
          window.clearTimeout(suggestTimer);
          suggestTimer = window.setTimeout(() => void requestSuggestions(composeQuery()), SUGGEST_DEBOUNCE_MS);
        }
      } else {
        // Editing manual fields while GPS is active switches back to manual.
        ensureManualMode();
        if (streetField.value.trim().length >= MIN_SUGGEST_LENGTH) {
          window.clearTimeout(suggestTimer);
          suggestTimer = window.setTimeout(() => void requestSuggestions(composeQuery()), SUGGEST_DEBOUNCE_MS);
        }
      }
    });
  }
  watchDestinationField(cityInput);
  watchDestinationField(stateInput);
  watchDestinationField(zipInput);

  streetField.addEventListener('input', () => {
    if (methodIsGps()) ensureManualMode();
    else if (manualCandidate || manualConfirmed) {
      invalidateManual();
      emit();
    } else {
      setState('typing');
    }
    window.clearTimeout(suggestTimer);
    const query = composeQuery();
    if (streetField.value.trim().length < MIN_SUGGEST_LENGTH) {
      clearSuggestions();
      setState('idle');
      setStatus('Start typing your street address — suggestions appear as you type.', 'info');
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
    window.setTimeout(() => clearSuggestions(), 150);
  });

  resolveButton?.addEventListener('click', () => void manualResolve());
  gpsButton?.addEventListener('click', () => useCurrentLocation());
  gpsRetryButton?.addEventListener('click', () => useCurrentLocation());
  manualOpenButton?.addEventListener('click', () => openManualSection());
  confirmButton?.addEventListener('click', confirmLocation);
  changeButton?.addEventListener('click', startChange);

  unitInput?.addEventListener('change', () => {
    if (method === 'manual' && manualConfirmed) {
      const next: ConfirmedLocation = { ...manualConfirmed };
      const unit = unitInput.value.trim();
      if (unit) next.unit = unit;
      else delete next.unit;
      manualConfirmed = next;
      if (confirmedLabel) confirmedLabel.textContent = formatLocationLine(manualConfirmed);
      emit();
    }
  });

  setMethod('manual');
  setState('idle');

  return {
    getLocation: () => activeConfirmed(),
    getSubmission: () => {
      if (methodIsGps()) {
        return {
          method,
          location: gpsConfirmed,
          street: gpsParts.street,
          unit: '',
          city: gpsParts.city,
          state: gpsParts.state,
          zip: gpsParts.zip,
        };
      }
      return {
        method,
        location: manualConfirmed,
        street: streetField.value.trim(),
        unit: unitInput?.value.trim() ?? '',
        city: cityInput?.value.trim() ?? '',
        state: stateInput?.value ?? 'FL',
        zip: zipInput?.value.trim() ?? '',
      };
    },
    reset: () => {
      cancelSuggestions();
      invalidateManual();
      invalidateGps();
      hidePermissionPanel();
      // Start Over always returns to the closed-by-default manual section.
      if (manualDetails) manualDetails.open = false;
      setMethod('manual');
      if (confirmedCard) confirmedCard.hidden = true;
      if (mapCard) mapCard.hidden = true;
      if (mapFallback) mapFallback.setAttribute('hidden', '');
      setState('idle');
      setStatus('Start typing your street address — suggestions appear as you type.', 'info');
      emit();
    },
    focus: () => streetField.focus(),
    focusManual: () => openManualSection(),
  };
}
