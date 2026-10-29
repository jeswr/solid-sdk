// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { isContainerUrl } from "@jeswr/guarded-fetch";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import {
  normalizePodRoot,
  podScopedUrlOrUndefined,
  requirePodScopedUrl,
  requirePodScopedWriteUrl,
  type SolidMcpConfig,
  scopedFetch,
  writesEnabled,
} from "./auth.js";
import { fetchBoundedRdf } from "./bounded-rdf.js";
import type { PodChild } from "./pod.js";
import { hasPodFetchLimits, podOperationFetch } from "./pod-operation.js";

/** Conditional mutation headers supported by a pod. */
export interface PodConditions {
  /** Require the current resource's ETag. */
  ifMatch?: string;
  /** Create only when the resource does not already exist. */
  ifNoneMatch?: "*";
}

/** Optional representation preference for a resource read. */
export interface PodReadOptions {
  /** Accepted media types; omitted for the backend's default representation. */
  accept?: string;
}

/** Raw resource bytes, media type and optional ETag. */
export interface PodReadResult {
  /** Unmodified response bytes. */
  body: Uint8Array;
  /** Bare media type; an empty string means the server omitted it. */
  contentType: string;
  /** Resource version, when supplied by the server. */
  etag?: string;
  /** Final representation URL after validated redirects, when available. */
  url?: string;
  /** Container identified by the backend, including LDP type links on redirect hops. */
  isContainer?: boolean;
}

/** Minimal portable container entry; fetch-backed listings retain legacy metadata. */
export type PodEntry = Pick<PodChild, "url" | "isContainer"> &
  Partial<Omit<PodChild, "url" | "isContainer">>;

/** Protocol-neutral data seam; storage-client will supply another implementation in MCP-15. */
export interface PodPort {
  /** Absolute container URL delimiting this capability. */
  readonly root: string;
  /** Owner identity used for best-effort Type Index discovery; empty when unknown. */
  readonly webId: string;
  /** Read raw bytes. The configured WebID may be read for discovery, even when off-pod. */
  read(url: string, options?: PodReadOptions): Promise<PodReadResult>;
  /** List a container's immediate children. */
  list(container: string): Promise<PodEntry[]>;
  /** Write bytes with optional preconditions; reject redirects and disabled writes. */
  write(
    url: string,
    body: Uint8Array,
    contentType: string,
    cond: PodConditions,
  ): Promise<{ etag?: string }>;
  /** Delete with optional preconditions; reject redirects and disabled writes. */
  delete(url: string, cond?: PodConditions): Promise<void>;
}

/** Existing fetch configuration or an injected portable pod. */
export type PodSource = SolidMcpConfig | PodPort;

/** Resolve legacy configuration without requiring storage-client or pod-auth packages. */
export function asPodPort(source: PodSource): PodPort {
  return "root" in source ? source : createFetchPodPort(source);
}

// Retain only configuration limits, never a way around the injected capability.
const searchLimits = new WeakMap<PodPort, SolidMcpConfig["searchLimits"]>();
const nativeReads = new WeakSet<PodPort["read"]>();

/** Internal: only native reads are known not to authorize against complete bodies. */
export function isFetchPodRead(read: PodPort["read"]): boolean {
  return nativeReads.has(read);
}

