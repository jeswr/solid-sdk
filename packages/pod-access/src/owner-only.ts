// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Claude Sonnet 5.5

import type { DatasetCore } from "@rdfjs/types";
import { Policy } from "@solid/object";
import { DataFactory } from "n3";
import {
  type DetectedAccessControl,
  detectAccessControl,
  hasWacEvidence,
  isOwnerOnlyConflictError,
  loadAccessDocument,
  locate,
  ownerOnlyConflict,
  shownDialect,
  shownModel,
} from "./access-detect.js";
import { ACL, ACP, modeIri, parent, RDF, RdfNode, safeIri } from "./rdf.js";
import { scoped } from "./roles/http.js";
import { readAcp } from "./systems/acp.js";
import { readWac } from "./systems/wac.js";
import type { AccessClientOptions, AccessMode, EffectivePolicy, Subject } from "./types.js";

/** Uses the same storage and independently established ACP dialect as createAccessClient. */
export interface OwnerOnlyOptions extends Pick<AccessClientOptions, "storage" | "acpDialect"> {
  url: string;
  ownerWebId: string;
  /**
   * The access-control model, when the caller knows it. It wins over unknown or absent
   * `storage.features.accessControl`. If it contradicts discovered features that name the other
   * model, or what the access document (or its link relation) shows, `checkOwnerOnly` throws
   * {@link OwnerOnlyConflict} instead of choosing a side. WAC additionally needs the resource's
   * HEAD to carry a `WAC-Allow` header (refusal `no-wac-evidence` otherwise). Use `checkOwnerOnlyAuto`
   * to have the model and dialect determined from the pod itself.
   */
  accessModel?: "wac" | "acp" | undefined;
}

/** Deliberately excludes policy text, identifiers and transport error messages. */
export interface OwnerOnlyReason {
  subject: "public" | "authenticated" | "agent" | "group" | "origin/client-scoped" | "unknown";
  modes: AccessMode[];
  reason:
    | "non-owner"
    | "unknown"
    | "unrepresentable"
    | "unsupported-model"
    | "not-storage-root"
    | "undecided"
    | "no-wac-evidence";
}

export type OwnerOnlyResult = { private: true } | { private: false; reasons: OwnerOnlyReason[] };

const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";
const TARGETS = [`${ACL}accessTo`, `${ACL}default`, `${ACP}resource`];

function refused(reason: OwnerOnlyReason["reason"]): OwnerOnlyResult {
  return { private: false, reasons: [{ subject: "unknown", modes: [], reason }] };
}

/** URL normalisation plus decoding of percent-escaped unreserved characters (`%2E` is `.`). */
function canonicalIri(value: string): string {
  return new URL(value).href.replace(/%([0-9a-f]{2})/gi, (match, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(character) ? character : match.toUpperCase();
  });
}

// The neutral readers intentionally omit unknown modes and some inactive constructs for
// migration. A privacy assertion must refuse those omissions, including untyped WAC rules.
function policy(
  dataset: DatasetCore,
  resource: string,
  endpoint: string,
  model: "wac" | "acp",
  dialect: "css" | "ess",
): EffectivePolicy {
  const vocabulary = model === "acp" && dialect === "ess" ? ACP : ACL;
  const allowed = (["read", "append", "write", "control"] as const).map((mode) =>
    modeIri(mode).replace(ACL, vocabulary),
  );
  const canonical = canonicalIri(resource);
  for (const q of dataset) {
    if (q.graph.termType !== "DefaultGraph") throw new TypeError("Named access graph");
    for (const term of [q.subject, q.predicate, q.object]) {
      if (term.termType === "NamedNode") safeIri(term.value);
    }
    const other = model === "wac" ? ACP : ACL;
    if (
      q.predicate.value.startsWith(other) ||
      (q.predicate.value === `${RDF}type` && q.object.value.startsWith(other))
    )
      throw new TypeError("Mixed access models");
    // The readers compare targets as exact strings, but a server may normalise them. A target
    // that names this resource only after URL normalisation could hide an effective grant.
    if (
      TARGETS.includes(q.predicate.value) &&
      q.object.value !== resource &&
      canonicalIri(q.object.value) === canonical
    )
      throw new TypeError("Non-canonical access target");
    if ([`${ACL}mode`, `${ACP}allow`, `${ACP}deny`].includes(q.predicate.value)) {
      if (q.object.termType !== "NamedNode" || !allowed.includes(q.object.value))
        throw new TypeError("Unrepresentable access mode");
    }
    if (model === "wac" && q.predicate.value.startsWith(ACL)) {
      const node = new RdfNode(q.subject, dataset, DataFactory);
      if (!node.iris(`${RDF}type`).includes(`${ACL}Authorization`))
        throw new TypeError("Unplaced WAC rule");
    }
    if (q.predicate.value === `${ACP}allow`) {
      const p = new Policy(q.subject, dataset, DataFactory);
      if (!p.allOf.size && !p.anyOf.size) throw new TypeError("Unrepresented ACP matcher");
    }
  }
  if (model === "wac") {
    // Validate the closed grammar, then retain origin conditions for diagnostics.
    readWac(dataset, resource, endpoint, "css", true);
    return readWac(dataset, resource, endpoint, "css");
  }
  let omitted = false;
  const result = readAcp(dataset, resource, endpoint, dialect, true, () => {
    omitted = true;
  });
  if (omitted) throw new TypeError("Unrepresented ACP grant");
  return result;
}

