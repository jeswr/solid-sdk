// AUTHORED-BY Codex
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { escapeIri, safeHttpIri, serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore, Term } from "@rdfjs/types";
import { DatasetWrapper, NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import {
  AccessControl,
  AccessControlResource,
  AclResource,
  AcrDataset,
  Authorization,
  Matcher,
  Policy,
} from "@solid/object";
import { DataFactory, Store } from "n3";
import { accessControl } from "../client/access";
import { PUBLIC, readGrants, SharingError } from "./rdf";
import { diffSharing, readSharing } from "./sharing";
import type {
  AccessDocument,
  AuthorizationChange,
  SharingInput,
  SharingSelection,
  SharingState,
} from "./types";

const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP = "http://www.w3.org/ns/solid/acp#";
const FOAF = "http://xmlns.com/foaf/0.1/Agent";

class Properties extends TermWrapper {
  values(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
  terms(predicate: string) {
    return SetFrom.subjectPredicate(
      this,
      predicate,
      (term) => term as Term,
      (term: Term) => term,
    );
  }
}
class Acrs extends DatasetWrapper {
  get resources() {
    return this.subjectsOf(`${ACP}resource`, AccessControlResource);
  }
}
function properties(term: Term, dataset: DatasetCore) {
  return new Properties(term, dataset, DataFactory);
}

/** Clone a node through typed setters, retaining foreign metadata without synthesizing quads. */
function clone(term: Term, from: DatasetCore, to: DatasetCore, exclude: string[]): Properties {
  const copy = properties(DataFactory.blankNode(), to);
  const original = properties(term, from);
  for (const predicate of new Set([...from.match(term)].map((q) => q.predicate.value))) {
    if (!exclude.includes(predicate))
      for (const object of original.terms(predicate)) copy.terms(predicate).add(object);
  }
  return copy;
}

export interface SharingSession {
  readonly fetch: typeof globalThis.fetch;
  readonly storageUrl: string;
  readonly webId: string;
}
export interface SharingSnapshot {
  readonly input: SharingInput;
  readonly state: SharingState;
  readonly own: AccessDocument;
  readonly ownExists: boolean;
  readonly etags: ReadonlyMap<string, string | null>;
  readonly canManage: boolean;
}
export class SharingConflictError extends Error {
  constructor(readonly snapshot: SharingSnapshot) {
    super("Sharing changed elsewhere, review and try again");
  }
}
/** The PUT committed or its response was lost. Discard stale controls; retry only the read. */
export class SharingRefreshError extends Error {
  constructor(
    cause: unknown,
    readonly committed = true,
  ) {
    super(
      committed
        ? "Sharing was saved, but current access couldn't be reloaded. Retry to verify access."
        : "The sharing write outcome is unknown. Retry to verify current access before making more changes.",
      { cause },
    );
  }
}

function advertisesAcp(headers: Headers): boolean {
  for (const match of (headers.get("link") ?? "").matchAll(/<([^>]*)>\s*((?:;\s*[^,]*)*)/g)) {
    const params = match[2] as string;
    if (/;\s*anchor\s*=/i.test(params)) continue;
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(params);
    const relations = (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/);
    if (
      relations.includes(`${ACP}accessControl`) ||
      (match[1] === `${ACP}AccessControlResource` && relations.includes("type"))
    )
      return true;
  }
  return false;
}

function parent(resource: string): string {
  return new URL(resource.endsWith("/") ? ".." : ".", resource).href;
}

/** Resolve advertised endpoints; WAC stops at the nearest ACL, ACP accumulates ancestors. */
export async function loadSharing(
  session: SharingSession,
  resource: string,
): Promise<SharingSnapshot> {
  const scoped = (url: string) => assertWithinPodScope(session.storageUrl, url);
  scoped(resource);
  const discovery = accessControl(session.fetch, session.storageUrl);
  const documents: AccessDocument[] = [];
  const etags = new Map<string, string | null>();
  let own: AccessDocument | undefined;
  let ownExists = false;
  let model: "wac" | "acp" = "wac";
  let current = resource;
  for (;;) {
    const response = await session.fetch(scoped(current), {
      method: "HEAD",
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw new SharingError(`Couldn't load sharing (HTTP ${response.status})`);
    const headers = new Headers(response.headers);
    // Demo ACLs are real stored documents even though the fixture enforces no authorization.
    headers.delete("x-solid-demo-access-control");
    const source = discovery.discover(current, headers, true);
    if (current === resource && !source)
      throw new SharingError("This resource does not advertise access documents");
    if (source) {
      let dataset: DatasetCore = new Store();
      let etag: string | null = null;
      let exists = false;
      let accessHeaders = new Headers();
      try {
        const fetched = await fetchRdf(scoped(source), {
          fetch: (url, init) =>
            session.fetch(url, { ...init, cache: "no-store", redirect: "error" }),
        });
        dataset = fetched.dataset;
        etag = fetched.etag;
        exists = true;
        accessHeaders = fetched.headers;
      } catch (error) {
        if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
      }
      const acp =
        source.endsWith(".acr") ||
        advertisesAcp(headers) ||
        advertisesAcp(accessHeaders) ||
        new AcrDataset(dataset, DataFactory).acr !== undefined ||
        [...dataset].some((q) => q.predicate.value.startsWith(ACP));
      const detected = acp ? "acp" : "wac";
      if (current === resource) model = detected;
      else if (exists && model !== detected)
        throw new SharingError("Mixed access models cannot be edited");
      if (model === "wac") {
        // WAC's legacy defaultForNew has the same inheritance semantics as default.
        for (const auth of new AclResource(dataset, DataFactory).authorizations) {
          const rule = properties(auth as Term, dataset);
          for (const value of rule.values(`${ACL}defaultForNew`))
            rule.values(`${ACL}default`).add(value);
        }
      }
      const document: AccessDocument = {
        model,
        dataset,
        source,
        governingResource: current,
        inherited: current !== resource,
      };
      etags.set(source, exists ? etag : null);
      if (current === resource) {
        own = document;
        ownExists = exists;
      }
      if (exists) documents.push(document);
      if (exists && model === "wac") break;
    }
    if (current === session.storageUrl) break;
    current = scoped(parent(current));
  }
  // The own endpoint is required above, even when the server returns 404 for its document.
  const destination = own as AccessDocument;
  if (model === "acp" && !documents.includes(destination)) documents.unshift(destination);
  if (!documents.length) throw new SharingError("No governing access document was found");
  const input: SharingInput = { access: { resource, documents } };
  const state = readSharing(input);
  return {
    input,
    state,
    own: destination,
    ownExists,
    etags,
    canManage: state.people.some((p) => p.webId === session.webId && p.role === "owner"),
  };
}

/** Copy effective WAC defaults before creating an own ACL. Never edit the ancestor. */
function editable(snapshot: SharingSnapshot): SharingInput {
  const { input, own } = snapshot;
  if (input.access.documents.every((d) => d.inherited)) {
    const dataset = new Store();
    const inherited = input.access.documents[0] as AccessDocument;
    for (const authorization of new AclResource(inherited.dataset, DataFactory).authorizations) {
      const original = properties(authorization as Term, inherited.dataset);
      if (!original.values(`${ACL}default`).has(inherited.governingResource)) continue;
      const copied = clone(authorization as Term, inherited.dataset, dataset, [
        `${ACL}accessTo`,
        `${ACL}default`,
        `${ACL}defaultForNew`,
      ]);
      copied.values(`${ACL}accessTo`).add(input.access.resource);
      if (input.access.resource.endsWith("/"))
        copied.values(`${ACL}default`).add(input.access.resource);
    }
    return { access: { resource: input.access.resource, documents: [{ ...own, dataset }] } };
  }
  return {
    access: {
      ...input.access,
      documents: input.access.documents.map((d) => ({ ...d, dataset: new Store([...d.dataset]) })),
    },
  };
}

function rewriteWac(document: AccessDocument, change: AuthorizationChange) {
  const dataset = document.dataset;
  const principal = change.principal.kind === "public" ? FOAF : change.principal.webId;
  const selector = change.principal.kind === "public" ? "agentClass" : "agent";
  // One folder selection governs both the folder and inheriting descendants, including
  // default-only rules and legacy defaultForNew. Other targets retain their own modes.
  const targets = [
    `${ACL}accessTo`,
    ...(change.resource.endsWith("/") ? [`${ACL}default`, `${ACL}defaultForNew`] : []),
  ];
  const allowed = new Set(
    readGrants({ resource: document.governingResource, documents: [document] })
      .filter(
        (grant) => grant.principal === (change.principal.kind === "public" ? PUBLIC : principal),
      )
      .flatMap((grant) => [...grant.modes]),
  );
  for (const mode of change.remove) allowed.delete(mode);
  for (const mode of change.add) allowed.add(mode);
  for (const authorization of [...new AclResource(dataset, DataFactory).authorizations]) {
    const rule = properties(authorization as Term, dataset);
    const affected = targets.filter((predicate) => rule.values(predicate).has(change.resource));
    if (!affected.length || !rule.values(ACL + selector).has(principal)) continue;
    // Split the changed scopes and principal, preserving unrelated scopes and metadata.
    const scope = clone(authorization as Term, dataset, dataset, [
      `${ACL}accessTo`,
      `${ACL}default`,
      `${ACL}defaultForNew`,
    ]);
    for (const predicate of affected) {
      rule.values(predicate).delete(change.resource);
      scope.values(predicate).add(change.resource);
    }
    scope.values(ACL + selector).delete(principal);
    const personal = clone(scope as Term, dataset, dataset, [
      `${ACL}agent`,
      `${ACL}agentClass`,
      `${ACL}agentGroup`,
    ]);
    personal.values(ACL + selector).add(principal);
    personal.values(`${ACL}mode`).clear();
    for (const mode of allowed) personal.values(`${ACL}mode`).add(ACL + mode);
  }
  if (allowed.size) {
    const rule = new Authorization(DataFactory.blankNode(), dataset, DataFactory);
    rule.type.add(`${ACL}Authorization`);
    rule.accessTo = change.resource;
    if (change.resource.endsWith("/")) rule.default = change.resource;
    properties(rule as Term, dataset)
      .values(ACL + selector)
      .add(principal);
    for (const mode of allowed) rule.mode.add(ACL + mode);
  }
}

function rewriteAcp(document: AccessDocument, resource: string, changes: AuthorizationChange[]) {
  const dataset = document.dataset;
  const modesFor = (scope: "resource" | "members") => {
    const modes = new Map<string, Set<string>>();
    for (const grant of readGrants(
      { resource: document.governingResource, documents: [document] },
      scope,
    ).filter((g) => g.resource === resource)) {
      const values = modes.get(grant.principal) ?? new Set<string>();
      for (const mode of grant.modes) values.add(mode);
      modes.set(grant.principal, values);
    }
    return modes;
  };
  const modes = modesFor("resource");
  for (const change of changes) {
    const principal = change.principal.kind === "public" ? PUBLIC : change.principal.webId;
    const values = modes.get(principal) ?? new Set<string>();
    for (const mode of change.remove) values.delete(mode);
    for (const mode of change.add) values.add(mode);
    modes.set(principal, values);
  }
  const scopes = new Map([[`${ACP}accessControl`, modes]]);
  if (resource.endsWith("/")) {
    const members = modesFor("members");
    // The selected final role governs both scopes. Applying only the direct delta
    // would leave descendant-only modes active after downgrading or removing a row.
    for (const change of changes) {
      const principal = change.principal.kind === "public" ? PUBLIC : change.principal.webId;
      members.set(principal, modes.get(principal) as Set<string>);
    }
    scopes.set(`${ACP}memberAccessControl`, members);
  }
  const target = new AccessControlResource(DataFactory.blankNode(), dataset, DataFactory);
  target.resource = resource;
  for (const acr of [...new Acrs(dataset, DataFactory).resources]) {
    if (acr.equals(target as Term)) continue;
    const original = properties(acr as Term, dataset);
    if (!original.values(`${ACP}resource`).has(resource)) continue;
    // Detach only this target. Shared policies, matchers, other scopes and metadata survive.
    original.values(`${ACP}resource`).delete(resource);
    for (const q of dataset.match(acr as Term)) {
      if (q.predicate.value === `${ACP}resource` || scopes.has(q.predicate.value)) continue;
      for (const term of original.terms(q.predicate.value))
        properties(target as Term, dataset)
          .terms(q.predicate.value)
          .add(term);
    }
  }
  for (const [predicate, principals] of scopes) {
    const control = new AccessControl(DataFactory.blankNode(), dataset, DataFactory);
    properties(target as Term, dataset)
      .terms(predicate)
      .add(control as Term);
    for (const [principal, allowed] of principals) {
      if (!allowed.size) continue;
      const policy = new Policy(DataFactory.blankNode(), dataset, DataFactory);
      const matcher = new Matcher(DataFactory.blankNode(), dataset, DataFactory);
      control.apply.add(policy);
      policy.allOf.add(matcher);
      matcher.agent.add(principal === PUBLIC ? `${ACP}PublicAgent` : principal);
      for (const mode of allowed) policy.allow.add(ACL + mode);
    }
  }
}

export async function applySharing(
  session: SharingSession,
  snapshot: SharingSnapshot,
  selection: SharingSelection,
): Promise<SharingSnapshot> {
  if (!snapshot.canManage) throw new SharingError("Only an owner can change sharing");
  if (!selection.people.some((p) => p.webId === session.webId && p.role === "owner"))
    throw new SharingError("You cannot remove your own owner access or Control");
  for (const person of selection.people) {
    if (safeHttpIri(person.webId) !== person.webId) throw new SharingError("Enter a valid WebID");
  }
  const input = editable(snapshot);
  // Inherited WAC rows remain immutable in this UI even though the new ACL preserves them.
  for (const row of snapshot.state.people)
    if (
      row.inherited &&
      !selection.people.some((p) => p.webId === row.webId && p.role === row.role)
    )
      throw new SharingError("Inherited access must be changed at its source");
  if (
    snapshot.state.general.inherited &&
    (snapshot.state.link !== selection.link || snapshot.state.public !== selection.public)
  )
    throw new SharingError("Inherited access must be changed at its source");
  // Diff against the materialized WAC grants; ACP retains ancestor contributions.
  const changes = diffSharing(input, selection);
  if (!changes.length) return snapshot;
  const document = input.access.documents.find((d) => !d.inherited) as AccessDocument;
  if (document.model === "wac") for (const change of changes) rewriteWac(document, change);
  else
    for (const resource of new Set(changes.map((c) => c.resource)))
      rewriteAcp(
        document,
        resource,
        changes.filter((c) => c.resource === resource),
      );
  // Revalidate every source before a copied/combined policy is written, including ancestors.
  for (const source of snapshot.input.access.documents) {
    // A missing own ACR is a conditional-create destination, not a source lacking an ETag.
    if (source.source === snapshot.own.source && !snapshot.ownExists) continue;
    const etag = snapshot.etags.get(source.source);
    if (!etag || etag.startsWith("W/"))
      throw new SharingError("A strong access document ETag is required to change sharing");
    const check = await session.fetch(assertWithinPodScope(session.storageUrl, source.source), {
      method: "HEAD",
      headers: { "if-match": etag },
      cache: "no-store",
      redirect: "error",
    });
    if (
      check.status === 412 ||
      check.status === 404 ||
      (check.ok && check.headers.get("etag") !== etag)
    )
      throw new SharingConflictError(await loadSharing(session, snapshot.input.access.resource));
    if (!check.ok)
      throw new SharingError(
        `Couldn't verify sharing (HTTP ${check.status}). Permissions were not saved. Try again.`,
      );
  }
  // An intervening nearer ACL or a changed endpoint must not be overwritten by a stale copy.
  const latest = await loadSharing(session, snapshot.input.access.resource);
  if (
    latest.own.source !== snapshot.own.source ||
    latest.ownExists !== snapshot.ownExists ||
    JSON.stringify([...latest.etags]) !== JSON.stringify([...snapshot.etags])
  )
    throw new SharingConflictError(latest);
  for (const quad of document.dataset)
    for (const term of [quad.subject, quad.predicate, quad.object])
      if (term.termType === "NamedNode" && escapeIri(term.value) !== term.value)
        throw new SharingError("Unsafe IRI in the access document");
  const etag = snapshot.etags.get(document.source);
  const url = assertWithinPodScope(session.storageUrl, document.source);
  const body = await serialize([...document.dataset]);
  let response: Response;
  try {
    response = await session.fetch(url, {
      method: "PUT",
      redirect: "error",
      headers: {
        "content-type": "text/turtle",
        ...(etag ? { "if-match": etag } : { "if-none-match": "*" }),
      },
      body,
    });
  } catch (cause) {
    // A rejected fetch does not prove the server rejected the conditional write.
    throw new SharingRefreshError(cause, false);
  }
  if (response.status === 412)
    throw new SharingConflictError(await loadSharing(session, snapshot.input.access.resource));
  if (!response.ok)
    throw new SharingError(
      `Couldn't save sharing (HTTP ${response.status}). Permissions were not saved. Try again.`,
    );
  try {
    return await loadSharing(session, snapshot.input.access.resource);
  } catch (cause) {
    throw new SharingRefreshError(cause);
  }
}
