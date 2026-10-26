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
import {
  dateTime,
  graph,
  NS,
  parseReferenceRdf,
  putGraph,
  RdfNode,
  ReferenceStore as Store,
} from "./rdf.js";

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
    return this.resourceUrl(id, false);
  }

  private resourceUrl(id: string, reservation: boolean): string {
    const match = uuid.exec(id);
    if (!match) throw new Error("Expected a nanopublication UUID IRI");
    const filename = reservation ? `shared-${match[1]}.reservation` : `${match[1]}.trig`;
    const url = new URL(filename, this.container).href;
    // A UUID-only filename has no path segments or URL delimiters. Exact equality
    // also asserts the normalized URL retains the container prefix and this leaf.
    if (url !== `${this.container}${filename}`)
      throw new Error("Expected a resource directly in the nanopublication container");
    return url;
  }

  /** Persist each nanopub separately, create-only; graph metadata is parsed before any write. */
  async put(value: Nanopublications): Promise<string[]> {
    const parsed = await parseNanopublications(await serializeNanopublications(value));
    const roles = new Map<string, GraphOwnership>();
    validateGraphRoles(parsed, roles);
    const parts = parsed.nanopubs.map((np) => {
      const sharedGraphs = [
        np.assertionId,
        pkgId("batch", np.batch, "sources"),
        pkgId("batch", np.batch, "entities"),
      ];
      // Validate every shared identity before initialization can write any ACLs,
      // containers, reservations or nanopubs, including earlier parts of a batch.
      for (const name of sharedGraphs) this.resourceUrl(name, true);
      const dataset = new Store();
      for (const name of [np.id, np.provenanceId, np.pubinfoId, ...sharedGraphs])
        putGraph(dataset, name, graph(parsed.dataset, name));
      return { np, dataset, sharedGraphs };
    });
    validateBlankNodeSharing(parsed.dataset, parts);
    // Stored documents have their own blank-node labels. Every pair must be
    // alignable using only their common graphs, regardless of listing order.
    const storedValues: Nanopublications[] = [];
    for (const id of await this.storedIds()) {
      const stored = await this.get(id);
      storedValues.push(stored);
      const np = stored.nanopubs[0] as Nanopublications["nanopubs"][number];
      const names = new Set([
        np.assertionId,
        pkgId("batch", np.batch, "sources"),
        pkgId("batch", np.batch, "entities"),
      ]);
      for (const part of parts) {
        validateSharedCopies(part.dataset, stored.dataset, part.sharedGraphs, names);
      }
    }
    // Also check joint references across the whole collection, including new
    // graphs that bridge existing resources. Pairwise checks above ensure that
    // correspondence never depends on which document happens to be listed first.
    mergeNanopublications([
      ...storedValues,
      ...parts.map(({ np, dataset }) => ({ dataset, nanopubs: [np] })),
    ]);
    const resources = await Promise.all(
      parts.map(async ({ np, dataset }) => ({
        url: this.url(np.id),
        bytes: encode(await serializeNanopublications({ dataset, nanopubs: [np] })),
      })),
    );
    await this.initialize();
    // Role reservations use the graph IRI, including fragment-bearing private
    // graphs, as their key. All must succeed before any dependent nanopub write.
    for (const [name, ownership] of [...roles].sort(([a], [b]) => a.localeCompare(b)))
      await this.reserveGraphRole(name, ownership);
    // Immutable graph reservations precede EVERY dependent nanopub. A crash can
    // leave a reservation alone, but cannot expose an unreserved nanopub. Each
    // reservation retains its shared-graph context so joint blank-node identity
    // is checked even when concurrent writers saw the same old collection.
    const reservations = new Map<string, { part: (typeof parts)[number]; required: string[] }>();
    for (const part of parts) {
      // Reserve every possible overlap (at most seven). Singleton reservations
      // fix graph contents; joint reservations fix blank-node correspondence even
      // when earlier orphan reservations came from disjoint graph contexts.
      for (let mask = 1; mask < 1 << part.sharedGraphs.length; mask++) {
        const required = part.sharedGraphs.filter((_, i) => mask & (1 << i)).sort();
        reservations.set(required.join("|"), { part, required });
      }
    }
    for (const [, { part, required }] of [...reservations].sort(([a], [b]) => a.localeCompare(b)))
      await this.reserveGraphs(required, part.dataset, part.sharedGraphs);
    for (const resource of resources) await this.writeNanopub(resource.url, resource.bytes);
    return resources.map((resource) => resource.url);
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
    const values: Nanopublications[] = [];
    for (const id of await this.storedIds()) values.push(await this.get(id));
    return mergeNanopublications(values);
  }

  private async storedIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    let entries: Awaited<ReturnType<PodPort["list"]>>;
    try {
      entries = await this.pod.list(this.container);
    } catch (error) {
      if (podStatus(error) === 404) return ids;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isContainer || !entry.url.startsWith(this.container)) continue;
      const id = `urn:uuid:${entry.url.slice(this.container.length).replace(/\.trig$/, "")}`;
      if (uuid.test(id) && this.url(id) === entry.url) ids.add(id);
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
        await this.protectResource(container, true, existingAcl, true);
      // CSS can create the container implicitly when its ACL is written.
      if (!existing && !(await this.readOptional(container))) {
        const description = new Store();
        new RdfNode(container, description).link(
          `${NS.rdf}type`,
          "http://www.w3.org/ns/ldp#BasicContainer",
        );
        try {
          await this.pod.write(
            container,
            encode(await serialize([...description])),
            "text/turtle",
            {
              ifNoneMatch: "*",
            },
          );
        } catch (error) {
          if (podStatus(error) !== 412) throw error;
          await this.pod.read(container);
        }
      }
    }
  }
  private async protectResource(
    url: string,
    inherit: boolean,
    existing: { etag?: string } | undefined,
    acceptIdentical = false,
  ) {
    const dataset = new Store();
    const authorization = new RdfNode(`${url}.acl#owner`, dataset)
      .link(`${NS.rdf}type`, `${acl}Authorization`)
      .link(`${acl}agent`, this.owner)
      .link(`${acl}accessTo`, url);
    if (inherit) authorization.link(`${acl}default`, url);
    for (const mode of ["Read", "Write", "Control"]) authorization.link(`${acl}mode`, acl + mode);
    const bytes = encode(await serialize([...dataset]));
    try {
      await this.pod.write(`${url}.acl`, bytes, "text/turtle", this.condition(existing));
    } catch (error) {
      // Concurrent initialization/reservations may install the same owner ACL.
      // Any different ACL, unreadable state or other failure still fails closed.
      if (
        !acceptIdentical ||
        podStatus(error) !== 412 ||
        !equalBytes((await this.pod.read(`${url}.acl`)).body, bytes)
      )
        throw error;
    }
  }
  private async reserveGraphs(
    required: string[],
    dataset: DatasetCore,
    names: string[],
  ): Promise<void> {
    const name =
      required.length === 1
        ? (required[0] as string)
        : pkgId("store", "joint-reservation", ...required);
    const url = this.resourceUrl(name, true);
    const contents = new Store();
    const labels = sharedGraphLabels(dataset, new Set(names)).labels;
    const canonical = (term: Term) =>
      term.termType === "BlankNode" ? df.blankNode(labels.get(term.value) as string) : term;
    const manifest = new RdfNode(url, contents).link(`${NS.pkg}reservedGraph`, name);
    for (const graphName of names) {
      manifest.link(`${NS.pkg}contextGraph`, graphName);
      const canonicalGraph = new Store();
      for (const quad of graph(dataset, graphName))
        new RdfNode(canonical(quad.subject), canonicalGraph).add(
          quad.predicate.value,
          canonical(quad.object),
        );
      putGraph(contents, graphName, canonicalGraph);
    }
    const bytes = encode(await serialize([...contents], { format: "application/trig" }));
    try {
      await this.writeNanopub(url, bytes, true);
    } catch (error) {
      if (podStatus(error) !== 412) throw error;
      const retained = await this.readOptional(url);
      if (!retained) throw error;
      const type = retained.contentType.split(";")[0]?.trim().toLowerCase();
      if (type !== "application/trig" && type !== "application/octet-stream")
        throw new Error("Unsupported shared graph reservation media type");
      const stored = await parseReferenceRdf(decode(retained.body), "application/trig", url);
      const metadata = new RdfNode(url, graphDefault(stored));
      if (metadata.oneIri(`${NS.pkg}reservedGraph`) !== name)
        throw new Error("Shared graph reservation identity mismatch");
      const context = new Set(
        [...metadata.terms(`${NS.pkg}contextGraph`)].map((term) => {
          if (term.termType !== "NamedNode" || !uuid.test(term.value))
            throw new Error("Invalid shared graph reservation context");
          return term.value;
        }),
      );
      if (!required.every((name) => context.has(name)))
        throw new Error("Missing shared graph reservation context");
      validateSharedCopies(dataset, stored, names, context);
    }
  }
  private async reserveGraphRole(name: string, ownership: GraphOwnership): Promise<void> {
    const url = this.resourceUrl(pkgId("store", "graph-role", name), true);
    const manifest = new Store();
    new RdfNode(url, manifest)
      .link(`${NS.pkg}reservedGraph`, name)
      .text(`${NS.pkg}graphRole`, ownership.role)
      .text(`${NS.pkg}graphOwner`, ownership.owner);
    const bytes = encode(await serialize([...manifest], { format: "application/trig" }));
    try {
      await this.writeNanopub(url, bytes, true);
    } catch (error) {
      if (podStatus(error) !== 412) throw error;
      const retained = await this.readOptional(url);
      if (!retained) throw error;
      const type = retained.contentType.split(";")[0]?.trim().toLowerCase();
      // Reservations are immutable and byte-preserving, like graph contents.
      // A malformed or different manifest cannot authorize a graph's reuse.
      if (
        (type !== "application/trig" && type !== "application/octet-stream") ||
        !equalBytes(retained.body, bytes)
      )
        throw new Error("Conflicting nanopublication graph role or owner");
    }
  }
  private async writeNanopub(url: string, bytes: Uint8Array, reservation = false): Promise<void> {
    // A resource ACL overrides the container default, including orphan ACLs.
    await this.protectResource(url, false, await this.readOptional(`${url}.acl`), true);
    try {
      if (!(await this.createResource(url, bytes, "application/trig", reservation))) return;
    } catch (error) {
      if (podStatus(error) !== 415) throw error;
      if (!(await this.createResource(url, bytes, "application/octet-stream", reservation))) return;
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
  /** A duplicate nanopub is idempotent only when its entire RDF dataset agrees. */
  private async createResource(
    url: string,
    bytes: Uint8Array,
    type: string,
    reservation: boolean,
  ): Promise<boolean> {
    try {
      await this.pod.write(url, bytes, type, { ifNoneMatch: "*" });
      return true;
    } catch (error) {
      if (reservation || podStatus(error) !== 412) throw error;
      const stored = await this.readOptional(url);
      if (!stored) throw error;
      const mediaType = stored.contentType.split(";")[0]?.trim().toLowerCase();
      if (mediaType !== "application/trig" && mediaType !== "application/octet-stream") throw error;
      const incoming = await parseNanopublications(decode(bytes));
      const retained = await parseNanopublications(decode(stored.body));
      if (datasetFingerprint(incoming.dataset) !== datasetFingerprint(retained.dataset))
        throw error;
      return false;
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

function graphDefault(dataset: DatasetCore): Store {
  return new Store([...dataset.match(null, null, null, df.defaultGraph())]);
}

/** Include every graph term in canonicalization, retaining joint blank-node identity. */
function datasetFingerprint(dataset: DatasetCore): string {
  const encoded = new Store();
  // Keep input blank nodes disjoint from statement nodes, even if caller labels
  // resemble our internal labels. One remapping spans subject, object and graph.
  const term = (value: Term) =>
    value.termType === "BlankNode" ? df.blankNode(`term-${value.value}`) : value;
  let index = 0;
  for (const quad of dataset) {
    if (quad.graph.termType === "BlankNode") {
      // Reify these quads so graph labels participate in the same correspondence
      // as subject/object labels. Statement predicates are disjoint from the UUID
      // predicates below, preventing input terms from impersonating statements.
      new RdfNode(df.blankNode(`quad-${index++}`), encoded)
        .add(`${NS.rdf}subject`, term(quad.subject))
        .add(`${NS.rdf}predicate`, quad.predicate)
        .add(`${NS.rdf}object`, term(quad.object))
        .add(`${NS.pkg}graph`, term(quad.graph));
    } else {
      // Constant graph terms need no statement nodes. JSON preserves tuple
      // boundaries even when an input IRI contains pkgId's pipe delimiter.
      new RdfNode(term(quad.subject), encoded).add(
        pkgId(
          "store",
          "dataset-predicate",
          JSON.stringify([quad.graph.termType, quad.graph.value, quad.predicate.value]),
        ),
        term(quad.object),
      );
    }
  }
  return canonicalizeGraphWithLabels(encoded).id;
}

function validateSharedCopies(
  incoming: DatasetCore,
  retained: DatasetCore,
  names: string[],
  retainedNames: Set<string>,
): void {
  const common = new Set(names.filter((name) => retainedNames.has(name)));
  for (const name of common) {
    const fingerprint = (contents: DatasetCore) =>
      contents.size === 0 ? "" : canonicalizeGraphWithLabels(contents).id;
    if (fingerprint(graph(incoming, name)) !== fingerprint(graph(retained, name)))
      throw new Error("Conflicting copies of a shared nanopublication graph");
  }
  if (sharedGraphLabels(incoming, common).id !== sharedGraphLabels(retained, common).id)
    throw new Error("Conflicting blank-node references in shared graphs");
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

interface GraphOwnership {
  role: "head" | "provenance" | "pubinfo" | "assertion" | "sources" | "entities";
  owner: string;
}

function registerGraphRoles(roles: Map<string, GraphOwnership>, np: Nanopublication): Set<string> {
  const entries: [string, GraphOwnership][] = [
    [np.id, { role: "head", owner: np.id }],
    [np.provenanceId, { role: "provenance", owner: np.id }],
    [np.pubinfoId, { role: "pubinfo", owner: np.id }],
    [np.assertionId, { role: "assertion", owner: np.assertionId }],
    [pkgId("batch", np.batch, "sources"), { role: "sources", owner: np.batch }],
    [pkgId("batch", np.batch, "entities"), { role: "entities", owner: np.batch }],
  ];
  for (const [name, ownership] of entries) {
    const previous = roles.get(name);
    if (previous && (previous.role !== ownership.role || previous.owner !== ownership.owner))
      throw new Error("Conflicting nanopublication graph role or owner");
    roles.set(name, ownership);
  }
  return new Set(entries.map(([name]) => name));
}

function validateGraphRoles(value: Nanopublications, roles: Map<string, GraphOwnership>): void {
  const names = new Set<string>();
  for (const np of value.nanopubs)
    for (const name of registerGraphRoles(roles, np)) names.add(name);
  for (const quad of value.dataset)
    if (quad.graph.termType !== "NamedNode" || !names.has(quad.graph.value))
      throw new Error("Unowned nanopublication graph");
}

/** Merge document-local blank nodes through their validated shared graphs. */
function mergeNanopublications(values: Iterable<Nanopublications>): Nanopublications {
  const dataset = new Store();
  const nanopubs: Nanopublications["nanopubs"] = [];
  const shared = new Map<string, string>();
  const roles = new Map<string, GraphOwnership>();
  for (const result of values) {
    const np = result.nanopubs[0] as Nanopublications["nanopubs"][number];
    validateGraphRoles(result, roles);
    const graphs = [
      np.assertionId,
      pkgId("batch", np.batch, "sources"),
      pkgId("batch", np.batch, "entities"),
    ].map((name) => {
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
    const retained = sharedGraphLabels(dataset, duplicates);
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
        dataset.add(
          df.quad(remap(quad.subject), quad.predicate, remap(quad.object), remap(quad.graph)),
        );
    for (const { name, fingerprint } of graphs) shared.set(name, fingerprint);
    nanopubs.push(...result.nanopubs);
  }
  return { dataset, nanopubs };
}
