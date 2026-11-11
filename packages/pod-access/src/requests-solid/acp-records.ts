// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Term } from "@rdfjs/types";
import { Store } from "n3";
import { ACP, RDF } from "../rdf.js";
import { type AccessDocument, isMixedModel, readAccessDocuments } from "../roles/http.js";
import { appendAcp, properties, roots } from "../roles/rdf.js";
import { UnsupportedAccessModelError } from "./errors.js";
import { put, requireStrongEtag } from "./http.js";
import { set, turtle, values } from "./rdf.js";
import { ACCM, ACL } from "./vocab.js";

const SHARED = "The access records folder is shared; make it private first";
const FULL = "The access records folder does not give you full control";
const CSS_MODES: readonly string[] = [ACL.Read, ACL.Write, ACL.Append, ACL.Control];

function privateShape(condition: boolean): asserts condition {
  if (!condition) throw new Error(SHARED);
}

/** A closed CSS graph proof, separate from the roles layer's unconditional role projection. */
function verify(document: AccessDocument, owner: string, container: string) {
  const { url, resource } = document;
  const dataset: DatasetCore = document.dataset;
  const visited = new Set<string>();
  const key = (term: Term) => JSON.stringify([term.termType, term.value]);
  function node(term: Term, names: string[], type: string) {
    privateShape(
      term.termType === "BlankNode" || term.value === url || term.value.startsWith(`${url}#`),
    );
    privateShape(dataset.match(term).size > 0);
    visited.add(key(term));
    for (const q of dataset.match(term)) {
      if (
        type === "AccessControlResource" &&
        term.value === url &&
        [`${ACCM.ns}recordsKey`, `${ACCM.ns}unverifiedRecords`].includes(q.predicate.value)
      )
        continue;
      if (q.predicate.value === `${RDF}type`) privateShape(q.object.value === ACP + type);
      else privateShape(names.some((name) => q.predicate.value === ACP + name));
    }
    return properties(term, dataset);
  }
  function matcher(term: Term, granting: boolean) {
    const m = node(term, ["agent", "client", "issuer"], "Matcher");
    const agents = m.iris(`${ACP}agent`);
    const clients = m.iris(`${ACP}client`);
    const issuers = m.iris(`${ACP}issuer`);
    if (granting) privateShape(agents.every((agent) => agent === owner));
    return {
      private: agents.length === 1 && agents[0] === owner,
      full: agents.length === 1 && agents[0] === owner && !clients.length && !issuers.length,
      // Constraints might match this owner; a denial must never be silently ignored.
      mayMatchOwner:
        !agents.length || agents.some((agent) => agent === owner || agent.startsWith(ACP)),
    };
  }
  function policy(term: Term, relevant: boolean) {
    const p = node(term, ["allow", "deny", "allOf", "anyOf", "noneOf"], "Policy");
    const allow = p.iris(`${ACP}allow`);
    const deny = p.iris(`${ACP}deny`);
    for (const mode of [...allow, ...deny])
      if (!CSS_MODES.includes(mode)) throw new UnsupportedAccessModelError("acp");
    const all = p.nodes(`${ACP}allOf`).map((m) => matcher(m as Term, relevant && allow.length > 0));
    const any = p.nodes(`${ACP}anyOf`).map((m) => matcher(m as Term, relevant && allow.length > 0));
    const none = p.nodes(`${ACP}noneOf`).map((m) => matcher(m as Term, false));
    if (relevant && allow.length)
      privateShape(all.some((m) => m.private) || (any.length > 0 && any.every((m) => m.private)));
    const full =
      (all.length > 0 || any.length > 0) &&
      all.every((m) => m.full) &&
      (!any.length || any.some((m) => m.full)) &&
      !none.length;
    const mayDenyOwner =
      all.every((m) => m.mayMatchOwner) &&
      (!any.length || any.some((m) => m.mayMatchOwner)) &&
      !none.some((m) => m.full);
    return { allow: full ? allow : [], deny: mayDenyOwner ? deny : [] };
  }
  const direct = new Set<string>();
  const members = new Set<string>();
  const deniedDirect = new Set<string>();
  const deniedMembers = new Set<string>();
  const acrs = roots(dataset);
  privateShape(acrs.length > 0);
  for (const root of acrs) {
    const r = node(
      root as Term,
      ["resource", "accessControl", "memberAccessControl", "access", "memberAccess"],
      "AccessControlResource",
    );
    if (r.nodes(`${ACP}access`).length || r.nodes(`${ACP}memberAccess`).length)
      throw new UnsupportedAccessModelError("acp");
    const targets = r.iris(`${ACP}resource`);
    // CSS resource Control governs ACR access. ESS access/memberAccess and resource-less
    // roots require trusted dialect support which requests-solid does not currently expose.
    if (!targets.length) throw new UnsupportedAccessModelError("acp");
    privateShape(targets.length === 1 && (targets[0] === resource || targets[0] === url));
    for (const [name, allowed, denied] of [
      ["accessControl", direct, deniedDirect],
      ["memberAccessControl", members, deniedMembers],
    ] as const) {
      for (const control of r.nodes(ACP + name)) {
        const c = node(control as Term, ["apply"], "AccessControl");
        const policies = c.nodes(`${ACP}apply`);
        privateShape(policies.length > 0);
        for (const p of policies) {
          // ACP §6.1 and CSS resolve direct accessControl only for that resource;
          // descendants collect memberAccessControl from every ancestor. Public Read
          // on an ancestor's listing does not share this folder or reveal its ACR key.
          // Still validate the closed graph, but privacy-check only applicable scopes.
          const relevant = resource === container || name === "memberAccessControl";
          const modes = policy(p as Term, relevant);
          if (!relevant) continue;
          if (targets[0] === resource) {
            for (const mode of modes.allow) allowed.add(mode);
            for (const mode of modes.deny) denied.add(mode);
          } else {
            // Even a foreign ACR-self reader learns the sealed key. These policies were
            // privacy-checked above; conservatively refuse owner-denying auxiliary policies.
            privateShape(modes.deny.length === 0);
          }
        }
      }
    }
  }
  for (const q of dataset) {
    privateShape(q.graph.termType === "DefaultGraph");
    if (q.predicate.value.startsWith(ACP)) privateShape(visited.has(key(q.subject)));
  }
  return { direct, members, deniedDirect, deniedMembers };
}

