// AUTHORED-BY Codex GPT-6.1-Sol

import { verifyApproval } from "@jeswr/agent-mandate";
import {
  type Batch,
  buildNanopublications,
  createFactAssertion,
  type Nanopublications,
  parseNanopublications,
  pkgId,
  serializeNanopublications,
} from "@jeswr/pkg-memory";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { StorageError } from "@jeswr/storage-client";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { createHash, randomUUID } from "crypto";
import { DataFactory as df, Store } from "n3";
import { communicationRules } from "./rules.js";
import type { AgentMemory, AgentMemoryOptions, RecalledMemory, RememberProposal } from "./types.js";

const PD = "https://w3id.org/dpv/pd#";
/** Exact categories only: health and financial categories require an explicit mandate entry. */
export const DEFAULT_MEMORY_SCOPE: readonly string[] = Object.freeze([`${PD}Preference`]);
const PROV = "http://www.w3.org/ns/prov#";
const MAX_BYTES = 1_048_576;
function iri(value: string): string {
  if (!/^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]+$/i.test(value))
    throw new TypeError("Expected an absolute IRI");
  return value;
}
function category(value: string): string {
  const expanded = value.startsWith("pd:") ? PD + value.slice(3) : value;
  if (!expanded.startsWith(PD) || !/^[A-Za-z][A-Za-z0-9]*$/.test(expanded.slice(PD.length)))
    throw new TypeError("Expected a DPV personal-data category");
  return expanded;
}
function strongEtag(value: string | null): string {
  if (!value || !/^"[^"\r\n]*"$/.test(value))
    throw new Error("Pending memory requires a strong ETag");
  return value;
}
function missing(error: unknown): boolean {
  return error instanceof StorageError && error.code === "not-found";
}
function conflict(error: unknown): boolean {
  return error instanceof StorageError && ["precondition-failed", "conflict"].includes(error.code);
}
function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Expected a positive limit");
  return value;
}

