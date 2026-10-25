import type { ContextKey } from "./ContextKey.js";
import type { Boundary } from "./CredentialBoundary.js";
import type { ChallengeContext } from "./challenge.js";
import { head, resolveStorageContext, selfIdentifiedSolidRoot } from "./StorageContext.js";
import type { HttpOptions } from "./transport.js";
import { hasAmbiguousPath, isWithin, parseHttpUrl, withoutFragment } from "./url.js";

/** What a traversal decision can look at. */
export interface TraversalContext {
  /** The URL that was challenged (no verified root was advertised for it). */
  readonly url: URL;
  /** The unauthenticated 401 response. */
  readonly response: Response;
  /** The request method (writes answered with 401 may lack GET/HEAD-only Link headers). */
  readonly method: string;
}

/** A storage root found for a URL, before it is added to the boundary. */
export interface DiscoveredRoot {
  /** Container URL (ends with `/`) that now bounds credential disclosure. */
  readonly root: string;
  /** How it was established. */
  readonly source: "lws" | "solid" | "solid-type" | "solid-ancestor";
}

export interface AutomaticCredentialBoundaryOptions {
  /** Transport and the insecure-HTTP opt-in for discovery requests. */
  readonly http?: HttpOptions;

  /**
   * Allow `http:` URLs and roots. Local development only. @defaultValue false
   */
  readonly allowInsecureHttp?: boolean;

  /**
   * Which URLs are eligible for discovery at all (e.g. an origin allow-list). URLs rejected here are
   * never upgraded, exactly as outside a static boundary. @defaultValue every HTTPS URL
   */
  readonly eligible?: (url: URL) => boolean;

  /**
   * Final approval of a discovered root before it is added (e.g. ask the user, or check an allow-list).
   * @defaultValue approve
   */
  readonly approve?: (root: DiscoveredRoot, url: URL) => boolean | Promise<boolean>;

  /**
   * Solid ancestor traversal when the 401 advertised no usable root: `"ancestors"` (default) walks up the
   * path with unauthenticated `HEAD`s looking for `Link: <pim:Storage>; rel="type"`; `"headers-only"` disables
   * the fallback target probe and traversal, but still fetches an advertised description and confirms its root.
   */
  readonly traversal?: "ancestors" | "headers-only";

  /** Decides per challenge whether to traverse (only consulted in `"ancestors"` mode). */
  readonly shouldTraverse?: (context: TraversalContext) => boolean | Promise<boolean>;

  /** Maximum ancestor `HEAD`s per discovery (the target `HEAD` for writes is counted too). @defaultValue 8 */
  readonly maxProbes?: number;

  /** How long a discovered root stays in the boundary. @defaultValue 1 hour */
  readonly lifetimeMs?: number;

  /** Maximum remembered roots; the oldest are dropped first. @defaultValue 256 */
  readonly maxRoots?: number;
}

type Entry = { root: string; source: DiscoveredRoot["source"]; expires: number };

const PIM_STORAGE_TRAVERSAL = "solid-ancestor";

