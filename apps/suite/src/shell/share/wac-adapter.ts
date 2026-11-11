// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, isContainerUrl, refuseRedirects } from "@jeswr/guarded-fetch";
import { escapeIri, safeHttpIri } from "@jeswr/rdf-serialize";
import type { DatasetCore, Term } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import {
  diffSharing,
  readSharing,
  type SharingInput,
  type SharingSelection,
} from "../../apps/drive/lib/sharing";
import {
  type ShareCapabilities,
  ShareError,
  type ShareRole,
  type ShareWriteOptions,
  type SharingAdapter,
  type SharingState,
} from "./types";

const ACL = "http://www.w3.org/ns/auth/acl#";
const PUBLIC = "http://xmlns.com/foaf/0.1/Agent";
export const wacShareCapabilities: ShareCapabilities = {
  publicLinks: true,
  authenticatedAgentGrants: false,
  grantExpiry: false,
  grantPurpose: false,
  notifyAgents: false,
  accessRequests: false,
  managerRole: false,
};
class ScopedAuthorization extends Authorization {
  values(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
interface LoadedDocument {
  resource: string;
  source: string;
  dataset: DatasetCore;
  etag: string | null;
}
interface Snapshot {
  documents: LoadedDocument[];
  state: SharingState;
}

/** Own WAC documents only. Missing/inherited/unsupported ACLs fail closed; never create a new ACL.
 * Commenters can create comments but cannot edit them yet.
 */
export class WacSharingAdapter implements SharingAdapter {
  readonly caps = wacShareCapabilities;
  readonly supportsCommenter: boolean;
  readonly supportsGeneralCommenter = false;
  private fetch: typeof fetch;
  private snapshots = new Map<string, Snapshot>();
  /** The comments ACL belongs to one document, so an adapter with one serves only that URL. */
  private boundUrl: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private options: { fetch?: typeof fetch; webId: string; commentsUrl?: string }) {
    this.fetch = refuseRedirects(options.fetch ?? globalThis.fetch);
    this.supportsCommenter = !!options.commentsUrl;
  }
  private url(value: string) {
    if (safeHttpIri(value) !== value) throw new ShareError("unsupported");
    const parsed = new URL(value);
    if (parsed.username || parsed.password) throw new ShareError("unsupported");
    return value;
  }
  private async check(response: Response) {
    if (response.status === 403) throw new ShareError("forbidden");
    if (!response.ok) throw new ShareError("network");
    return response;
  }
  private async document(resource: string, signal: AbortSignal): Promise<LoadedDocument> {
    this.url(resource);
    const head = await this.check(await this.fetch(resource, { method: "HEAD", signal }));
    const links = [...(head.headers.get("link") ?? "").matchAll(/<([^>]+)>\s*([^,]*)/g)];
    const targets = links.filter((match) => {
      const rel = (match[2] ?? "").match(/;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i);
      return (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("acl");
    });
    if (targets.length !== 1) throw new ShareError("unsupported");
    const target = targets[0]?.[1];
    if (!target) throw new ShareError("unsupported");
    const source = this.url(new URL(target, resource).href);
    assertWithinPodScope(new URL("/", resource).href, source);
    if (source === resource || new URL(source).hash) throw new ShareError("unsupported");
    const response = await this.check(
      await this.fetch(source, { headers: { accept: "text/turtle" }, signal }),
    );
    const dataset = await parseRdf(response.body ?? "", response.headers.get("content-type"), {
      baseIRI: source,
    });
    return { resource, source, dataset, etag: response.headers.get("etag") };
  }
  private input(documents: LoadedDocument[]): SharingInput {
    const context = (doc: LoadedDocument) => ({
      resource: doc.resource,
      documents: [
        {
          model: "wac" as const,
          dataset: doc.dataset,
          source: doc.source,
          governingResource: doc.resource,
          inherited: false,
        },
      ],
    });
    const first = documents[0];
    if (!first) throw new ShareError("unsupported");
    return {
      access: context(first),
      ...(documents[1] ? { comments: context(documents[1]) } : {}),
    };
  }
  private project(documents: LoadedDocument[]): SharingState {
    const current = readSharing(this.input(documents));
    return {
      people: current.people.map(({ webId, role }) => ({ webId, role })),
      general:
        current.link === "none" ? { mode: "restricted" } : { mode: "link", role: current.link },
      canManage: current.people.some(
        (person) => person.webId === this.options.webId && person.role === "owner",
      ),
    };
  }
  async load(url: string, signal: AbortSignal): Promise<SharingState> {
    this.url(url);
    if (this.options.commentsUrl) {
      if (this.boundUrl !== undefined && this.boundUrl !== url) throw new ShareError("unsupported");
      this.boundUrl = url;
    }
    try {
      const documents = [await this.document(url, signal)];
      if (this.options.commentsUrl)
        documents.push(await this.document(this.options.commentsUrl, signal));
      if (new Set(documents.map((doc) => doc.source)).size !== documents.length)
        throw new ShareError("unsupported");
      signal.throwIfAborted();
      const state = this.project(documents);
      this.snapshots.set(url, { documents, state });
      return structuredClone(state);
    } catch (error) {
      const previous = this.snapshots.get(url);
      if (error instanceof ShareError && error.code === "forbidden" && previous) {
        previous.state = { ...previous.state, readOnly: "forbidden" };
        return structuredClone(previous.state);
      }
      // Unreachable storage is not a lost permission: lock writes as offline, and let the
      // next successful load (a fresh snapshot) unlock them.
      if (previous && !signal.aborted)
        previous.state = {
          ...previous.state,
          // Only a failed connection is "offline"; anything else (an ACL the core can't
          // summarise, a parse error) is a lasting reason not to write.
          readOnly:
            (error instanceof ShareError && error.code === "network") || error instanceof TypeError
              ? "offline"
              : "forbidden",
        };
      throw error;
    }
  }
  private change(
    url: string,
    select: (selection: SharingSelection) => SharingSelection,
    opts?: ShareWriteOptions,
  ) {
    const pending = this.queue.then(async () => {
      const snapshot = this.snapshots.get(url);
      if (!snapshot) throw new ShareError("unsupported");
      if (snapshot.state.readOnly === "offline") throw new ShareError("network");
      if (!snapshot.state.canManage || snapshot.state.readOnly) throw new ShareError("forbidden");
      const input = this.input(snapshot.documents);
      const current = readSharing(input);
      const changes = diffSharing(input, select(current));
      // This plan and its conditional PUTs use the same snapshot. Any added mode
      // widens at least one principal/scope, even if an earlier read called it a revocation.
      if (opts?.narrowOnly && changes.some((change) => change.add.length > 0))
        throw new ShareError("would-grant");
      // No early return on an empty plan: legacy comment rules may still need narrowing.
      const next = snapshot.documents.map((doc) => ({
        ...doc,
        dataset: new Store([...doc.dataset]),
      }));
      const dirty = new Set<string>();
      const comments = next[1];
      // Narrow every legacy rule, including comments-only principals. Retain all
      // other modes and scopes exactly; migration never grants Read. The migration
      // needs its own conditional write, so it never blocks a plan that does not
      // touch the comments ACL when that ACL has no strong validator.
      if (comments && strongEtag(comments.etag) && this.narrowLegacyAppend(comments))
        dirty.add(comments.source);
      for (const change of changes) {
        const doc = next.find((entry) => entry.source === change.source);
        if (!doc) throw new ShareError("unsupported");
        this.apply(doc.dataset, change.resource, change.principal, change.add, change.remove);
        dirty.add(doc.source);
      }
      if (!dirty.size) return;
      for (const doc of next)
        if (dirty.has(doc.source) && !strongEtag(doc.etag)) throw new ShareError("unsupported");
      // Never write a state the sharing dialog cannot read back.
      try {
        readSharing(this.input(next));
      } catch {
        throw new ShareError("unsupported");
      }
      // Prepare every body before the first write. Never leave half a plan due to local validation.
      const writes = await Promise.all(
        next
          .filter((doc) => dirty.has(doc.source))
          .map(async (doc) => ({ doc, body: await this.serialize(doc.dataset) })),
      );
      try {
        for (const { doc, body } of writes) {
          const response = await this.fetch(doc.source, {
            method: "PUT",
            headers: { "content-type": "text/turtle", "if-match": doc.etag as string },
            body,
          });
          if (response.status === 412) throw new ShareError("conflict");
          await this.check(response);
        }
        // The new ETags and permissions come from storage, including changes coupled by the server.
        await this.load(url, new AbortController().signal);
        if (this.snapshots.get(url)?.state.readOnly) throw new ShareError("forbidden");
      } catch (error) {
        // Invalidate write permission before revalidation, including partially applied comments plans.
        snapshot.state = { ...snapshot.state, readOnly: "forbidden" };
        this.snapshots.set(url, snapshot);
        if (!(error instanceof ShareError && error.code === "forbidden")) {
          await this.load(url, new AbortController().signal).catch(() => undefined);
        }
        throw error;
      }
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  async setPerson(
    url: string,
    webId: string,
    role: ShareRole | null,
    opts?: ShareWriteOptions & { expires?: Date; purpose?: string },
  ) {
    this.url(webId);
    if (
      role === "manager" ||
      (role !== null && !["viewer", "commenter", "editor"].includes(role)) ||
      opts?.expires ||
      opts?.purpose
    )
      throw new ShareError("unsupported");
    return this.change(
      url,
      (current) => ({
        ...current,
        people: [
          ...current.people.filter((person) => person.webId !== webId),
          ...(role ? [{ webId, role }] : []),
        ],
      }),
      opts,
    );
  }
  async setGeneral(url: string, general: SharingState["general"], opts?: ShareWriteOptions) {
    if (
      !["restricted", "link"].includes(general.mode) ||
      (general.role !== undefined && !["viewer", "editor"].includes(general.role))
    )
      throw new ShareError("unsupported");
    return this.change(
      url,
      (current) => ({
        ...current,
        link:
          general.mode === "restricted" ? "none" : general.role === "editor" ? "editor" : "viewer",
        public: general.mode === "restricted" ? "none" : "viewer",
      }),
      opts,
    );
  }
  private apply(
    dataset: DatasetCore,
    resource: string,
    principal: { kind: "webid"; webId: string } | { kind: "public" },
    add: string[],
    remove: string[],
  ) {
    const predicate = principal.kind === "public" ? `${ACL}agentClass` : `${ACL}agent`;
    const identifier = principal.kind === "public" ? PUBLIC : principal.webId;
    // The projection has validated effective scopes. Comments may use split container
    // and member grants; ordinary folders still require symmetric authorizations.
    const container = isContainerUrl(resource);
    const comments = container && resource === this.options.commentsUrl;
    const modes = new Set<string>();
    for (const auth of [...new AclResource(dataset, DataFactory).authorizations]) {
      const scoped = new ScopedAuthorization(auth as Term, dataset, DataFactory);
      if (!scoped.values(predicate).has(identifier)) continue;
      const own = scoped.values(`${ACL}accessTo`).has(resource);
      const members =
        container &&
        (scoped.values(`${ACL}default`).has(resource) ||
          scoped.values(`${ACL}defaultForNew`).has(resource));
      if (container && !comments && own !== members) throw new ShareError("unsupported");
      if (!own && !members) continue;
      if (own) for (const mode of auth.mode) modes.add(mode);
      // Split the principal away from ALL other principals before changing its target scope.
      const isolated = this.copyAuthorization(auth);
      scoped.values(predicate).delete(identifier);
      if (!scoped.agent.size && !scoped.agentClass.size && !scoped.values(`${ACL}agentGroup`).size)
        this.dropAuthorization(scoped);
      isolated.values(`${ACL}agent`).clear();
      isolated.values(`${ACL}agentClass`).clear();
      isolated.values(`${ACL}agentGroup`).clear();
      isolated.values(predicate).add(identifier);
      isolated.values(`${ACL}accessTo`).delete(resource);
      if (container) {
        isolated.values(`${ACL}default`).delete(resource);
        isolated.values(`${ACL}defaultForNew`).delete(resource);
      }
      if (
        !isolated.values(`${ACL}accessTo`).size &&
        !isolated.values(`${ACL}default`).size &&
        !isolated.values(`${ACL}defaultForNew`).size
      ) {
        this.dropAuthorization(isolated);
      }
    }
    for (const mode of remove) modes.delete(ACL + mode);
    for (const mode of add) modes.add(ACL + mode);
    if (!modes.size) return;
    const grant = new ScopedAuthorization(DataFactory.blankNode(), dataset, DataFactory);
    grant.type.add(`${ACL}Authorization`);
    grant.values(`${ACL}accessTo`).add(resource);
    grant.values(predicate).add(identifier);
    for (const mode of modes) grant.mode.add(mode);
    const memberModes = [...modes].filter((mode) => !comments || mode !== `${ACL}Append`);
    if (container && memberModes.length) {
      if (memberModes.length === modes.size) grant.values(`${ACL}default`).add(resource);
      else {
        const members = new ScopedAuthorization(DataFactory.blankNode(), dataset, DataFactory);
        members.type.add(`${ACL}Authorization`);
        members.values(`${ACL}default`).add(resource);
        members.values(predicate).add(identifier);
        for (const mode of memberModes) members.mode.add(mode);
      }
    }
  }
  private copyAuthorization(auth: Authorization): ScopedAuthorization {
    const copy = new ScopedAuthorization(DataFactory.blankNode(), auth.dataset, DataFactory);
    for (const quad of [...auth.dataset.match(auth as Term)])
      SetFrom.subjectPredicate(copy, quad.predicate.value, TermAs.term, TermFrom.itself).add(
        quad.object,
      );
    return copy;
  }
  private dropAuthorization(auth: Authorization): void {
    for (const quad of [...auth.dataset.match(auth as Term)]) auth.dataset.delete(quad);
  }
  private narrowLegacyAppend(doc: LoadedDocument): boolean {
    let changed = false;
    for (const auth of [...new AclResource(doc.dataset, DataFactory).authorizations]) {
      const scoped = new ScopedAuthorization(auth as Term, doc.dataset, DataFactory);
      // Only Read/Append rules are legacy commenter shapes. Write already reaches members
      // as Append, and Control holders can rewrite this ACL; leave both unchanged.
      if (
        !auth.mode.has(`${ACL}Append`) ||
        [...auth.mode].some((mode) => mode !== `${ACL}Read` && mode !== `${ACL}Append`) ||
        !["default", "defaultForNew"].some((p) => scoped.values(ACL + p).has(doc.resource))
      )
        continue;
      // Split only the mode and target placement, retaining every principal and
      // unrelated scope. Never add a target when narrowing a defaults-only rule.
      const append = this.copyAuthorization(auth);
      append.mode.clear();
      append.mode.add(`${ACL}Append`);
      append.values(`${ACL}default`).delete(doc.resource);
      append.values(`${ACL}defaultForNew`).delete(doc.resource);
      if (
        !append.values(`${ACL}accessTo`).size &&
        !append.values(`${ACL}default`).size &&
        !append.values(`${ACL}defaultForNew`).size
      )
        this.dropAuthorization(append);
      scoped.mode.delete(`${ACL}Append`);
      if (!scoped.mode.size) this.dropAuthorization(scoped);
      changed = true;
    }
    return changed;
  }
  private serialize(dataset: DatasetCore): Promise<string> {
    for (const quad of dataset)
      for (const term of [quad.subject, quad.predicate, quad.object, quad.graph]) {
        if (
          (term.termType === "NamedNode" && escapeIri(term.value) !== term.value) ||
          (term.termType === "Literal" &&
            (escapeIri(term.datatype.value) !== term.datatype.value ||
              [...term.value].some((char) => {
                const code = char.charCodeAt(0);
                return (code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159);
              })))
        )
          throw new ShareError("unsupported");
      }
    return new Promise((resolve, reject) => {
      const writer = new Writer();
      writer.addQuads([...dataset]);
      writer.end((error, body) => (error ? reject(error) : resolve(body)));
    });
  }
}

function strongEtag(etag: string | null | undefined): etag is string {
  return !!etag && /^"[^"\r\n]*"$/.test(etag);
}
