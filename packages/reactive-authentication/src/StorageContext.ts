import type { KeyValueStore } from "@key-value-kit/core";
import LinkHeader from "http-link-header";
import { Parser } from "n3";
import type { ContextKey } from "./ContextKey.js";
import type { ChallengeContext } from "./challenge.js";
import {
  LWS_STORAGE_DESCRIPTION_TYPE,
  LWS_STORAGE_REL,
  SOLID_STORAGE_DESCRIPTION_REL,
} from "./lws/constants.js";
import { type HttpOptions, secureFetch } from "./transport.js";
import { hasAmbiguousPath, isWithin, parseHttpUrl, withoutFragment } from "./url.js";
import { storagesFromDescription } from "./webId.js";

const RDF_TYPE = "type";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";

/**
 * The storage a resource belongs to, used to group caches (e.g. sessions) per storage.
 *
 * A verified context never authorizes sending credentials: that is the {@link CredentialBoundary}'s job.
 */
export interface StorageContext {
  /** Cache key: the storage root when verified, the exact resource URL otherwise. */
  readonly key: string;

  /** The URL prefix (container) every resource of the storage is under, when verified. */
  readonly root?: string;

  /** The storage identifier (LWS storage URI / Solid `pim:Storage`), when verified. */
  readonly storage?: string;

  readonly source: "lws" | "solid" | "exact";
}

export interface StorageContextOptions {
  readonly http?: HttpOptions;
  readonly signal?: AbortSignal;
}

/**
 * Resolves the storage of a resource from the Link headers of a response for exactly that resource.
 *
 * Supported discovery (no other relations are assumed interchangeable):
 * - LWS 1.0: `Link: <storage>; rel="https://www.w3.org/ns/lws#storage"`; the storage description
 *   (`application/lws+cid`) must have `id` equal to that URI, type `Storage`, and `StorageRoot` services.
 * - Solid Protocol 0.11: `Link: <description>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`;
 *   the Turtle description must type a `pim:Storage`.
 *
 * Evidence is only accepted when it is authoritative and mutually binding:
 * - the response is for the resource itself (not the end of a redirect) and Link `anchor`s, if any, name it;
 * - the description is on the resource's origin (no external description can speak for it);
 * - a candidate root is on the resource's origin and contains it at a path-segment boundary;
 * - the root itself confirms the binding with an unauthenticated, non-redirected `HEAD`: for LWS its Link
 *   names the same storage; for Solid it is typed `pim:Storage` and names the same description.
 *
 * A description claiming a broader root than its storage therefore fails the root's confirmation, and of
 * nested storages the most specific confirmed root wins. Anything else yields the conservative exact-URL
 * context. Servers that answer `HEAD` on a private root without these Link headers get exact-URL contexts.
 */
export async function resolveStorageContext(
  resource: string,
  response: Response | undefined,
  options: StorageContextOptions = {},
): Promise<StorageContext> {
  const target = withoutFragment(resource);
  const exact: StorageContext = { key: target, source: "exact" };
  if (response === undefined || !describes(response, target)) return exact;

  const links = parseLinks(response.headers.get("Link"), target);
  const lws = links.filter((l) => l.rel === LWS_STORAGE_REL);
  const solid = links.filter((l) => l.rel === SOLID_STORAGE_DESCRIPTION_REL);

  try {
    if (lws.length === 1) return (await lwsContext(target, lws[0]!.href, options)) ?? exact;
    if (solid.length === 1) return (await solidContext(target, solid[0]!.href, options)) ?? exact;
  } catch {
    // Unreachable, malformed or unconfirmed evidence: fall back.
  }
  return exact;
}

export interface StorageContextKeyOptions {
  readonly http?: HttpOptions;

  /**
   * Cache of verified resource→storage mappings (e.g. `createBrowserCaches(...).storageContext`, which
   * expires them after the metadata lifetime). Mappings are not revalidated before expiry; clear the store
   * when storages are known to have moved.
   */
  readonly mappings?: KeyValueStore<StorageContext>;

