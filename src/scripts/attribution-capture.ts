// Captures inbound campaign attribution (UTMs, referrer, ad click ids) into
// localStorage for lead records. Runs on every page; stores metadata only.

import { captureAttribution } from '../lib/attribution';

captureAttribution();
