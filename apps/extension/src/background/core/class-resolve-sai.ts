// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Bounded SAI discovery and class matching; exact shapes stay private to the check. */
import { DataFactory, Parser, Store } from 'n3';
import type { PinnedTarget } from './class-grant';
import { safePathUrl } from './class-path';
import type { ResolutionBudget } from './class-resolution-budget';
import type { ResolveFetch, ResolveOptions } from './class-resolve';
import { CLASS_SHAPE_TREES } from './class-shape-trees';
import type { ClassShape } from './shacl-lite';

const INTEROP = 'http://www.w3.org/ns/solid/interop#';
const ST = 'http://www.w3.org/ns/shapetrees#';
const SH = 'http://www.w3.org/ns/shacl#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const MAX_REGISTRIES = 4;
const MAX_REGISTRATIONS = 64;
const MAX_SHAPE_DOCUMENTS = 16;

export type TargetSource = 'sai' | 'type-index';

/** Discovery annotations belong to the resolver, never to persisted PinnedTarget. */
export interface ResolvedTarget extends PinnedTarget {
  readonly source: TargetSource;
  /** All rungs that independently produced this kind + URL, in discovery order. */
  readonly sources: readonly TargetSource[];
  readonly check: 'conforms' | 'mixed' | 'unchecked';
}

export interface ClassResolution {
  readonly targets: readonly ResolvedTarget[];
  readonly truncated: boolean;
  readonly shape?: string;
}

type Document = Awaited<ReturnType<ResolveFetch>>;
type ParsedDocument = { readonly url: string; readonly store: Store };

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function documentUrl(value: string): string {
  return value.split('#')[0];
}

/** Cache successes/failures and fragment/redirect aliases once per (document, credential mode). */
export function memoiseResolveFetch(fetch: ResolveFetch): ResolveFetch {
  const publicDocuments = new Map<string, Promise<Document>>();
  const authenticatedDocuments = new Map<string, Promise<Document>>();
  return (url, authenticated) => {
    // Neither anonymous failures nor authenticated bytes can satisfy the other mode.
    const documents = authenticated ? authenticatedDocuments : publicDocuments;
    const key = documentUrl(httpUrl(url)?.href ?? url);
    const cached = documents.get(key);
    if (cached) return cached;
    const read = (async () => {
      try {
        if (!httpUrl(url)) return { ok: false, text: '', url };
        const body = await fetch(url, authenticated);
        const final = httpUrl(body.url);
        return final ? body : { ok: false, text: '', url };
      } catch {
        return { ok: false, text: '', url };
      }
    })();
    documents.set(key, read);
    void read.then((body) => {
      const finalKey = documentUrl(httpUrl(body.url)?.href ?? body.url);
      if (!documents.has(finalKey)) documents.set(finalKey, read);
    });
    return read;
  };
}

function parse(body: Document, budget?: ResolutionBudget): ParsedDocument | null {
  if (!body.ok) return null;
  try {
    return {
      url: body.url,
      store: budget
        ? budget.parse(body.url, body.text)
        : new Store(new Parser({ baseIRI: documentUrl(body.url) }).parse(body.text)),
    };
  } catch {
    return null;
  }
}

/** Subject-specific, NamedNode-only HTTP(S) links; unrelated triples confer no discovery. */
function* refs(
  doc: ParsedDocument,
  subject: string,
  predicate: string,
  budget?: ResolutionBudget,
): Generator<string> {
  const seen = new Set<string>();
  for (const { object } of doc.store.readQuads(
    DataFactory.namedNode(subject),
    DataFactory.namedNode(predicate),
    null,
    null,
  )) {
    if (budget && !budget.active()) return;
    if (object.termType !== 'NamedNode' || seen.has(object.value) || !httpUrl(object.value))
      continue;
    seen.add(object.value);
    yield object.value;
  }
}