  /**
   * Without a challenge response (e.g. when restoring a session), send an unauthenticated `HEAD` to read
   * the resource's Link headers. @defaultValue true
   */
  readonly probe?: boolean;
}

/**
 * A {@link ContextKey} grouping requests by verified storage (see {@link resolveStorageContext}). Only
 * verified mappings are cached; failures never poison the cache.
 */
export function storageContextKey(options: StorageContextKeyOptions = {}): ContextKey {
  return async (request: Request, challenge?: ChallengeContext) => {
    const url = withoutFragment(request.url);
    const cached = await options.mappings?.getItem(url);
    if (cached !== null && cached !== undefined) return cached.key;

    const resolveOptions = {
      signal: request.signal,
      ...(options.http === undefined ? {} : { http: options.http }),
    };
    const response =
      challenge?.response ??
      (options.probe === false ? undefined : await head(url, resolveOptions));
    const resolved = await resolveStorageContext(url, response, resolveOptions);
    if (resolved.source !== "exact") await options.mappings?.setItem(url, resolved);
    return resolved.key;
  };
}

/**
 * Whether a resource is inside an LWS realm: by path, or under a StorageRoot of the realm's description
 * that confirms the binding (see {@link resolveStorageContext}). Callers must already trust the realm.
 */
export async function isInRealm(
  resource: string,
  realm: URL,
  options: StorageContextOptions = {},
): Promise<boolean> {
  if (isWithin(resource, realm)) return true;
  return (
    (await lwsContext(withoutFragment(resource), realm.href, options, true).catch(
      () => undefined,
    )) !== undefined
  );
}

/**
 * LWS context. `crossOrigin` permits a description on another origin; only used by {@link isInRealm},
 * after the caller's trust policy accepted that realm.
 */
async function lwsContext(
  resource: string,
  storage: string,
  options: StorageContextOptions,
  crossOrigin = false,
): Promise<StorageContext | undefined> {
  const storageUrl = new URL(storage);
  if (!crossOrigin && storageUrl.origin !== new URL(resource).origin) return undefined;

  const response = await get(
    storageUrl,
    `${LWS_STORAGE_DESCRIPTION_TYPE}, application/ld+json;q=0.9, application/json;q=0.8`,
    options,
  );
  if (response === undefined) return undefined;
  const description = (await response.json()) as {
    id?: unknown;
    type?: unknown;
    service?: unknown;
  };
  if (description.id !== storage || !includes(description.type, "Storage")) return undefined;

  const services = Array.isArray(description.service) ? description.service : [];
  const roots = services
    .filter((s: { type?: unknown }) => includes(s?.type, "StorageRoot"))
    .map((s: { serviceEndpoint?: unknown }) => s.serviceEndpoint)
    .filter((e): e is string => typeof e === "string");

  for (const root of containingRoots(resource, roots)) {
    const confirmation = await head(root, options);
    if (confirmation === undefined || !describes(confirmation, root)) continue;
    const named = parseLinks(confirmation.headers.get("Link"), root).filter(
      (l) => l.rel === LWS_STORAGE_REL,
    );
    if (named.length === 1 && named[0]!.href === storage)
      return { key: root, root, storage, source: "lws" };
  }
  return undefined;
}

async function solidContext(
  resource: string,
  descriptionUrl: string,
  options: StorageContextOptions,
): Promise<StorageContext | undefined> {
  const url = new URL(descriptionUrl);
  if (url.origin !== new URL(resource).origin) return undefined;

  const response = await get(url, "text/turtle", options);
  if (response === undefined) return undefined;
  const quads = new Parser({ baseIRI: descriptionUrl }).parse(await response.text());

  for (const root of containingRoots(resource, storagesFromDescription(quads))) {
    const confirmation = await head(root, options);
    if (confirmation === undefined || !describes(confirmation, root)) continue;
    const links = parseLinks(confirmation.headers.get("Link"), root);
    const typed = links.some((l) => l.rel === RDF_TYPE && l.href === PIM_STORAGE);
    const sameDescription = links.some(
      (l) => l.rel === SOLID_STORAGE_DESCRIPTION_REL && l.href === descriptionUrl,
    );
    if (typed && sameDescription) return { key: root, root, storage: root, source: "solid" };
  }
  return undefined;
}

