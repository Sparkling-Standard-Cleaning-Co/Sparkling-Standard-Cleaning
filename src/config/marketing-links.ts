// ─────────────────────────────────────────────────────────────────────────────
// Central marketing link registry — SINGLE SOURCE OF TRUTH for every inbound
// campaign URL (UTMs) used by the cleaning company.
//
// RULES (enforced by scripts/generate-marketing-links.mjs):
//  - UTMs are for INBOUND marketing links only. Never add them to internal
//    navigation, canonical URLs, sitemap entries, tel:/sms:/mailto: links, or
//    the review QR.
//  - Lowercase snake_case values only; no spaces, no uppercase, no PII.
//  - No manual Google Ads UTMs: Google Ads must use auto-tagging (gclid /
//    gbraid / wbraid / gad_*), which the site preserves untouched.
//  - Every definition must be unique — duplicate campaign definitions fail
//    verification.
//
// Generated documents (do not edit by hand):
//   docs/marketing/UTM-MASTER-LINKS.md
//   docs/marketing/UTM-MASTER-LINKS.csv
//   docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md
//   public/marketing/qr/*.svg | *.png | *-print.png
//
// The production origin comes from PUBLIC_SITE_URL at generation time. The
// owner-confirmed domain is the fallback, so committed docs and QR assets
// carry the real URLs even when no environment variable is set.
// ─────────────────────────────────────────────────────────────────────────────

/** Internal destination pages that campaign links may point at. */
export const destinations = {
  home: '/',
  houseCleaning: '/house-cleaning/',
  recurringCleaning: '/recurring-cleaning/',
  deepCleaning: '/deep-cleaning/',
  moveOut: '/move-in-move-out-cleaning/',
  str: '/short-term-rental-cleaning/',
  commercial: '/commercial-cleaning/',
  church: '/church-cleaning/',
  estimate: '/estimate/',
  contact: '/contact/',
  about: '/about/',
  serviceArea: '/service-area/',
  giftCertificates: '/gift-certificates/',
} as const;

export type DestinationPath = (typeof destinations)[keyof typeof destinations];

export type UtmParams = {
  source: string;
  medium: string;
  campaign: string;
  content?: string;
};

export type MarketingLink = {
  /** Stable, unique id (lowercase snake_case). */
  id: string;
  /** Human channel label (CSV "Channel"). */
  channel: string;
  /** Human campaign label (CSV "Campaign"). */
  campaign: string;
  /** Where the link lives (CSV "Placement"). */
  placement: string;
  /** Internal destination path from `destinations`. */
  path: DestinationPath;
  utm: UtmParams;
  /** What this link is for (CSV "Purpose"). */
  purpose: string;
  /** True when the owner must place this link/asset outside the repo. */
  manual: boolean;
  /** Exact owner action (CSV "Where Owner Must Paste It"). */
  whereToPaste: string;
  /**
   * Prepared but NOT active: the public profile/placement does not exist yet.
   * Pending links are listed separately and are never presented as ready.
   */
  pending?: boolean;
};

const CHANNEL = {
  gbp: 'Google Business Profile',
  bingPlaces: 'Bing Places',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  nextdoor: 'Nextdoor',
  pinterest: 'Pinterest',
  rumble: 'Rumble',
  gab: 'Gab',
  parler: 'Parler',
  x: 'X',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  alignable: 'Alignable',
  reddit: 'Reddit',
  yelp: 'Yelp',
  email: 'Email',
  sms: 'SMS',
  realtor: 'Realtor outreach',
  propertyManager: 'Property-manager outreach',
  apartment: 'Apartment outreach',
  strHost: 'Airbnb / STR host outreach',
  commercial: 'Commercial outreach',
  church: 'Church outreach',
  print: 'Print material',
  vehicle: 'Vehicle graphics',
  referral: 'Referral card',
  yardSign: 'Yard sign',
} as const;

