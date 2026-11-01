// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * DATA-CLASS → CONCRETE TARGET resolution — the compile step (design §2.3, resolution ladder).
 *
 * At GRANT time a data-class IRI is resolved to the concrete pod resources/containers that
 * hold data of that class, and the result is PINNED into the immutable grant (TOCTOU
 * mitigation, design §6.2). SAI registrations run first, followed by the ubiquitous rung — the
 * **Solid Type Index** (`solid:publicTypeIndex` / `solid:privateTypeIndex` →
 * `solid:TypeRegistration` `solid:forClass` → `solid:instance` / `solid:instanceContainer`).
 * SAI class matching lives in class-resolve-sai.ts; SHACL member sampling remains a follow-up.
 * The built-in pim:Storage class instead pins the WebID's advertised pim:storage containers.
 *
 * RDF is parsed with N3.js (the house rule — never regex over Turtle). The pure parse helpers
 * are unit-testable against fixtures; `resolveClassTargets` takes an injected fetch that
 * distinguishes public discovery from authenticated private-index reads.
 *
 * FAIL-CLOSED / defence-in-depth:
 *   - only `NamedNode`, http(s), same-*credential*-origin targets are kept (a type index that
 *     points at a foreign origin is dropped — a compromised index cannot pin an off-pod target;
 *     the SW gate would refuse the token there anyway, this removes it earlier);
 *   - `forClass` / `instance` / `instanceContainer` objects that are not usable IRIs are dropped;
 *   - a fetch that fails / is non-2xx is skipped (a private index a public read can't reach
 *     simply contributes nothing) — resolution degrades, never throws the whole grant.
 */

import { DataFactory, Parser, Store } from 'n3';
import { PIM_STORAGE_CLASS } from '../../shared/storage-class';
import type { PinnedTarget } from './class-grant';
import { safePathUrl } from './class-path';
import {
  type ClassResolution,
  memoiseResolveFetch,
  mergeClassTargets,
  resolveSaiTargets,
} from './class-resolve-sai';

const SOLID = 'http://www.w3.org/ns/solid/terms#';
const PUBLIC_TYPE_INDEX = `${SOLID}publicTypeIndex`;
const PRIVATE_TYPE_INDEX = `${SOLID}privateTypeIndex`;
const FOR_CLASS = `${SOLID}forClass`;
const INSTANCE = `${SOLID}instance`;
const INSTANCE_CONTAINER = `${SOLID}instanceContainer`;
const PIM_STORAGE = 'http://www.w3.org/ns/pim/space#storage';

/** Public documents must never carry credentials; `url` is the final post-redirect RDF base. */
export type ResolveFetch = (
  url: string,
  authenticated: boolean,
) => Promise<{ ok: boolean; text: string; url: string }>;

export interface ResolveOptions {
  /** The active session's WebID (the profile document to read the type-index refs from). */
  readonly webId: string;
  /** The injected fetch, with credential use explicit for each document. */
  readonly fetch: ResolveFetch;
  /** Origins permitted for private-index reads. Omit to discover public documents only. */
  readonly authenticatedOrigins?: ReadonlySet<string>;
  /**
   * The pod/credential origins a target is allowed to live on (defence in depth). When given,
   * a resolved target on any other origin is DROPPED. Omit to keep all http(s) targets.
   */
  readonly allowedOrigins?: ReadonlySet<string>;
}

function parse(baseUrl: string, turtle: string): Store {
  const parser = new Parser({ baseIRI: baseUrl.split('#')[0] });
  const store = new Store();
  store.addQuads(parser.parse(turtle));
  return store;
}

/** Normalise an IRI to its `origin + pathname`, keeping only http(s); else `null`. */
function normaliseTargetUrl(value: string): { url: string; origin: string } | null {
  const u = safePathUrl(value);
  if (!u) return null;
  return { url: `${u.origin}${u.pathname}`, origin: u.origin };
}

/**
 * The type-index document URLs advertised on the WebID subject (`solid:publicTypeIndex` +
 * `solid:privateTypeIndex`), NamedNode + http(s) only. Public refs take precedence when a
 * document is advertised both ways, so it is fetched once without credentials. PURE.
 * `profileUrl` supplies the final document base; `webId` remains the subject to match.
 */
export function parseTypeIndexRefs(
  webId: string,
  profileTurtle: string,
  profileUrl = webId,
): Array<{ url: string; authenticated: boolean }> {
  const store = parse(profileUrl, profileTurtle);
  const out: Array<{ url: string; authenticated: boolean }> = [];
  for (const pred of [PUBLIC_TYPE_INDEX, PRIVATE_TYPE_INDEX]) {
    for (const q of store.getQuads(
      DataFactory.namedNode(webId),
      DataFactory.namedNode(pred),
      null,
      null,
    )) {
      if (q.object.termType !== 'NamedNode') continue;
      const n = normaliseTargetUrl(q.object.value);
      if (n && !out.some((ref) => ref.url === q.object.value))
        out.push({ url: q.object.value, authenticated: pred === PRIVATE_TYPE_INDEX });
    }
  }
  return out;
}

/**
 * The pinned targets for `classIRI` declared in ONE type-index document. For every
 * `solid:TypeRegistration`-shaped subject with `solid:forClass classIRI`, collect its
 * `solid:instance` (kind `instance`) and `solid:instanceContainer` (kind `container`) objects,
 * NamedNode + http(s) only, normalised to `origin + pathname`, optionally confined to
 * `allowedOrigins`. PURE + deduped.
 */
