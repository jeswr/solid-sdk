// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type RdfReadResult, StorageError } from "@jeswr/storage-client";
import type { DatasetCore } from "@rdfjs/types";
import { Policy } from "@solid/object";
import { DataFactory } from "n3";
import { ACL, ACP, modeIri, parent, RDF, RdfNode, safeIri } from "./rdf.js";
import { scoped } from "./roles/http.js";
import { readAcp } from "./systems/acp.js";
import { readWac } from "./systems/wac.js";
import type { AccessClientOptions, AccessMode, EffectivePolicy, Subject } from "./types.js";

/** Uses the same storage and independently established ACP dialect as createAccessClient. */
export interface OwnerOnlyOptions extends Pick<AccessClientOptions, "storage" | "acpDialect"> {
  url: string;
  ownerWebId: string;
}

/** Deliberately excludes policy text, identifiers and transport error messages. */
export interface OwnerOnlyReason {
  subject: "public" | "authenticated" | "agent" | "group" | "origin/client-scoped" | "unknown";
  modes: AccessMode[];
  reason: "non-owner" | "unknown" | "unrepresentable" | "unsupported-model";
}

export type OwnerOnlyResult = { private: true } | { private: false; reasons: OwnerOnlyReason[] };

function refused(reason: OwnerOnlyReason["reason"]): OwnerOnlyResult {
  return { private: false, reasons: [{ subject: "unknown", modes: [], reason }] };
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

/**
 * Inspect raw effective access, never the lossy role projection. Containers include member
 * defaults. Any discovery, transport or representation uncertainty refuses the assertion.
 * This is a read-time observation, not an atomic guarantee for a subsequent write.
 */
export async function checkOwnerOnly(options: OwnerOnlyOptions): Promise<OwnerOnlyResult> {
  const { storage, url, ownerWebId, acpDialect } = options;
  try {
    const model =
      storage.features.accessControl.state === "available"
        ? storage.features.accessControl.detail.model
        : "none";
    if (storage.protocol !== "solid" || (model !== "wac" && model !== "acp"))
      return refused("unsupported-model");
    if (model === "acp" && acpDialect !== "css" && acpDialect !== "ess")
      return refused("unrepresentable");
    const root = storage.root;
    scoped(root, root);
    scoped(url, root);
    safeIri(ownerWebId);
    const owner = new URL(ownerWebId);
    if (!/^https?:$/.test(owner.protocol) || owner.username || owner.password)
      return refused("unknown");
    const reasons: OwnerOnlyReason[] = [];
    let container = false;
    let current: string | undefined = url;
    for (let depth = 0; current !== undefined && depth < 64; depth++) {
      const head = await storage.head(current, { revalidate: true });
      if (head.url !== current || head.status !== 200) return refused("unknown");
      if (current === url) container = head.kind === "container";
      const links = [
        ...(head.links.get("acl") ?? []),
        ...(head.links.get(`${ACP}accessControl`) ?? []),
      ];
      if (model === "wac" && head.links.has(`${ACP}accessControl`)) return refused("unknown");
      if (links.some((link) => Object.hasOwn(link.params, "anchor"))) return refused("unknown");
      const endpoints = [...new Set(links.map((link) => link.target))];
      if (endpoints.length !== 1) return refused("unknown");
      const endpoint = scoped(endpoints[0] as string, root, true);
      if (!storage.isWithinStorage(endpoint)) return refused("unknown");
      let accessHead: Awaited<ReturnType<typeof storage.head>>;
      try {
        accessHead = await storage.head(endpoint, { revalidate: true });
      } catch (error) {
        // Only a revalidated WAC HEAD 404 establishes absence and permits inheritance.
        // An unreadable ACL, or any missing ACP ACR, never establishes private access.
        if (model === "wac" && error instanceof StorageError && error.status === 404) {
          current = parent(current, root);
          continue;
        }
        throw error;
      }
      if (
        accessHead.url !== endpoint ||
        accessHead.status !== 200 ||
        accessHead.etag === null ||
        !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(accessHead.etag)
      )
        return refused("unknown");
      // readRdf has no cache-control option. Bind its possibly cached representation to
      // a fresh HEAD validator. A GET failure after an existing HEAD is never absence.
      const read: RdfReadResult = await storage.readRdf(endpoint);
      if (
        read.url !== endpoint ||
        read.etag !== accessHead.etag ||
        read.notModified ||
        !read.dataset.size ||
        read.dataset.size > 10_000
      )
        return refused("unknown");
      let parsed: EffectivePolicy;
      try {
        parsed = policy(read.dataset, current, endpoint, model, acpDialect ?? "css");
      } catch {
        return refused("unrepresentable");
      }
      if (!parsed.grants.length) return refused("unrepresentable");
      if (
        model === "wac" &&
        current !== url &&
        !parsed.grants.some((grant) => grant.appliesTo !== "resource")
      )
        return refused("unknown");
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
      if (reasons.length) return { private: false, reasons };
      if (model === "wac" || current === root) return { private: true };
      current = parent(current, root);
    }
    return refused("unknown");
  } catch {
    return refused("unknown");
  }
}