/**
 * A credential boundary that learns storage roots from 401 responses instead of a pre-configured list
 * (opt-in: select it explicitly). A root, once verified, bounds disclosure exactly like a static entry.
 *
 * Discovery runs only when an eligible URL answers 401, before any provider logs in or attaches credentials:
 * 1. **Advertised evidence** in that response's Link headers, validated as in {@link resolveStorageContext}
 *    — LWS `lws#storage` → description (`id`, type `Storage`) → `StorageRoot` endpoint confirmed by the root;
 *    Solid `storageDescription` → `pim:Storage` root confirmed by the root; or the URL itself typed
 *    `pim:Storage`. The target is not re-requested when its response already carries this evidence.
 * 2. In `"ancestors"` mode (and when `shouldTraverse` agrees), for writes whose 401 carries no Link headers,
 *    one unauthenticated `HEAD` of the target.
 * 3. **Solid ancestor traversal** (Solid Protocol §4.1): nearest parent first, one container at a time up to
 *    the origin root, within `maxProbes`, stopping at the first container that identifies itself as a
 *    storage. Every ancestor is checked — only the root carries the type, so no level can be skipped.
 *
 * Discovery requests omit credentials and caller headers, never follow redirects, and use the non-reactive
 * transport. No evidence means no root: the 401 is returned and nothing is disclosed. Public (non-401)
 * responses pass through without discovery. A discovered root describes the disclosure scope; it is not
 * consent to use a particular identity provider — combine with `eligible`/`approve` for that. `eligible`
 * is enforced on every check, so a discovered root never authorizes URLs the predicate excludes.
 *
 * Limitations: storage descriptions must be on the resource's origin (separately hosted LWS storage
 * descriptions are not accepted automatically; use a static boundary for them). A remembered root covers all
 * its descendants until it expires or is removed with `delete`/`clear`; a more specific storage advertised
 * under it is not re-discovered meanwhile.
 */
export class AutomaticCredentialBoundary implements Boundary {
  readonly #options: AutomaticCredentialBoundaryOptions;
  readonly #roots = new Map<string, Entry>();
  #epoch = 0;

