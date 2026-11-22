// Stripe key selection for production versus isolated sandbox environments.
// Production never falls back to the test secret. Local/preview never uses a
// live secret, even if one is accidentally present in the environment.

export interface StripeSecretEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_TEST_SECRET?: string;
}

export function resolveStripeSecret(
  env: StripeSecretEnv,
  production: boolean,
): string {
  const live = env.STRIPE_SECRET_KEY?.trim() ?? '';
  const test = env.STRIPE_TEST_SECRET?.trim() ?? '';
  if (production) return live;
  if (test) return test;
  return live.startsWith('sk_test_') || live.startsWith('rk_test_') ? live : '';
}
