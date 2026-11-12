// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type ActionProposal,
  canonicalJson,
  digestOf,
  fromRdf,
  recordToTurtle,
} from "@jeswr/agent-model";
import { buildOwnerOnlyAclTurtle, messageSlug } from "@jeswr/agentic-legacy-bridge";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { PodAuth } from "@jeswr/pod-auth";
import { serialize } from "@jeswr/rdf-serialize";
import { type ReadResult, type StorageClient, StorageError } from "@jeswr/storage-client";
import { createAt, isExactChildUrl } from "@jeswr/storage-client/helpers";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";

const AGENT = "https://jeswr.org/ns/agent#";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
class Node extends TermWrapper {
  iris(p: string) {
    return SetFrom.subjectPredicate(this, p, NamedNodeAs.string, NamedNodeFrom.string);
  }
  iri(p: string, v: string) {
    OptionalAs.object(this, p, v, NamedNodeFrom.string);
  }
  text(p: string, v: string) {
    OptionalAs.object(this, p, v, LiteralFrom.string);
  }
}
const node = (store: Store, id: string) => new Node(DataFactory.namedNode(id), store, DataFactory);
const turtle = (store: Store) => serialize([...store], { format: "text/turtle" });
const safe = (value: string) => {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    /[\s\\]/.test(value)
  )
    throw new Error("Unsafe workspace URL");
  return u;
};

