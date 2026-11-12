// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import {
  type ChallengeBinding,
  CredentialBoundary,
  describes,
  type HttpOptions,
  head,
  isWithin,
  parseLinks,
  secureDocumentFetch,
  selfIdentifiedSolidRoot,
} from "@jeswr/reactive-authentication";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store } from "n3";
import { type ResourceGrant, ResourceGrantError } from "./grants.js";
import { isLoopback, secureUrl, storageEndpointPaths } from "./options.js";
import type { PodAuthOptions } from "./types.js";

const PIM = "http://www.w3.org/ns/pim/space#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** At most this many same-origin description roots are probed per storage identifier. */
const MAX_DESCRIPTION_ROOTS = 8;
const LWS_STORAGE = "https://www.w3.org/ns/lws#storage";
const SOLID_STORAGE_DESCRIPTION = "http://www.w3.org/ns/solid/terms#storageDescription";

/**
 * The storage roots a storage description advertises, read without credentials or redirects:
 * an LWS (`application/lws+cid`) description's `StorageRoot` services, or a Turtle description's
 * `pim:Storage` subjects. Any failure yields no roots. Advertised roots are claims only; callers
 * must still confirm each root (pod-auth's `learn()` requires a same-origin container that
 * confirms itself by HEAD) or require it to lie inside an existing grant.
 */
