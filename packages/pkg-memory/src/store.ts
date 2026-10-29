// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { safeHttpIri, serialize } from "@jeswr/rdf-serialize";
import { type OdrlPolicy, policyToTurtle } from "@jeswr/solid-odrl";
import type { DatasetCore, Term } from "@rdfjs/types";
import { DataFactory as df } from "n3";
import { compareDateTimes } from "./chronology.js";
import { canonicalizeGraphWithLabels, pkgId } from "./ids.js";
import {
  buildNanopublications,
  type Nanopublication,
  type Nanopublications,
  parseNanopublications,
  serializeNanopublications,
} from "./model.js";
import { type PodConditions, type PodPort, podStatus } from "./pod-port.js";
import { readMemoryPolicy } from "./policy.js";
import { createDefaultPolicy } from "./purpose.js";
import { dateTime, graph, NS, putGraph, RdfNode, ReferenceStore as Store } from "./rdf.js";

const encode = (body: string) => new TextEncoder().encode(body);
const decode = (body: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(body);
const uuid = /^urn:uuid:([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})(?![\s\S])/;
const acl = "http://www.w3.org/ns/auth/acl#";

/** Identity and clock for an append-only withdrawal. */
export interface RetractionOptions {
  batchId: string;
  clientId: string;
  generatedAt?: string;
}

/** One TriG resource per nanopub, behind owner-only ACLs (MCP DESIGN §4). */
export class NanopubStore {
  readonly container: string;
  readonly policyUrl: string;
  private readonly root: string;
  private readonly owner: string;
  private initialized?: Promise<void>;

  constructor(private readonly pod: PodPort) {
    const root = new URL(pod.root);
    const owner = safeHttpIri(pod.webId);
    if (
      !owner ||
      owner !== pod.webId ||
      safeHttpIri(pod.root) !== pod.root ||
      root.username ||
      root.password ||
      root.search ||
      root.hash ||
      !root.pathname.endsWith("/")
    )
      throw new Error("Expected an unambiguous pod root and owner WebID");
    this.root = root.href;
    this.owner = owner;
    this.container = new URL("private/pkg/mcp/", root).href;
    this.policyUrl = new URL("private/pkg/mcp-policy.ttl", root).href;
  }

  /** Resolve only UUID nanopub identities to the fixed storage container. */
  url(id: string): string {
    const match = uuid.exec(id);
    if (!match) throw new Error("Expected a nanopublication UUID IRI");
    return `${this.container}${match[1]}.trig`;
  }

  /** Persist each nanopub separately, create-only; graph metadata is parsed before any write. */
  async put(value: Nanopublications): Promise<string[]> {
    const parsed = await parseNanopublications(await serializeNanopublications(value));
    const parts = nanopubParts(parsed);
    validateBlankNodeSharing(parsed.dataset, parts);
    await this.validatePut(parts);
    const resources = await Promise.all(
      parts.map(async ({ np, dataset }) => ({
        url: this.url(np.id),
        bytes: encode(await serializeNanopublications({ dataset, nanopubs: [np] })),
      })),
    );
    await this.initialize();
    for (const resource of resources) await this.writeNanopub(resource.url, resource.bytes);
    return resources.map((resource) => resource.url);
  }

  private async validatePut(parts: ReturnType<typeof nanopubParts>): Promise<void> {
    const collection: Nanopublications = { dataset: new Store(), nanopubs: [] };
    const shared = new Map<string, string>();
    let entries: Awaited<ReturnType<PodPort["list"]>>;
    try {
      entries = await this.pod.list(this.container);
    } catch (error) {
      if (podStatus(error) !== 404) throw error;
      entries = [];
    }
    for (const id of this.resourceIds(entries)) {
      const stored = await this.get(id);
      const names = sharedGraphNames(stored.nanopubs[0] as Nanopublication);
      for (const { dataset, sharedGraphs } of parts) {
        const common = new Set(sharedGraphs.filter((name) => names.includes(name)));
        // Later batches may share fewer graphs than this call's resources do.
        // Check each stored copy using only graphs list() can use in either order.
        if (sharedGraphLabels(dataset, common).id !== sharedGraphLabels(stored.dataset, common).id)
          throw new Error("Conflicting copies of a shared nanopublication graph");
      }
      mergeNanopublication(collection, shared, stored);
    }
    for (const { np, dataset } of parts)
      mergeNanopublication(collection, shared, { dataset, nanopubs: [np] });
    // Check all aligned resources, including when a bridging copy was loaded
    // first: nodes need a common graph in every resource that refers to them.
    validateBlankNodeSharing(collection.dataset, nanopubParts(collection));
  }

  /** Read TriG or the sole permitted byte-preserving fallback and validate identity. */
  async get(id: string): Promise<Nanopublications> {
    const result = await this.pod.read(this.url(id));
    const type = result.contentType.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/trig" && type !== "application/octet-stream")
      throw new Error("Unsupported nanopublication media type");
    const value = await parseNanopublications(decode(result.body));
    if (value.nanopubs.length !== 1 || value.nanopubs[0]?.id !== id)
      throw new Error("Nanopublication resource identity mismatch");
    return value;
  }

  /** Load immediate UUID resources only; never traverse listing-provided URLs. */
  async list(): Promise<Nanopublications> {
    const collection: Nanopublications = { dataset: new Store(), nanopubs: [] };
    const shared = new Map<string, string>();
    for (const id of this.resourceIds(await this.pod.list(this.container)))
      mergeNanopublication(collection, shared, await this.get(id));
    return collection;
  }

  private resourceIds(entries: Awaited<ReturnType<PodPort["list"]>>): Set<string> {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.isContainer || !entry.url.startsWith(this.container)) continue;
      const id = `urn:uuid:${entry.url.slice(this.container.length).replace(/\.trig$/, "")}`;
      if (!uuid.test(id) || this.url(id) !== entry.url || ids.has(id)) continue;
      ids.add(id);
    }
    return ids;
  }

  /** Append a Retracted revision; the original resource remains immutable. */
  async retract(id: string, options: RetractionOptions): Promise<Nanopublications> {
    const original = await this.get(id);
    const previous = original.nanopubs[0] as Nanopublications["nanopubs"][number];
    const now = dateTime(options.generatedAt ?? new Date().toISOString());
    if (compareDateTimes(now, previous.generatedAt) < 0)
      throw new Error("Retraction predates its original");
    const value = await buildNanopublications(
      {
        batch_id: options.batchId,
        worker: { agent_id: options.clientId, agent_label: "MCP memory retraction" },
        sources: [{ id: "original", kind: "document", url: this.url(id) }],
        claims: [
          {
            id: `retract-${id}`,
            assertion: graph(original.dataset, previous.assertionId),
            epistemic: previous.epistemic,
            validity: "Retracted",
            categories: previous.categories,
            attributed_to: this.owner,
            evidence: [{ source: "original", timestamp: now }],
          },
        ],
      },
      { owner: this.owner, generatedAt: now },
    );
    const np = value.nanopubs[0] as Nanopublications["nanopubs"][number];
    // The builder hashes its input. Already-skolemized assertions must instead
    // retain their original graph and identity in the new withdrawal envelope.
    const head = graph(value.dataset, np.id);
    const assertionLink = new RdfNode(np.id, head);
    assertionLink.terms(`${NS.np}hasAssertion`).clear();
    assertionLink.link(`${NS.np}hasAssertion`, previous.assertionId);
    const provenance = new Store();
    for (const q of graph(value.dataset, np.provenanceId)) {
      const subject =
        q.subject.termType === "NamedNode" && q.subject.value === np.assertionId
          ? previous.assertionId
          : q.subject;
      const node = new RdfNode(subject, provenance);
      if (q.object.termType === "NamedNode" && q.object.value === np.assertionId)
        node.link(q.predicate.value, previous.assertionId);
      else node.add(q.predicate.value, q.object);
    }
    new RdfNode(previous.assertionId, provenance)
      .link(`${NS.prov}wasRevisionOf`, previous.assertionId)
      .text(`${NS.prov}invalidatedAtTime`, now, `${NS.xsd}dateTime`);
    // Scope this withdrawal to its target envelope, not every copy of the assertion.
    new RdfNode(np.id, provenance).link(`${NS.prov}wasRevisionOf`, previous.id);
    const dataset = new Store(
      [...value.dataset].filter(
        (q) => ![np.id, np.assertionId, np.provenanceId].includes(q.graph.value),
      ),
    );
    putGraph(dataset, np.id, head);
    putGraph(dataset, previous.assertionId, graph(original.dataset, previous.assertionId));
    putGraph(dataset, np.provenanceId, provenance);
    np.assertionId = previous.assertionId;
    const revision = await parseNanopublications(
      await serializeNanopublications({ dataset, nanopubs: [np] }),
    );
    await this.put(revision);
    return revision;
  }

  /** Create the default once; preserve owner edits and fail closed on unreadable policies. */
  async writeDefaultPolicy(): Promise<OdrlPolicy> {
    const existing = await this.readOptional(this.policyUrl);
    if (existing) return this.readPolicy(existing.body);
    const policy = createDefaultPolicy(this.policyUrl, this.owner);
    const bytes = encode(await policyToTurtle(policy));
    await this.initialize();
    await this.protectResource(
      this.policyUrl,
      false,
      await this.readOptional(`${this.policyUrl}.acl`),
    );
    try {
      await this.pod.write(this.policyUrl, bytes, "text/turtle", { ifNoneMatch: "*" });
      return policy;
    } catch (error) {
      if (podStatus(error) !== 412) throw error;
      return this.readPolicy((await this.pod.read(this.policyUrl)).body);
    }
  }

  private async readPolicy(bytes: Uint8Array): Promise<OdrlPolicy> {
    return readMemoryPolicy(decode(bytes), this.policyUrl);
  }
  private async readOptional(url: string) {
    try {
      return await this.pod.read(url);
    } catch (error) {
      if (podStatus(error) === 404) return undefined;
      throw error;
    }
  }
  private condition(existing: { etag?: string } | undefined): PodConditions {
    if (!existing) return { ifNoneMatch: "*" };
    if (!existing.etag || existing.etag.startsWith("W/"))
      throw new Error("A strong ETag is required to replace a resource");
    return { ifMatch: existing.etag };
  }
  private async initialize(): Promise<void> {
    this.initialized ??= this.protectContainers().catch((error) => {
      this.initialized = undefined;
      throw error;
    });
    await this.initialized;
  }
  private async protectContainers(): Promise<void> {
    for (const path of ["private/", "private/pkg/", "private/pkg/mcp/"]) {
      const container = new URL(path, this.root).href;
      const existing = await this.readOptional(container);
      // Ancestors are shared with other applications; only this store's subtree is ours.
      if (container !== this.container && existing) continue;
      const existingAcl = await this.readOptional(`${container}.acl`);
      if (container === this.container || !existingAcl)
        await this.protectResource(container, true, existingAcl);
      // CSS can create the container implicitly when its ACL is written.
      if (!existing && !(await this.readOptional(container))) {
        const description = new Store();
        new RdfNode(container, description).link(
          `${NS.rdf}type`,
          "http://www.w3.org/ns/ldp#BasicContainer",
        );
        await this.pod.write(container, encode(await serialize([...description])), "text/turtle", {
          ifNoneMatch: "*",
        });
      }
    }
  }
  private async protectResource(
    url: string,
    inherit: boolean,
    existing: { etag?: string } | undefined,
  ) {
    const dataset = new Store();
    const authorization = new RdfNode(`${url}.acl#owner`, dataset)
      .link(`${NS.rdf}type`, `${acl}Authorization`)
      .link(`${acl}agent`, this.owner)
      .link(`${acl}accessTo`, url);
    if (inherit) authorization.link(`${acl}default`, url);
    for (const mode of ["Read", "Write", "Control"]) authorization.link(`${acl}mode`, acl + mode);
    await this.pod.write(
      `${url}.acl`,
      encode(await serialize([...dataset])),
      "text/turtle",
      this.condition(existing),
    );
  }
  private async writeNanopub(url: string, bytes: Uint8Array): Promise<void> {
    // A resource ACL overrides the container default, including orphan ACLs.
    await this.protectResource(url, false, await this.readOptional(`${url}.acl`));
    try {
      await this.pod.write(url, bytes, "application/trig", { ifNoneMatch: "*" });
    } catch (error) {
      if (podStatus(error) !== 415) throw error;
      await this.pod.write(url, bytes, "application/octet-stream", { ifNoneMatch: "*" });
      await this.verifyBytes(url, bytes);
      return;
    }
    const stored = await this.pod.read(url);
    if (
      !equalBytes(stored.body, bytes) ||
      stored.contentType.split(";")[0]?.trim().toLowerCase() !== "application/trig"
    ) {
      await this.pod.write(url, bytes, "application/octet-stream", this.condition(stored));
      await this.verifyBytes(url, bytes);
    }
  }
  private async verifyBytes(url: string, bytes: Uint8Array): Promise<void> {
    const stored = await this.pod.read(url);
    if (
      !equalBytes(stored.body, bytes) ||
      stored.contentType.split(";")[0]?.trim().toLowerCase() !== "application/octet-stream"
    )
      throw new Error("Pod did not preserve nanopublication bytes in octet-stream fallback");
  }
}

