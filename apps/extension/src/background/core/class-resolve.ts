// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * DATA-CLASS → CONCRETE TARGET resolution — the compile step (design §2.3, resolution ladder).
 *
 * At GRANT time a data-class IRI is resolved to the concrete pod resources/containers that
 * hold data of that class, and the result is PINNED into the immutable grant (TOCTOU
 * mitigation, design §6.2). SAI registrations run first, followed by the ubiquitous rung — the
 * **Solid Type Index** (`solid:publicTypeIndex` / `solid:privateTypeIndex` →
 * `solid:TypeRegistration` `solid:forClass` → `solid:instance` / `solid:instanceContainer`).
 * SAI class matching lives in class-resolve-sai.ts; C4 sampling follows discovery.
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
import { safePathUrl, safeTargetUrl } from './class-path';
import { ResolutionBudget } from './class-resolution-budget';
import { checkClassCandidates } from './class-resolve-check';
import type { InternalRead } from './class-resolve-read';
import {
  type ClassResolution,
  ClassTargetCollector,
  memoiseResolveFetch,
  resolveSaiTargets,
} from './class-resolve-sai';

const SOLID = 'http://www.w3.org/ns/solid/terms#';
const PUBLIC_TYPE_INDEX = `${SOLID}publicTypeIndex`;
const PRIVATE_TYPE_INDEX = `${SOLID}privateTypeIndex`;
const FOR_CLASS = `${SOLID}forClass`;
const INSTANCE = `${SOLID}instance`;
const INSTANCE_CONTAINER = `${SOLID}instanceContainer`;
const PREFERENCES_FILE = 'http://www.w3.org/ns/pim/space#preferencesFile';
const PIM_STORAGE = 'http://www.w3.org/ns/pim/space#storage';

/** Public documents must never carry credentials; `url` is the final post-redirect RDF base. */
export type ResolveFetch = (
  url: string,
  authenticated: boolean,
  method?: 'GET' | 'HEAD',
) => Promise<{ ok: boolean; text: string; url: string; contentType?: string }>;

export interface ResolveOptions {
  /** The active session's WebID (the profile document to read the type-index refs from). */
  readonly webId: string;
  /** The injected fetch, with credential use explicit for each document. */
  readonly fetch: ResolveFetch;
  /** Worker-owned confinement; required for sampling. Fetch-only fixtures discover unchecked targets. */
  readonly read?: InternalRead;
  readonly budget?: ResolutionBudget;
  readonly signal?: AbortSignal;
  /** Origins permitted for private-index reads. Omit to discover public documents only. */
  readonly authenticatedOrigins?: ReadonlySet<string>;
  /**
   * The pod/credential origins a target is allowed to live on (defence in depth). When given,
   * a resolved target on any other origin is DROPPED. Omit to keep all http(s) targets.
   */
  readonly allowedOrigins?: ReadonlySet<string>;
}

function parse(baseUrl: string, turtle: string, budget?: ResolutionBudget): Store {
  if (budget) return budget.parse(baseUrl, turtle);
  const parser = new Parser({ baseIRI: baseUrl.split('#')[0] });
  const store = new Store();
  store.addQuads(parser.parse(turtle));
  return store;
}

