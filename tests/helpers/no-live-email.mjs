// Test-only network guard.
//
// Automated tests must never consume the live Resend quota or send a real
// transactional email. Every test in this repository stubs fetch before it
// reaches an email sender, but this guard fails closed if a future test forgets
// to. It is loaded with `node --import` by `npm test`.
//
// A deliberate, owner-authorized live test must set ALLOW_LIVE_RESEND_TESTS=1
// for that single command. Normal test runs never set it.

const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (/^https:\/\/api\.resend\.com\//i.test(url) && process.env.ALLOW_LIVE_RESEND_TESTS !== '1') {
    throw new Error(
      'Live Resend is disabled during tests. Stub the response or set ALLOW_LIVE_RESEND_TESTS=1 only for an owner-authorized live test.',
    );
  }
  return originalFetch(input, init);
};
