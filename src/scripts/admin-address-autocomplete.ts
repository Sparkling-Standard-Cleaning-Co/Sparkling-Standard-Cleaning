// Admin-only Google Places address autocomplete.
//
// The public estimator keeps its existing workflow. This module enhances admin
// address fields that opt in with data-admin-address and populates the related
// city/state/ZIP/coordinates fields in the same block. If Google Places is
// unavailable, it falls back to the existing address lookup and never marks
// free text as a verified Google address.

interface AddressSuggestion {
  id: string;
  label: string;
  mainText: string;
  secondaryText: string;
  provider: 'google' | 'lookup';
  prediction?: any;
}

interface AddressDetails {
  placeId: string;
  formattedAddress: string;
  line1: string;
  unit: string;
  city: string;
  county: string;
  state: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  precise: boolean;
  supportedState: boolean;
}

type GoogleMaps = {
  maps?: {
    importLibrary?: (name: string) => Promise<Record<string, unknown>>;
  };
};

const GOOGLE_SCRIPT_ID = 'ss-admin-google-maps';
let googleLoading: Promise<any | null> | null = null;

function field<T extends HTMLInputElement | HTMLSelectElement>(block: HTMLElement, name: string): T | null {
  return (
    block.querySelector<T>(`[data-admin-address-${name}]`) ??
    block.querySelector<T>(`[name="${name}"]`)
  );
}

function hiddenField(block: HTMLElement, name: string): HTMLInputElement | null {
  return block.querySelector<HTMLInputElement>(`[data-admin-address-${name}]`);
}

function statusNode(block: HTMLElement): HTMLElement | null {
  return block.querySelector<HTMLElement>('[data-admin-address-status]');
}

function setStatus(block: HTMLElement, message: string, kind: 'muted' | 'ok' | 'error' | 'loading' = 'muted'): void {
  const node = statusNode(block);
  if (!node) return;
  node.textContent = message;
  node.dataset.kind = kind;
  node.className = `admin-address-status admin-address-status--${kind}`;
}

function clearVerification(block: HTMLElement, message = ''): void {
  for (const name of ['lat', 'lng', 'precision', 'place-id', 'county', 'formatted']) {
    const input = hiddenField(block, name);
    if (input) input.value = '';
  }
  block.dataset.addressVerified = 'false';
  if (message) setStatus(block, message, 'muted');
}

function applyDetails(block: HTMLElement, details: AddressDetails, provider: 'google' | 'lookup'): void {
  if (!details.supportedState) {
    clearVerification(block);
    setStatus(block, `This address is in ${details.state || 'an unsupported state'}; service is limited to Florida and Alabama.`, 'error');
    return;
  }
  const line = field<HTMLInputElement>(block, 'addressLine1') ?? field<HTMLInputElement>(block, 'line1');
  const unit = field<HTMLInputElement>(block, 'addressUnit') ?? field<HTMLInputElement>(block, 'line2');
  const city = field<HTMLInputElement>(block, 'city');
  const state = field<HTMLInputElement | HTMLSelectElement>(block, 'state');
  const zip = field<HTMLInputElement>(block, 'postalCode') ?? field<HTMLInputElement>(block, 'zip');
  if (!line) return;
  const existingUnit = unit?.value.trim() ?? '';
  if (details.line1) line.value = details.line1;
  if (unit && details.unit && !existingUnit) unit.value = details.unit;
  if (city) city.value = details.city;
  if (state) state.value = details.state;
  if (zip) zip.value = details.postalCode;
  const lat = hiddenField(block, 'lat');
  const lng = hiddenField(block, 'lng');
  const precision = hiddenField(block, 'precision');
  const placeId = hiddenField(block, 'place-id');
  const county = hiddenField(block, 'county');
  const formatted = hiddenField(block, 'formatted');
  if (lat) lat.value = Number.isFinite(details.latitude) ? String(details.latitude) : '';
  if (lng) lng.value = Number.isFinite(details.longitude) ? String(details.longitude) : '';
  if (precision) precision.value = details.precise ? 'exact' : 'street';
  if (placeId) placeId.value = details.placeId;
  if (county) county.value = details.county;
  if (formatted) formatted.value = details.formattedAddress;
  const hasCoordinates = Boolean(lat?.value && lng?.value);
  block.dataset.addressVerified = hasCoordinates ? 'true' : 'false';
  setStatus(
    block,
    hasCoordinates
      ? provider === 'google'
        ? 'Google address selected and verified.'
        : 'Address verified with the address lookup service.'
      : 'Address selected, but no usable coordinates were returned.',
    hasCoordinates ? 'ok' : 'error',
  );
}