function subjectKind(clause: Subject[]): OwnerOnlyReason["subject"] {
  if (clause.some((s) => ["origin", "client", "issuer", "vc"].includes(s.kind)))
    return "origin/client-scoped";
  const subject = clause[0];
  if (subject && ["public", "authenticated", "agent", "group"].includes(subject.kind))
    return subject.kind as OwnerOnlyReason["subject"];
  return "unknown";
}

/** What `checkOwnerOnlyAuto` determined, plus the documents its answer rests on. */
export type OwnerOnlyAutoResult = OwnerOnlyResult & {
  /** The model (and, for ACP, dialect) detected from the pod itself. */
  detected: DetectedAccessControl;
  /**
   * The access document that decided: the effective ACL for WAC (the resource's own, or the
   * nearest ancestor's it inherits), the resource's own ACR for ACP private, or the document
   * holding the first non-owner rule when exposed. Absent when nothing was read to a verdict.
   */
  decidedBy?: string;
  /** Every access document read for the verdict, nearest first. */
  evaluated: readonly string[];
};

interface Inspection {
  result: OwnerOnlyResult;
  decidedBy?: string;
  evaluated: string[];
}

/** An explicit option must agree with what the access document itself shows. */
function assertAgrees(
  dataset: DatasetCore,
  acpLink: boolean,
  model: "wac" | "acp",
  dialect: "css" | "ess" | undefined,
  explicitModel: boolean,
): void {
  // Only an explicit `accessModel` can turn a disagreement into an error; every other caller
  // keeps the non-throwing refusal.
  if (!explicitModel) return;
  const shown = shownModel(dataset, acpLink);
  if ((shown === "wac" || shown === "acp") && shown !== model)
    throw ownerOnlyConflict("model", model, shown);
  const dialectShown = model === "acp" ? shownDialect(dataset) : undefined;
  if (dialectShown !== undefined && dialectShown !== dialect)
    throw ownerOnlyConflict("dialect", dialect as string, dialectShown);
}

async function inspect(
  options: Pick<OwnerOnlyOptions, "storage" | "url" | "ownerWebId">,
  model: "wac" | "acp",
  acpDialect: "css" | "ess" | undefined,
  explicitModel: boolean,
): Promise<Inspection> {
  const { storage, url, ownerWebId } = options;
  const evaluated: string[] = [];
  const done = (result: OwnerOnlyResult, decidedBy?: string): Inspection => ({
    result,
    ...(decidedBy === undefined ? {} : { decidedBy }),
    evaluated,
  });
  try {
    const root = storage.root;
    scoped(root, root);
    scoped(url, root);
    safeIri(ownerWebId);
    const owner = new URL(ownerWebId);
    if (!/^https?:$/.test(owner.protocol) || owner.username || owner.password)
      return done(refused("unknown"));
    const reasons: OwnerOnlyReason[] = [];
    let container = false;
    let current: string | undefined = url;
    for (let depth = 0; current !== undefined && depth < 64; depth++) {
      const head = await storage.head(current, { revalidate: true });
      if (head.url !== current || head.status !== 200) return done(refused("unknown"));
      // storage.root is caller-supplied and may be a sub-root. ACP member policies above it
      // would never be examined, so reaching the root requires the server's pim:Storage type.
      if (
        current === root &&
        !(head.links.get("type") ?? []).some((link) => link.target === PIM_STORAGE)
      )
        return done(refused("not-storage-root"));
      if (current === url) container = head.kind === "container";
      const found = locate(head, storage, root);
      if ("problem" in found) return done(refused("unknown"));
      // A resource that advertises an ACP access-control relation is not a WAC resource. With
      // an explicit WAC model that is a conflict; with a discovered one, a refusal.
      if (model === "wac" && found.acpLink) {
        if (explicitModel) throw ownerOnlyConflict("model", "wac", "acp");
        return done(refused("unknown"));
      }
      // Positive server evidence that WAC is enforced: a document's vocabulary only shows what
      // someone wrote, and an ACP server advertises its ACRs with rel="acl" as well.
      if (model === "wac" && current === url && !hasWacEvidence(head))
        return done(refused("no-wac-evidence"));
      // Only a revalidated WAC HEAD 404 establishes absence and permits inheritance.
      // An unreadable ACL, or any missing ACP ACR, never establishes private access.
      const document = await loadAccessDocument(storage, found.endpoint);
      if (!document) {
        if (model !== "wac") return done(refused("unknown"));
        current = parent(current, root);
        continue;
      }
      const { endpoint } = found;
      evaluated.push(endpoint);
      const dataset = document.dataset;
      if (!dataset.size) return done(refused("unknown"));
      assertAgrees(dataset, found.acpLink, model, acpDialect, explicitModel);
      let parsed: EffectivePolicy;
      try {
        parsed = policy(dataset, current, endpoint, model, acpDialect ?? "css");
      } catch {
        return done(refused("unrepresentable"));
      }
      if (!parsed.grants.length) return done(refused("unrepresentable"));
      if (
        model === "wac" &&
        current !== url &&
        !parsed.grants.some((grant) => grant.appliesTo !== "resource")
      )
        return done(refused("unknown"));
      for (const grant of parsed.grants) {
        if (
          !grant.modes.size ||
          (current !== url && grant.appliesTo === "resource") ||
          (current === url && !container && grant.appliesTo === "members")
        )
          continue;
        // Exclusions and denials cannot make a potentially non-owner grant private here.
        // Requiring the exact supplied identity is the only accepted owner restriction.
        for (const clause of grant.who.length ? grant.who : [[]]) {
          if (clause.some((subject) => subject.kind === "agent" && subject.webId === ownerWebId))
            continue;
          const subject = subjectKind(clause);
          reasons.push({
            subject,
            modes: [...grant.modes],
            reason: subject === "unknown" ? "unknown" : "non-owner",
          });
        }
      }
      if (reasons.length) return done({ private: false, reasons }, endpoint);
      if (model === "wac") return done({ private: true }, endpoint);
      if (current === root) return done({ private: true }, evaluated[0]);
      current = parent(current, root);
    }
    return done(refused("unknown"));
  } catch (error) {
    if (isOwnerOnlyConflictError(error)) throw error;
    return done(refused("unknown"));
  }
}

