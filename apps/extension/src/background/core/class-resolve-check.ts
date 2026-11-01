// AUTHORED-BY Codex GPT-6
/** Private C4 sampling: no page gate, replica, or new candidate discovery. */
import { DataFactory, type Store } from 'n3';
import type { PinnedTarget } from './class-grant';
import { safePathUrl } from './class-path';
import { RESOLUTION_LIMITS, type ResolutionBudget } from './class-resolution-budget';
import type { ResolveFetch } from './class-resolve';
import type { InternalRead } from './class-resolve-read';
import type { ResolvedTarget } from './class-resolve-sai';
import { type ClassShape, compileShaclLite, memberEvidence } from './shacl-lite';

const CONTAINS = DataFactory.namedNode('http://www.w3.org/ns/ldp#contains');
const MODIFIED = DataFactory.namedNode('http://purl.org/dc/terms/modified');
const RDF_TYPES = new Set([
  'text/turtle',
  'application/n-triples',
  'application/n-quads',
  'application/trig',
  'text/n3',
]);
type Body = Awaited<ReturnType<ResolveFetch>>;
function rdfKind(body: Body): 'supported' | 'unsupported' | 'non-rdf' {
  if (!body.contentType) return 'supported'; // Legacy injected RDF transports.
  const type = body.contentType.split(';')[0].trim().toLowerCase();
  if (RDF_TYPES.has(type)) return 'supported';
  return type === 'application/ld+json' ||
    type === 'application/rdf+xml' ||
    type === 'application/trix'
    ? 'unsupported'
    : 'non-rdf';
}

/** Only explicitly listed, path-safe direct members can enter the private read capability. */
export function directMember(target: PinnedTarget, value: string): string | null {
  const parent = safePathUrl(target.url);
  const member = safePathUrl(value);
  if (
    !parent ||
    !member ||
    target.kind !== 'container' ||
    !parent.pathname.endsWith('/') ||
    parent.search ||
    parent.hash ||
    member.search ||
    member.hash ||
    member.username ||
    member.password ||
    member.origin !== parent.origin ||
    !member.pathname.startsWith(parent.pathname)
  )
    return null;
  const suffix = member.pathname.slice(parent.pathname.length).replace(/\/$/, '');
  return suffix && !suffix.includes('/') ? member.href : null;
}

/** Keep at most the request's remaining possible reads. The fixed 128 bound makes this
 * linear in listing size, without sorting an attacker-sized array or scanning it per sample. */
export function sampleMembers(
  store: Store,
  target: PinnedTarget,
  budget: ResolutionBudget,
  signal?: AbortSignal,
): string[] {
  const latest: { url: string; modified: number }[] = [];
  const seen = new Set<string>();
  const active = () => {
    signal?.throwIfAborted();
    if (!budget.active()) budget.signal.throwIfAborted();
  };
  for (const q of store.readQuads(DataFactory.namedNode(target.url), CONTAINS, null, null)) {
    active();
    if (q.object.termType !== 'NamedNode') continue;
    const url = directMember(target, q.object.value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let modified = -Infinity;
    for (const stamp of store.readQuads(q.object, MODIFIED, null, null)) {
      active();
      if (
        stamp.object.termType !== 'Literal' ||
        stamp.object.datatype.value !== 'http://www.w3.org/2001/XMLSchema#dateTime'
      )
        continue;
      const time = Date.parse(stamp.object.value);
      if (Number.isFinite(time)) modified = Math.max(modified, time);
    }
    let position = 0;
    while (position < latest.length && latest[position].modified >= modified) {
      active();
      position++;
    }
    if (position < RESOLUTION_LIMITS.documents) latest.splice(position, 0, { url, modified });
    if (latest.length > RESOLUTION_LIMITS.documents) latest.pop();
  }
  active();
  return latest.map(({ url }) => url);
}

export async function checkClassCandidates(
  classIRI: string,
  targets: readonly ResolvedTarget[],
  shapes: ReadonlyMap<string, ClassShape>,
  read: InternalRead,
  budget: ResolutionBudget,
  signal?: AbortSignal,
): Promise<{ targets: readonly ResolvedTarget[]; shape: string | null }> {
  const checked: ResolvedTarget[] = [];
  const fallback = shapes.values().next().value as ClassShape | undefined;
  const validators = new Map<ClassShape, ReturnType<typeof compileShaclLite>>();
  const active = () => !signal?.aborted && budget.active();
  for (const target of targets) {
    if (!active()) return { targets, shape: fallback?.iri ?? null };
    let conforms = 0;
    let sampled = 0;
    let incomplete = false;
    const shape = shapes.get(`${target.kind} ${target.url}`) ?? fallback;
    let validate = shape ? validators.get(shape) : undefined;
    if (shape && !validate) {
      validate = compileShaclLite(shape, budget, signal);
      validators.set(shape, validate);
    }
    try {
      read.allowTarget(target);
      const body = await read.fetch(target.url, true);
      if (!body.ok) incomplete = true;
      else {
        const kind = rdfKind(body);
        if (kind === 'unsupported') incomplete = true;
        else if (kind === 'supported') {
          const graph = budget.parse(body.url, body.text);
          const members =
            target.kind === 'instance'
              ? [target.url]
              : sampleMembers(graph, target, budget, signal);
          for (const url of members) {
            if (!active()) break;
            if (sampled === 8) break;
            if (target.kind === 'container') read.allowMember(target, url);
            const member = target.kind === 'instance' ? body : await read.fetch(url, true);
            if (!active()) break;
            if (!member.ok) {
              incomplete = true;
              continue;
            }
            const type = rdfKind(member);
            if (type === 'non-rdf') continue;
            sampled++;
            if (type === 'unsupported') {
              incomplete = true;
              continue;
            }
            try {
              const evidence = memberEvidence(
                budget.parse(member.url, member.text),
                classIRI,
                budget,
                validate,
                signal,
              );
              if (evidence === 'conforms') conforms++;
              if (evidence === 'incomplete') incomplete = true;
            } catch {
              incomplete = true;
            }
          }
        }
      }
    } catch {
      incomplete = true;
    }
    // Whole-resolution exhaustion/cancellation cannot certify a partially checked target set.
    if (!active()) return { targets, shape: fallback?.iri ?? null };
    if (incomplete || sampled === 0) checked.push({ ...target, check: 'unchecked' });
    else if (conforms > 0)
      checked.push({ ...target, check: conforms === sampled ? 'conforms' : 'mixed' });
  }
  return { targets: checked, shape: fallback?.iri ?? null };
}