/** All URLs are derived locally or scope checked before releasing the DPoP transport. */
export class PodWorkspace {
  readonly io: PodAuth["fetch"];
  readonly storage: StorageClient;
  readonly root: string;
  readonly ownerWebId: string;
  private readonly index: string;
  constructor(options: {
    io: PodAuth["fetch"];
    storage: StorageClient;
    root: string;
    ownerWebId: string;
    privateTypeIndex: string;
  }) {
    if (options.storage.protocol !== "solid") throw new Error("Workspace requires Solid storage");
    const root = safe(options.root);
    if (!root.pathname.endsWith("/") || root.hash) throw new Error("Invalid storage root");
    const owner = safe(options.ownerWebId);
    if (options.storage.root !== root.href) throw new Error("Invalid storage root");
    this.storage = options.storage;
    this.root = root.href;
    this.ownerWebId = owner.href;
    this.index = options.privateTypeIndex;
    this.io = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      this.assertScope(url);
      const response = await options.io(input, { ...init, redirect: "manual", cache: "no-store" });
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
        throw new Error("Pod redirect refused");
      return response;
    };
    this.assertScope(this.index);
  }
  private assertScope(value: string) {
    const url = safe(value);
    const root = new URL(this.root);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || url.hash)
      throw new Error("Pod URL outside storage");
  }
  url(path: string): string {
    const url = new URL(path, `${this.root}agent/`).href;
    if (!this.within(url)) throw new Error("URL outside workspace");
    return url;
  }
  within(value: string, path = ""): boolean {
    try {
      const url = safe(value);
      const base = new URL(path, `${this.root}agent/`);
      return url.origin === base.origin && url.pathname.startsWith(base.pathname) && !url.hash;
    } catch {
      return false;
    }
  }
  private async put(url: string, body: string) {
    this.assertScope(url);
    try {
      // These snapshots (ACL, triage, descriptor, heartbeat) were unconditional PUTs.
      await this.storage.write(url, body, { contentType: "text/turtle", ifMatch: "*" });
    } catch (error) {
      throw this.failure(
        error instanceof StorageError && error.status === 412
          ? "Pod write conflict"
          : "Pod write failed",
        error,
      );
    }
  }
  private failure(message: string, error: unknown): Error {
    if (
      error instanceof StorageError &&
      error.status !== null &&
      error.status >= 300 &&
      error.status < 400
    )
      return new Error("Pod redirect refused");
    return new Error(message);
  }
  private nameTaken(error: unknown): boolean {
    return error instanceof StorageError && error.code === "conflict" && error.status === 412;
  }
  private async create(
    url: string,
    body: string | null,
    kind: "resource" | "container" = "resource",
  ) {
    this.assertScope(url);
    return createAt(this.storage, url, body, {
      kind,
      contentType: "text/turtle",
    });
  }

  private async document(
    url: string,
  ): Promise<{ store: Store; etag: string | null; missing: boolean }> {
    this.assertScope(url);
    let response: ReadResult;
    try {
      response = await this.storage.read(url, { accept: "text/turtle" });
    } catch (error) {
      if (error instanceof StorageError && error.status === 404)
        return { store: new Store(), etag: null, missing: true };
      throw this.failure("Pod read failed", error);
    }
    if (!response.body) throw new Error("Pod read failed");
    const reader = response.body.getReader();
    const buffers: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024 * 1024) throw new Error("Pod document exceeds bound");
        buffers.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const type = response.contentType?.split(";")[0];
    if (!type || !["text/turtle", "application/trig", "application/n-triples"].includes(type))
      throw new Error("Unsupported pod document");
    const store = new Store(
      await parseRdf(Buffer.concat(buffers).toString("utf8"), type, { baseIRI: url }),
    );
    return { store, etag: response.etag, missing: false };
  }
  private async container(url: string) {
    this.assertScope(url);
    try {
      await this.storage.head(url);
      return;
    } catch (error) {
      if (!(error instanceof StorageError) || error.status !== 404)
        throw this.failure("Container unavailable", error);
    }
    try {
      await this.create(url, null, "container");
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== "conflict")
        throw this.failure("Container creation failed", error);
      try {
        await this.storage.head(url);
      } catch (cause) {
        throw this.failure("Container creation failed", cause);
      }
    }
  }

  async initialize(): Promise<void> {
    await this.container(this.url(""));
    // The first nonempty write locks the workspace, before any inbox or audit content.
    await this.put(this.url(".acl"), await buildOwnerOnlyAclTurtle(this.url(""), this.ownerWebId));
    for (const path of [
      "control/",
      "approvals/",
      "inbox/",
      "proposals/",
      "conversations/",
      "outbox/",
      "audit/",
    ])
      await this.container(this.url(path));
    await this.register();
  }
  async inbox(binding: string, account: string): Promise<string> {
    if (![binding, account].every((s) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(s)))
      throw new Error("Invalid inbox identifier");
    await this.container(this.url(`inbox/${binding}/`));
    const url = this.url(`inbox/${binding}/${account}/`);
    await this.container(url);
    return url;
  }
  messageUrl(inbox: string, id: string): string {
    if (!this.within(inbox, "inbox/")) throw new Error("Invalid inbox");
    return `${inbox}${messageSlug(id)}.ttl`;
  }
  proposalLocation(id: string): string {
    return isExactChildUrl(this.url("proposals/"), id) && id.endsWith(".ttl")
      ? id
      : this.url(`proposals/${digestOf(id).slice(8)}.ttl`);
  }
  /** An ID earlier releases accepted under proposals/ that is not an exact child URL. */
  legacyProposal(id: string): boolean {
    return this.proposalLocation(id) !== id && this.within(id, "proposals/") && id.endsWith(".ttl");
  }
  /** Whether an earlier release published a legacy proposal ID; it wrote via fetch's URL. */
  async legacyProposalPublished(id: string): Promise<boolean> {
    if (!this.legacyProposal(id)) throw new Error("Proposal outside proposals container");
    return !(await this.document(new URL(id).href)).missing;
  }
  /** Replay a proposal an earlier release published at a legacy ID; never create one. */
  async confirmLegacyProposal(proposal: ActionProposal): Promise<void> {
    if (!this.legacyProposal(proposal.id)) throw new Error("Proposal outside proposals container");
    const current = await this.document(new URL(proposal.id).href);
    if (current.missing)
      throw new Error("Legacy proposal already projected; manual migration needed");
    if (canonicalJson(fromRdf(current.store, proposal.id)) !== canonicalJson(proposal))
      throw new Error("Proposal conflict");
  }
  async proposal(proposal: ActionProposal): Promise<void> {
    if (this.proposalLocation(proposal.id) !== proposal.id)
      throw new Error("Proposal outside proposals container");
    try {
      await this.create(proposal.id, await recordToTurtle(proposal));
    } catch (error) {
      if (!this.nameTaken(error)) throw this.failure("Proposal write failed", error);
      const current = await this.document(proposal.id);
      if (
        !current.missing &&
        canonicalJson(fromRdf(current.store, proposal.id)) === canonicalJson(proposal)
      )
        return;
      throw new Error("Proposal conflict");
    }
  }

  async triage(source: string, triage: { primary: string; urgency: string; confidence: number }) {
    const store = new Store();
    const url = `${source.slice(0, -4)}.triage.ttl`;
    if (!this.within(url, "inbox/")) throw new Error("Invalid triage source");
    const resource = node(store, url);
    resource.iri(`${RDF}type`, `${AGENT}TriageAssessment`);
    resource.iri("http://www.w3.org/ns/prov#wasDerivedFrom", source);
    resource.text(`${AGENT}primaryClass`, triage.primary);
    resource.text(`${AGENT}urgency`, triage.urgency);
    resource.text(`${AGENT}confidence`, String(triage.confidence));
    await this.put(url, await turtle(store));
    return triage;
  }
  /**
   * Publish the agent's introduction. The owner's app trusts only this resource for the
   * agent's WebID (the mandate subject); other descriptors/ resources are channel capabilities.
   * Rewritten on every start so it stays current.
   */
  async introduce(agentWebId: string): Promise<void> {
    const agent = safe(agentWebId).href;
    await this.container(this.url("descriptors/"));
    const store = new Store();
    const resource = node(store, this.url("descriptors/agent.ttl"));
    resource.iri(`${RDF}type`, `${AGENT}ImplementationDescription`);
    resource.iri(`${AGENT}describes`, agent);
    await this.put(resource.value, await turtle(store));
  }
  async heartbeat(at: Date, state: "running" | "paused" | "stopped" = "running"): Promise<void> {
    const store = new Store();
    const resource = node(store, this.url("control/heartbeat.ttl"));
    resource.iri(`${RDF}type`, `${AGENT}Heartbeat`);
    resource.text("http://www.w3.org/ns/prov#generatedAtTime", at.toISOString());
    resource.text(`${AGENT}state`, state);
    await this.put(resource.value, await turtle(store));
  }
  private async register() {
    // Explicit private index is provisioned/discovered by the host; no public registration.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.document(this.index);
      if (!current.missing && !current.etag) throw new Error("Type index lacks validator");
      const entry = node(current.store, `${this.index}#agent-workspace`);
      if (
        entry.iris(`${SOLID}forClass`).has(`${AGENT}AgentWorkspace`) &&
        entry.iris(`${SOLID}instance`).has(this.url(""))
      )
        return;
      entry.iri(`${RDF}type`, `${SOLID}TypeRegistration`);
      entry.iri(`${SOLID}forClass`, `${AGENT}AgentWorkspace`);
      entry.iri(`${SOLID}instance`, this.url(""));
      entry.iris(`${SOLID}instanceContainer`).clear();
      if (current.missing) {
        node(current.store, this.index).iris(`${RDF}type`).add(`${SOLID}TypeIndex`);
        node(current.store, this.index).iris(`${RDF}type`).add(`${SOLID}UnlistedDocument`);
        await this.put(`${this.index}.acl`, await this.resourceAcl(this.index));
      }
      try {
        const body = await turtle(current.store);
        if (current.missing) await this.create(this.index, body);
        else
          await this.storage.write(this.index, body, {
            contentType: "text/turtle",
            ifMatch: current.etag as string,
          });
      } catch (error) {
        if (
          error instanceof StorageError &&
          (current.missing ? this.nameTaken(error) : error.code === "precondition-failed")
        )
          continue;
        throw this.failure("Type index registration failed", error);
      }
      return;
    }
    throw new Error("Type index conflict limit");
  }
  private async resourceAcl(url: string) {
    const store = new Store();
    const acl = "http://www.w3.org/ns/auth/acl#";
    const authorization = node(store, `${url}.acl#owner`);
    authorization.iri(`${RDF}type`, `${acl}Authorization`);
    authorization.iri(`${acl}agent`, this.ownerWebId);
    authorization.iri(`${acl}accessTo`, url);
    for (const mode of ["Read", "Write", "Control"])
      authorization.iris(`${acl}mode`).add(`${acl}${mode}`);
    return turtle(store);
  }
}
