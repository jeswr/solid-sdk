// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Verification of fedreg: registry records and storage descriptions. A
// fedreg:Membership is the REGISTRY's assertion of an app's membership — distinct
// from the app's self-asserted fedapp:App — so a well-formed membership MUST name
// the app, a recognised lifecycle status, and the authority that asserts it
// (fedreg:assertedBy). A storage description MUST advertise at least one accepted
// spec-version (else it carries no migration-coordination information).
//
// Extraction is via the typed wrappers; the term-type guard rejects a literal or
// blank node where an IRI is required (a malformed graph a lexical-only read would
// silently accept).

import type {
  Membership,
  MembershipVerification,
  RegistryIssue,
  StorageDescription,
  StorageVerification,
} from "./types.js";
import {
  FEDREG_ACCEPTS_SPEC,
  FEDREG_APP,
  FEDREG_ASSERTED_BY,
  FEDREG_STATUS,
  FEDREG_STORAGE,
  FEDREG_SUPPORTS_SECTOR,
  statusName,
  VALID_STATUS_IRIS,
} from "./vocab.js";
import type { MembershipNode, StorageNode, TermWrapperType } from "./wrappers.js";

/**
 * Filter a Set of object TERMS for an IRI-valued property down to the IRI string
 * values whose term is a `NamedNode`, recording an `invalid-term-type` issue for
 * every object that is NOT a NamedNode (a literal or blank node where an IRI is
 * required is malformed).
 */
function validIris(
  terms: ReadonlySet<TermWrapperType>,
  subject: string,
  predicate: string,
  issues: RegistryIssue[],
): string[] {
  const out: string[] = [];
  for (const term of terms) {
    if (term.termType !== "NamedNode") {
      issues.push({
        code: "invalid-term-type",
        message: `Expected an IRI (NamedNode) for <${predicate}> but found a ${term.termType} ("${term.value}").`,
        subject,
        value: term.value,
      });
      continue;
    }
    out.push(term.value);
  }
  return out;
}

/**
 * Validate the `fedreg:app` cardinality: a membership names EXACTLY one app
 * (its client_id). Pushes `membership-missing-app` (none) or
 * `membership-multiple-apps` (more than one).
 */
function validateAppCardinality(
  apps: readonly string[],
  id: string,
  issues: RegistryIssue[],
): void {
  if (apps.length === 0) {
    issues.push({
      code: "membership-missing-app",
      message: "fedreg:Membership names no fedreg:app (the app's client_id).",
      subject: id,
    });
  } else if (apps.length > 1) {
    issues.push({
      code: "membership-multiple-apps",
      message: `fedreg:Membership names ${apps.length} apps via fedreg:app; expected exactly one.`,
      subject: id,
    });
  }
}

/**
 * Validate `fedreg:status`: a membership has EXACTLY one lifecycle state, and that
 * state must be a known coded value. Pushes (in this order) the cardinality issue
 * — `membership-missing-status` (none) / `membership-multiple-statuses` (more than
 * one; ambiguous, since which one "wins" would depend on RDF iteration order) —
 * then an `unknown-status` for EVERY status IRI not in the coded set (every one, so
 * an unknown anywhere in the set is flagged regardless of iteration order).
 */
function validateStatus(statusIris: readonly string[], id: string, issues: RegistryIssue[]): void {
  if (statusIris.length === 0) {
    issues.push({
      code: "membership-missing-status",
      message: "fedreg:Membership has no fedreg:status.",
      subject: id,
    });
  } else if (statusIris.length > 1) {
    issues.push({
      code: "membership-multiple-statuses",
      message: `fedreg:Membership has ${statusIris.length} fedreg:status values; expected exactly one. (${statusIris.join(", ")})`,
      subject: id,
    });
  }
  for (const s of statusIris) {
    if (!VALID_STATUS_IRIS.has(s)) {
      issues.push({
        code: "unknown-status",
        message: `fedreg:status is not a known fedreg:MembershipStatus value: ${s}`,
        subject: id,
        value: s,
      });
    }
  }
}