export const marketingLinks: MarketingLink[] = [
  // ── Google Business Profile ────────────────────────────────────────────────
  {
    id: 'gbp_home',
    channel: CHANNEL.gbp,
    campaign: 'gbp',
    placement: 'Business profile → website field',
    path: destinations.home,
    utm: { source: 'google', medium: 'organic', campaign: 'gbp' },
    purpose: 'Identify visits that start from the Google Business Profile listing.',
    manual: true,
    whereToPaste: 'Google Business Profile → Edit profile → Contact → Website. Only after the GBP listing exists.',
    pending: true,
  },
  {
    id: 'gbp_estimate',
    channel: CHANNEL.gbp,
    campaign: 'gbp',
    placement: 'Business profile → appointment link',
    path: destinations.estimate,
    utm: { source: 'google', medium: 'organic', campaign: 'gbp', content: 'estimate' },
    purpose: 'Attribute GBP appointment-link clicks that go straight to the estimate flow.',
    manual: true,
    whereToPaste: 'Google Business Profile → Bookings/Appointment link (or the contact link if appointments are not enabled).',
    pending: true,
  },

  // ── Social profiles ────────────────────────────────────────────────────────
  {
    id: 'facebook_profile',
    channel: CHANNEL.facebook,
    campaign: 'profile',
    placement: 'Page website field',
    path: destinations.home,
    utm: { source: 'facebook', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute Facebook page visitors arriving through the website link.',
    manual: true,
    whereToPaste: 'Facebook Page → About → Website.',
    pending: false,
  },
  {
    id: 'facebook_recurring',
    channel: CHANNEL.facebook,
    campaign: 'recurring',
    placement: 'Recurring-cleaning community posts',
    path: destinations.recurringCleaning,
    utm: { source: 'facebook', medium: 'organic_social', campaign: 'recurring', content: 'community_post' },
    purpose: 'Track recurring-cleaning interest from neighborhood and community group posts.',
    manual: true,
    whereToPaste: 'Facebook post links when promoting weekly/biweekly cleaning.',
    pending: false,
  },
  {
    id: 'instagram_profile',
    channel: CHANNEL.instagram,
    campaign: 'profile',
    placement: 'Bio link',
    path: destinations.home,
    utm: { source: 'instagram', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute Instagram bio-link traffic.',
    manual: true,
    whereToPaste: 'Instagram → Edit profile → Website.',
    pending: true,
  },
  {
    id: 'instagram_estimate',
    channel: CHANNEL.instagram,
    campaign: 'profile',
    placement: 'Story / link sticker when pushing estimates',
    path: destinations.estimate,
    utm: { source: 'instagram', medium: 'organic_social', campaign: 'profile', content: 'story_estimate' },
    purpose: 'Track estimate starts from Instagram stories.',
    manual: true,
    whereToPaste: 'Instagram story link sticker when highlighting the instant estimate.',
    pending: true,
  },
  {
    id: 'tiktok_profile',
    channel: CHANNEL.tiktok,
    campaign: 'profile',
    placement: 'Bio link',
    path: destinations.home,
    utm: { source: 'tiktok', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute TikTok bio-link traffic.',
    manual: true,
    whereToPaste: 'TikTok → Edit profile → Website.',
    pending: true,
  },
  {
    id: 'youtube_profile',
    channel: CHANNEL.youtube,
    campaign: 'profile',
    placement: 'Channel links',
    path: destinations.home,
    utm: { source: 'youtube', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute YouTube channel description traffic.',
    manual: true,
    whereToPaste: 'YouTube channel → Links.',
    pending: true,
  },
  {
    id: 'nextdoor_profile',
    channel: CHANNEL.nextdoor,
    campaign: 'profile',
    placement: 'Business page website field',
    path: destinations.home,
    utm: { source: 'nextdoor', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute Nextdoor neighborhood traffic.',
    manual: true,
    whereToPaste: 'Nextdoor business page → Website.',
    pending: false,
  },
  {
    id: 'linkedin_profile',
    channel: CHANNEL.linkedin,
    campaign: 'profile',
    placement: 'Company page website field',
    path: destinations.commercial,
    utm: { source: 'linkedin', medium: 'organic_social', campaign: 'profile', content: 'commercial' },
    purpose: 'Attribute commercial enquiries arriving from LinkedIn.',
    manual: true,
    whereToPaste: 'LinkedIn company page → Website (secondary channel — commercial relationships only).',
    pending: true,
  },
  {
    id: 'bing_places_profile',
    channel: CHANNEL.bingPlaces,
    campaign: 'profile',
    placement: 'Business listing website field',
    path: destinations.home,
    utm: { source: 'bing', medium: 'organic', campaign: 'profile' },
    purpose: 'Attribute Bing local-listing visitors.',
    manual: true,
    whereToPaste: 'Bing Places dashboard → Website. Only after the listing is verified.',
    pending: true,
  },
  {
    id: 'yelp_profile',
    channel: CHANNEL.yelp,
    campaign: 'profile',
    placement: 'Business page website field',
    path: destinations.home,
    utm: { source: 'yelp', medium: 'organic', campaign: 'profile' },
    purpose: 'Attribute Yelp business-page visitors.',
    manual: true,
    whereToPaste: 'Yelp for Business → Business information → Website.',
    pending: true,
  },
  {
    id: 'pinterest_profile',
    channel: CHANNEL.pinterest,
    campaign: 'profile',
    placement: 'Profile website field',
    path: destinations.home,
    utm: { source: 'pinterest', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute Pinterest profile visitors.',
    manual: true,
    whereToPaste: 'Pinterest business profile → Claim → Website.',
    pending: true,
  },
  {
    id: 'rumble_profile',
    channel: CHANNEL.rumble,
    campaign: 'profile',
    placement: 'Channel about link',
    path: destinations.home,
    utm: { source: 'rumble', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute Rumble channel visitors.',
    manual: true,
    whereToPaste: 'Rumble channel → About → Website.',
    pending: true,
  },
  {
    id: 'gab_profile',
    channel: CHANNEL.gab,
    campaign: 'profile',
    placement: 'Profile website field',
    path: destinations.home,
    utm: { source: 'gab', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute Gab profile visitors.',
    manual: true,
    whereToPaste: 'Gab profile → Website.',
    pending: true,
  },
  {
    id: 'parler_profile',
    channel: CHANNEL.parler,
    campaign: 'profile',
    placement: 'Profile website field',
    path: destinations.home,
    utm: { source: 'parler', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute Parler profile visitors.',
    manual: true,
    whereToPaste: 'Parler profile → Website.',
    pending: true,
  },
  {
    id: 'x_profile',
    channel: CHANNEL.x,
    campaign: 'profile',
    placement: 'Profile bio link',
    path: destinations.home,
    utm: { source: 'x', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute X profile visitors.',
    manual: true,
    whereToPaste: 'X profile → Edit profile → Website.',
    pending: true,
  },
  {
    id: 'threads_profile',
    channel: CHANNEL.threads,
    campaign: 'profile',
    placement: 'Bio link',
    path: destinations.home,
    utm: { source: 'threads', medium: 'organic_social', campaign: 'profile' },
    purpose: 'Attribute Threads bio-link visitors.',
    manual: true,
    whereToPaste: 'Threads profile → Edit profile → Link.',
    pending: true,
  },
  {
    id: 'alignable_profile',
    channel: CHANNEL.alignable,
    campaign: 'profile',
    placement: 'Business profile website field',
    path: destinations.commercial,
    utm: { source: 'alignable', medium: 'organic_social', campaign: 'profile', content: 'commercial' },
    purpose: 'Attribute local-business-network commercial enquiries.',
    manual: true,
    whereToPaste: 'Alignable business profile → Website.',
    pending: true,
  },
  {
    id: 'reddit_local',
    channel: CHANNEL.reddit,
    campaign: 'community',
    placement: 'Local subreddit participation',
    path: destinations.home,
    utm: { source: 'reddit', medium: 'organic_social', campaign: 'community', content: 'local_thread' },
    purpose: 'Attribute visits from genuine local subreddit participation (follow each community’s self-promotion rules).',
    manual: true,
    whereToPaste: 'Local subreddit comments/posts where sharing the site is appropriate and allowed.',
    pending: true,
  },

  // ── Email / SMS (manual one-to-one sends) ──────────────────────────────────
  {
    id: 'email_signature_estimate',
    channel: CHANNEL.email,
    campaign: 'signature',
    placement: 'Email signature',
    path: destinations.estimate,
    utm: { source: 'email', medium: 'email', campaign: 'signature', content: 'estimate' },
    purpose: 'Track estimate starts from the owner’s email signature link.',
    manual: true,
    whereToPaste: 'Email signature → “Get an instant estimate” link.',
    pending: false,
  },
  {
    id: 'sms_followup_estimate',
    channel: CHANNEL.sms,
    campaign: 'followup',
    placement: 'Text-message follow-up template',
    path: destinations.estimate,
    utm: { source: 'sms', medium: 'sms', campaign: 'followup', content: 'estimate' },
    purpose: 'Track estimate starts from follow-up texts about a quote.',
    manual: true,
    whereToPaste: 'Saved text-message template used after phone enquiries.',
    pending: false,
  },

  // ── Direct outreach packets ────────────────────────────────────────────────
  {
    id: 'realtor_moveout',
    channel: CHANNEL.realtor,
    campaign: 'moveout',
    placement: 'Realtor packet / card',
    path: destinations.moveOut,
    utm: { source: 'realtor', medium: 'outreach', campaign: 'moveout', content: 'packet' },
    purpose: 'Track move-out cleaning enquiries from realtor outreach.',
    manual: true,
    whereToPaste: 'Realtor packet QR + linked URL on the move-out card.',
    pending: false,
  },
  {
    id: 'property_manager_commercial',
    channel: CHANNEL.propertyManager,
    campaign: 'commercial_pm',
    placement: 'Property-manager packet',
    path: destinations.commercial,
    utm: { source: 'property_manager', medium: 'outreach', campaign: 'commercial_pm', content: 'packet' },
    purpose: 'Track property-manager commercial enquiries (common areas, turnovers, portfolios).',
    manual: true,
    whereToPaste: 'Property-manager packet QR + cover letter.',
    pending: false,
  },
  {
    id: 'apartment_turnover',
    channel: CHANNEL.apartment,
    campaign: 'apartment_turnover',
    placement: 'Apartment community packet',
    path: destinations.moveOut,
    utm: { source: 'apartment', medium: 'outreach', campaign: 'apartment_turnover', content: 'packet' },
    purpose: 'Track apartment turnover and common-area cleaning enquiries.',
    manual: true,
    whereToPaste: 'Apartment community manager packet QR.',
    pending: false,
  },
  {
    id: 'str_host_turnover',
    channel: CHANNEL.strHost,
    campaign: 'str_turnover',
    placement: 'STR host packet / saved message',
    path: destinations.str,
    utm: { source: 'str_host', medium: 'outreach', campaign: 'str_turnover', content: 'packet' },
    purpose: 'Track short-term-rental host turnover enquiries.',
    manual: true,
    whereToPaste: 'Airbnb/VRBO host packet QR + saved outreach message.',
    pending: false,
  },
  {
    id: 'commercial_walkthrough',
    channel: CHANNEL.commercial,
    campaign: 'commercial_walkthrough',
    placement: 'Commercial walkthrough request',
    path: destinations.commercial,
    utm: { source: 'commercial', medium: 'outreach', campaign: 'commercial_walkthrough', content: 'packet' },
    purpose: 'Track commercial walkthrough requests from business outreach.',
    manual: true,
    whereToPaste: 'Commercial packet QR + email template link.',
    pending: false,
  },
  {
    id: 'church_outreach',
    channel: CHANNEL.church,
    campaign: 'church_walkthrough',
    placement: 'Church outreach card / packet',
    path: destinations.church,
    utm: { source: 'church', medium: 'outreach', campaign: 'church_walkthrough', content: 'card' },
    purpose: 'Track church cleaning walkthrough requests.',
    manual: true,
    whereToPaste: 'Church outreach card + packet QR.',
    pending: false,
  },

  // ── Print + physical placements ────────────────────────────────────────────
  {
    id: 'business_card_estimate',
    channel: CHANNEL.print,
    campaign: 'business_card',
    placement: 'Business card QR',
    path: destinations.estimate,
    utm: { source: 'business_card', medium: 'print', campaign: 'business_card', content: 'qr' },
    purpose: 'Track estimate flow scans from business cards.',
    manual: true,
    whereToPaste: 'Print on every business card (see public/marketing/qr/business-card.svg).',
    pending: false,
  },
  {
    id: 'business_card_home',
    channel: CHANNEL.print,
    campaign: 'business_card',
    placement: 'Business card website line',
    path: destinations.home,
    utm: { source: 'business_card', medium: 'print', campaign: 'business_card', content: 'website_line' },
    purpose: 'Track typed card visits.',
    manual: true,
    whereToPaste: 'Business card printed website line (tracked short URL of this link).',
    pending: false,
  },
  {
    id: 'door_hanger_recurring',
    channel: CHANNEL.print,
    campaign: 'door_hanger',
    placement: 'Door hanger QR',
    path: destinations.recurringCleaning,
    utm: { source: 'door_hanger', medium: 'print', campaign: 'door_hanger', content: 'recurring' },
    purpose: 'Track recurring-cleaning interest from door hangers.',
    manual: true,
    whereToPaste: 'Door hanger artwork QR (regenerate QR after final domain).',
    pending: false,
  },
  {
    id: 'flyer_moveout',
    channel: CHANNEL.print,
    campaign: 'flyer',
    placement: 'Flyer QR',
    path: destinations.moveOut,
    utm: { source: 'flyer', medium: 'print', campaign: 'flyer', content: 'moveout' },
    purpose: 'Track move-out cleaning interest from flyers.',
    manual: true,
    whereToPaste: 'Flyer artwork QR (regenerate QR after final domain).',
    pending: false,
  },
  {
    id: 'vehicle_qr',
    channel: CHANNEL.vehicle,
    campaign: 'vehicle',
    placement: 'Vehicle graphics QR',
    path: destinations.estimate,
    utm: { source: 'vehicle', medium: 'print', campaign: 'vehicle', content: 'qr' },
    purpose: 'Track scans from vehicle graphics.',
    manual: true,
    whereToPaste: 'Vehicle decal QR panel.',
    pending: false,
  },
  {
    id: 'referral_card_qr',
    channel: CHANNEL.referral,
    campaign: 'referral',
    placement: 'Referral card QR',
    path: destinations.estimate,
    utm: { source: 'referral', medium: 'referral', campaign: 'referral', content: 'qr' },
    purpose: 'Track referral-card scans (referral program details are configured separately; no discounts are promised until approved).',
    manual: true,
    whereToPaste: 'Referral card QR — hand to happy customers after service.',
    pending: false,
  },
  {
    id: 'yard_sign_estimate',
    channel: CHANNEL.yardSign,
    campaign: 'yard_sign',
    placement: 'Yard sign QR',
    path: destinations.estimate,
    utm: { source: 'yard_sign', medium: 'print', campaign: 'yard_sign', content: 'qr' },
    purpose: 'Track scans from yard signs placed at active job sites (only with customer permission).',
    manual: true,
    whereToPaste: 'Yard sign QR — only where the customer approves signage.',
    pending: false,
  },

  // ── Campaign landing links (no print asset required) ───────────────────────
  {
    id: 'gbp_deep_clean',
    channel: CHANNEL.gbp,
    campaign: 'deep_clean',
    placement: 'GBP post link',
    path: destinations.deepCleaning,
    utm: { source: 'google', medium: 'organic', campaign: 'deep_clean', content: 'gbp_post' },
    purpose: 'Track deep-clean interest from GBP posts.',
    manual: true,
    whereToPaste: 'Google Business Profile → Add update (Post) link.',
    pending: true,
  },
  {
    id: 'instagram_before_after',
    channel: CHANNEL.instagram,
    campaign: 'proof',
    placement: 'Before/after post link',
    path: destinations.deepCleaning,
    utm: { source: 'instagram', medium: 'organic_social', campaign: 'proof', content: 'before_after' },
    purpose: 'Track profile visits converting from before/after content.',
    manual: true,
    whereToPaste: 'Instagram posts with before/after proof (link in bio when pushing this campaign).',
    pending: true,
  },
  {
    id: 'tiktok_detail_video',
    channel: CHANNEL.tiktok,
    campaign: 'proof',
    placement: 'Detail-video bio link',
    path: destinations.houseCleaning,
    utm: { source: 'tiktok', medium: 'organic_social', campaign: 'proof', content: 'detail_video' },
    purpose: 'Track house-cleaning interest from detail demonstration videos.',
    manual: true,
    whereToPaste: 'TikTok bio link while a detail-video campaign runs.',
    pending: true,
  },
  {
    id: 'nextdoor_recommendation',
    channel: CHANNEL.nextdoor,
    campaign: 'neighborhood',
    placement: 'Neighborhood post link',
    path: destinations.houseCleaning,
    utm: { source: 'nextdoor', medium: 'organic_social', campaign: 'neighborhood', content: 'post' },
    purpose: 'Track neighborhood recommendation-post traffic.',
    manual: true,
    whereToPaste: 'Nextdoor posts and replies (link in the post body).',
    pending: false,
  },
  {
    id: 'pinterest_recurring',
    channel: CHANNEL.pinterest,
    campaign: 'recurring',
    placement: 'Recurring-cleaning pin',
    path: destinations.recurringCleaning,
    utm: { source: 'pinterest', medium: 'organic_social', campaign: 'recurring', content: 'pin' },
    purpose: 'Track recurring-cleaning interest from pinned checklists and tips.',
    manual: true,
    whereToPaste: 'Pinterest pin source URL while the recurring campaign runs (link field).',
    pending: true,
  },
  {
    id: 'x_recurring',
    channel: CHANNEL.x,
    campaign: 'recurring',
    placement: 'Recurring-cleaning post',
    path: destinations.recurringCleaning,
    utm: { source: 'x', medium: 'organic_social', campaign: 'recurring', content: 'post' },
    purpose: 'Track recurring-cleaning interest from X posts.',
    manual: true,
    whereToPaste: 'X posts that mention weekly/biweekly availability.',
    pending: true,
  },
  {
    id: 'rumble_video',
    channel: CHANNEL.rumble,
    campaign: 'proof',
    placement: 'Video description link',
    path: destinations.houseCleaning,
    utm: { source: 'rumble', medium: 'organic_social', campaign: 'proof', content: 'video_description' },
    purpose: 'Track house-cleaning interest from Rumble video descriptions.',
    manual: true,
    whereToPaste: 'Rumble video description while the detail-video campaign runs.',
    pending: true,
  },
  {
    id: 'youtube_detail_video',
    channel: CHANNEL.youtube,
    campaign: 'proof',
    placement: 'Video description link',
    path: destinations.houseCleaning,
    utm: { source: 'youtube', medium: 'organic_social', campaign: 'proof', content: 'detail_video' },
    purpose: 'Track house-cleaning interest from YouTube video descriptions.',
    manual: true,
    whereToPaste: 'YouTube video description while the detail-video campaign runs.',
    pending: true,
  },
  // ── Gift certificates ──────────────────────────────────────────────────────
  {
    id: 'facebook_gift',
    channel: CHANNEL.facebook,
    campaign: 'gift_certificate',
    placement: 'Gift-certificate posts',
    path: destinations.giftCertificates,
    utm: { source: 'facebook', medium: 'organic_social', campaign: 'gift_certificate', content: 'post' },
    purpose: 'Track gift-certificate interest from Facebook posts.',
    manual: true,
    whereToPaste: 'Facebook posts when promoting gift certificates (holidays, housewarmings, new parents).',
    pending: false,
  },
  {
    id: 'nextdoor_gift',
    channel: CHANNEL.nextdoor,
    campaign: 'gift_certificate',
    placement: 'Neighborhood gift posts',
    path: destinations.giftCertificates,
    utm: { source: 'nextdoor', medium: 'organic_social', campaign: 'gift_certificate', content: 'post' },
    purpose: 'Track gift-certificate interest from Nextdoor neighborhood posts.',
    manual: true,
    whereToPaste: 'Nextdoor posts around gift-giving seasons.',
    pending: false,
  },
  {
    id: 'email_signature_gift',
    channel: CHANNEL.email,
    campaign: 'signature',
    placement: 'Email signature (gift link)',
    path: destinations.giftCertificates,
    utm: { source: 'email', medium: 'email', campaign: 'signature', content: 'gift' },
    purpose: 'Track gift-certificate interest from the owner’s email signature.',
    manual: true,
    whereToPaste: 'Email signature → “Gift certificates” link (alongside the estimate link).',
    pending: false,
  },
  {
    id: 'gbp_gift_post',
    channel: CHANNEL.gbp,
    campaign: 'gift_certificate',
    placement: 'Business profile post',
    path: destinations.giftCertificates,
    utm: { source: 'google', medium: 'organic', campaign: 'gift_certificate', content: 'post' },
    purpose: 'Track gift-certificate interest from Google Business Profile posts.',
    manual: true,
    whereToPaste: 'Google Business Profile → Add update, once the profile is verified and visible.',
    pending: true,
  },
  {
    id: 'instagram_gift',
    channel: CHANNEL.instagram,
    campaign: 'gift_certificate',
    placement: 'Gift-certificate post / story',
    path: destinations.giftCertificates,
    utm: { source: 'instagram', medium: 'organic_social', campaign: 'gift_certificate', content: 'post' },
    purpose: 'Track gift-certificate interest from Instagram.',
    manual: true,
    whereToPaste: 'Instagram post or story link sticker when promoting gifting.',
    pending: true,
  },
  {
    id: 'x_gift',
    channel: CHANNEL.x,
    campaign: 'gift_certificate',
    placement: 'Gift-certificate post',
    path: destinations.giftCertificates,
    utm: { source: 'x', medium: 'organic_social', campaign: 'gift_certificate', content: 'post' },
    purpose: 'Track gift-certificate interest from X.',
    manual: true,
    whereToPaste: 'X posts promoting gift certificates.',
    pending: true,
  },
  {
    id: 'gift_card_print',
    channel: CHANNEL.print,
    campaign: 'gift_certificate',
    placement: 'Printed gift card / certificate holder',
    path: destinations.giftCertificates,
    utm: { source: 'gift_card', medium: 'print', campaign: 'gift_certificate', content: 'qr' },
    purpose: 'Track scans from a printed gift card that leads to the gift-certificate page.',
    manual: true,
    whereToPaste: 'Printed gift card or certificate holder (QR from public/marketing/qr/gift-card.svg).',
    pending: false,
  },
];

export type QrAsset = {
  /** File base name under public/marketing/qr/. */
  id: string;
  /** Registry link this QR resolves to. */
  linkId: string;
  /** What the QR is for. */
  purpose: string;
  /** Human placement description. */
  placement: string;
  pending: boolean;
};

export const qrAssets: QrAsset[] = [
  { id: 'business-card', linkId: 'business_card_estimate', purpose: 'Instant estimate from business cards.', placement: 'Business card back.', pending: false },
  { id: 'door-hanger', linkId: 'door_hanger_recurring', purpose: 'Recurring-cleaning door hanger.', placement: 'Front-door hangers in target neighborhoods.', pending: false },
  { id: 'flyer', linkId: 'flyer_moveout', purpose: 'Move-out flyer.', placement: 'Realtor offices, apartment communities, community boards.', pending: false },
  { id: 'vehicle', linkId: 'vehicle_qr', purpose: 'Vehicle graphics scan.', placement: 'Van/truck decal.', pending: false },
  { id: 'referral-card', linkId: 'referral_card_qr', purpose: 'Customer referral card.', placement: 'Left with customers after service.', pending: false },
  { id: 'realtor-packet', linkId: 'realtor_moveout', purpose: 'Realtor move-out packet.', placement: 'Realtor packet cover card.', pending: false },
  { id: 'property-manager-packet', linkId: 'property_manager_commercial', purpose: 'Property-manager packet.', placement: 'Property-manager packet cover card.', pending: false },
  { id: 'airbnb-host-packet', linkId: 'str_host_turnover', purpose: 'STR host packet.', placement: 'STR host packet cover card.', pending: false },
  { id: 'commercial-packet', linkId: 'commercial_walkthrough', purpose: 'Commercial packet.', placement: 'Commercial outreach packet cover card.', pending: false },
  { id: 'church-outreach', linkId: 'church_outreach', purpose: 'Church outreach card.', placement: 'Church outreach card.', pending: false },
  { id: 'recurring-campaign', linkId: 'door_hanger_recurring', purpose: 'Recurring campaign (social/email).', placement: 'Anywhere the recurring campaign link is needed.', pending: false },
  { id: 'move-out-campaign', linkId: 'flyer_moveout', purpose: 'Move-out campaign (social/email).', placement: 'Anywhere the move-out campaign link is needed.', pending: false },
  { id: 'str-campaign', linkId: 'str_host_turnover', purpose: 'STR campaign (social/email).', placement: 'Anywhere the STR campaign link is needed.', pending: false },
  { id: 'gift-card', linkId: 'gift_card_print', purpose: 'Printed gift card scanning to the gift-certificate page.', placement: 'Gift card or certificate holder print run.', pending: false },
];

/**
 * Canonical public URLs are NEVER given UTMs. This helper exists so scripts
 * can assert that invariant against built output.
 */
export const canonicalPaths: string[] = Object.values(destinations);

export function resolveSiteUrl(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return 'https://sparkling-standard.com';
  return trimmed.replace(/\/+$/, '');
}

export function linkUrl(link: MarketingLink, siteUrl: string): string {
  const url = new URL(link.path, resolveSiteUrl(siteUrl));
  url.searchParams.set('utm_source', link.utm.source);
  url.searchParams.set('utm_medium', link.utm.medium);
  url.searchParams.set('utm_campaign', link.utm.campaign);
  if (link.utm.content) url.searchParams.set('utm_content', link.utm.content);
  return url.href;
}
