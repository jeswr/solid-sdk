// AUTHORED-BY Codex GPT-6.1-Sol
import { createTypeIndex } from "@jeswr/pod-type-index";
import { parseWacAllow } from "@jeswr/storage-capabilities";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { canonicalize } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory as df, Store } from "n3";
import { podScopedUrlOrUndefined, requirePodScopedUrl } from "./auth.js";
import { parseBoundedRdf, serializeBoundedTurtle } from "./bounded-rdf.js";
import { MAX_CONTENT_BYTES } from "./content.js";
import { verifyContextAcl } from "./context-access.js";
import { MemoryNode, status } from "./memory-context.js";
import { withPodDataAccess } from "./pod-operation.js";
import type { PodPort, PodReadResult } from "./pod-port.js";

export const SHARED_CONTEXT_PATH = "agent/context/shared-context.md";
export const SHARED_CONTEXT_CLASS = "https://jeswr.org/ns/agent#SharedContext";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const PREFS = "http://www.w3.org/ns/pim/space#preferencesFile";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const PRIVATE = `${SOLID}privateTypeIndex`;
const encoder = new TextEncoder();

export type ContextDiscoveryReason =
  | "ambiguous_registration"
  | "registration_outside_pod"
  | "registration_container"
  | "malformed_registration"
  | "pointer_acl_untrusted"
  | "type_index_unreadable";

/** Fixed diagnostics: never expose a value from an untrusted registration. */
export class ContextDiscoveryError extends Error {
  constructor(readonly reason: ContextDiscoveryReason) {
    super(reason);
  }
}
function fail(reason: ContextDiscoveryReason): never {
  throw new ContextDiscoveryError(reason);
}
const documentUrl = (value: string) => {
  const url = new URL(value);
  url.hash = "";
  return url.href;
};

/** A strict private-index view over the current PodPort. The general client intentionally
 * drops unsafe hints and combines public/private indexes; this capability validates first
 * and hides public pointers so neither behaviour can cause a context fallback.
 */
