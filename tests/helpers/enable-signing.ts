// Unit/integration tests exercise the signing engine directly. Production
// activation still defaults to false and is enforced in createSigningRequest.
// Enabling it here keeps the tests focused on signing behavior rather than the
// deployment activation flag.
import { legalPolicyConfig } from '../../src/config/legal-policy.ts';

(legalPolicyConfig.activation as { electronicSigning: boolean }).electronicSigning = true;

export {};
