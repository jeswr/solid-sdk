// AUTHORED-BY Claude Opus 4.8
/**
 * PURE consent-flow logic — the decision layer behind the extension's consent surface
 * (design §4.1, "the consent dialog must be unspoofable by the requesting origin"). The
 * consent WINDOW (an extension-chrome page opened by the service worker) renders a
 * {@link PendingConsent}; the user's per-class approve/deny maps back to concrete
 * {@link ClassGrant}s through {@link consentDecisionToGrants}. Keeping this pure means the
 * grant-minting is exhaustively unit-testable without a packed extension.
 *
 * The consent surface shows, per requested class: the data-class IRI, the requested MODES,
 * the declared PURPOSE, the EXPIRY, and — critically — the RESOLVED TARGET SET ("this will
 * share these N resources", design §3.4 step 2 / §6.2 gross-mislabelling catch). A class that
 * resolved to ZERO targets is surfaced as such and, if approved, mints a grant that authorises
 * NOTHING (fail-closed) — never a blanket grant.
 */

import type { ClassGrant, GrantMode, PinnedTarget } from './class-grant';

/** One requested class as presented in the consent window (already resolved to targets). */
export interface ConsentClass {
  readonly dataClass: string;
  readonly modes: readonly GrantMode[];
  readonly purpose: string | null;
  readonly expiresAt: number;
  /** The RESOLVED, pinned targets — shown to the user and frozen into the grant on approve. */
  readonly targets: readonly PinnedTarget[];
  /** The shape IRI the class resolved through (design anchor), or `null` (type-index rung). */
  readonly shape: string | null;
}

/** A pending consent request awaiting the user's decision in the consent window. */
export interface PendingConsent {
  readonly consentId: string;
  /** The verified requesting origin (dual-origin agreement already passed). */
  readonly origin: string;
  /** The active WebID the grant would be minted under (the session boundary). */
  readonly webId: string;
  readonly createdAt: number;
  readonly classes: readonly ConsentClass[];
}

/**
 * Build the pending-consent record from a validated request spec + the per-class resolution.
 * `resolved` maps each class IRI to its pinned targets (+ optional shape). A class missing from
 * `resolved` is presented with an empty target set.
 */
export function buildPendingConsent(
  consentId: string,
  origin: string,
  webId: string,
  spec: {
    readonly classes: readonly string[];
    readonly modes: readonly GrantMode[];
    readonly purpose: string | null;
    readonly expiresAt: number;
  },
  resolved: ReadonlyMap<string, { targets: readonly PinnedTarget[]; shape?: string | null }>,
  createdAt: number,
): PendingConsent {
  const classes: ConsentClass[] = spec.classes.map((dataClass) => {
    const r = resolved.get(dataClass);
    return {
      dataClass,
      modes: spec.modes,
      purpose: spec.purpose,
      expiresAt: spec.expiresAt,
      targets: r?.targets ?? [],
      shape: r?.shape ?? null,
    };
  });
  return { consentId, origin, webId, createdAt, classes };
}

/**
 * Map a user decision (the set of APPROVED data-class IRIs) to the grants to persist. Only a
 * class that was BOTH requested AND approved mints a grant; a denied/unknown class mints none.
 * `mintId` supplies a unique grantId per grant. Fail-closed: an approved class not present in
 * the pending set is ignored (the window can only approve what it was shown).
 */
export function consentDecisionToGrants(
  pending: PendingConsent,
  approvedClasses: readonly string[],
  mintId: () => string,
): ClassGrant[] {
  const approved = new Set(approvedClasses);
  const out: ClassGrant[] = [];
  for (const c of pending.classes) {
    if (!approved.has(c.dataClass)) continue;
    out.push({
      grantId: mintId(),
      webId: pending.webId,
      origin: pending.origin,
      dataClass: c.dataClass,
      modes: c.modes,
      purpose: c.purpose,
      expiresAt: c.expiresAt,
      targets: c.targets,
      createdAt: pending.createdAt,
    });
  }
  return out;
}
