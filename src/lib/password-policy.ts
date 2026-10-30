/**
 * Single source of truth for administrator password rules.
 *
 * Owner directive (2026-10-30): a password must be at least 8 characters and
 * include at least one special character. Nothing else is required. Longer
 * passwords and passphrases are permitted.
 *
 * Client-side hints, the estimator-independent admin gate, the operations API,
 * the legacy gift register and the tests all import this module so the rule
 * can never drift between authentication paths.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * "Special character" means any non-whitespace character that is not an ASCII
 * letter or digit (for example ! @ # $ % & * - _ + = ?). Spaces are allowed
 * inside passphrases but do not satisfy the special-character rule.
 */
export const PASSWORD_SPECIAL_PATTERN = /[^A-Za-z0-9\s]/;

export const PASSWORD_POLICY_HINT =
  'At least 8 characters, including one special character (for example ! @ # $ %).';

export const PASSWORD_POLICY_PATTERN = '(?=.*[^A-Za-z0-9\\s]).{8,200}';

export type PasswordProblem =
  | 'password_required'
  | 'password_too_short'
  | 'password_too_long'
  | 'password_needs_special';

const MESSAGES: Record<PasswordProblem, string> = {
  password_required: 'Enter a password.',
  password_too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  password_too_long: `Use no more than ${PASSWORD_MAX_LENGTH} characters.`,
  password_needs_special: 'Include at least one special character, such as ! @ # $ %.',
};

export function passwordProblem(password: string): PasswordProblem | null {
  if (!password) return 'password_required';
  if (password.length < PASSWORD_MIN_LENGTH) return 'password_too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'password_too_long';
  if (!PASSWORD_SPECIAL_PATTERN.test(password)) return 'password_needs_special';
  return null;
}

export function passwordPolicyMessage(problem: PasswordProblem): string {
  return MESSAGES[problem];
}

/** Human-readable check used by invitation and password-change confirmations. */
export function passwordConfirmationProblem(password: string, confirmation: string): PasswordProblem | 'password_mismatch' | null {
  const problem = passwordProblem(password);
  if (problem) return problem;
  if (password !== confirmation) return 'password_mismatch';
  return null;
}

export function passwordConfirmationMessage(problem: PasswordProblem | 'password_mismatch'): string {
  if (problem === 'password_mismatch') return 'The two passwords do not match.';
  return passwordPolicyMessage(problem);
}