export function contextTypeIndex(
  pod: PodPort,
  protect?: (url: string, inherit: boolean) => Promise<void>,
) {
  const profileUrl = documentUrl(pod.webId);
  const preferences = new Set<string>();
  const indexes = new Set<string>();
  const publicPointers = new Map<string, import("@rdfjs/types").Term[]>();
  let matches = 0;
  let discovered: string | undefined;
  const pointer = (value: string) => {
    try {
      const url = requirePodScopedUrl({ podRoot: pod.root }, value);
      if (new URL(url).hash || new URL(url).pathname.endsWith("/")) fail("type_index_unreadable");
      return url;
    } catch {
      return fail("type_index_unreadable");
    }
  };
  const iris = (node: MemoryNode, predicate: string) =>
    [...node.terms(predicate)].map((term) => {
      if (term.termType !== "NamedNode") fail("malformed_registration");
      return term.value;
    });
  function inspect(dataset: Store, url: string) {
    for (const quad of dataset)
      if (quad.graph.termType !== "DefaultGraph") fail("type_index_unreadable");
    if (url === profileUrl || preferences.has(url)) {
      const owner = new MemoryNode(pod.webId, dataset, df);
      // The private-only view retains the RDF profile, but removes public discovery pointers.
      publicPointers.set(url, [...owner.terms(`${SOLID}publicTypeIndex`)]);
      owner.terms(`${SOLID}publicTypeIndex`).clear();
      if (url === profileUrl) {
        for (const value of iris(owner, PREFS)) preferences.add(pointer(value));
        if (preferences.size > 1) fail("ambiguous_registration");
      }
      for (const value of iris(owner, PRIVATE)) indexes.add(pointer(value));
      if (indexes.size > 1) fail("ambiguous_registration");
      // The general client memoizes by URL. Reject role aliases before its cache can
      // reuse an unvalidated profile/preferences graph as a private index.
      if (
        preferences.has(profileUrl) ||
        [...indexes].some((index) => index === profileUrl || preferences.has(index))
      )
        fail("type_index_unreadable");
    } else {
      if (!new MemoryNode(url, dataset, df).terms(TYPE).has(df.namedNode(`${SOLID}TypeIndex`)))
        fail("type_index_unreadable");
      for (const subject of dataset.getSubjects(null, null, null)) {
        const reg = new MemoryNode(subject, dataset, df);
        if (
          !iris(reg, `${SOLID}forClass`).some((iri) => canonicalize(iri) === SHARED_CONTEXT_CLASS)
        )
          continue;
        if (!reg.terms(TYPE).has(df.namedNode(`${SOLID}TypeRegistration`)))
          fail("malformed_registration");
        if (iris(reg, `${SOLID}forClass`).length !== 1) fail("malformed_registration");
        if (reg.terms(`${SOLID}instanceContainer`).size) fail("registration_container");
        const targets = iris(reg, `${SOLID}instance`);
        if (targets.length !== 1)
          fail(targets.length > 1 ? "ambiguous_registration" : "malformed_registration");
        const value = targets[0] as string;
        let target: string;
        try {
          target = requirePodScopedUrl({ podRoot: pod.root }, value);
        } catch {
          return fail("registration_outside_pod");
        }
        const parsed = new URL(target);
        if (parsed.hash || target !== value) fail("malformed_registration");
        if (parsed.pathname.endsWith("/")) fail("registration_container");
        // Count entries as well as locations; duplicate registrations are ambiguous too.
        if (++matches > 1) fail("ambiguous_registration");
        discovered = target;
      }
    }
  }
  const unsupported = (): never => {
    throw new Error("Unsupported context-index operation");
  };
  // No backend discovery occurs here: this is an RDF-document adapter, even for a portable
  // port. All actual reads/writes stay on that port, preserving its exact-create support.
  const unknown = <T>(detail: T) => ({ state: "unknown" as const, evidence: "PodPort", detail });
  const features: StorageClient["features"] = {
    protocol: "solid",
    liveUpdates: unknown({ channels: [] }),
    realtimeCollab: unknown({ protocols: [] }),
    serverSearch: unknown({}),
    typeIndex: unknown({ mode: "client" }),
    accessRequests: unknown({ profiles: [] }),
    accessGrants: unknown({ profiles: [] }),
    accessControl: unknown({ model: "none" }),
    versioning: unknown({}),
    trash: unknown({}),
    move: unknown({ native: false, containers: false, preservesIdentifier: null }),
    patch: unknown({ formats: {} }),
    resumableUploads: unknown(undefined),
    recursiveDelete: unknown(undefined),
    pagination: unknown(undefined),
    rdfConneg: unknown({ formats: ["text/turtle"] }),
  };
  const missing = (url: string) =>
    new StorageError("not-found", { url, method: "GET", status: 404 });
  async function verifyPointer(url: string, raw: PodReadResult) {
    try {
      if (
        raw.isContainer ||
        (raw.url && raw.url !== url) ||
        !(await verifyContextAcl(pod, url, raw))
      )
        fail("pointer_acl_untrusted");
    } catch {
      fail("pointer_acl_untrusted");
    }
  }
  async function write(
    url: string,
    dataset: DatasetCore | Iterable<import("@rdfjs/types").Quad>,
    ifMatch: string,
  ) {
    if (!protect || ifMatch === "*") throw new Error("Context registration requires a strong ETag");
    // Register re-reads on conflicts. A foreign concurrent registration must stop setup.
    if (discovered && discovered !== new URL(SHARED_CONTEXT_PATH, pod.root).href)
      fail("ambiguous_registration");
    // Existing pointer documents belong to the owner. Verify their effective ACLs;
    // setup must never tighten or replace ACLs on resources it did not create.
    if (url !== profileUrl) {
      try {
        await verifyPointer(url, await pod.read(pointer(url), { redirect: "error" }));
      } catch {
        fail("pointer_acl_untrusted");
      }
    }
    const saved = new Store([...dataset]);
    for (const term of publicPointers.get(url) ?? [])
      new MemoryNode(pod.webId, saved, df).terms(`${SOLID}publicTypeIndex`).add(term);
    const result = await pod.write(
      pointer(url),
      encoder.encode(serializeBoundedTurtle(saved)),
      "text/turtle",
      { ifMatch },
    );
    return { url, etag: result.etag ?? null, created: false };
  }
  const storage: StorageClient = {
    root: pod.root,
    protocol: "solid",
    features,
    isWithinStorage: (value) =>
      value === pod.webId ||
      value === profileUrl ||
      podScopedUrlOrUndefined({ podRoot: pod.root }, value) !== undefined,
    async readRdf(url) {
      const profile = url === profileUrl;
      let raw: PodReadResult;
      try {
        raw = await withPodDataAccess(pod, "profile-discovery", () =>
          pod.read(profile ? pod.webId : pointer(url), {
            accept: "text/turtle",
            redirect: "error",
          }),
        );
      } catch (error) {
        // Linked preferences/indexes must be readable, including on 404. Only unlinked
        // conventional bootstrap destinations may be created by the registration client.
        if (
          protect &&
          !profile &&
          !preferences.has(url) &&
          !indexes.has(url) &&
          status(error) === 404
        )
          throw missing(url);
        return fail("type_index_unreadable");
      }
      if (
        raw.isContainer ||
        (raw.url && documentUrl(raw.url) !== url) ||
        raw.body.byteLength > MAX_CONTENT_BYTES
      )
        fail("type_index_unreadable");
      let dataset: Store;
      try {
        dataset = await parseBoundedRdf(
          new TextDecoder("utf-8", { fatal: true }).decode(raw.body),
          raw.contentType,
          url,
        );
      } catch {
        return fail("type_index_unreadable");
      }
      if (protect && url === new URL("settings/prefs.ttl", pod.root).href) preferences.add(url);
      // The client may read documents again during a retry; reset per index observation.
      if (!profile && !preferences.has(url)) {
        matches = 0;
        discovered = undefined;
      }
      inspect(dataset, url);
      // Profiles are expected to be public; private discovery pointers need proven
      // owner-only mutation authority even when the eventual context ACL is safe.
      if (!profile) await verifyPointer(url, raw);
      return { url, etag: raw.etag ?? null, contentType: "text/turtle", dataset };
    },
    writeRdf: (url, dataset, opts) => write(url, dataset, opts.ifMatch),
    async create(parent, body, opts) {
      if (!protect || !opts?.name) return unsupported();
      const url = requirePodScopedUrl(
        { podRoot: pod.root },
        new URL(encodeURIComponent(opts.name), parent).href +
          (opts.kind === "container" ? "/" : ""),
      );
      await protect(url, opts.kind === "container");
      const bytes =
        body === null
          ? new Uint8Array()
          : typeof body === "string"
            ? encoder.encode(body)
            : body instanceof Uint8Array
              ? body
              : unsupported();
      const result = await pod.write(url, bytes, opts.contentType ?? "text/turtle", {
        ifNoneMatch: "*",
      });
      return { url, etag: result.etag ?? null, created: true };
    },
    async head(url) {
      if (url === pod.root) {
        const metadata = await pod.head?.(url);
        // Bootstrap must retain the Type Index client's root Write+Control precondition.
        const user = parseWacAllow(metadata?.wacAllow ?? "")?.user ?? [];
        return {
          allow: { write: user.includes("write"), control: user.includes("control") },
        } as Awaited<ReturnType<StorageClient["head"]>>;
      }
      try {
        await pod.read(requirePodScopedUrl({ podRoot: pod.root }, url), { redirect: "error" });
      } catch (error) {
        if (status(error) === 404) throw missing(url);
        throw error;
      }
      return { allow: null } as Awaited<ReturnType<StorageClient["head"]>>;
    },
    list: unsupported,
    listAll: unsupported,
    read: unsupported,
    write: unsupported,
    patch: unsupported,
    move: unsupported,
    delete: unsupported,
    metadata: unsupported,
    setMetadata: unsupported,
    parentOf: unsupported,
  };
  const client = createTypeIndex({ storage, features, profile: pod.webId });
  return {
    protectedUrls: () => [...preferences, ...indexes],
    async discover() {
      return (await client.find(SHARED_CONTEXT_CLASS))[0];
    },
    async register(url: string) {
      matches = 0;
      discovered = undefined;
      await client.register(SHARED_CONTEXT_CLASS, { instance: url }, { index: "private" });
    },
  };
}