/** Verify all additive ACR sources, then create/seal only the folder's advertised own ACR. */
export async function acpRecords(
  container: string,
  storage: string,
  owner: string,
  fetchFn: typeof fetch,
  url: string,
  settings: {
    unverified: string;
    recordsKey: string;
    assertEmpty: (refusal: string) => Promise<void>;
    notPrivate: string;
    missingKey: string;
    peek?: boolean;
    readOnly?: boolean;
    /** A not-yet-created folder: check its existing parent chain only. */
    absent?: boolean;
  },
): Promise<string | undefined> {
  const { unverified, recordsKey, assertEmpty, notPrivate, missingKey, peek, readOnly, absent } =
    settings;
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await readAccessDocuments(absent ? new URL("..", container).href : container, {
      fetch: fetchFn,
      root: `${new URL(storage).origin}/`,
      requireAncestorAccess: true,
    }).catch((error: unknown) => {
      if (isMixedModel(error)) throw new UnsupportedAccessModelError("unknown");
      throw error;
    });
    if (snapshot.model !== "acp") throw new UnsupportedAccessModelError("unknown");
    if (!absent && snapshot.ownUrl !== url) throw new Error("The advertised ACL is ambiguous");
    const own = snapshot.documents.find((document) => document.resource === container);
    if (!own && peek) return undefined;
    const checked = snapshot.documents.map((document) => ({
      document,
      proof: verify(document, owner, container),
    }));
    const inheritedDenials = new Set(
      checked
        .filter(({ document }) => document !== own)
        .flatMap(({ proof }) => [...proof.deniedMembers]),
    );
    if ([ACL.Read, ACL.Write, ACL.Control].some((mode) => inheritedDenials.has(mode)))
      throw new Error(FULL);
    const ownProof = checked.find(({ document }) => document === own)?.proof;
    if (
      ownProof &&
      ![
        [ownProof.direct, ownProof.deniedDirect] as const,
        [ownProof.members, ownProof.deniedMembers] as const,
      ].every(([allow, deny]) =>
        [ACL.Read, ACL.Write, ACL.Control].every((mode) => allow.has(mode) && !deny.has(mode)),
      )
    )
      throw new Error(FULL);
    if (!own) {
      if (!absent) await assertEmpty(notPrivate);
      if (readOnly) return undefined;
      const dataset = new Store();
      appendAcp(
        dataset,
        container,
        url,
        [{ agent: { type: "webid", id: owner }, modes: new Set(["read", "write", "control"]) }],
        "css",
        true,
      );
      set(dataset, url, unverified, "true");
      await put(url, await turtle(dataset), fetchFn, null, true);
      continue;
    }
    const key = values(own.dataset, url, recordsKey)[0];
    const pending = values(own.dataset, url, unverified).length > 0;
    if (!pending && key !== undefined) return key;
    await assertEmpty(pending ? notPrivate : missingKey);
    requireStrongEtag(own.etag);
    if (readOnly) return undefined;
    const sealed = crypto.randomUUID();
    set(own.dataset, url, unverified, undefined);
    set(own.dataset, url, recordsKey, sealed);
    if (await put(url, await turtle(own.dataset), fetchFn, own.etag)) return sealed;
  }
  throw new Error("The access records folder ACL kept changing");
}
