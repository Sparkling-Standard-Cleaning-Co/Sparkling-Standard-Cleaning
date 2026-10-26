import {
  assertValidEstimatorConfiguration,
  formatEstimatorConfigIssues,
  validateEstimatorConfiguration,
} from '../src/config/estimators/validation.ts';
import { PRICING_CONFIG_VERSION } from '../src/config/estimators/pricing-version.ts';

const result = validateEstimatorConfiguration();

for (const warning of result.warnings) {
  console.warn(`WARNING ${warning.path}: ${warning.message}`);
}

if (!result.valid) {
  console.error('Estimator configuration is INVALID:\n');
  console.error(formatEstimatorConfigIssues(result.errors));
  process.exit(1);
}

try {
  assertValidEstimatorConfiguration();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(
  `✓ Estimator configuration valid; automatic version ${PRICING_CONFIG_VERSION}`,
);
