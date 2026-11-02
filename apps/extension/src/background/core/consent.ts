// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
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
 * share these N resources", design §3.4 step 2 / §6.2 gross-mislabelling catch). The person
 * confirms each target (BWC3 C5): every target carries an opaque worker-assigned id, and a
 * decision names the selected ids per class. Only selected targets are pinned; a class with no
 * selected target (including one that resolved to nothing) mints no grant.
 */

import { PIM_STORAGE_CLASS } from '../../shared/storage-class';
import type { ClassGrant, GrantMode, PinnedTarget } from './class-grant';
import type { ResolvedTarget, TargetSource } from './class-resolve-sai';

export type TargetCheck = ResolvedTarget['check'];

/** One resolved target as the consent window offers it. */
export interface ConsentTarget extends PinnedTarget {
  /** Opaque id, unique to this pending snapshot; a decision selects targets by id. */
  readonly id: string;
  /** The rung that first produced the target (the consent window groups by it). */
  readonly source: TargetSource;
  readonly check: TargetCheck;
  /** Checked when the window opens (C5); the person can change any choice. */
  readonly preselected: boolean;
}

/** A per-class decision: data-class IRI → the selected target ids. */
export type ApprovedTargets = Readonly<Record<string, readonly string[]>>;

/**
 * C5 pre-selection: Type Index targets that conform or are unchecked, and SAI targets that
 * conform. Mixed targets, unchecked SAI-only targets and whole-pod storage are never
 * pre-selected. A target that the Type Index also declares counts as a Type Index target.
 */
export function preselectTarget(dataClass: string, target: ResolvedTarget): boolean {
  if (dataClass === PIM_STORAGE_CLASS || target.check === 'mixed') return false;
  return target.check === 'conforms' || target.sources.includes('type-index');
}

/** One requested class as presented in the consent window (already resolved to targets). */
export interface ConsentClass {
  readonly dataClass: string;
  readonly modes: readonly GrantMode[];
  readonly purpose: string | null;
  readonly expiresAt: number;
  /** The RESOLVED targets — shown to the user; only the selected ones are pinned. */
  readonly targets: readonly ConsentTarget[];
  /** The shape IRI the class resolved through (design anchor), or `null` (type-index rung). */
  readonly shape: string | null;
  readonly truncated?: boolean;
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
 * `resolved` maps each class IRI to its resolved targets (+ optional shape). A class missing
 * from `resolved` is presented with an empty target set. `mintTargetId` must return ids that
 * are unique and unguessable across requests.
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
  resolved: ReadonlyMap<
    string,
    { targets: readonly ResolvedTarget[]; shape?: string | null; truncated?: boolean }
  >,
  createdAt: number,
  mintTargetId: () => string,
): PendingConsent {
  const classes: ConsentClass[] = spec.classes.map((dataClass) => {
    const r = resolved.get(dataClass);
    return {
      dataClass,
      modes: spec.modes,
      purpose: spec.purpose,
      expiresAt: spec.expiresAt,
      targets: (r?.targets ?? []).map((target) => ({
        id: mintTargetId(),
        url: target.url,
        kind: target.kind,
        source: target.source,
        check: target.check,
        preselected: preselectTarget(dataClass, target),
      })),
      shape: r?.shape ?? null,
      ...(r?.truncated ? { truncated: true } : {}),
    };
  });
  return { consentId, origin, webId, createdAt, classes };
}

/**
 * Validate a decision against the pending snapshot. Fail-closed: `null` unless every class key
 * was requested and every id belongs to that class in this snapshot. Classes with no selected
 * id are left out, so they are not granted.
 */
export function validateApprovedTargets(
  pending: PendingConsent,
  approved: unknown,
): ApprovedTargets | null {
  if (approved === null || typeof approved !== 'object' || Array.isArray(approved)) return null;
  const result: Record<string, string[]> = {};
  for (const [dataClass, ids] of Object.entries(approved)) {
    const cls = pending.classes.find((c) => c.dataClass === dataClass);
    if (!cls || !Array.isArray(ids)) return null;
    const known = new Set(cls.targets.map((t) => t.id));
    const selected = [...new Set(ids)];
    if (selected.some((id) => typeof id !== 'string' || !known.has(id))) return null;
    if (selected.length) result[dataClass] = selected;
  }
  return result;
}

/**
 * Map a validated decision to the grants to persist: one grant per class with at least one
 * selected target, pinning exactly those targets. `mintId` supplies a unique grantId per grant.
 * Returns `null` when the decision does not validate against `pending`.
 */
export function consentDecisionToGrants(
  pending: PendingConsent,
  approvedTargets: unknown,
  mintId: () => string,
): ClassGrant[] | null {
  const approved = validateApprovedTargets(pending, approvedTargets);
  if (!approved) return null;
  const out: ClassGrant[] = [];
  for (const c of pending.classes) {
    const selected = new Set(approved[c.dataClass] ?? []);
    if (!selected.size) continue;
    out.push({
      grantId: mintId(),
      webId: pending.webId,
      origin: pending.origin,
      dataClass: c.dataClass,
      modes: c.modes,
      purpose: c.purpose,
      expiresAt: c.expiresAt,
      // Resolver provenance and ids are transient; only the immutable URL/kind scope persists.
      targets: c.targets.filter((t) => selected.has(t.id)).map(({ url, kind }) => ({ url, kind })),
      createdAt: pending.createdAt,
    });
  }
  return out;
}
