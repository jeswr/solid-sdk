// AUTHORED-BY Codex GPT-6.1-Sol
import { type Nanopublication, type Nanopublications, NanopubStore } from "@jeswr/pkg-memory";
import { safeIri } from "@jeswr/rdf-serialize";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { requirePodScopedUrl, requirePodScopedWriteUrl } from "./auth.js";
import { MAX_CONTENT_BYTES } from "./content.js";
import { PodOutput } from "./output.js";
import type { PodPort } from "./pod-port.js";

/** Operator-supplied identity; never take deletion authority from tool arguments. */
export interface MemoryClientInfo {
  /** Absolute IRI identifying the authenticated MCP client (an HTTPS URL or URN). */
  clientId: string;
  /** Human-readable client name. */
  name?: string;
  /** Model name supplied by the client, retained as provenance metadata. */
  model?: string;
}

/** @internal Accessors are graph scoped, including deletion authority. */
export class MemoryNode extends TermWrapper {
  terms(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself);
  }
  text(predicate: string, value: string) {
    this.terms(predicate).add(DataFactory.literal(value));
    return this;
  }
}

function graphOf(value: Nanopublications, graph: string): Store {
  const store = new Store();
  for (const quad of value.dataset.match(null, null, null, DataFactory.namedNode(graph)))
    store.addQuad(DataFactory.quad(quad.subject, quad.predicate, quad.object));
  return store;
}
/** @internal */
export function values(value: Nanopublications, graph: string, subject: string, predicate: string) {
  return [...new MemoryNode(subject, graphOf(value, graph), DataFactory).terms(predicate)].map(
    (term) => term.value,
  );
}
/** @internal */
export function assertion(value: Nanopublications, np: Nanopublication): Store {
  return graphOf(value, np.assertionId);
}
/** @internal */
export function status(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number")
    return error.status;
  return error instanceof Error ? Number(/\bHTTP (\d{3})\b/.exec(error.message)?.[1]) : undefined;
}

/** @internal A fresh projection per call, retaining the decorated port. */
export function memoryContext(pod: PodPort, readOnly: boolean, client?: MemoryClientInfo) {
  if (!client || safeIri(client.clientId) !== client.clientId || !client.clientId)
    throw new Error("Memory requires a configured client IRI");
  const output = new PodOutput(pod);
  const reads = new Map<string, { etag?: string }>();
  function mutationTarget(url: string) {
    if (readOnly) throw new Error("write disabled: server is read-only");
    return requirePodScopedWriteUrl({ podRoot: pod.root }, url);
  }
  const port: PodPort = {
    root: pod.root,
    webId: pod.webId,
    async read(url) {
      const read = await output.read(url);
      reads.set(url, read);
      return output.representation(url, read);
    },
    async list(container) {
      const target = requirePodScopedUrl({ podRoot: pod.root }, container);
      try {
        await output.read(target, { accept: "text/turtle" });
        // Entries stay internal. NanopubStore accepts only fixed UUID paths
        // and reads every selected resource through the projection above.
        return await pod.list(target);
      } catch (error) {
        if (status(error) !== 404) throw error;
        return [];
      }
    },
    async write(url, body, contentType, cond) {
      const target = mutationTarget(url);
      if (body.byteLength > MAX_CONTENT_BYTES)
        throw new Error("Resource exceeds the bounded read limit.");
      return pod.write(target, body, contentType, cond);
    },
    delete: (url, cond) => pod.delete(mutationTarget(url), cond),
  };
  const store = new NanopubStore(port);
  return { store, port, reads, output, client };
}