/**
 * Validate `fedreg:assertedBy`: a registry assertion MUST name the authority that
 * vouches for it (else it is indistinguishable from a self-asserted claim). Pushes
 * `membership-missing-asserted-by` when none is present.
 */
function validateAssertedBy(
  assertedBy: readonly string[],
  id: string,
  issues: RegistryIssue[],
): void {
  if (assertedBy.length === 0) {
    issues.push({
      code: "membership-missing-asserted-by",
      message:
        "fedreg:Membership has no fedreg:assertedBy — a registry assertion MUST name the authority that vouches for it (else it is indistinguishable from a self-asserted claim).",
      subject: id,
    });
  }
}

/**
 * Project a {@link MembershipNode} into a plain {@link Membership}, recording
 * issues. Exposed so a registry walk can verify each membership independently. The
 * per-field validators run in a fixed order (term-type → app → status → assertedBy)
 * so the recorded issue ORDER is stable.
 */
export function membershipNodeToView(node: MembershipNode, issues: RegistryIssue[]): Membership {
  const id = node.value;
  // validIris pushes any `invalid-term-type` issue first (before the cardinality /
  // value checks), so a literal where an IRI is required is flagged ahead of the
  // resulting "missing" issue — see the MEMBERSHIP_LITERAL_APP characterization.
  const apps = validIris(node.apps, id, FEDREG_APP, issues);
  const statusIris = validIris(node.statuses, id, FEDREG_STATUS, issues);
  const assertedBy = validIris(node.assertedBy, id, FEDREG_ASSERTED_BY, issues);

  validateAppCardinality(apps, id, issues);
  validateStatus(statusIris, id, issues);
  validateAssertedBy(assertedBy, id, issues);

  const statusIri = statusIris[0];
  return {
    id,
    app: apps[0] ?? "",
    ...(statusIri !== undefined ? { statusIri, status: statusName(statusIri) } : {}),
    ...(assertedBy.length > 0 ? { assertedBy } : {}),
    ...(node.asserted !== undefined ? { asserted: node.asserted } : {}),
  };
}

/** Verify a single {@link MembershipNode} in isolation. */
export function verifyMembershipNode(node: MembershipNode): MembershipVerification {
  const issues: RegistryIssue[] = [];
  const membership = membershipNodeToView(node, issues);
  return { valid: issues.length === 0, membership, issues };
}

/** Project a {@link StorageNode} into a plain {@link StorageDescription}. Internal. */
function storageNodeToView(node: StorageNode, issues: RegistryIssue[]): StorageDescription {
  const id = node.value;
  const acceptsSpec = validIris(node.acceptsSpec, id, FEDREG_ACCEPTS_SPEC, issues);
  const supportsSector = validIris(node.supportsSector, id, FEDREG_SUPPORTS_SECTOR, issues);
  const storageIris = validIris(node.storage, id, FEDREG_STORAGE, issues);

  if (acceptsSpec.length === 0) {
    issues.push({
      code: "storage-missing-accepts-spec",
      message:
        "fedreg:StorageDescription advertises no fedreg:acceptsSpec — it carries no spec-version information for migration coordination.",
      subject: id,
    });
  }

  // `storage` defaults to the description's own IRI when no explicit
  // fedreg:storage triple is present — matching StorageInput.storage's documented
  // "defaults to id" semantics, so the round-trip describeStorage → parseStorage
  // always yields a defined `storage`.
  return {
    id,
    storage: storageIris[0] ?? id,
    acceptsSpec,
    supportsSector,
  };
}

/** Verify a single {@link StorageNode} in isolation. */
export function verifyStorageNode(node: StorageNode): StorageVerification {
  const issues: RegistryIssue[] = [];
  const storage = storageNodeToView(node, issues);
  return { valid: issues.length === 0, storage, issues };
}