export function parseTargetsForClass(
  typeIndexUrl: string,
  typeIndexTurtle: string,
  classIRI: string,
  allowedOrigins?: ReadonlySet<string>,
): PinnedTarget[] {
  const store = parse(typeIndexUrl, typeIndexTurtle);
  const seen = new Set<string>();
  const out: PinnedTarget[] = [];

  // Subjects registering this class (match on the NamedNode class object).
  const subjects = new Set<string>();
  for (const q of store.getQuads(
    null,
    DataFactory.namedNode(FOR_CLASS),
    DataFactory.namedNode(classIRI),
    null,
  )) {
    subjects.add(q.subject.value);
  }

  const collect = (pred: string, kind: PinnedTarget['kind']): void => {
    for (const subject of subjects) {
      for (const q of store.getQuads(
        DataFactory.namedNode(subject),
        DataFactory.namedNode(pred),
        null,
        null,
      )) {
        if (q.object.termType !== 'NamedNode') continue;
        const n = normaliseTargetUrl(q.object.value);
        if (n === null) continue;
        if (allowedOrigins && !allowedOrigins.has(n.origin)) continue;
        const dedupe = `${kind} ${n.url}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({ url: n.url, kind });
      }
    }
  };
  collect(INSTANCE, 'instance');
  collect(INSTANCE_CONTAINER, 'container');
  return out;
}

/** Storage roots must already be containers; never widen a resource by adding a slash. */
function parseStorageTargets(
  webId: string,
  profileTurtle: string,
  profileUrl: string,
  allowedOrigins?: ReadonlySet<string>,
): PinnedTarget[] {
  const store = parse(profileUrl, profileTurtle);
  const roots = new Set<string>();
  for (const q of store.getQuads(
    DataFactory.namedNode(webId),
    DataFactory.namedNode(PIM_STORAGE),
    null,
    null,
  )) {
    if (q.object.termType !== 'NamedNode') continue;
    const n = normaliseTargetUrl(q.object.value);
    if (n === null || !n.url.endsWith('/')) continue;
    if (allowedOrigins && !allowedOrigins.has(n.origin)) continue;
    roots.add(n.url);
  }
  return [...roots].map((url) => ({ url, kind: 'container' }));
}

/**
 * Resolve SAI first, then Type Index, sharing one public profile read and document cache.
 * Merge only rung-produced targets, preserving provenance and truncation internally.
 * pim:Storage skips SAI and resolves directly from the profile's storage roots.
 * An unregistered class resolves to nothing. Per-document fetch/parse failures are skipped.
 */
export async function resolveClassTargets(
  classIRI: string,
  opts: ResolveOptions,
): Promise<ClassResolution> {
  const fetch = memoiseResolveFetch(opts.fetch);
  const options = { ...opts, fetch };
  if (classIRI === PIM_STORAGE_CLASS)
    return mergeClassTargets(
      { targets: [], truncated: false },
      await resolveTypeIndexTargets(classIRI, options),
    );
  const profile = await fetch(opts.webId, false);
  const sai = await resolveSaiTargets(classIRI, options, profile);
  const indexed = await resolveTypeIndexTargets(classIRI, options);
  return mergeClassTargets(sai, indexed);
}

async function resolveTypeIndexTargets(
  classIRI: string,
  opts: ResolveOptions,
): Promise<PinnedTarget[]> {
  const profile = await safeFetch(opts.fetch, opts.webId, false);
  if (profile === null) return [];

  let refs: ReturnType<typeof parseTypeIndexRefs>;
  try {
    if (classIRI === PIM_STORAGE_CLASS)
      return parseStorageTargets(opts.webId, profile.text, profile.url, opts.allowedOrigins);
    refs = parseTypeIndexRefs(opts.webId, profile.text, profile.url);
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const out: PinnedTarget[] = [];
  for (const ref of refs) {
    // Public indexes may live beside the WebID or on any other http(s) host. Only
    // private-index egress is confined to authenticated origins; targets are filtered below.
    if (
      ref.authenticated &&
      (!opts.authenticatedOrigins || !isAllowedOrigin(ref.url, opts.authenticatedOrigins))
    )
      continue;
    const body = await safeFetch(opts.fetch, ref.url, ref.authenticated);
    if (body === null) continue;
    let targets: PinnedTarget[];
    try {
      targets = parseTargetsForClass(body.url, body.text, classIRI, opts.allowedOrigins);
    } catch {
      continue;
    }
    for (const t of targets) {
      const dedupe = `${t.kind} ${t.url}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push(t);
    }
  }
  return out;
}

/** Whether `url`'s origin is in `allowed` (fail-closed on an unparseable URL). */
function isAllowedOrigin(url: string, allowed: ReadonlySet<string>): boolean {
  try {
    return allowed.has(new URL(url).origin);
  } catch {
    return false;
  }
}

async function safeFetch(
  fetchFn: ResolveFetch,
  url: string,
  authenticated: boolean,
): Promise<{ text: string; url: string } | null> {
  try {
    const { ok, text, url: finalUrl } = await fetchFn(url, authenticated);
    return ok ? { text, url: finalUrl } : null;
  } catch {
    return null;
  }
}