/** Pin only path-safe resources without query/fragment delimiters or credentials. */
function normaliseTargetUrl(value: string): { url: string; origin: string } | null {
  const u = safeTargetUrl(value);
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
  budget?: ResolutionBudget,
): Array<{ url: string; authenticated: boolean }> {
  const store = parse(profileUrl, profileTurtle, budget);
  const out: Array<{ url: string; authenticated: boolean }> = [];
  const seen = new Set<string>();
  for (const pred of [PUBLIC_TYPE_INDEX, PRIVATE_TYPE_INDEX]) {
    for (const q of store.readQuads(
      DataFactory.namedNode(webId),
      DataFactory.namedNode(pred),
      null,
      null,
    )) {
      if (budget && !budget.active()) return out;
      if (q.object.termType !== 'NamedNode') continue;
      if (!seen.has(q.object.value) && safePathUrl(q.object.value)) {
        seen.add(q.object.value);
        out.push({ url: q.object.value, authenticated: pred === PRIVATE_TYPE_INDEX });
      }
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
  budget?: ResolutionBudget,
  onTarget?: (target: PinnedTarget) => void,
): PinnedTarget[] {
  const store = parse(typeIndexUrl, typeIndexTurtle, budget);
  const seen = new Set<string>();
  const out: PinnedTarget[] = [];

  // Subjects registering this class (match on the NamedNode class object).
  const subjects = new Set<string>();
  for (const q of store.readQuads(
    null,
    DataFactory.namedNode(FOR_CLASS),
    DataFactory.namedNode(classIRI),
    null,
  )) {
    if (budget && !budget.active()) return out;
    if (q.subject.termType === 'NamedNode') subjects.add(q.subject.value);
  }

  const collect = (pred: string, kind: PinnedTarget['kind']): void => {
    for (const subject of subjects) {
      if (budget && !budget.active()) return;
      for (const q of store.readQuads(
        DataFactory.namedNode(subject),
        DataFactory.namedNode(pred),
        null,
        null,
      )) {
        if (budget && !budget.active()) return;
        if (q.object.termType !== 'NamedNode') continue;
        const n = normaliseTargetUrl(q.object.value);
        if (n === null) continue;
        if (allowedOrigins && !allowedOrigins.has(n.origin)) continue;
        const dedupe = `${kind} ${n.url}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        if (budget && !budget.active()) return;
        const target = { url: n.url, kind };
        out.push(target);
        onTarget?.(target);
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
  budget?: ResolutionBudget,
  onTarget?: (target: PinnedTarget) => void,
): PinnedTarget[] {
  const store = parse(profileUrl, profileTurtle, budget);
  const roots = new Set<string>();
  const out: PinnedTarget[] = [];
  for (const q of store.readQuads(
    DataFactory.namedNode(webId),
    DataFactory.namedNode(PIM_STORAGE),
    null,
    null,
  )) {
    if (budget && !budget.active()) break;
    if (q.object.termType !== 'NamedNode') continue;
    const n = normaliseTargetUrl(q.object.value);
    if (n === null || !n.url.endsWith('/')) continue;
    if (allowedOrigins && !allowedOrigins.has(n.origin)) continue;
    if (roots.has(n.url)) continue;
    roots.add(n.url);
    const target = { url: n.url, kind: 'container' as const };
    out.push(target);
    onTarget?.(target);
  }
  return out;
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
  const budget = opts.budget ?? opts.read?.budget ?? new ResolutionBudget(opts.signal);
  const ownsBudget = !opts.budget && !opts.read;
  const fetch = memoiseResolveFetch(async (url, authenticated) => {
    if (opts.signal?.aborted || !budget.active() || (!opts.read && !budget.document()))
      return { ok: false, text: '', url };
    const body = await budget.run(
      () => (opts.read?.fetch ?? opts.fetch)(url, authenticated),
      opts.signal,
    );
    budget.checkText(body.text);
    return body;
  });
  const options = { ...opts, fetch, budget };
  // Annotate and deduplicate at discovery time. No potentially huge merge/copy may run
  // after the deadline: the same array of already discovered targets survives truncation.
  const found = new ClassTargetCollector();
  try {
    let truncated = false;
    if (classIRI !== PIM_STORAGE_CLASS) {
      const profile = await fetch(opts.webId, false);
      ({ truncated } = await resolveSaiTargets(classIRI, options, profile, found));
    }
    await resolveTypeIndexTargets(classIRI, options, (target) => found.add(target, 'type-index'));
    // The worker supplies this capability. Legacy discovery-only callers cannot perform
    // pre-consent member reads through an unconstrained transport.
    const checked =
      opts.read && classIRI !== PIM_STORAGE_CLASS
        ? await checkClassCandidates(
            classIRI,
            found.targets,
            found.shapes,
            opts.read,
            budget,
            opts.signal,
          )
        : { targets: found.targets, shape: null };
    return {
      targets: checked.targets,
      ...(checked.shape ? { shape: checked.shape } : {}),
      truncated: truncated || budget.truncated,
    };
  } finally {
    if (ownsBudget) budget.dispose();
  }
}

async function resolveTypeIndexTargets(
  classIRI: string,
  opts: ResolveOptions,
  onTarget: (target: PinnedTarget) => void,
): Promise<void> {
  const profile = await safeFetch(opts.fetch, opts.webId, false);
  if (profile === null || opts.signal?.aborted) return;
  const accept = (target: PinnedTarget) => {
    opts.read?.allowTarget(target);
    onTarget(target);
  };
  const documents = new Map<string, { url: string; authenticated: boolean }>();
  const discover = (refs: ReturnType<typeof parseTypeIndexRefs>) => {
    // Public declarations take precedence across profile + preferences, including fragments.
    for (const ref of refs) {
      if (opts.signal?.aborted || (opts.budget && !opts.budget.active())) break;
      const key = new URL(ref.url).href.split('#')[0];
      if (!documents.has(key) || !ref.authenticated) documents.set(key, ref);
    }
  };
  try {
    if (classIRI === PIM_STORAGE_CLASS) {
      parseStorageTargets(
        opts.webId,
        profile.text,
        profile.url,
        opts.allowedOrigins,
        opts.budget,
        accept,
      );
      return;
    }
    discover(parseTypeIndexRefs(opts.webId, profile.text, profile.url, opts.budget));
    const store = parse(profile.url, profile.text, opts.budget);
    // C1: malformed statements are not private-index pointers. Public precedence in
    // the deduplicated refs must not hide a usable private declaration on the WebID.
    let hasPrivateIndex = false;
    for (const q of store.readQuads(
      DataFactory.namedNode(opts.webId),
      DataFactory.namedNode(PRIVATE_TYPE_INDEX),
      null,
      null,
    )) {
      if (opts.signal?.aborted || (opts.budget && !opts.budget.active())) break;
      if (q.object.termType === 'NamedNode' && safePathUrl(q.object.value)) {
        hasPrivateIndex = true;
        break;
      }
    }
    if (!hasPrivateIndex) {
      for (const q of store.readQuads(
        DataFactory.namedNode(opts.webId),
        DataFactory.namedNode(PREFERENCES_FILE),
        null,
        null,
      )) {
        if (opts.signal?.aborted || (opts.budget && !opts.budget.active())) break;
        if (q.object.termType !== 'NamedNode' || !safePathUrl(q.object.value)) continue;
        const url = q.object.value;
        if (!opts.authenticatedOrigins || !isAllowedOrigin(url, opts.authenticatedOrigins))
          continue;
        opts.read?.allowDocument(url, true);
        const preferences = await safeFetch(opts.fetch, url, true);
        if (!preferences || opts.signal?.aborted) continue;
        try {
          discover(parseTypeIndexRefs(opts.webId, preferences.text, preferences.url, opts.budget));
        } catch {
          /* An unreadable/malformed preferences document contributes nothing. */
        }
      }
    }
  } catch {
    return;
  }

  // Allow all separately discovered redirect destinations before reading the first index.
  for (const ref of documents.values()) {
    if (opts.signal?.aborted || (opts.budget && !opts.budget.active())) break;
    opts.read?.allowDocument(ref.url, ref.authenticated);
  }
  for (const ref of documents.values()) {
    if (opts.signal?.aborted || (opts.budget && !opts.budget.active())) break;
    // Foreign public indexes stay anonymous; only private reads need credential origins.
    if (
      ref.authenticated &&
      (!opts.authenticatedOrigins || !isAllowedOrigin(ref.url, opts.authenticatedOrigins))
    )
      continue;
    const body = await safeFetch(opts.fetch, ref.url, ref.authenticated);
    if (!body || opts.signal?.aborted) continue;
    try {
      parseTargetsForClass(body.url, body.text, classIRI, opts.allowedOrigins, opts.budget, accept);
    } catch {
      /* A failed document contributes nothing; earlier targets remain available. */
    }
  }
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
