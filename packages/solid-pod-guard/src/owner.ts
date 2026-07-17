// AUTHORED-BY Claude Fable 5
/**
 * Authorized-pod derivation (L2): the pod a route may touch is
 * derived from the VERIFIED token WebID by a bidirectional `pim:storage`
 * binding — never from a request parameter.
 *
 * Extracted verbatim from the reviewed reference implementation (config
 * renamed only).
 *
 *   1. FORWARD claim — the WebID's own profile document must claim
 *      `<webid> pim:storage <pod>`;
 *   2. ALLOWLIST — claimed pods are filtered through the operator's
 *      `allowedPodOrigins`; exactly ONE candidate must survive
 *      (zero or several ⇒ 403, fail closed — never pick-first);
 *   3. BACKWARD acknowledgment — `<pod>profile/card`, a resource only the pod
 *      owner can write, must assert the SAME triple. This is THE load-bearing
 *      control on shared pod hosts: an ORIGIN allowlist cannot separate
 *      `https://pods.example/alex/` from `https://pods.example/mallory/`, and
 *      the forward claim is attacker-authored (anyone can put any IRI in their
 *      own profile) — only the victim pod's refusal to name the attacker stops
 *      cross-pod substitution. When the WebID document IS `<pod>profile/card`
 *      (pod-rooted WebIDs) the forward claim was
 *      already read from an owner-controlled pod resource and one fetch serves
 *      both checks.
 *
 *      TRUST ASSUMPTION: the backward
 *      acknowledgment is meaningful only because `<pod>profile/card` is
 *      OWNER-ONLY-WRITABLE — an operator requirement on every allowlisted pod
 *      host that this code cannot verify from outside. See SKILL.md.
 *
 * All RDF via `@jeswr/fetch-rdf` + `@solid/object` typed accessors (house
 * rule). The WebID profile fetch is DNS-pinned SSRF-guarded in production
 * (`@jeswr/guarded-fetch/node`); the dev/e2e loopback flag swaps ONLY the
 * transport (plain redirect-refusing fetch + the https→http loopback mapping
 * the dev issuer's TLS-terminator stand-in needs) — every binding check runs
 * identically.
 */
import { fetchRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import type { PodGuardConfig } from "./config.js";
import { assertAllowedPodBase, PodAccessError, readPodResource } from "./pod.js";

/** Test seams for {@link resolveAuthorizedPod}. */
export interface OwnerBindingSeams {
  /** Fetch for the WebID profile document (defaults per the module header). */
  profileFetch?: typeof fetch;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Dev-only TLS-terminator stand-in: WebID claims are hard-required to be
 * `https:`, but the loopback dev issuer actually listens on plain HTTP — map
 * `https://<loopback>` onto `http://<loopback>` (same host/port). Loopback
 * hosts only; everything else passes through untouched.
 */
function loopbackMappedFetch(base: typeof fetch): typeof fetch {
  return (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && LOOPBACK_HOSTS.has(url.hostname)) {
        url.protocol = "http:";
        return input instanceof Request
          ? base(new Request(url.href, input), init)
          : base(url.href, init);
      }
    } catch {
      // Not an absolute URL — let the underlying fetch produce the error.
    }
    return base(input, init);
  };
}

/** Lazily-built production profile fetch (undici DNS pinning; server-only import). */
let pinnedProfileFetch: Promise<typeof fetch> | undefined;

function productionProfileFetch(): Promise<typeof fetch> {
  pinnedProfileFetch ??= import("@jeswr/guarded-fetch/node").then((mod) =>
    mod.createNodeGuardedFetch({}),
  );
  return pinnedProfileFetch;
}

async function profileFetchFor(
  config: PodGuardConfig,
  seams: OwnerBindingSeams,
): Promise<typeof fetch> {
  if (seams.profileFetch !== undefined) return seams.profileFetch;
  if (config.allowInsecureLoopback === true) {
    const plain: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" });
    return loopbackMappedFetch(plain);
  }
  return productionProfileFetch();
}

/**
 * The claimed storages of `webid` in `dataset`, via the typed accessor. Pod
 * RDF is untrusted input: a malformed claim (e.g. a literal where an IRI is
 * expected) reads as NO claim (fail closed), never as a crash.
 */
function storageClaims(dataset: DatasetCore, webid: string): ReadonlySet<string> {
  try {
    const agent = new Agent(DataFactory.namedNode(webid), dataset, DataFactory);
    return agent.pimStorage;
  } catch {
    return new Set();
  }
}

/**
 * Derive the ONE pod base the verified `webid` is authorized for. Throws
 * `PodAccessError` (fail-closed) on every violation; the route layer lowers it
 * to an HTTP response without leaking internals.
 */
export async function resolveAuthorizedPod(
  webid: string,
  config: PodGuardConfig,
  seams: OwnerBindingSeams = {},
): Promise<string> {
  // 1. Forward claim from the WebID's own (authoritative) profile document.
  const profileFetch = await profileFetchFor(config, seams);
  let claims: ReadonlySet<string>;
  try {
    const { dataset } = await fetchRdf(webid, { fetch: profileFetch });
    claims = storageClaims(dataset, webid);
  } catch {
    throw new PodAccessError(502, "could not read the caller's WebID profile document");
  }
  if (claims.size === 0) {
    throw new PodAccessError(
      403,
      "pod_binding: the caller's WebID profile claims no pim:storage pod",
    );
  }

  // 2. Allowlist filter — exactly one surviving candidate.
  const candidates = new Set<string>();
  for (const claim of claims) {
    try {
      candidates.add(assertAllowedPodBase(claim, config));
    } catch (error) {
      // 503 means the whole rail is unconfigured — that is not a per-claim skip.
      if (error instanceof PodAccessError && error.status === 503) throw error;
      // Otherwise: a claim outside the allowlist is simply not a candidate.
    }
  }
  if (candidates.size === 0) {
    throw new PodAccessError(
      403,
      "pod_binding: no pim:storage claimed by the caller's WebID is in the pod allowlist",
    );
  }
  if (candidates.size > 1) {
    throw new PodAccessError(
      403,
      "pod_binding: the caller's WebID claims multiple allowlisted pods — refusing to guess",
    );
  }
  const [podBase] = candidates;
  if (podBase === undefined) throw new PodAccessError(500, "unreachable: empty candidate set");

  // 3. Backward acknowledgment from the pod's owner-controlled profile card.
  const cardIri = `${podBase}profile/card`;
  const webidDocIri = webid.split("#")[0];
  if (webidDocIri !== cardIri) {
    const card = await readPodResource(cardIri, podBase);
    if (card === undefined) {
      throw new PodAccessError(
        403,
        "pod_binding: the pod has no profile card acknowledging an owner",
      );
    }
    const acknowledged = storageClaims(card.dataset, webid);
    let acknowledges = false;
    for (const value of acknowledged) {
      try {
        if (assertAllowedPodBase(value, config) === podBase) {
          acknowledges = true;
          break;
        }
      } catch {
        // A malformed/non-allowlisted acknowledgment value is not a match.
      }
    }
    if (!acknowledges) {
      throw new PodAccessError(
        403,
        "pod_binding: the pod does not acknowledge this WebID as its owner",
      );
    }
  }

  return podBase;
}
