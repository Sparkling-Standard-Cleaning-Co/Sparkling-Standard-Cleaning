// Routing factory — selects the configured provider or reports that none is
// available. The estimator keeps working without routing (offline zone mode).

import {
  GoogleRoutesProvider,
  MapboxProvider,
  type RoutingProvider,
  type RoutingProviderConfig,
} from './provider.ts';

/** Optional offline fallback: straight-line distance × a road-factor estimate. */
export function straightLineMiles(origin: string, destination: string): number {
  const [lat1, lng1] = origin.split(',').map(Number);
  const [lat2, lng2] = destination.split(',').map(Number);
  if (
    lat1 === undefined || lng1 === undefined || lat2 === undefined || lng2 === undefined ||
    !Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)
  ) {
    return 0;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const straight = 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
  // 1.18 approximates real road distance on the Gulf Coast grid — used ONLY as
  // a last-resort fallback, always labeled as an estimate.
  return straight * 1.18;
}

export function createRoutingProvider(config: RoutingProviderConfig): RoutingProvider | null {
  const provider = config.provider?.trim().toLowerCase();
  const apiKey = config.apiKey?.trim();
  if (!provider || !apiKey) return null;
  switch (provider) {
    case 'google':
    case 'google_routes':
      return new GoogleRoutesProvider(apiKey, config.timeoutMs);
    case 'mapbox':
      return new MapboxProvider(apiKey, config.timeoutMs);
    default:
      return null;
  }
}