/**
 * The storage root when the response for the requested `url` advertises `Link: <pim:Storage>; rel="type"`
 * (Solid Protocol §4.1: storages identify themselves). Only containers (path ending in `/`) qualify; the
 * response must be for `url` itself (query included), and the root is returned canonically, without query
 * or fragment.
 */
export function selfIdentifiedSolidRoot(url: string, response: Response): string | undefined {
  const requested = parseHttpUrl(url);
  if (requested === undefined || !requested.pathname.endsWith("/") || hasAmbiguousPath(requested))
    return undefined;
  const target = withoutFragment(requested);
  if (!describes(response, target)) return undefined;
  const typed = parseLinks(response.headers.get("Link"), target).some(
    (l) => l.rel === RDF_TYPE && l.href === PIM_STORAGE,
  );
  return typed ? `${requested.origin}${requested.pathname}` : undefined;
}

/** A clean container URL (no query, fragment, credentials or ambiguous path, path ending in `/`), or `undefined`. */
function containerUrl(candidate: string): string | undefined {
  const url = parseHttpUrl(candidate);
  if (
    url === undefined ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.endsWith("/") ||
    hasAmbiguousPath(url)
  )
    return undefined;
  return url.href;
}

/** Candidate roots on the resource's origin that contain it, most specific first. */
function containingRoots(resource: string, candidates: string[]): string[] {
  return candidates
    .map(containerUrl)
    .filter((c): c is string => c !== undefined && isWithin(resource, c))
    .sort((a, b) => b.length - a.length);
}

/** Whether a response describes `url` itself: not redirected, not an opaque or redirect response. */
export function describes(response: Response, url: string): boolean {
  if (
    response.redirected ||
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400)
  )
    return false;
  return response.url === "" || withoutFragment(response.url) === url;
}

/**
 * An unauthenticated discovery `HEAD`: no cookies or caller headers (`credentials: "omit"`), redirects not
 * followed, HTTPS unless insecure requests are allowed, non-reactive transport. `undefined` on network failure.
 */
export async function head(
  url: string,
  options: StorageContextOptions,
): Promise<Response | undefined> {
  const init: RequestInit = { method: "HEAD", redirect: "manual", credentials: "omit" };
  if (options.signal !== undefined) init.signal = options.signal;
  return await secureFetch(new URL(url), init, options.http).catch(() => undefined);
}

async function get(
  url: URL,
  accept: string,
  options: StorageContextOptions,
): Promise<Response | undefined> {
  const init: RequestInit = { headers: { accept }, redirect: "manual", credentials: "omit" };
  if (options.signal !== undefined) init.signal = options.signal;
  const response = await secureFetch(url, init, options.http);
  return response.ok && describes(response, url.href) ? response : undefined;
}

function includes(value: unknown, item: string): boolean {
  return value === item || (Array.isArray(value) && value.includes(item));
}

/**
 * Parses Link headers (RFC 8288) about `context`: targets are resolved against it, and links whose `anchor`
 * names a different resource are dropped. Unparseable headers yield no links.
 */
export function parseLinks(
  header: string | null,
  context: string,
): { href: string; rel: string }[] {
  if (header === null) return [];
  try {
    return LinkHeader.parse(header)
      .refs.filter(
        (ref) =>
          ref.anchor === undefined ||
          withoutFragment(new URL(ref.anchor, context)) === withoutFragment(context),
      )
      .flatMap((ref) =>
        ref.rel
          .split(/\s+/)
          .filter((r) => r !== "")
          .map((rel) => ({ href: new URL(ref.uri, context).href, rel })),
      );
  } catch {
    return [];
  }
}
