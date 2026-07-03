// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The knowledge egress chokepoint (Phase 3a/3b §3.4 — the misinformation guard).
 *
 * EVERY request `lib/knowledge/*` makes to the outside world goes through
 * {@link knowledgeFetch}, which is a CLOSED HOST ALLOWLIST layered on top of the
 * suite's foreign-origin SSRF guard (`../fetch/guarded.ts`). Only four curated,
 * authoritative origins are reachable:
 *
 *   - `www.ebi.ac.uk`          — Europe PMC (peer-reviewed indexed literature)
 *   - `eutils.ncbi.nlm.nih.gov` — PubMed E-utilities (canonical NLM index)
 *   - `clinicaltrials.gov`     — the official US trial registry
 *   - `api.fda.gov`            — openFDA drug labels
 *
 * There is NO open-web-search path and NO user-supplied-URL fetch anywhere in the
 * app: misinformation is prevented *structurally*, not by moderation. A request to
 * any other host throws {@link KnowledgeFetchError} BEFORE the network is touched,
 * and the final response URL is re-checked so a cross-host redirect can never
 * smuggle in off-allowlist content. `https:` is mandatory.
 */
import { foreignFetch } from "../fetch/guarded.js";

/** The closed allowlist of knowledge origins (hostnames). Frozen — never mutated. */
export const KNOWLEDGE_HOSTS: readonly string[] = Object.freeze([
  "www.ebi.ac.uk",
  "eutils.ncbi.nlm.nih.gov",
  "clinicaltrials.gov",
  "api.fda.gov",
]);

/** A blocked / failed knowledge fetch (off-allowlist host, non-https, or a network error). */
export class KnowledgeFetchError extends Error {
  constructor(
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeFetchError";
  }
}

/**
 * Whether `url` is an https URL on the closed knowledge allowlist. Fail-closed: a
 * malformed URL, a non-https scheme, or an off-list host all return `false`.
 */
export function isAllowlistedKnowledgeHost(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return KNOWLEDGE_HOSTS.includes(u.hostname);
}

/** Extract the string URL from a fetch input (string | URL | Request). */
function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

/**
 * A fetch bound to the knowledge allowlist. The initial URL is checked *before*
 * any network I/O (belt); the resolved `response.url` is re-checked *after* (so a
 * redirect off the allowlist is rejected, not returned — braces). Underneath, the
 * suite's guarded browser SSRF policy still applies (https-only, credentials
 * omitted, size cap, timeout).
 *
 * @param publicFetch - the pristine, credential-free fetch (never the DPoP-authed
 *   one) — no user token can ride along to a third party.
 */
export function knowledgeFetch(publicFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  const guarded = foreignFetch(publicFetch);
  return async (input, init) => {
    const url = inputUrl(input);
    if (!isAllowlistedKnowledgeHost(url)) {
      throw new KnowledgeFetchError(url, "host is not on the knowledge allowlist");
    }
    const res = await guarded(url, init);
    // A redirect can only land somewhere the browser followed it; if the final URL
    // left the allowlist, refuse the body rather than surfacing off-list content.
    if (res.url && !isAllowlistedKnowledgeHost(res.url)) {
      throw new KnowledgeFetchError(res.url, "response redirected off the knowledge allowlist");
    }
    return res;
  };
}

/**
 * Fetch + JSON-parse an allowlisted knowledge URL. A default `Accept:
 * application/json` header is safe for EPMC / PubMed / openFDA. For
 * ClinicalTrials.gov v2, pass `simple: true` so NO custom headers are sent —
 * a CORS *preflight* is triggered by any non-simple header and CT.gov 403s it
 * (§1.1). Throws {@link KnowledgeFetchError} on network / non-2xx / non-JSON.
 */
export async function knowledgeJson(
  fetchFn: typeof globalThis.fetch,
  url: string,
  opts: { simple?: boolean } = {},
): Promise<unknown> {
  let res: Response;
  try {
    res = opts.simple ? await fetchFn(url) : await fetchFn(url, { headers: { accept: "application/json" } });
  } catch (err) {
    if (err instanceof KnowledgeFetchError) throw err;
    throw new KnowledgeFetchError(url, `request failed: ${(err as Error).message}`);
  }
  if (!res.ok) throw new KnowledgeFetchError(url, `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new KnowledgeFetchError(url, "non-JSON body");
  }
}
