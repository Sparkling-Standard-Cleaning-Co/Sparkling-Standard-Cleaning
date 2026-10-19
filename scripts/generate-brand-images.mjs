// Brand raster generation now lives in one place so every asset stays on the
// current circular logo. This alias keeps the historical command working:
//   node scripts/generate-brand-images.mjs
//
// The canonical generator is scripts/generate-logo-assets.mjs (social preview,
// favicons, PWA icons, logo marks).

import './generate-logo-assets.mjs';