export async function storageDescriptionRoots(
  storage: string,
  http: Pick<HttpOptions, "fetch">,
  options: { allowInsecureLoopback?: boolean; signal: AbortSignal },
): Promise<string[]> {
  try {
    const url = secureUrl(storage, options.allowInsecureLoopback === true, "storage description");
    const response = await http.fetch!(url, {
      headers: { accept: "application/lws+cid, text/turtle;q=0.9" },
      credentials: "omit",
      redirect: "error",
      signal: options.signal,
    });
    if (!response.ok || !describes(response, url.href)) return [];
    if (
      response.headers.get("content-type")?.includes("json") ||
      response.headers.get("content-type")?.includes("application/lws+cid")
    ) {
      const document = await response.json();
      const includes = (value: unknown, type: string) =>
        value === type || (Array.isArray(value) && value.includes(type));
      if (document?.id !== storage || !includes(document.type, "Storage")) return [];
      return (Array.isArray(document.service) ? document.service : [])
        .filter((service: { type?: unknown } | null) => includes(service?.type, "StorageRoot"))
        .map((service: { serviceEndpoint?: unknown }) => service.serviceEndpoint)
        .filter((root: unknown): root is string => typeof root === "string");
    }
    const dataset = new Store(new Parser({ baseIRI: storage }).parse(await response.text()));
    return dataset
      .getSubjects(DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${PIM}Storage`), null)
      .filter((subject) => subject.termType === "NamedNode")
      .map((subject) => subject.value);
  } catch {
    return [];
  }
}

/** Identity assertions authorize roots. Resource responses can only narrow that authority. */
export function createBoundary(
  options: Pick<PodAuthOptions, "boundary" | "allowInsecureLoopback">,
  http: HttpOptions,
) {
  const insecure = options.allowInsecureLoopback === true;
  const eligible = (value: string | URL) => {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || (insecure && url.protocol === "http:" && isLoopback(url))) &&
      (options.boundary?.eligible?.(url) ?? true)
    );
  };
  const fixed = new CredentialBoundary(options.boundary?.roots, { allowInsecureHttp: insecure });
  // Read and validated once here, so later mutation (or a getter) cannot add or swap grants.
  const storageEndpoints = storageEndpointPaths(options.boundary?.storageEndpoints);
  const automaticRoots = options.boundary?.automatic !== false;
  let automatic = new CredentialBoundary([], { allowInsecureHttp: insecure });
  // Configured server endpoints on a verified storage's origin, mapped to that storage root.
  let endpoints = new Map<string, string>();
  let learnedWebId: string | undefined;
  let learnedSignal: AbortSignal | undefined;
  let epoch = 0;
  // Resources on other storages the user chose to open with this account (grantResource). They
  // receive credentials like a storage, but are never roots: no AS trust, storages() or login context.
  let consented = new CredentialBoundary([], { allowInsecureHttp: insecure });
  let grants: readonly ResourceGrant[] = Object.freeze([]);
  const grantListeners = new Set<() => void>();
  const setGrants = (next: readonly ResourceGrant[]) => {
    consented = new CredentialBoundary(
      next.map((grant) => grant.root),
      { allowInsecureHttp: insecure },
    );
    grants = Object.freeze([...next]);
    for (const listener of [...grantListeners]) {
      try {
        listener();
      } catch {
        // Observers cannot interrupt credential policy or other observers.
      }
    }
  };
  // Grants end with the session generation they were made in, even when no roots were learned.
  let grantLifetime: AbortSignal | undefined;
  const endGrants = () => {
    grantLifetime = undefined;
    if (grants.length > 0) setGrants([]);
  };
  const clear = () => {
    ++epoch;
    grantLifetime?.removeEventListener("abort", endGrants);
    grantLifetime = undefined;
    learnedSignal?.removeEventListener("abort", clear);
    learnedSignal = undefined;
    automatic = new CredentialBoundary([], { allowInsecureHttp: insecure });
    endpoints = new Map();
    learnedWebId = undefined;
    if (grants.length > 0) setGrants([]);
  };
  const roots = () => [...new Set([...fixed.entries, ...automatic.entries])];
  const owns = (url: string | URL) => fixed.allows(url) || automatic.allows(url);
  const allows = (url: string | URL) => eligible(url) && (owns(url) || consented.allows(url));
  const withinGrants = (url: string | URL) => {
    try {
      return eligible(url) && consented.allows(url);
    } catch {
      return false;
    }
  };
  /** Whether a root (container or exact resource) contains `url`. */
  const contains = (root: string, url: string) => {
    if (root.endsWith("/")) return isWithin(url, root);
    const target = new URL(url);
    const entry = new URL(root);
    return target.origin === entry.origin && target.pathname === entry.pathname;
  };
  /** Validates a requested grant without network access; throws {@link ResourceGrantError}. */
  const grantRoot = (value: string): string => {
    let url: URL;
    try {
      if (typeof value !== "string") throw new TypeError("not a string");
      url = new URL(value);
    } catch {
      throw new ResourceGrantError("invalid-url");
    }
    // Only the canonical spelling is accepted: no normalization, credentials, query or fragment.
    if (
      url.href !== value ||
      /[?#\\]/.test(value) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname.includes("//") ||
      !eligible(url)
    )
      throw new ResourceGrantError("invalid-url");
    try {
      // Rejects encoded separators and dots, exactly as the credential boundary does.
      new CredentialBoundary([url], { allowInsecureHttp: insecure });
    } catch {
      throw new ResourceGrantError("invalid-url");
    }
    if (url.pathname === "/") throw new ResourceGrantError("origin-wide");
    if (
      owns(url) ||
      (value.endsWith("/") &&
        [...roots(), ...endpoints.keys()].some((root) => contains(value, root)))
    )
      throw new ResourceGrantError("own-storage");
    return value;
  };
  // Exchanges may use only origins already vouched for, including configured AS roots.
  const trustsOrigin = (url: string | URL) =>
    roots().some((root) => eligible(root) && new URL(root).origin === new URL(url).origin);
  const add = (boundary: CredentialBoundary, root: string) => {
    try {
      if (eligible(root)) boundary.add(root);
    } catch {
      // Invalid identity assertions never become credential destinations.
    }
  };
  const descriptionRoots = (storage: string, signal: AbortSignal) =>
    storageDescriptionRoots(storage, http, { allowInsecureLoopback: insecure, signal });
  const trustAuthorizationServer = ({
    authorizationServer,
    resource,
  }: {
    authorizationServer: URL;
    resource: URL;
  }) => allows(resource) && trustsOrigin(authorizationServer);
  const trustLws = async (
    { authorizationServer, realm, resource }: ChallengeBinding,
    signal: AbortSignal,
  ) => {
    signal.throwIfAborted();
    if (!trustAuthorizationServer({ authorizationServer, resource })) return false;
    if (
      (realm.href.endsWith("/") || realm.href === resource.href) &&
      allows(realm) &&
      isWithin(resource, realm)
    )
      return true;
    // A description can identify an audience only inside an existing grant; it cannot add roots.
    if (realm.origin !== resource.origin) return false;
    const descriptions = await descriptionRoots(realm.href, signal);
    signal.throwIfAborted();
    return descriptions.some(
      (root) => root.endsWith("/") && allows(root) && isWithin(resource, root),
    );
  };
  return {
    roots,
    /** Credential roots that are storages, without the configured server endpoints. */
    storages: () => roots().filter((root) => !endpoints.has(root)),
    allows,
    // No response-driven discovery, including ancestor HEADs or self-asserted pim:Storage types.
    isCandidate: (_url: string | URL) => false,
    trustAuthorizationServer,
    /**
     * A UMA authorization server for this resource: on the resource's own origin, or an
     * explicitly configured root's origin. Another learned storage's origin never qualifies.
     */
    trustUmaAuthorizationServer: (binding: { authorizationServer: URL; resource: URL }) =>
      trustAuthorizationServer(binding) &&
      (binding.authorizationServer.origin === binding.resource.origin ||
        fixed.entries.some(
          (root) => eligible(root) && new URL(root).origin === binding.authorizationServer.origin,
        )),
    trustLws,
    exchangeHttp: {
      ...http,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.method === "POST" && !trustsOrigin(request.url))
          throw new Error("Credential exchange endpoint is not trusted");
        return await http.fetch!(new Request(request, { redirect: "error" }));
      },
    } satisfies HttpOptions,
    learn: async (webId: string | undefined, signal: AbortSignal, lifetime = signal) => {
      if (!automaticRoots) return;
      if (webId === undefined) {
        clear();
        return;
      }
      if (learnedWebId === webId) return;
      const started = epoch;
      const { response, url } = await secureDocumentFetch(
        new URL(webId),
        "text/turtle",
        signal,
        http,
      );
      if (!response.ok) throw new Error("WebID storage discovery failed");
      const dataset = new Store(new Parser({ baseIRI: url.href }).parse(await response.text()));
      const agent = new TermWrapper(webId, dataset, DataFactory);
      const storages = SetFrom.subjectPredicate(
        agent,
        `${PIM}storage`,
        NamedNodeAs.string,
        NamedNodeFrom.string,
      );
      const next = new CredentialBoundary([], { allowInsecureHttp: insecure });
      for (const storage of storages) {
        add(next, storage);
        // Solid roots are containers. Non-container identifiers may be LWS/Solid descriptions.
        if (next.allows(storage) && !storage.endsWith("/")) {
          const candidates = new CredentialBoundary([], { allowInsecureHttp: insecure });
          for (const root of await descriptionRoots(storage, signal)) add(candidates, root);
          const identifier = new URL(storage);
          const sameOrigin = candidates.entries
            .filter((root) => root.endsWith("/") && new URL(root).origin === identifier.origin)
            .slice(0, MAX_DESCRIPTION_ROOTS);
          for (const root of sameOrigin) {
            // A description cannot grant an ancestor or sibling by itself. The same-origin
            // container must bind back to this LWS identifier, or identify itself as Solid
            // storage and either contain the identifier or name it as its storage description.
            const confirmation = await head(root, { http, signal });
            if (confirmation === undefined || !describes(confirmation, root)) continue;
            const links = parseLinks(confirmation.headers.get("link"), root);
            const only = (rel: string) => {
              const matching = links.filter((link) => link.rel === rel);
              return matching.length === 1 && matching[0]!.href === identifier.href;
            };
            if (
              only(LWS_STORAGE) ||
              (selfIdentifiedSolidRoot(root, confirmation) !== undefined &&
                (isWithin(identifier, root) || only(SOLID_STORAGE_DESCRIPTION)))
            )
              add(next, root);
          }
        }
      }
      const nextEndpoints = new Map<string, string>();
      const verified = [...next.entries];
      for (const root of verified)
        for (const path of storageEndpoints) {
          // Built on the storage's own origin; validation rejected "//", "@", "..", "?" and "#".
          const endpoint = new URL(path, root).href;
          // A verified storage or fixed root keeps its own identity and grant; it is never an alias.
          if (
            nextEndpoints.has(endpoint) ||
            verified.includes(endpoint) ||
            fixed.entries.includes(endpoint)
          )
            continue;
          add(next, endpoint);
          // Use the grant of the root (verified or fixed) that contains the endpoint, else the
          // first verified storage on its origin.
          const owner =
            [...verified, ...fixed.entries]
              .filter((storage) => storage.endsWith("/") && isWithin(new URL(endpoint), storage))
              .sort((a, b) => b.length - a.length)[0] ?? root;
          if (next.entries.includes(endpoint)) nextEndpoints.set(endpoint, owner);
        }
      signal.throwIfAborted();
      lifetime.throwIfAborted();
      if (started !== epoch) throw new Error("Credential boundary changed during discovery");
      learnedSignal?.removeEventListener("abort", clear);
      automatic = next;
      endpoints = nextEndpoints;
      learnedWebId = webId;
      learnedSignal = lifetime;
      lifetime.addEventListener("abort", clear, { once: true });
    },
    clear,
    /** Increments whenever learned roots and grants are cleared (logout, supersession). */
    generation: () => epoch,
    grantRoot,
    /**
     * Adds a consented grant after {@link grantRoot}'s checks pass again, unless the boundary was
     * cleared since `started` or the session generation's `lifetime` ended (which later ends
     * every grant). `protocol` names the issuer, its discovery documents and endpoints: a grant
     * may not contain them, nor any dot-prefixed path segment (CSS's `.oidc`, `.account`,
     * `.well-known`, at any depth) on the issuer's origin.
     * A grant already covered by an existing one returns that grant unchanged.
     */
    consent: (
      value: string,
      created: number,
      protocol: { issuer: string; endpoints: readonly string[] },
      started: number,
      lifetime: AbortSignal,
    ): ResourceGrant => {
      if (started !== epoch || lifetime.aborted) throw new ResourceGrantError("signed-out");
      const root = grantRoot(value);
      const url = new URL(root);
      if (
        [protocol.issuer, ...protocol.endpoints].some((endpoint) => contains(root, endpoint)) ||
        (url.origin === new URL(protocol.issuer).origin && url.pathname.includes("/."))
      )
        throw new ResourceGrantError("protocol-endpoint");
      const existing = grants.find(
        (grant) => grant.root === root || (grant.root.endsWith("/") && isWithin(root, grant.root)),
      );
      if (existing !== undefined) return existing;
      const grant = Object.freeze({ root, origin: url.origin, created });
      if (grantLifetime !== lifetime) {
        grantLifetime?.removeEventListener("abort", endGrants);
        grantLifetime = lifetime;
        lifetime.addEventListener("abort", endGrants, { once: true });
      }
      setGrants([...grants, grant]);
      return grant;
    },
    /** Removes the grant with exactly this root; true when one was removed. */
    revoke: (root: string) => {
      if (!grants.some((grant) => grant.root === root)) return false;
      setGrants(grants.filter((grant) => grant.root !== root));
      return true;
    },
    grants: () => grants,
    withinGrants,
    /** Whether a context key names a consented grant rather than a storage root. */
    consented: (key: string) => grants.some((grant) => grant.root === key),
    /** Observes grant changes for the life of this boundary. */
    onGrants: (listener: () => void) => {
      grantListeners.add(listener);
    },
    contextKey: async (request: Request) => {
      const url = new URL(request.url);
      url.hash = "";
      const best = [...roots(), ...consented.entries]
        .filter((r) =>
          r.endsWith("/")
            ? isWithin(url, r)
            : new URL(r).origin === url.origin && new URL(r).pathname === url.pathname,
        )
        .sort((a, b) => b.length - a.length)[0];
      // A storage endpoint uses its storage's grant rather than a separate authorization.
      return best === undefined ? url.href : (endpoints.get(best) ?? best);
    },
  };
}
