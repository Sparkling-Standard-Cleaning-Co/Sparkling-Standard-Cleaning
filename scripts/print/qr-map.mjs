// QR mapping — resolves every print QR asset through the authoritative registry
// (src/config/marketing-links.ts). Nothing here hand-writes a URL.
import fs from 'node:fs';
import { marketingLinks, qrAssets, linkUrl } from '../../src/config/marketing-links.ts';

export const SITE_URL = 'https://sparkling-standard.com';

/** Resolve a public/marketing/qr asset id to its registry link and exact URL. */
export function resolveQrAsset(qrAssetId) {
  const asset = qrAssets.find((entry) => entry.id === qrAssetId);
  if (!asset) throw new Error(`QR asset "${qrAssetId}" is not registered in marketing-links.ts.`);
  const link = marketingLinks.find((entry) => entry.id === asset.linkId);
  if (!link) throw new Error(`QR asset "${qrAssetId}" points at unknown link "${asset.linkId}".`);
  if (link.pending) throw new Error(`QR asset "${qrAssetId}" uses a pending link; never print a pending campaign.`);
  return {
    qrAssetId,
    linkId: link.id,
    url: linkUrl(link, SITE_URL),
    svgPath: `public/marketing/qr/${asset.id}.svg`,
    pngPath: `public/marketing/qr/${asset.id}.png`,
  };
}

/** Read the inline SVG markup for a QR asset (for HTML layouts). */
export function readQrSvg(qrAssetId) {
  const { svgPath } = resolveQrAsset(qrAssetId);
  const svg = fs.readFileSync(svgPath, 'utf8');
  return svg
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<svg /, '<svg class="qrsvg" preserveAspectRatio="xMidYMid meet" ');
}

/** Every QR asset used by the print suite, for verifiers and tests. */
export function printQrMappings() {
  const ids = [
    'business-card',
    'quarter-sheet',
    'door-hanger',
    'qr-estimate-card',
    'event-poster',
    'foam-board',
    'community-leave-behind',
    'realtor-packet',
  ];
  return ids.map((id) => resolveQrAsset(id));
}
