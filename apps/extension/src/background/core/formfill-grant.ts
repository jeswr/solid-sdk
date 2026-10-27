// AUTHORED-BY Codex GPT-6.1-Sol
import type { FieldCategory } from '../../content/formfill/detect';
import { canonicalOrigin } from './origin-grant';
import { isValidClientIdUrl } from './origin-policy';

/** Separate from API grants: this record never authorizes window.solid or pod egress. */
export interface FormFillGrant {
  readonly origin: string;
  readonly profileId: string;
  readonly categories: readonly FieldCategory[];
  readonly createdAt: number;
  readonly expiresAt?: number;
}

export function sanitiseFormFillGrants(raw: unknown): FormFillGrant[] {
  if (!Array.isArray(raw)) return [];
  const valid: FormFillGrant[] = [];
  const counts = new Map<string, number>();
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const g = value as FormFillGrant;
    if (
      !canonicalOrigin(g.origin) ||
      !isValidClientIdUrl(g.origin) ||
      typeof g.profileId !== 'string' ||
      !g.profileId.trim() ||
      !Number.isFinite(g.createdAt) ||
      g.createdAt < 0 ||
      (g.expiresAt !== undefined &&
        (!Number.isFinite(g.expiresAt) || g.expiresAt <= g.createdAt)) ||
      !Array.isArray(g.categories) ||
      !g.categories.length ||
      !g.categories.every((c) => c === 'contact' || c === 'address')
    )
      continue;
    counts.set(g.origin, (counts.get(g.origin) ?? 0) + 1);
    valid.push({
      origin: g.origin,
      profileId: g.profileId,
      categories: [...new Set(g.categories)],
      createdAt: g.createdAt,
      ...(g.expiresAt === undefined ? {} : { expiresAt: g.expiresAt }),
    });
  }
  return valid.filter((g) => counts.get(g.origin) === 1);
}

export function liveFormFillGrant(
  grants: readonly FormFillGrant[],
  origin: string,
  now: number,
): FormFillGrant | null {
  return (
    grants.find((g) => g.origin === origin && (g.expiresAt === undefined || g.expiresAt > now)) ??
    null
  );
}

export function revokeProfileFormFillGrants(
  grants: readonly FormFillGrant[],
  profileId: string,
): FormFillGrant[] {
  return grants.filter((g) => g.profileId !== profileId);
}
