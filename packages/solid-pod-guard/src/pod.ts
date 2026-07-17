// AUTHORED-BY Claude Fable 5
/**
 * Guarded server-side pod IO for the authenticated-caller boundary.
 *
 * Extracted verbatim from the reviewed reference implementation (config
 * renamed; only the pieces `resolveAuthorizedPod` depends on moved — app
 * write helpers stayed in the reference app). Reads go through
 * `@jeswr/fetch-rdf` (the sanctioned fetch+parse path).
 *
 * SSRF posture: the pod base is DERIVED from the authenticated caller
 * (never a request parameter), and defence-in-depth confines
 * every pod IO to the operator-configured `allowedPodOrigins` allowlist;
 * non-loopback origins must be https, and redirects are refused. No allowlist
 * ⇒ every pod route fails closed (503).
 */
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import type { PodGuardConfig } from "./config.js";

/** Fail-closed pod-boundary violation; the route layer lowers it to an HTTP response. */
export class PodAccessError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PodAccessError";
    this.status = status;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname) || url.hostname === "::1";
}

/**
 * Validate an untrusted pod base URL against the config allowlist. Returns
 * the normalised base (trailing slash). Throws `PodAccessError` (fail-closed).
 */
export function assertAllowedPodBase(pod: string, config: PodGuardConfig): string {
  if (config.allowedPodOrigins.length === 0) {
    throw new PodAccessError(
      503,
      "the allowedPodOrigins pod allowlist is unset — pod rail disabled",
    );
  }
  let url: URL;
  try {
    url = new URL(pod);
  } catch {
    throw new PodAccessError(400, "pod is not a valid URL");
  }
  if (url.username !== "" || url.password !== "") {
    throw new PodAccessError(400, "pod URL must not carry userinfo");
  }
  const httpsOk = url.protocol === "https:";
  const loopbackOk =
    url.protocol === "http:" && config.allowInsecureLoopback === true && isLoopback(url);
  if (!httpsOk && !loopbackOk) {
    throw new PodAccessError(400, "pod must be https (or loopback http in dev mode)");
  }
  const allowed = config.allowedPodOrigins.some((entry) => {
    try {
      return new URL(entry).origin === url.origin;
    } catch {
      return false;
    }
  });
  if (!allowed) {
    throw new PodAccessError(403, `pod origin ${url.origin} is not in the allowlist`);
  }
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

/**
 * The pod-IO fetch. Redirect-refusing always — an allowlisted origin must not
 * bounce us out of the boundary.
 */
export type PodIoFetch = typeof fetch;

/** The default (ANONYMOUS) pod-IO fetch — redirect-refusing. */
export function anonymousPodFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, redirect: "error" });
}

export interface PodResource {
  readonly dataset: DatasetCore;
  readonly etag: string | null;
}

/** GET+parse one pod RDF resource. 404 → `undefined`; other failures throw. */
export async function readPodResource(
  iri: string,
  base: string,
  podFetch: PodIoFetch = anonymousPodFetch,
): Promise<PodResource | undefined> {
  try {
    const { dataset, etag } = await fetchRdf(iri, {
      fetch: (input, init) => podFetch(input, { ...init, redirect: "error" }),
    });
    return { dataset, etag };
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404) return undefined;
    throw new PodAccessError(
      502,
      `could not read ${iri.replace(base, "<pod>/")}: ${(error as Error).message}`,
    );
  }
}