function mountMenu(input: HTMLInputElement): {
  menu: HTMLDivElement;
  render: (suggestions: AddressSuggestion[], query: string) => void;
  close: () => void;
} {
  const menu = document.createElement('div');
  menu.className = 'admin-address-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  menu.id = `admin-address-menu-${Math.random().toString(36).slice(2, 10)}`;
  document.body.appendChild(menu);
  input.setAttribute('aria-controls', menu.id);
  const reposition = (): void => {
    if (menu.hidden) return;
    const rect = input.getBoundingClientRect();
    const maxHeight = Math.min(320, window.innerHeight - rect.bottom - 12);
    menu.style.left = `${Math.max(8, rect.left)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.width = `${Math.max(240, rect.width)}px`;
    menu.style.maxHeight = `${Math.max(120, maxHeight)}px`;
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  const close = (): void => {
    menu.hidden = true;
    menu.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    delete menu.dataset.active;
  };
  const render = (suggestions: AddressSuggestion[], query: string): void => {
    menu.innerHTML = '';
    if (suggestions.length === 0) {
      menu.innerHTML = '<p class="admin-address-menu__empty">No matching addresses. You can still enter the address manually.</p>';
      menu.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      reposition();
      return;
    }
    const list = document.createElement('div');
    list.className = 'admin-address-menu__list';
    for (const [index, suggestion] of suggestions.entries()) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'admin-address-menu__option';
      option.id = `${menu.id}-option-${index}`;
      option.setAttribute('role', 'option');
      option.dataset.index = String(index);
      option.dataset.id = suggestion.id;
      option.dataset.provider = suggestion.provider;
      option.dataset.label = suggestion.label;
      option.innerHTML = `<span class="admin-address-menu__main">${escapeHtml(suggestion.mainText || suggestion.label)}</span><span class="admin-address-menu__secondary">${escapeHtml(suggestion.secondaryText || '')}</span>`;
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => {
        input.dispatchEvent(
          new CustomEvent('admin-address-select', {
            bubbles: true,
            detail: suggestion,
          }),
        );
        close();
      });
      list.appendChild(option);
    }
    const attribution = document.createElement('p');
    attribution.className = 'admin-address-menu__attribution';
    attribution.textContent = suggestions[0]?.provider === 'google' ? 'Powered by Google' : 'Address lookup';
    menu.appendChild(list);
    menu.appendChild(attribution);
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-autocomplete', 'list');
    menu.dataset.query = query;
    reposition();
  };
  return { menu, render, close };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function suggestionFromGoogle(prediction: any): AddressSuggestion {
  const label = String(prediction?.text?.text ?? prediction?.text ?? prediction?.mainText?.text ?? '').trim();
  return {
    id: String(prediction?.placeId ?? ''),
    label,
    mainText: String(prediction?.mainText?.text ?? label.split(',')[0] ?? '').trim(),
    secondaryText: String(prediction?.secondaryText?.text ?? label.split(',').slice(1).join(',') ?? '').trim(),
    provider: 'google',
    prediction,
  };
}

async function googlePlaces(): Promise<any | null> {
  if (!googleLoading) {
    googleLoading = (async () => {
      try {
        const existing = (window as unknown as { google?: GoogleMaps }).google;
        if (!existing?.maps) {
          const config = await fetch('/api/maps-browser-config', {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          if (!config.ok) return null;
          const data = (await config.json().catch(() => ({}))) as { ok?: boolean; key?: string };
          if (data.ok !== true || !data.key) return null;
          const existingScript = document.getElementById(GOOGLE_SCRIPT_ID);
          if (!existingScript) {
            await new Promise<void>((resolve, reject) => {
              const callback = '__ssAdminGoogleMapsReady';
              (window as unknown as Record<string, unknown>)[callback] = () => {
                delete (window as unknown as Record<string, unknown>)[callback];
                resolve();
              };
              const script = document.createElement('script');
              script.id = GOOGLE_SCRIPT_ID;
              script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(String(data.key))}&v=weekly&loading=async&libraries=places&callback=${callback}`;
              script.async = true;
              script.defer = true;
              script.onerror = () => reject(new Error('maps_script_failed'));
              document.head.appendChild(script);
            });
          }
        }
        const maps = (window as unknown as { google?: GoogleMaps }).google?.maps;
        if (!maps?.importLibrary) return null;
        return await maps.importLibrary('places');
      } catch {
        return null;
      }
    })();
  }
  return googleLoading;
}
async function fetchGoogleSuggestions(
  query: string,
  branchId: string,
  sessionToken: string,
): Promise<AddressSuggestion[] | null> {
  const places = await googlePlaces();
  if (!places) return null;
  try {
    const suggestionApi = places.AutocompleteSuggestion as any;
    if (!suggestionApi?.fetchAutocompleteSuggestions) return null;
    const bias =
      branchId === 'branch_tampa'
        ? { center: { lat: 27.9506, lng: -82.4572 }, radius: 50000 }
        : { center: { lat: 30.4213, lng: -87.2169 }, radius: 50000 };
    const result = await suggestionApi.fetchAutocompleteSuggestions({
      input: query,
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
      locationBias: bias,
      ...(sessionToken ? { sessionToken } : {}),
    });
    const rows = (result?.suggestions ?? []) as any[];
    return rows
      .map(suggestionFromGoogle)
      .filter((row) => row.id && row.label)
      .slice(0, 5);
  } catch {
    return null;
  }
}