function isAuthenticated(url: string, opts: ResolveOptions): boolean {
  const parsed = safePathUrl(url);
  return parsed !== null && opts.authenticatedOrigins?.has(parsed.origin) === true;
}

/** Registries are containers; require a strict path descendant, never a sibling prefix. */
function registrationTarget(
  registry: string,
  registration: string,
  opts: ResolveOptions,
): string | null {
  const parent = safePathUrl(registry);
  const child = safePathUrl(registration);
  if (!parent || !child || !parent.pathname.endsWith('/') || !child.pathname.endsWith('/'))
    return null;
  // Queries/fragments must not turn a metadata document into a broader pinned container.
  if (parent.search || parent.hash || child.search || child.hash) return null;
  if (
    parent.origin !== child.origin ||
    parent.pathname === child.pathname ||
    // The parent's trailing slash makes this a whole-segment comparison of normalised paths.
    !child.pathname.startsWith(parent.pathname)
  )
    return null;
  if (opts.allowedOrigins && !opts.allowedOrigins.has(child.origin)) return null;
  return `${child.origin}${child.pathname}`;
}

function matchesClass(doc: ParsedDocument, shape: string, classIRI: string): boolean {
  const node = DataFactory.namedNode(shape);
  return (
    !doc.store
      .readQuads(
        node,
        DataFactory.namedNode(RDF_TYPE),
        DataFactory.namedNode(`${SH}NodeShape`),
        null,
      )
      [Symbol.iterator]()
      .next().done &&
    !doc.store
      .readQuads(
        node,
        DataFactory.namedNode(`${SH}targetClass`),
        DataFactory.namedNode(classIRI),
        null,
      )
      [Symbol.iterator]()
      .next().done
  );
}

