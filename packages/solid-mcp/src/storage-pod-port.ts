// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { AsyncLocalStorage } from "node:async_hooks";
import { createPodClient, type StorageClient } from "@jeswr/storage-client";
import {
  normalizePodRoot,
  podScopedUrlOrUndefined,
  requirePodScopedUrl,
  requirePodScopedWriteUrl,
  type SolidMcpConfig,
  writesEnabled,
} from "./auth.js";
import { parseBoundedRdf } from "./bounded-rdf.js";
import { requireContainerCreationBody } from "./container-mutation.js";
import { limitedBody, mediaType, RDF_MEDIA_TYPES } from "./content.js";
import { requireWriteConditions } from "./generic-mutation.js";
import { podOperationFetch, withPodReadMode } from "./pod-operation.js";
import {
  configurePodSearchLimits,
  createFetchPodPort,
  type PodConditions,
  type PodPort,
  registerNativePodRead,
} from "./pod-port.js";

const solidListings = new AsyncLocalStorage<boolean>();

/** Discover Solid or LWS through storage-client, retaining the MCP capability boundary. */
export function createStoragePodPort(
  input: SolidMcpConfig,
  discoveryFetch?: typeof fetch,
): PodPort {
  const config = { ...input, podRoot: normalizePodRoot(input.podRoot) };
  const legacy = createFetchPodPort(config);
  let client: Promise<StorageClient> | undefined;
  const transport: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    let response: Response;
    if (podScopedUrlOrUndefined(config, request.url) !== undefined) {
      response = await podOperationFetch(config.fetch)(request);
    } else {
      // Description documents may sit outside the storage root. They remain
      // same-origin public discovery and never receive a pod credential.
      if (
        new URL(request.url).origin !== new URL(config.podRoot).origin ||
        !["GET", "HEAD", "OPTIONS"].includes(request.method)
      )
        throw new Error("Outside discovery scope");
      for (const name of ["authorization", "dpop", "cookie"])
        if (request.headers.has(name)) throw new Error("Caller credentials are forbidden");
      if (discoveryFetch === undefined) throw new Error("Anonymous discovery transport required");
      response = await podOperationFetch(discoveryFetch)(request, {
        redirect: "manual",
        credentials: "omit",
      });
    }
    // Keep MCP's RDF allocation/context limits before the Solid backend parses
    // a listing. LWS JSON listings remain opaque JSON, including JSON-LD contexts.
    const type = mediaType(response.headers.get("content-type"));
    if (
      solidListings.getStore() &&
      request.method === "GET" &&
      response.ok &&
      RDF_MEDIA_TYPES.has(type)
    ) {
      const { bytes, truncated } = await limitedBody(response, request.signal);
      if (truncated) throw new Error("Container exceeds the bounded read limit");
      await parseBoundedRdf(new TextDecoder().decode(bytes), type, request.url);
      const bounded = new Response(new Uint8Array(bytes), response);
      Object.defineProperty(bounded, "url", { value: response.url });
      return bounded;
    }
    return response;
  };
  const storage = () => {
    // Discovery needs complete descriptions even when the resource read only
    // needs headers or a fetch prefix. Keep the operation's deadline and cap.
    client ??= withPodReadMode("complete", () =>
      createPodClient({
        storage: config.podRoot,
        // Resolve the operation's deadline/body budget on every request, including pagination.
        fetch: transport,
      }),
    )
      .then((pod) => pod.storage)
      .catch((error: unknown) => {
        client = undefined;
        throw error;
      });
    return client;
  };
  const mutation = (url: string, cond: PodConditions) => {
    if (!writesEnabled(config)) throw new Error("write disabled: server is read-only");
    const target = requirePodScopedWriteUrl(config, url);
    if (cond.ifNoneMatch !== undefined && cond.ifNoneMatch !== "*")
      throw new Error("Unsupported create precondition");
    if (cond.ifMatch !== undefined && cond.ifNoneMatch !== undefined)
      throw new Error("Conflicting mutation preconditions");
    return target;
  };
  const pod: PodPort = {
    root: config.podRoot,
    webId: config.webId ?? "",
    async head(url) {
      const target = requirePodScopedUrl(config, url);
      await storage();
      // storage-client rejects 404 responses before exposing their Link headers.
      // Use the same scoped fetch metadata path so absent targets remain discoverable.
      return (await legacy.head?.(target)) ?? {};
    },
    async read(url, options) {
      if (url === config.webId && podScopedUrlOrUndefined(config, url) === undefined)
        return legacy.read(url, options);
      const target = requirePodScopedUrl(config, url);
      const read = await (await storage()).read(target, options);
      return {
        body: await read.bytes(),
        contentType:
          read.contentType === null
            ? ""
            : (read.contentType.split(";", 1)[0] ?? "").trim().toLowerCase(),
        etag: read.etag ?? undefined,
        url: requirePodScopedUrl(config, read.url),
        isContainer: read.kind === "container",
      };
    },
    async list(url) {
      const target = requirePodScopedUrl(config, url);
      const backend = await storage();
      return solidListings.run(backend.protocol === "solid", async () => {
        const children = [];
        for await (const entry of backend.listAll(target)) {
          const child = podScopedUrlOrUndefined(config, entry.url);
          if (child === undefined) continue;
          children.push({
            url: child,
            isContainer: entry.kind === "container",
            type: [...entry.types],
            ...(entry.contentType === null ? {} : { mimeType: entry.contentType }),
            ...(entry.size === null ? {} : { size: entry.size }),
            ...(entry.modified === null ? {} : { modified: entry.modified.toISOString() }),
          });
        }
        return children;
      });
    },
    async write(url, body, contentType, cond) {
      const target = mutation(url, cond);
      // storage-client's '*' means unconditional; PodPort's explicit wildcard
      // requires an existing representation. Refuse rather than drop that guard.
      if (cond.ifMatch === "*") throw new Error("Unsupported wildcard update precondition");
      requireWriteConditions(cond);
      const backend = await storage();
      let result: Awaited<ReturnType<StorageClient["write"]>>;
      if (cond.ifNoneMatch === "*") {
        // PodPort promises an exact URL. LWS Slug is only a hint, so a create could
        // silently write somewhere else. Refuse before sending any mutation.
        if (backend.protocol !== "solid")
          throw new Error("Exact create-only URLs are unsupported by LWS");
        const parsed = new URL(target);
        if (parsed.search || parsed.hash || /[?#]/u.test(url))
          throw new Error("Invalid create target");
        const container = parsed.pathname.endsWith("/");
        await requireContainerCreationBody(target, body, contentType);
        const path = target.replace(/\/$/u, "");
        const slash = path.lastIndexOf("/");
        const name = decodeURIComponent(path.slice(slash + 1));
        if (
          `${path.slice(0, slash + 1)}${encodeURIComponent(name)}${container ? "/" : ""}` !== target
        )
          throw new Error("Exact create target is not representable");
        result = await backend.create(path.slice(0, slash + 1), body, {
          name,
          contentType,
          kind: container ? "container" : "resource",
        });
      } else {
        result = await backend.write(target, body, {
          contentType,
          ifMatch: cond.ifMatch,
        });
      }
      return { etag: result.etag ?? undefined };
    },
    async delete(url, cond = {}) {
      const target = mutation(url, cond);
      if (cond.ifNoneMatch !== undefined) throw new Error("Unsupported delete precondition");
      const backend = await storage();
      const ifMatch = cond.ifMatch ?? (await backend.head(target)).etag;
      if (!ifMatch) throw new Error("Deletion requires an ETag");
      await backend.delete(target, { ifMatch });
    },
  };
  configurePodSearchLimits(pod, config.searchLimits);
  registerNativePodRead(pod.read);
  return pod;
}