async function fetchLookupSuggestions(query: string, state: string): Promise<AddressSuggestion[]> {
  try {
    const response = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'suggest', query, ...(state ? { state } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const data = (await response.json().catch(() => ({}))) as {
      suggestions?: Array<{ id?: string; label?: string; kind?: string }>;
    };
    return (data.suggestions ?? [])
      .filter((row) => row.id && row.label)
      .slice(0, 5)
      .map((row) => {
        const label = String(row.label ?? '');
        return {
          id: String(row.id),
          label,
          mainText: label.split(',')[0]?.trim() ?? label,
          secondaryText: label.split(',').slice(1).join(',').trim(),
          provider: 'lookup' as const,
        };
      });
  } catch {
    return [];
  }
}

async function resolveGoogleSelection(places: any, suggestion: AddressSuggestion, sessionToken: string): Promise<AddressDetails | null> {
  try {
    let prediction = suggestion.prediction;
    if (!prediction?.toPlace) {
      const predictionApi = places.AutocompleteSuggestion as any;
      if (!predictionApi?.fetchAutocompleteSuggestions) return null;
      const result = await predictionApi.fetchAutocompleteSuggestions({
        input: suggestion.label,
        includedRegionCodes: ['us'],
        ...(sessionToken ? { sessionToken } : {}),
      });
      const rows = (result?.suggestions ?? []) as any[];
      const match = rows.find((row) => String(row?.placePrediction?.placeId ?? '') === suggestion.id) ?? rows[0];
      prediction = match?.placePrediction;
    }
    if (!prediction?.toPlace) return null;
    const place = prediction.toPlace();
    await place.fetchFields({
      fields: ['id', 'formattedAddress', 'addressComponents', 'location'],
    });
    const components = (place.addressComponents ?? []) as Array<{ longText?: string; shortText?: string; types?: string[] }>;
    const get = (type: string): string => {
      const component = components.find((entry) => (entry.types ?? []).includes(type));
      return String(component?.longText ?? component?.shortText ?? '').trim();
    };
    const streetNumber = get('street_number');
    const route = get('route');
    const line1 = [streetNumber, route].filter(Boolean).join(' ').trim();
    const location = place.location;
    const latitude = typeof location?.lat === 'function' ? location.lat() : Number(location?.lat);
    const longitude = typeof location?.lng === 'function' ? location.lng() : Number(location?.lng);
    const state = get('administrative_area_level_1').toUpperCase();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      placeId: String(place.id ?? suggestion.id),
      formattedAddress: String(place.formattedAddress ?? suggestion.label),
      line1: line1 || String(place.formattedAddress ?? suggestion.label).split(',')[0]?.trim() || suggestion.label,
      unit: get('subpremise'),
      city: get('locality') || get('postal_town') || get('sublocality_level_1') || get('sublocality'),
      county: get('administrative_area_level_2'),
      state,
      postalCode: get('postal_code'),
      latitude,
      longitude,
      precise: Boolean(streetNumber && route),
      supportedState: state === 'FL' || state === 'AL',
    };
  } catch {
    return null;
  }
}

