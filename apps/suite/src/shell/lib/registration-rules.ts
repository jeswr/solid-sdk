// AUTHORED-BY Claude Opus 5.5
/**
 * Pure self-registration rules (02-suite-shell §8.2): the username rules shown
 * beside the field, the display name prefilled from the username, the
 * username status line, and an advisory password strength. The only password
 * requirement is length; there are no composition rules.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const PASSWORD_MIN = 12;

export interface UsernameRule {
  id: "length" | "characters";
  label: string;
  met: boolean;
}

const ALLOWED = /^[a-z0-9-]+$/u;

export function usernameRules(username: string): UsernameRule[] {
  return [
    {
      id: "length",
      label: `${USERNAME_MIN}–${USERNAME_MAX} characters`,
      met: username.length >= USERNAME_MIN && username.length <= USERNAME_MAX,
    },
    {
      id: "characters",
      label: "Lowercase letters, numbers and hyphens only",
      met: ALLOWED.test(username),
    },
  ];
}

export function isValidUsername(username: string): boolean {
  return usernameRules(username).every((rule) => rule.met);
}

/** The first rule a username breaks, in plain words; null when it is valid. */
export function usernameProblem(username: string): string | null {
  if (username.length === 0) return "Choose a username.";
  if (username.length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`;
  if (username.length > USERNAME_MAX) return `Use ${USERNAME_MAX} characters or fewer.`;
  if (!ALLOWED.test(username)) return "Use only lowercase letters, numbers and hyphens.";
  return null;
}

/** "sam-river-2" → "Sam River 2": a starting point the person can edit. */
export function displayNameFromUsername(username: string): string {
  return username
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type UsernameCheck = "idle" | "checking" | "available" | "taken" | "error";

/** The live status line under the username field. */
export function usernameStatus(username: string, check: UsernameCheck): string {
  if (username.length === 0) return "";
  const problem = usernameProblem(username);
  if (problem) return problem;
  switch (check) {
    case "checking":
      return `Checking whether ${username} is free…`;
    case "available":
      return `${username} is available.`;
    case "taken":
      return `${username} is taken. Try another username.`;
    case "error":
      return "We couldn't check this username. You can still try to create your account.";
    case "idle":
      return "";
  }
}

export type PasswordScore = 0 | 1 | 2 | 3 | 4;
export interface PasswordStrength {
  score: PasswordScore;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
  /** Length is the only requirement; the score is advice. */
  acceptable: boolean;
}

const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

function pool(characters: readonly string[]): number {
  let size = 0;
  if (characters.some((c) => /[a-z]/u.test(c))) size += 26;
  if (characters.some((c) => /[A-Z]/u.test(c))) size += 26;
  if (characters.some((c) => /[0-9]/u.test(c))) size += 10;
  if (characters.some((c) => /[^a-zA-Z0-9]/u.test(c))) size += 33;
  return size;
}

/**
 * Estimate strength from length and character variety. Repeated characters and
 * runs ("aaaa", "abcd", "1234") add nothing, and a password containing one of
 * the `avoid` words (the username, the display name) is at best weak.
 */
export function passwordStrength(
  password: string,
  avoid: readonly string[] = [],
): PasswordStrength {
  const characters = [...password];
  if (characters.length < PASSWORD_MIN) return { score: 0, label: LABELS[0], acceptable: false };
  let effective = 1;
  characters
    .map((character) => character.codePointAt(0) as number)
    .reduce((previous, point) => {
      if (Math.abs(point - previous) > 1) effective++;
      return point;
    });
  const bits = effective * Math.log2(pool(characters));
  let score: PasswordScore = bits < 50 ? 1 : bits < 65 ? 2 : bits < 80 ? 3 : 4;
  const lower = password.toLowerCase();
  if (
    avoid.some((word) => {
      const term = word.trim().toLowerCase();
      return term.length >= USERNAME_MIN && lower.includes(term);
    })
  )
    score = 1;
  return { score, label: LABELS[score], acceptable: true };
}
