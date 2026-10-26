// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri, serialize } from "@jeswr/rdf-serialize";
import { type OdrlPolicy, policyToTurtle } from "@jeswr/solid-odrl";
import { compareDateTimes } from "./chronology.js";
import { pkgId } from "./ids.js";
import {
  buildNanopublications,
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
    const resources = await Promise.all(
      parsed.nanopubs.map(async (np) => {
        const dataset = new Store();
        for (const name of [
          np.id,
          np.assertionId,
          np.provenanceId,
          np.pubinfoId,
          pkgId("batch", np.batch, "sources"),
          pkgId("batch", np.batch, "entities"),
        ])
          putGraph(dataset, name, graph(parsed.dataset, name));
        return {
          url: this.url(np.id),
          bytes: encode(await serializeNanopublications({ dataset, nanopubs: [np] })),
        };
      }),
    );
    await this.initialize();
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
    const dataset = new Store();
    const nanopubs: Nanopublications["nanopubs"] = [];
    const ids = new Set<string>();
    for (const entry of await this.pod.list(this.container)) {
      if (entry.isContainer || !entry.url.startsWith(this.container)) continue;
      const id = `urn:uuid:${entry.url.slice(this.container.length).replace(/\.trig$/, "")}`;
      if (!uuid.test(id) || this.url(id) !== entry.url || ids.has(id)) continue;
      ids.add(id);
      const result = await this.get(id);
      for (const quad of result.dataset) dataset.add(quad);
      nanopubs.push(...result.nanopubs);
    }
    return { dataset, nanopubs };
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
    const provenance = graph(value.dataset, np.provenanceId);
    new RdfNode(np.assertionId, provenance)
      .link(`${NS.prov}wasRevisionOf`, previous.assertionId)
      .text(`${NS.prov}invalidatedAtTime`, now, `${NS.xsd}dateTime`);
    putGraph(value.dataset, np.provenanceId, provenance);
    const revision = await parseNanopublications(await serializeNanopublications(value));
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
      const dataset = new Store();
      const authorization = new RdfNode(`${container}.acl#owner`, dataset)
        .link(`${NS.rdf}type`, `${acl}Authorization`)
        .link(`${acl}agent`, this.owner)
        .link(`${acl}accessTo`, container)
        .link(`${acl}default`, container);
      for (const mode of ["Read", "Write", "Control"]) authorization.link(`${acl}mode`, acl + mode);
      await this.pod.write(
        `${container}.acl`,
        encode(await serialize([...dataset])),
        "text/turtle",
        this.condition(await this.readOptional(`${container}.acl`)),
      );
      if (!(await this.readOptional(container))) {
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
  private async writeNanopub(url: string, bytes: Uint8Array): Promise<void> {
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
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
