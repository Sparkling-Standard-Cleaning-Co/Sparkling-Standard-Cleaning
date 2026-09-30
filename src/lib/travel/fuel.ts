// Gas price provider abstraction — server-side only.
//
// Preferred source: U.S. Energy Information Administration weekly Gulf Coast
// retail regular gasoline price (series EMM_EPMR_PTE_R30_DPG). This is a
// REGIONAL REFERENCE, not a Pensacola pump price, and is never displayed to
// customers. If the feed fails, the configured reference price is used and the
// fallback is logged — a customer quote never fails because of EIA downtime
// (directive §32).

export interface FuelPriceResult {
  pricePerGallon: number;
  source: 'eia_live' | 'configured_reference';
  asOf?: string;
}

export interface FuelPriceProvider {
  readonly id: string;
  fetchGulfCoastPrice(signal?: AbortSignal): Promise<FuelPriceResult>;
}

const EIA_URL =
  'https://api.eia.gov/v2/petroleum/pri/gnd/data/?frequency=weekly&data[0]=value' +
  '&facets[series][]=EMM_EPMR_PTE_R30_DPG&sort[0][column]=period&sort[0][direction]=desc&length=1';

export class EiaFuelPriceProvider implements FuelPriceProvider {
  readonly id = 'eia_gulf_coast';
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, timeoutMs = 5000) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async fetchGulfCoastPrice(): Promise<FuelPriceResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${EIA_URL}&api_key=${encodeURIComponent(this.apiKey)}`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`EIA HTTP ${response.status}`);
      const data = (await response.json()) as {
        response?: { data?: Array<{ value?: number | string; period?: string }> };
      };
      const row = data.response?.data?.[0];
      const price = typeof row?.value === 'number' ? row.value : Number(row?.value);
      if (!Number.isFinite(price) || price <= 0) throw new Error('EIA returned no usable price');
      return {
        pricePerGallon: price,
        source: 'eia_live',
        ...(row?.period ? { asOf: row.period } : {}),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createFuelPriceProvider(apiKey: string | undefined): FuelPriceProvider | null {
  const key = apiKey?.trim();
  if (!key) return null;
  return new EiaFuelPriceProvider(key);
}

/** Resolves the best available gas price, falling back safely. */
export async function resolveGasPrice(
  provider: FuelPriceProvider | null,
  referencePrice: number,
): Promise<FuelPriceResult> {
  if (!provider) {
    return { pricePerGallon: referencePrice, source: 'configured_reference' };
  }
  try {
    return await provider.fetchGulfCoastPrice();
  } catch {
    // Never fail a customer quote because the fuel feed is down.
    return { pricePerGallon: referencePrice, source: 'configured_reference' };
  }
}