/** Consume the already-read public profile, then walk authenticated SAI documents. */
export async function resolveSaiTargets(
  classIRI: string,
  opts: ResolveOptions,
  profile: Document,
  found?: ClassTargetCollector,
): Promise<ClassResolution> {
  opts = { ...opts, fetch: memoiseResolveFetch(opts.fetch) };
  const active = () => !opts.signal?.aborted && (!opts.budget || opts.budget.active());
  const targets: ResolvedTarget[] = [];
  let truncated = false;
  const registries = new Set<string>();
  const registrations = new Set<string>();
  const shapeDocuments = new Map<string, Promise<ParsedDocument | null>>();
  // Both tree and external shape documents count against one budget, including failed reads.
  const publicShapes = async (url: string): Promise<ParsedDocument | null> => {
    if (!active()) return null;
    const key = documentUrl(httpUrl(url)?.href ?? url);
    const cached = shapeDocuments.get(key);
    if (cached) return cached;
    if (
      shapeDocuments.size >= MAX_SHAPE_DOCUMENTS ||
      (opts.budget && !opts.budget.saiDocument('shapes', key, MAX_SHAPE_DOCUMENTS))
    ) {
      truncated = true;
      return null;
    }
    opts.read?.allowDocument(url, false);
    const read = opts
      .fetch(url, false)
      .then((body) => (active() ? parse(body, opts.budget) : null));
    shapeDocuments.set(key, read);
    return read;
  };
  const treeMatches = async (tree: string): Promise<boolean | ClassShape> => {
    if (!active()) return false;
    if (CLASS_SHAPE_TREES.get(classIRI)?.includes(tree)) return true;
    const doc = await publicShapes(tree);
    if (!doc) return false;
    for (const shape of refs(doc, tree, `${ST}shape`, opts.budget)) {
      if (!active()) break;
      if (matchesClass(doc, shape, classIRI)) return { iri: shape, store: doc.store };
      if (documentUrl(shape) === documentUrl(doc.url)) continue;
      const shapeDoc = await publicShapes(shape);
      if (shapeDoc && matchesClass(shapeDoc, shape, classIRI))
        return { iri: shape, store: shapeDoc.store };
    }
    return false;
  };
  const privateDocument = async (url: string): Promise<ParsedDocument | null> => {
    if (!active() || !isAuthenticated(url, opts)) return null;
    opts.read?.allowDocument(url, true);
    const body = await opts.fetch(url, true);
    const doc = active() ? parse(body, opts.budget) : null;
    return doc && isAuthenticated(doc.url, opts) ? doc : null;
  };
  const profileDoc = parse(profile, opts.budget);
  if (!profileDoc) return { targets, truncated };
  for (const set of refs(profileDoc, opts.webId, `${INTEROP}hasRegistrySet`, opts.budget)) {
    if (!active()) break;
    const setDoc = await privateDocument(set);
    if (!setDoc) continue;
    for (const registry of refs(setDoc, set, `${INTEROP}hasDataRegistry`, opts.budget)) {
      if (!active()) break;
      if (!isAuthenticated(registry, opts) || registries.has(registry)) continue;
      if (
        registries.size >= MAX_REGISTRIES ||
        (opts.budget &&
          !opts.budget.saiDocument('registries', documentUrl(registry), MAX_REGISTRIES))
      ) {
        truncated = true;
        continue;
      }
      registries.add(registry);
      const registryDoc = await privateDocument(registry);
      if (!registryDoc) continue;
      for (const registration of refs(
        registryDoc,
        registry,
        `${INTEROP}hasDataRegistration`,
        opts.budget,
      )) {
        if (!active()) break;
        const url = registrationTarget(registry, registration, opts);
        if (!url || registrations.has(url)) continue;
        if (
          registrations.size >= MAX_REGISTRATIONS ||
          (opts.budget && !opts.budget.saiDocument('registrations', url, MAX_REGISTRATIONS))
        ) {
          truncated = true;
          continue;
        }
        registrations.add(url);
        const doc = await privateDocument(registration);
        if (!doc || !registrationTarget(registry, doc.url, opts)) continue;
        for (const tree of refs(doc, registration, `${INTEROP}registeredShapeTree`, opts.budget)) {
          const match = await treeMatches(tree);
          if (match && active()) {
            opts.read?.allowTarget({ url, kind: 'container' });
            found?.add({ url, kind: 'container' }, 'sai', match === true ? undefined : match);
            targets.push({
              url,
              kind: 'container',
              source: 'sai',
              sources: ['sai'],
              check: 'unchecked',
            });
            break;
          }
        }
      }
    }
  }
  return { targets, truncated };
}

/** Incremental provenance merging keeps finalization constant-time when the budget expires. */
export class ClassTargetCollector {
  readonly targets: ResolvedTarget[] = [];
  readonly shapes = new Map<string, ClassShape>();
  private readonly indices = new Map<string, number>();

  add(target: PinnedTarget, source: TargetSource, shape?: ClassShape): void {
    const key = `${target.kind} ${target.url}`;
    if (shape) this.shapes.set(key, shape);
    const index = this.indices.get(key);
    const previous = index === undefined ? undefined : this.targets[index];
    const sources = previous?.sources.includes(source)
      ? previous.sources
      : [...(previous?.sources ?? []), source];
    const resolved: ResolvedTarget = {
      url: target.url,
      kind: target.kind,
      source: previous?.source ?? source,
      sources,
      check: 'unchecked',
    };
    if (index === undefined) {
      this.indices.set(key, this.targets.length);
      this.targets.push(resolved);
    } else this.targets[index] = resolved;
  }
}

/** Merge only rung-produced targets; kind is part of identity, provenance is unioned. */
export function mergeClassTargets(
  sai: ClassResolution,
  indexed: readonly PinnedTarget[],
): ClassResolution {
  const found = new ClassTargetCollector();
  for (const target of sai.targets) found.add(target, 'sai');
  for (const target of indexed) found.add(target, 'type-index');
  return { targets: found.targets, truncated: sai.truncated };
}
