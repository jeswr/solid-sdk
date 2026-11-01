// AUTHORED-BY Claude Fable 5
/**
 * Authorized-pod derivation (L2): the pod a route may touch is
 * derived from the VERIFIED token WebID by a bidirectional `pim:storage`
 * binding — never from a request parameter.
 *
 * Originally extracted from the reviewed reference implementation; since
 * hardened here (storage-root check, malformed-claim handling).
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
 *      The candidate must also be a storage root (`pim:Storage` type link), so
 *      a shared sub-container where others can write cannot pose as a pod.
 *
 * All RDF is parsed via `@jeswr/fetch-rdf`; storage claims are read by quad
 * match so one malformed value cannot abort the walk (see `storageClaims`).
 * The WebID profile fetch is DNS-pinned and SSRF-guarded
 * (`@jeswr/guarded-fetch/node`). The dev/e2e loopback flag admits loopback
 * addresses to that guard and adds the https→http loopback mapping the dev
 * issuer's TLS-terminator stand-in needs; every binding check runs identically.
 */
import { fetchRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import type { PodGuardConfig } from "./config.js";
import {
  assertAllowedPodBase,
  assertStorageRoot,
  isLoopback,
  PodAccessError,
  type PodIoFetch,
  readPodResource,
} from "./pod.js";

/** Test seams for {@link resolveAuthorizedPod}. */
export interface OwnerBindingSeams {
  /** Fetch for the WebID profile document (defaults per the module header). */
  profileFetch?: typeof fetch;
  /** Fetch for the pod-root probe and the owner-card read (default: anonymous, redirect-refusing). */
  podFetch?: PodIoFetch;
}

const PIM_STORAGE = "http://www.w3.org/ns/pim/space#storage";

/**
 * Dev-only TLS-terminator stand-in for loopback WebID profile fetches. WebIDs
 * are hard-required `https:`, but a loopback dev issuer may listen on EITHER
 * the plain-HTTP stand-in (the historical dev case — TLS termination is faked)
 * OR a REAL TLS listener (issuers whose own OIDC verifier demands genuine TLS,
 * e.g. sparq's `@solid/access-token-verifier`, which has no loopback-http
 * exception on its pod-direct path). So for a `https://<loopback>` target we
 * try the `http://<loopback>` stand-in FIRST (same host/port — the long-
 * standing behaviour, unchanged for plain-HTTP dev issuers) and fall back to
 * the `https:` the WebID actually claims ONLY if the downgraded request fails
 * at the connection layer. Loopback hosts only; non-loopback and non-https
 * targets pass through untouched.
 *
 * SECURITY: reachable ONLY under `allowInsecureLoopback` (dev/e2e) — production
 * uses the DNS-pinned SSRF-guarded fetch and never enters here. This fetch
 * carries NO token/credential: it reads the caller's PUBLIC WebID profile
 * document. The fallback only ever targets the SAME loopback host/port over the
 * WebID's own claimed https — it opens no new host and leaks no secret.
 *
 * @internal exported for unit testing only; not part of the package API.
 */
export function loopbackMappedFetch(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      // Not an absolute URL — let the underlying fetch produce the error.
      return base(input, init);
    }
    if (url.protocol !== "https:" || !isLoopback(url)) {
      // Not a loopback https target — pass through untouched.
      return base(input, init);
    }
    const mapped = new URL(url.href);
    mapped.protocol = "http:";
    const httpHref = mapped.href;
    try {
      // Primary: the plain-HTTP stand-in (unchanged historical behaviour).
      return await (input instanceof Request
        ? base(new Request(httpHref, input), init)
        : base(httpHref, init));
    } catch (httpError) {
      // The stand-in isn't there — the issuer serves REAL TLS. Honor the
      // https the WebID claims (same host/port). If that also fails, surface
      // the original downgraded-request error (fail closed).
      try {
        return await base(input, init);
      } catch {
        throw httpError;
      }
    }
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

/** Dev/e2e profile fetch: still DNS-pinned and SSRF-guarded, with loopback admitted. */
let loopbackProfileFetch: Promise<typeof fetch> | undefined;

function devProfileFetch(): Promise<typeof fetch> {
  loopbackProfileFetch ??= import("@jeswr/guarded-fetch/node").then((mod) =>
    mod.createNodeGuardedFetch({ allowLoopback: true }),
  );
  return loopbackProfileFetch;
}

async function profileFetchFor(
  config: PodGuardConfig,
  seams: OwnerBindingSeams,
): Promise<typeof fetch> {
  if (seams.profileFetch !== undefined) return seams.profileFetch;
  if (config.allowInsecureLoopback === true) {
    const guarded = await devProfileFetch();
    return loopbackMappedFetch((input, init) => guarded(input, { ...init, redirect: "error" }));
  }
  return productionProfileFetch();
}

/**
 * The claimed storages of `webid` in `dataset`. Pod RDF is untrusted input: a
 * claim whose object is not an IRI (a literal or blank node) is skipped, so a
 * stray value next to a valid claim neither crashes the binding nor counts.
 * (The typed `Agent.pimStorage` set throws mid-iteration on such a value.)
 */
function storageClaims(dataset: DatasetCore, webid: string): ReadonlySet<string> {
  const claims = new Set<string>();
  const { namedNode } = DataFactory;
  for (const quad of dataset.match(namedNode(webid), namedNode(PIM_STORAGE), null)) {
    if (quad.object.termType === "NamedNode") claims.add(quad.object.value);
  }
  return claims;
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
  // An unconfigured rail is a 503 before any outbound IO, whatever the profile says.
  if (config.allowedPodOrigins.length === 0) {
    throw new PodAccessError(
      503,
      "the allowedPodOrigins pod allowlist is unset — pod rail disabled",
    );
  }

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

  // The candidate must be a storage root: otherwise a container where a non-owner can
  // create `profile/card` would pass both the pod-rooted shortcut and step 3.
  await assertStorageRoot(podBase, seams.podFetch);

  // 3. Backward acknowledgment from the pod's owner-controlled profile card.
  const cardIri = `${podBase}profile/card`;
  const webidDocIri = webid.split("#")[0];
  if (webidDocIri !== cardIri) {
    const card = await readPodResource(cardIri, podBase, seams.podFetch);
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