function sharedGraphNames(np: Nanopublication): string[] {
  return [
    np.assertionId,
    pkgId("batch", np.batch, "sources"),
    pkgId("batch", np.batch, "entities"),
  ];
}

function nanopubParts(value: Nanopublications) {
  // An incoming create may repeat a stored identity; it is still one resource.
  const nanopubs = new Map(value.nanopubs.map((np) => [np.id, np]));
  return [...nanopubs.values()].map((np) => {
    const sharedGraphs = sharedGraphNames(np);
    const dataset = new Store();
    for (const name of [np.id, np.provenanceId, np.pubinfoId, ...sharedGraphs])
      putGraph(dataset, name, graph(value.dataset, name));
    return { np, dataset, sharedGraphs };
  });
}

/** Match each resource against all graphs retained in the collection so far. */
function mergeNanopublication(
  collection: Nanopublications,
  shared: Map<string, string>,
  result: Nanopublications,
): void {
  const np = result.nanopubs[0] as Nanopublication;
  const graphs = sharedGraphNames(np).map((name) => {
    const contents = graph(result.dataset, name);
    const canonical =
      contents.size === 0
        ? { id: "", labels: new Map<string, string>() }
        : canonicalizeGraphWithLabels(contents);
    return { name, fingerprint: canonical.id, previous: shared.get(name) };
  });
  // Blank-node labels are document-local. Keep one validated graph instead
  // of unioning copies, and align references throughout the incoming dataset.
  const duplicates = new Set<string>();
  for (const { name, fingerprint, previous } of graphs) {
    if (previous === undefined) continue;
    if (previous !== fingerprint)
      throw new Error("Conflicting copies of a shared nanopublication graph");
    duplicates.add(name);
  }
  // Match duplicate graphs jointly; unresolved structural ties must reject
  // rather than choose a correspondence based on document-local ordering.
  const incoming = sharedGraphLabels(result.dataset, duplicates);
  const retained = sharedGraphLabels(collection.dataset, duplicates);
  if (incoming.id !== retained.id)
    throw new Error("Conflicting blank-node references in shared graphs");
  const retainedNodes = new Map([...retained.labels].map(([node, label]) => [label, node]));
  const replacements = new Map(
    [...incoming.labels].map(([node, label]) => [node, retainedNodes.get(label) as string]),
  );
  const remap = <T extends Term>(term: T) =>
    term.termType === "BlankNode" && replacements.has(term.value)
      ? df.blankNode(replacements.get(term.value) as string)
      : term;
  for (const quad of result.dataset)
    if (!duplicates.has(quad.graph.value))
      collection.dataset.add(
        df.quad(remap(quad.subject), quad.predicate, remap(quad.object), remap(quad.graph)),
      );
  for (const { name, fingerprint } of graphs) shared.set(name, fingerprint);
  collection.nanopubs.push(...result.nanopubs);
}

