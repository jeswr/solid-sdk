/**
 * Two-letter uppercase initials from a person's display name:
 *   - empty / whitespace-only → "?"
 *   - one word → its first two letters
 *   - several words → first letter of the FIRST + first letter of the LAST word
 */
export declare function initialsFromName(name: string): string;