  constructor(options: AutomaticCredentialBoundaryOptions = {}) {
    const {
      maxProbes = 8,
      maxRoots = 256,
      lifetimeMs = 60 * 60 * 1000,
      traversal = "ancestors",
    } = options;
    if (!Number.isSafeInteger(maxProbes) || maxProbes < 0)
      throw new RangeError("maxProbes must be a non-negative integer");
    if (!Number.isSafeInteger(maxRoots) || maxRoots < 1)
      throw new RangeError("maxRoots must be a positive integer");
    if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0)
      throw new RangeError("lifetimeMs must be a positive finite number");
    if (traversal !== "ancestors" && traversal !== "headers-only")
      throw new RangeError(`Unknown traversal mode ${String(traversal)}`);
    this.#options = options;
  }

  /** Whether `url` is eligible and under a discovered, unexpired root. */
  allows(url: string | URL): boolean {
    const target = this.#eligible(url);
    if (target === undefined) return false;
    const now = Date.now();
    for (const [key, entry] of this.#roots) {
      if (entry.expires <= now) {
        this.#roots.delete(key);
      } else if (isWithin(target, entry.root)) {
        return true;
      }
    }
    return false;
  }

  isCandidate(url: string | URL): boolean {
    return this.#eligible(url) !== undefined;
  }

  async discover(
    url: string,
    response: Response,
    { method, signal }: { method: string; signal: AbortSignal },
  ): Promise<boolean> {
    if (this.allows(url)) return true;
    const target = this.#eligible(url);
    if (target === undefined) return false;

    const epoch = this.#epoch;
    const found = await this.#find(withoutFragment(target), response, method, signal);
    if (found === undefined || !isWithin(target, found.root)) return false;
    if (!(await (this.#options.approve?.(found, target) ?? true))) return false;

    // Nothing is added after cancellation, logout or a concurrent clear().
    if (signal.aborted || epoch !== this.#epoch) return false;
    this.#add(found);
    return this.allows(target);
  }

  /** The verified roots currently in the boundary. */
  get roots(): readonly string[] {
    const now = Date.now();
    return [...this.#roots.values()].filter((e) => e.expires > now).map((e) => e.root);
  }

  /** Forgets one root (e.g. after the application learns the storage moved). */
  delete(root: string): boolean {
    this.#epoch++;
    return this.#roots.delete(root);
  }

  /** Forgets every discovered root; discoveries still in flight are discarded. */
  clear(): void {
    this.#epoch++;
    this.#roots.clear();
  }

  /**
   * A {@link ContextKey} for providers (e.g. `DPoPTokenProvider`'s `context` option) using the same roots:
   * eligible requests under a discovered root share it; anything else is keyed by its exact URL.
   */
  readonly contextKey: ContextKey = async (request: Request, _?: ChallengeContext) => {
    const url = withoutFragment(request.url);
    if (this.#eligible(url) === undefined) return url;
    const root = this.roots.filter((r) => isWithin(url, r)).sort((a, b) => b.length - a.length)[0];
    return root ?? url;
  };

  async #find(
    url: string,
    response: Response,
    method: string,
    signal: AbortSignal,
  ): Promise<DiscoveredRoot | undefined> {
    const options = {
      signal,
      ...(this.#options.http === undefined ? {} : { http: this.#options.http }),
    };

    const advertised = await this.#fromResponse(url, response, options);
    if (advertised !== undefined) return advertised;

    // Beyond validating advertised evidence, probes are opt-in: "headers-only" sends no fallback target HEAD or traversal.
    if ((this.#options.traversal ?? "ancestors") !== "ancestors") return undefined;
    const context: TraversalContext = { url: new URL(url), response, method };
    if (!(await (this.#options.shouldTraverse?.(context) ?? true))) return undefined;

    let probes = this.#options.maxProbes ?? 8;
    // A write's 401 may omit Link headers that servers only send for GET/HEAD: ask once.
    if (!response.headers.has("Link") && method !== "GET" && method !== "HEAD" && probes > 0) {
      probes--;
      const probe = await head(url, options);
      const fromProbe =
        probe === undefined ? undefined : await this.#fromResponse(url, probe, options);
      if (fromProbe !== undefined) return fromProbe;
    }

    for (const ancestor of ancestors(url)) {
      if (probes-- <= 0 || signal.aborted) return undefined;
      const probe = await head(ancestor, options);
      if (probe !== undefined && selfIdentifiedSolidRoot(ancestor, probe) !== undefined) {
        return { root: ancestor, source: PIM_STORAGE_TRAVERSAL };
      }
    }
    return undefined;
  }

  async #fromResponse(
    url: string,
    response: Response,
    options: { signal: AbortSignal; http?: HttpOptions },
  ): Promise<DiscoveredRoot | undefined> {
    const self = selfIdentifiedSolidRoot(url, response);
    if (self !== undefined) return { root: self, source: "solid-type" };
    const context = await resolveStorageContext(url, response, options);
    if (context.source === "exact" || context.root === undefined) return undefined;
    return { root: context.root, source: context.source };
  }

  #add(found: DiscoveredRoot) {
    this.#roots.delete(found.root);
    this.#roots.set(found.root, {
      root: found.root,
      source: found.source,
      expires: Date.now() + (this.#options.lifetimeMs ?? 60 * 60 * 1000),
    });
    const max = this.#options.maxRoots ?? 256;
    while (this.#roots.size > max) this.#roots.delete(this.#roots.keys().next().value!);
  }

  /** The parsed URL if it may take part at all: HTTP(S), unambiguous, and accepted by `eligible`. */
  #eligible(url: string | URL): URL | undefined {
    const parsed = parseHttpUrl(url);
    if (parsed === undefined || hasAmbiguousPath(parsed)) return undefined;
    if (parsed.protocol === "http:" && this.#options.allowInsecureHttp !== true) return undefined;
    return (this.#options.eligible?.(parsed) ?? true) ? parsed : undefined;
  }
}

/** Strict ancestor containers of `url`, nearest first, ending with the origin root. */
function ancestors(url: string): string[] {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").slice(1, -1); // containers above the last segment
  const result: string[] = [];
  const selfIsContainer = parsed.pathname.endsWith("/");
  for (let i = segments.length - (selfIsContainer ? 1 : 0); i >= 0; i--) {
    result.push(
      new URL(`/${segments.slice(0, i).join("/")}${i > 0 ? "/" : ""}`, parsed.origin).href,
    );
  }
  return result;
}