/** Type relations may share a Link header with quoted commas and other relations. */
function hasContainerTypeLink(header: string): boolean {
  for (const link of header.matchAll(/<([^<>]*)>((?:[^"<,]|"(?:[^"\\]|\\.)*")*)/g)) {
    if (!/^http:\/\/www\.w3\.org\/ns\/ldp#(?:Basic|Direct|Indirect)?Container$/.test(link[1] ?? ""))
      continue;
    for (const rel of (link[2] ?? "").matchAll(
      /(?:^|;)\s*rel\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s;,]+))/gi,
    )) {
      if (
        (rel[1] ?? rel[2] ?? "").replace(/\\(.)/g, "$1").toLowerCase().split(/\s+/).includes("type")
      )
        return true;
    }
  }
  return false;
}

/** Internal: configured search defaults for a legacy source or fetch adapter. */
export function podSearchLimits(source: PodSource): SolidMcpConfig["searchLimits"] {
  return "root" in source ? searchLimits.get(source) : source.searchLimits;
}

/** Fetch-backed PodPort, preserving the existing pod scope and configured-identity exception. */
export function createFetchPodPort(input: SolidMcpConfig): PodPort {
  const config = { ...input, podRoot: normalizePodRoot(input.podRoot) };
  const pod: PodPort = {
    root: config.podRoot,
    webId: config.webId ?? "",
    async read(url, options: PodReadOptions = {}) {
      // Only the operator-configured identity retains the legacy off-pod exception.
      // Tool/resource callers scope-check first, so clients cannot use it as an escape.
      const profile = url === config.webId;
      const target = profile ? url : requirePodScopedUrl(config, url);
      let finalUrl = target;
      let isContainer = false;
      const boundedFetch = podOperationFetch(config.fetch);
      const transport: typeof globalThis.fetch = async (input, init) => {
        const requestedUrl = input instanceof Request ? input.url : input.toString();
        const response = await boundedFetch(input, init);
        finalUrl = response.url || requestedUrl;
        // Retain container evidence across the whole guarded redirect chain,
        // even when a transport omits Response.url (e.g. a portable test seam).
        isContainer ||=
          isContainerUrl(requestedUrl) ||
          isContainerUrl(finalUrl) ||
          hasContainerTypeLink(response.headers.get("link") ?? "");
        return response;
      };
      const fetcher =
        profile && podScopedUrlOrUndefined(config, url) === undefined
          ? transport
          : scopedFetch({ ...config, fetch: transport });
      const response = await fetcher(target, {
        method: "GET",
        // The off-pod identity exception must never follow an unchecked redirect.
        // In-pod reads still use guardedFetch's validated redirect loop.
        redirect: "manual",
        // Generic reads preserve the server's default representation.
        headers: options.accept === undefined ? undefined : { accept: options.accept },
      });
      if (!response.ok) void response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `unauthenticated/forbidden (${response.status}) reading ${target} (HTTP ${response.status}) — supply an authenticated fetch (the Solid-MCP server holds no credentials of its own).`,
        );
      }
      if (!response.ok) {
        throw new Error(`failed to read ${target}: HTTP ${response.status} ${response.statusText}`);
      }
      return {
        body: new Uint8Array(await response.arrayBuffer()),
        contentType: ((response.headers.get("content-type") ?? "").split(";").shift() ?? "")
          .trim()
          .toLowerCase(),
        etag: response.headers.get("etag") ?? undefined,
        ...(response.url || finalUrl !== target ? { url: finalUrl } : {}),
        ...(isContainer ? { isContainer: true } : {}),
      };
    },
    async list(url): Promise<PodChild[]> {
      const target = requirePodScopedUrl(config, url);
      const read = hasPodFetchLimits() ? fetchBoundedRdf : fetchRdf;
      const { dataset } = await read(target, {
        fetch: scopedFetch({ ...config, fetch: podOperationFetch(config.fetch) }),
      });
      const container = new ContainerDataset(dataset, DataFactory).container;
      const children: PodChild[] = [];
      for (const r of container?.contains ?? []) {
        // child.id may be relative to the container; resolve against the container URL,
        // then re-validate it is within the pod (the listing is untrusted — drop any
        // entry that escapes the pod scope rather than trusting it).
        let resolvedChild: string;
        try {
          resolvedChild = new URL(r.id, target).toString();
        } catch {
          continue; // unparseable child id — skip.
        }
        const childUrl = podScopedUrlOrUndefined(config, resolvedChild);
        if (childUrl === undefined) {
          continue; // out-of-pod child entry in the listing — drop it (SSRF guard).
        }
        const child: PodChild = {
          url: childUrl,
          name: r.name,
          isContainer: r.isContainer,
          type: [...r.type],
        };
        if (r.mimeType !== undefined) child.mimeType = r.mimeType;
        if (r.size !== undefined) child.size = r.size;
        if (r.modified !== undefined) child.modified = r.modified.toISOString();
        children.push(child);
      }
      return children;
    },
    async write(url, body, contentType, cond) {
      const response = await mutate("PUT", url, cond, body, contentType);
      return { etag: response.headers.get("etag") ?? undefined };
    },
    async delete(url, cond = {}) {
      await mutate("DELETE", url, cond);
    },
  };

  searchLimits.set(pod, config.searchLimits && { ...config.searchLimits });
  nativeReads.add(pod.read);
  return pod;

  async function mutate(
    method: "PUT" | "DELETE",
    url: string,
    cond: PodConditions,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    if (!writesEnabled(config)) {
      throw new Error("write disabled: server is read-only (set readOnly:false to enable writes).");
    }
    const target = requirePodScopedWriteUrl(config, url);
    const headers = new Headers();
    if (contentType !== undefined) headers.set("content-type", contentType);
    if (cond.ifMatch !== undefined) headers.set("if-match", cond.ifMatch);
    if (cond.ifNoneMatch !== undefined) headers.set("if-none-match", cond.ifNoneMatch);
    const response = await config.fetch(target, {
      method,
      headers,
      ...(body === undefined ? {} : { body: Buffer.from(body) }),
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        `refusing to follow a redirect (${response.status}) on a write to ${target} (SSRF guard).`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `unauthenticated/forbidden (${response.status}) writing ${target} — supply an authenticated fetch with write access.`,
      );
    }
    if (!response.ok) {
      throw new Error(`failed to write ${target}: HTTP ${response.status} ${response.statusText}`);
    }
    return response;
  }
}