/** Create a memory service over existing private storage, with no credentials or implicit I/O. */
export function createAgentMemory(options: AgentMemoryOptions): AgentMemory {
  const { storage, ownerWebId, agentId } = options;
  iri(ownerWebId);
  iri(agentId);
  const root = new URL(options.container);
  if (
    !["http:", "https:"].includes(root.protocol) ||
    root.username ||
    root.password ||
    root.search ||
    root.hash ||
    root.href !== options.container ||
    !root.pathname.endsWith("/") ||
    storage.protocol !== "solid" ||
    !storage.isWithinStorage(root.href) ||
    !options.shapes.trim()
  )
    throw new TypeError("Expected a scoped memory container and canonical SHACL shapes");
  const container = root.href;
  const pending = new URL("pending/", container).href;
  const now = options.now ?? (() => new Date());
  const maxResources = positive(options.maxResources ?? 1000);
  const maxBytes = positive(options.maxResourceBytes ?? MAX_BYTES);
  // Serialize mutations within an instance; conditional storage operations fence other writers.
  let tail: Promise<unknown> = Promise.resolve();
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  }
  function name(url: string, parent: string): string {
    if (!url.startsWith(parent) || !/^[A-Za-z0-9._~-]+\.trig$/.test(url.slice(parent.length)))
      throw new TypeError("Expected a directly contained memory TriG resource");
    return url.slice(parent.length);
  }
  async function read(url: string) {
    const response = await storage.read(url, { accept: "application/trig" });
    if (
      response.status !== 200 ||
      response.kind !== "resource" ||
      response.contentType?.split(";")[0]?.trim().toLowerCase() !== "application/trig"
    ) {
      await response.body?.cancel();
      throw new TypeError("Expected a memory TriG resource");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing memory resource body");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > maxBytes) throw new RangeError("Memory resource exceeds the size limit");
        chunks.push(chunk.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { trig: new TextDecoder("utf-8", { fatal: true }).decode(bytes), etag: response.etag };
  }
  function proposal(url: string, trig: string, data: Nanopublications): RememberProposal {
    const target = new URL(name(url, pending), container).href;
    const terms = JSON.stringify(["remember", ownerWebId, agentId, url, target, trig]);
    return {
      kind: "remember",
      id: url,
      target,
      termsDigest: `sha-256:${createHash("sha256").update(terms).digest("hex")}`,
      trig,
      nanopublications: data.nanopubs.map((np) => np.id),
    };
  }
  async function existing(filename: string): Promise<RememberProposal | undefined> {
    for (const parent of [container, pending]) {
      const url = new URL(filename, parent).href;
      try {
        const { trig } = await read(url);
        const item = proposal(
          new URL(filename, pending).href,
          trig,
          await parseNanopublications(trig),
        );
        if (parent === pending) await options.queueApproval(item);
        return item;
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return undefined;
  }
  async function stage(batch: Batch, filename: string, once = false): Promise<RememberProposal> {
    const built = await buildNanopublications(batch, {
      owner: ownerWebId,
      generatedAt: now().toISOString(),
    });
    const trig = await serializeNanopublications(built);
    if (new TextEncoder().encode(trig).length > maxBytes)
      throw new RangeError("Memory resource exceeds the size limit");
    try {
      await storage.create(pending, trig, { name: filename, contentType: "application/trig" });
    } catch (error) {
      if (!conflict(error)) throw error;
      const previous = await existing(filename);
      if (previous) return previous;
      throw error;
    }
    if (once) {
      // A previous approval can finish between the existence reads and conditional create.
      // The approved resource wins; remove only the pending snapshot we just created.
      let approved: Awaited<ReturnType<typeof read>> | undefined;
      try {
        approved = await read(new URL(filename, container).href);
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (approved) {
        const staged = await read(new URL(filename, pending).href);
        if (staged.trig !== trig) throw new Error("Concurrent communication rules edit");
        await storage.delete(new URL(filename, pending).href, { ifMatch: strongEtag(staged.etag) });
        return proposal(
          new URL(filename, pending).href,
          approved.trig,
          await parseNanopublications(approved.trig),
        );
      }
    }
    const item = proposal(new URL(filename, pending).href, trig, built);
    await options.queueApproval(item);
    return item;
  }
  return {
    async recall(request) {
      const query = structuredClone(request);
      const limit = positive(query.limit);
      iri(query.purpose);
      if (query.about !== undefined) iri(query.about);
      const requested = query.categories?.map(category);
      const mandate = await options.loadMandate(query);
      const at = now().getTime();
      if (
        !mandate ||
        mandate.issuer !== ownerWebId ||
        mandate.subject !== agentId ||
        !Number.isFinite(at) ||
        !(Date.parse(mandate.validFrom) <= at && at < Date.parse(mandate.validUntil))
      )
        return [];
      const scope = new Set((mandate.memoryScope ?? DEFAULT_MEMORY_SCOPE).map(category));
      if (scope.size === 0 || requested?.some((cat) => !scope.has(cat))) return [];
      const results: RecalledMemory[] = [];
      let count = 0;
      for await (const entry of storage.listAll(container, { revalidate: true })) {
        if (++count > maxResources)
          throw new RangeError("Memory listing exceeds the resource limit");
        if (entry.kind !== "resource") continue;
        try {
          name(entry.url, container);
        } catch {
          continue;
        }
        const { trig } = await read(entry.url);
        const data = await parseNanopublications(trig, entry.url);
        for (const np of data.nanopubs) {
          if (
            np.validity !== "Current" ||
            np.categories.length === 0 ||
            !np.categories.every((cat) => scope.has(cat)) ||
            (requested && !np.categories.some((cat) => requested.includes(cat)))
          )
            continue;
          const assertion = data.dataset.match(null, null, null, df.namedNode(np.assertionId));
          if (
            query.about &&
            ![...assertion].some(
              (q) =>
                (q.subject.termType === "NamedNode" && q.subject.value === query.about) ||
                (q.object.termType === "NamedNode" && q.object.value === query.about),
            )
          )
            continue;
          const provenance = data.dataset.match(null, null, null, df.namedNode(np.provenanceId));
          if (
            [
              ...provenance.match(
                df.namedNode(np.assertionId),
                df.namedNode(`${PROV}invalidatedAtTime`),
              ),
            ].some(
              (q) =>
                !Number.isFinite(Date.parse(q.object.value)) || Date.parse(q.object.value) <= at,
            )
          )
            continue;
          const graphs = new Set([np.id, np.assertionId, np.provenanceId, np.pubinfoId]);
          results.push({
            resource: entry.url,
            nanopubs: [np],
            dataset: new Store([...data.dataset].filter((q) => graphs.has(q.graph.value))),
          });
          if (results.length === limit) return results;
        }
      }
      return results;
    },
    proposeRemember(claim) {
      // Snapshot caller-owned values before any await, including queued mutations.
      const input = structuredClone(claim);
      return mutate(async () => {
        const categories = input.categories.map(category);
        if (!categories.length) throw new TypeError("Memory requires personal-data categories");
        const origin = input.origin;
        iri(origin.source);
        if (origin.kind !== "owner-conversation" && origin.kind !== "inference")
          throw new TypeError("Expected trusted memory origin");
        if (origin.kind === "owner-conversation" && !origin.quote.trim())
          throw new TypeError("Owner-typed memory requires a conversation quote");
        if (origin.kind === "inference") iri(origin.rule);
        if (
          ["condition", "allergy", "medication"].includes(input.fact.template) &&
          !categories.includes(`${PD}Health`)
        )
          throw new TypeError("Clinical memories require pd:Health");
        const batchId = randomUUID();
        return stage(
          {
            batch_id: batchId,
            worker: { agent_id: agentId, agent_label: "Agent memory" },
            sources: [{ id: "origin", kind: "document", url: origin.source }],
            claims: [
              {
                id: "claim",
                assertion: createFactAssertion(ownerWebId, input.fact),
                categories,
                epistemic:
                  origin.kind === "owner-conversation" ? "SelfReportedExplicit" : "Inferred",
                evidence: [{ source: "origin", ...(origin.quote ? { quote: origin.quote } : {}) }],
                ...(origin.kind === "inference" ? { inference: { rule: origin.rule } } : {}),
              },
            ],
          },
          `${pkgId("agent-memory", ownerWebId, batchId).slice(9)}.trig`,
        );
      });
    },
    approveRemember(url, approval) {
      name(url, pending);
      return mutate(async () => {
        const target = new URL(name(url, pending), container).href;
        let snapshot: Awaited<ReturnType<typeof read>>;
        let alreadyMoved = false;
        try {
          snapshot = await read(url);
        } catch (error) {
          if (!missing(error)) throw error;
          snapshot = await read(target);
          alreadyMoved = true;
        }
        const data = await parseNanopublications(snapshot.trig, url);
        const item = proposal(url, snapshot.trig, data);
        const verify = async () => {
          const result = await verifyApproval(approval.document, {
            id: approval.id,
            ownerWebId,
            proposal: url,
            termsDigest: item.termsDigest,
            webIdKeyResolver: options.webIdKeyResolver,
            now,
          });
          if (!result.valid) throw new Error(`Memory approval refused: ${result.reason}`);
          if (result.approval.decision !== "approve")
            throw new Error("Memory approval refused: deny");
        };
        await verify();
        const etag = strongEtag(snapshot.etag);
        const ownedEngine = options.validator === undefined ? createRdfEngine() : undefined;
        const engine = options.validator ?? ownedEngine;
        if (!engine) throw new Error("No SHACL validator available");
        try {
          const report = await engine.validate(data.dataset, options.shapes);
          if (report.conforms !== true) throw new Error("Memory does not conform to SHACL shapes");
        } finally {
          ownedEngine?.dispose();
        }
        // Validation may take time; do not promote under an approval that expired meanwhile.
        await verify();
        if (alreadyMoved) return target;
        try {
          await storage.create(container, snapshot.trig, {
            name: name(url, pending),
            contentType: "application/trig",
          });
        } catch (error) {
          if (!conflict(error)) throw error;
          if ((await read(target)).trig !== snapshot.trig)
            throw new Error("Conflicting approved memory");
        }
        await storage.delete(url, { ifMatch: etag });
        return target;
      });
    },
    importCommunicationRules(input) {
      const snapshot = structuredClone(input);
      return mutate(async () => {
        const filename = `${pkgId("agent-memory", ownerWebId, "communication-rules").slice(9)}.trig`;
        const previous = await existing(filename);
        if (previous) return previous;
        if (!/^[a-f0-9]{40}$/i.test(snapshot.commit))
          throw new TypeError("Expected a full source commit");
        iri(snapshot.source);
        const rules = communicationRules(snapshot.yaml);
        return stage(
          {
            batch_id: `communication-rules-${pkgId("agent-memory", ownerWebId, agentId, snapshot.commit).slice(9)}`,
            worker: { agent_id: agentId, agent_label: "Agent memory import" },
            sources: [
              {
                id: "rules",
                kind: "document",
                url: snapshot.source,
                title: `communication-rules.yaml@${snapshot.commit}`,
              },
            ],
            claims: rules.map((rule) => ({
              id: rule.id,
              assertion: createFactAssertion(ownerWebId, {
                template: "preference",
                value: { propertyID: "communication-rule", value: rule.rule },
              }),
              epistemic: "SelfReportedExplicit",
              categories: [...DEFAULT_MEMORY_SCOPE],
              evidence: [
                { source: "rules", locator: rule.id, quote: [...rule.rule].slice(0, 300).join("") },
              ],
            })),
          },
          filename,
          true,
        );
      });
    },
  };
}