async function resolveLookupSelection(suggestion: AddressSuggestion): Promise<AddressDetails | null> {
  try {
    const response = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'resolve-id', id: suggestion.id }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as {
      result?: { label?: string; lat?: number; lng?: number; precise?: boolean; city?: string; state?: string; zip?: string };
    };
    const result = data.result;
    if (!result || !Number.isFinite(Number(result.lat)) || !Number.isFinite(Number(result.lng))) return null;
    const label = String(result.label ?? suggestion.label);
    const state = String(result.state ?? '').toUpperCase();
    return {
      placeId: '',
      formattedAddress: label,
      line1: label.split(',')[0]?.trim() || label,
      unit: '',
      city: String(result.city ?? ''),
      county: '',
      state,
      postalCode: String(result.zip ?? ''),
      latitude: Number(result.lat),
      longitude: Number(result.lng),
      precise: result.precise === true,
      supportedState: state === 'FL' || state === 'AL',
    };
  } catch {
    return null;
  }
}

function setupBlock(block: HTMLElement): void {
  if (block.dataset.adminAddressReady === 'true') {
    const lat = hiddenField(block, 'lat')?.value;
    const lng = hiddenField(block, 'lng')?.value;
    if (lat && lng && block.dataset.addressVerified !== 'true') {
      block.dataset.addressVerified = 'true';
      setStatus(block, 'Saved coordinates on file. Edit the address to re-verify it.', 'muted');
    }
    return;
  }
  const input =
    block.querySelector<HTMLInputElement>('[data-admin-address-input]') ??
    field<HTMLInputElement>(block, 'addressLine1') ??
    field<HTMLInputElement>(block, 'line1');
  if (!input) return;
  block.dataset.adminAddressReady = 'true';
  block.dataset.addressVerified = block.dataset.addressVerified ?? 'false';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  const { menu, render, close } = mountMenu(input);
  let sessionToken = '';
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let suggestions: AddressSuggestion[] = [];
  let activeIndex = -1;
  let selectedLabel = '';
  const branchField = block.querySelector<HTMLSelectElement>('[data-admin-address-branch]') ?? block.closest('form')?.querySelector<HTMLSelectElement>('[name="branchId"]') ?? null;
  const stateField = field<HTMLInputElement | HTMLSelectElement>(block, 'state');
  const unitField = field<HTMLInputElement>(block, 'addressUnit') ?? field<HTMLInputElement>(block, 'line2');
  const getPlaces = async (): Promise<any | null> => googlePlaces();

  const updateActive = (): void => {
    for (const option of menu.querySelectorAll<HTMLElement>('[role="option"]')) {
      const index = Number(option.dataset.index);
      const active = index === activeIndex;
      option.dataset.active = active ? 'true' : 'false';
      if (active) {
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  const select = async (suggestion: AddressSuggestion): Promise<void> => {
    close();
    setStatus(block, 'Resolving the selected address…', 'loading');
    const places = suggestion.provider === 'google' ? await getPlaces() : null;
    const details =
      suggestion.provider === 'google' && places
        ? await resolveGoogleSelection(places, suggestion, sessionToken)
        : await resolveLookupSelection(suggestion);
    if (!details) {
      clearVerification(block, 'The address lookup did not return usable coordinates. Select another suggestion or enter the address manually.');
      setStatus(block, 'The address lookup did not return usable coordinates. Select another suggestion or enter the address manually.', 'error');
      return;
    }
    applyDetails(block, details, suggestion.provider);
    selectedLabel = suggestion.label;
    if (suggestion.provider === 'google') {
      sessionToken = '';
    }
  };

  input.addEventListener('input', () => {
    const value = input.value.trim();
    if (block.dataset.addressVerified === 'true' && value !== selectedLabel) {
      clearVerification(block, 'Address changed — select a suggestion to verify the new address, or continue with manual entry.');
      selectedLabel = '';
    }
    if (value.length < 4) {
      close();
      setStatus(block, '', 'muted');
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const requestSeq = ++seq;
      const current = input.value.trim();
      if (current.length < 4) return;
      setStatus(block, 'Searching addresses…', 'loading');
      const places = await getPlaces();
      if (requestSeq !== seq) return;
      let rows: AddressSuggestion[] | null = null;
      if (places && !sessionToken) {
        try {
          const tokenApi = (places as any).AutocompleteSessionToken;
          if (tokenApi) sessionToken = String(new tokenApi());
        } catch {
          sessionToken = '';
        }
      }
      if (places) {
        rows = await fetchGoogleSuggestions(current, branchField?.value ?? '', sessionToken);
      }
      if (requestSeq !== seq) return;
      if (!rows || rows.length === 0) {
        rows = await fetchLookupSuggestions(current, stateField?.value ?? '');
      }
      if (requestSeq !== seq) return;
      suggestions = rows ?? [];
      activeIndex = -1;
      if (suggestions.length === 0) {
        close();
        setStatus(block, 'No address suggestions matched. Enter the address manually or try a different search.', 'muted');
        return;
      }
      render(suggestions, current);
      setStatus(block, `${suggestions.length} address suggestion${suggestions.length === 1 ? '' : 's'} available.`, 'muted');
    }, 260);
  });

  input.addEventListener('keydown', (event) => {
    if (menu.hidden) {
      if (event.key === 'ArrowDown' && suggestions.length) {
        menu.hidden = false;
        render(suggestions, input.value.trim());
        activeIndex = 0;
        updateActive();
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      activeIndex = Math.min(suggestions.length - 1, activeIndex + 1);
      updateActive();
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      activeIndex = Math.max(0, activeIndex - 1);
      updateActive();
      event.preventDefault();
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const suggestion = suggestions[activeIndex];
      if (suggestion) void select(suggestion);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  });

  input.addEventListener('admin-address-select', (event) => {
    const suggestion = (event as CustomEvent<AddressSuggestion>).detail;
    if (suggestion) void select(suggestion);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => close(), 160);
  });

  for (const node of [input, field<HTMLInputElement>(block, 'city'), stateField, field<HTMLInputElement>(block, 'postalCode'), field<HTMLInputElement>(block, 'zip')]) {
    if (!node) continue;
    node.addEventListener('change', () => {
      if (block.dataset.addressVerified === 'true') {
        clearVerification(block, 'Address details changed — verify the new address with a suggestion.');
        selectedLabel = '';
      }
    });
  }
  if (unitField) {
    unitField.addEventListener('change', () => {
      const formatted = hiddenField(block, 'formatted');
      if (formatted && unitField.value.trim() && !formatted.value.includes(unitField.value.trim())) {
        formatted.value = `${formatted.value} ${unitField.value.trim()}`.trim();
      }
    });
  }
  branchField?.addEventListener('change', () => {
    if (block.dataset.addressVerified === 'true') {
      clearVerification(block, 'Branch changed — select the address again so the correct travel origin is used.');
      selectedLabel = '';
    }
  });

  block.addEventListener('admin-address-reset', () => {
    clearVerification(block, '');
    selectedLabel = '';
    close();
    setStatus(block, '', 'muted');
  });
  if (hiddenField(block, 'lat')?.value && hiddenField(block, 'lng')?.value) {
    block.dataset.addressVerified = 'true';
    setStatus(block, 'Saved coordinates on file. Edit the address to re-verify it.', 'muted');
  }
}

function scan(root: ParentNode = document): void {
  for (const block of root.querySelectorAll<HTMLElement>('[data-admin-address-block]')) setupBlock(block);
}

export function refreshAdminAddressFields(root: ParentNode = document): void {
  scan(root);
}

declare global {
  interface Window {
    refreshAdminAddressFields?: typeof refreshAdminAddressFields;
  }
}

if (typeof window !== 'undefined') {
  window.refreshAdminAddressFields = refreshAdminAddressFields;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan(), { once: true });
  } else {
    scan();
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) scan(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