/**
 * Inspect raw effective access, never the lossy role projection. Containers include member
 * defaults. Any discovery, transport or representation uncertainty refuses the assertion.
 * This is a read-time observation, not an atomic guarantee for a subsequent write.
 *
 * The model is `options.accessModel` when given, otherwise the discovered
 * `features.accessControl`; ACP additionally needs `options.acpDialect`. An explicit option
 * must agree with the access document or an `OwnerOnlyConflict` error is thrown (the only error
 * this function throws). Without a model to hand, use {@link checkOwnerOnlyAuto}.
 *
 * WAC inheritance: a resource's own ACL decides when it exists (a revalidated 404 means
 * absent); otherwise the nearest ancestor ACL decides and only its `acl:default` rules apply,
 * its `acl:accessTo`-only rules being ignored. ACP evaluates the resource's own ACR and then
 * every ancestor's member policies up to a `pim:Storage` root.
 */
export async function checkOwnerOnly(options: OwnerOnlyOptions): Promise<OwnerOnlyResult> {
  const { storage, acpDialect } = options;
  const discovered =
    storage.features.accessControl.state === "available"
      ? storage.features.accessControl.detail.model
      : "none";
  // An explicit model wins over unknown or absent features only; features that positively name
  // the other model are a contradiction, never silently resolved.
  if (
    options.accessModel !== undefined &&
    (discovered === "wac" || discovered === "acp") &&
    discovered !== options.accessModel
  )
    throw ownerOnlyConflict("model", options.accessModel, discovered);
  const model = options.accessModel ?? discovered;
  if (storage.protocol !== "solid" || (model !== "wac" && model !== "acp"))
    return refused("unsupported-model");
  if (model === "acp" && acpDialect !== "css" && acpDialect !== "ess")
    return refused("unrepresentable");
  return (await inspect(options, model, acpDialect, options.accessModel !== undefined)).result;
}

/**
 * Detect the model and ACP dialect with {@link detectAccessControl}, then run the same check
 * with them as explicit options, returning that result plus what was detected and which
 * documents decided. A separate function rather than an option on `checkOwnerOnly`, because its
 * result carries extra fields and it needs no `features` or `acpDialect` from the caller.
 * Anything undecided is a refusal with reason `"undecided"`, never private. It does not throw
 * for a document that changed between detection and the check: that is a refusal too.
 */
export async function checkOwnerOnlyAuto(
  options: Pick<OwnerOnlyOptions, "storage" | "url" | "ownerWebId">,
): Promise<OwnerOnlyAutoResult> {
  const detected = await detectAccessControl(options);
  if (detected.model === "undecided") return { ...refused("undecided"), detected, evaluated: [] };
  const dialect = detected.model === "acp" ? detected.dialect : undefined;
  try {
    const { result, decidedBy, evaluated } = await inspect(options, detected.model, dialect, true);
    return { ...result, detected, ...(decidedBy === undefined ? {} : { decidedBy }), evaluated };
  } catch {
    // inspect throws only OwnerOnlyConflictError: the document changed after detection.
    return { ...refused("unknown"), detected, evaluated: [] };
  }
}