/** Encode (graph, predicate) pairs only for joint matching, never for stored RDF. */
function sharedGraphLabels(
  dataset: DatasetCore,
  names: Set<string>,
  requiredUniqueNodes?: ReadonlySet<string>,
) {
  const combined = new Store();
  const nodes = new Set<string>();
  for (const name of names)
    for (const quad of graph(dataset, name)) {
      new RdfNode(quad.subject, combined).add(
        pkgId("store", "shared-predicate", name, quad.predicate.value),
        quad.object,
      );
      for (const term of [quad.subject, quad.object])
        if (term.termType === "BlankNode") nodes.add(term.value);
    }
  return combined.size === 0
    ? { id: "", labels: new Map<string, string>() }
    : canonicalizeGraphWithLabels(combined, { requiredUniqueNodes: requiredUniqueNodes ?? nodes });
}

/** Every cross-resource node needs a common graph through which list() can align it. */
function validateBlankNodeSharing(
  dataset: DatasetCore,
  parts: { dataset: DatasetCore; sharedGraphs: string[] }[],
): void {
  const anchors = new Map<string, Set<string>>();
  for (const { dataset, sharedGraphs } of parts) {
    const nodes = new Map<string, Set<string>>();
    for (const quad of dataset)
      for (const term of [quad.subject, quad.object]) {
        if (term.termType !== "BlankNode") continue;
        const names = nodes.get(term.value) ?? new Set<string>();
        if (sharedGraphs.includes(quad.graph.value)) names.add(quad.graph.value);
        nodes.set(term.value, names);
      }
    for (const [node, names] of nodes) {
      const previous = anchors.get(node);
      if (previous === undefined) anchors.set(node, names);
      else {
        const common = new Set([...previous].filter((name) => names.has(name)));
        if (common.size === 0) throw new Error("Unsupported cross-resource blank-node sharing");
        anchors.set(node, common);
      }
    }
  }
  // Only graphs common to every resource using a node can establish its identity.
  // Refinement must give unique structural labels without tie-breaking search.
  const groups = new Map<string, { names: Set<string>; nodes: Set<string> }>();
  for (const [node, names] of anchors) {
    // Validate even one-resource puts: later calls can repeat these graphs.
    if (names.size === 0) continue;
    const key = JSON.stringify([...names].sort());
    const group = groups.get(key) ?? { names, nodes: new Set<string>() };
    group.nodes.add(node);
    groups.set(key, group);
  }
  for (const { names, nodes } of groups.values()) sharedGraphLabels(dataset, names, nodes);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
