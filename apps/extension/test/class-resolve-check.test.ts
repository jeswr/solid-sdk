// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESOLUTION_LIMITS,
  ResolutionBudget,
} from '../src/background/core/class-resolution-budget';
import { resolveClassTargets } from '../src/background/core/class-resolve';
import {
  checkClassCandidates,
  directMember,
  sampleMembers,
} from '../src/background/core/class-resolve-check';
import { createInternalRead } from '../src/background/core/class-resolve-read';
import type { ResolvedTarget } from '../src/background/core/class-resolve-sai';
import type { ClassShape } from '../src/background/core/shacl-lite';
import { PIM_STORAGE_CLASS } from '../src/shared/storage-class';

const POD = 'https://pod.example';
const WEBID = `${POD}/profile#me`;
const TARGET = `${POD}/data/contacts/`;
const CLASS = 'https://example.org/Contact';
const TREE = 'https://trees.example/tree#T';
const SHAPE = 'https://trees.example/shapes#Contact';
const PREFIX = `@prefix sh: <http://www.w3.org/ns/shacl#> .
 @prefix ldp: <http://www.w3.org/ns/ldp#> .
 @prefix dct: <http://purl.org/dc/terms/> .
 @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
 @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
 @prefix solid: <http://www.w3.org/ns/solid/terms#> .
 @prefix i: <http://www.w3.org/ns/solid/interop#> .
 @prefix st: <http://www.w3.org/ns/shapetrees#> .`;
const good = `<#one> a <${CLASS}>; <https://example.org/name> "Alice" .`;
const bad = '<#one> <https://example.org/name> "Nobody" .';
const shape = `<${SHAPE}> a sh:NodeShape; sh:targetClass <${CLASS}>;
 sh:property [ sh:path <https://example.org/name>; sh:minCount 1; sh:datatype xsd:string ] .`;
const candidate = (url = TARGET, kind: 'container' | 'instance' = 'container'): ResolvedTarget => ({
  url,
  kind,
  source: 'type-index',
  sources: ['type-index'],
  check: 'unchecked',
});
const budgets: ResolutionBudget[] = [];
type Document = string | { text: string; type: string; status?: number };
function fixture(documents: Record<string, Document> = {}, signal?: AbortSignal) {
  const docs: Record<string, Document> = {
    [WEBID]: `<${WEBID}> solid:publicTypeIndex <${POD}/index> .`,
    [`${POD}/index`]: `<#r> solid:forClass <${CLASS}>; solid:instanceContainer <${TARGET}> .`,
    ...documents,
  };
  const budget = new ResolutionBudget(signal);
  budgets.push(budget);
  const send = vi.fn(async (url: string, _auth: boolean, _method: string, _signal: AbortSignal) => {
    const doc = docs[url] ?? docs[url.split('#')[0]];
    if (doc === undefined) return new Response(null, { status: 404 });
    const text = typeof doc === 'string' ? PREFIX + doc : doc.text;
    return new Response(text, {
      status: typeof doc === 'string' ? 200 : (doc.status ?? 200),
      headers: { 'Content-Type': typeof doc === 'string' ? 'text/turtle' : doc.type },
    });
  });
  const origins = new Set([POD]);
  const read = createInternalRead({
    webId: WEBID,
    budget,
    signal,
    send,
    authenticatedOrigins: origins,
    allowedOrigins: origins,
  });
  const resolve = (cls = CLASS) =>
    resolveClassTargets(cls, {
      webId: WEBID,
      fetch: async () => {
        throw new Error('unconfined transport used');
      },
      read,
      budget,
      signal,
      authenticatedOrigins: origins,
      allowedOrigins: origins,
    });
  return { budget, send, read, resolve, docs };
}
const listing = (names: string[]) =>
  `<${TARGET}> ldp:contains ${names.map((name) => `<${name}>`).join(', ')} .`;
afterEach(() => {
  for (const b of budgets.splice(0)) b.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('C4 sampling through the confined read', () => {
  it.each([
    [[good, good], 'conforms'],
    [[good, bad], 'mixed'],
    [[bad, bad], 'dropped'],
  ] as const)('classifies samples %#', async (members, check) => {
    const urls = members.map((_, i) => `${TARGET}${i}`);
    const f = fixture({
      [TARGET]: listing(urls),
      ...Object.fromEntries(urls.map((url, i) => [url, members[i]])),
    });
    const result = await f.resolve();
    expect(result.truncated).toBe(false);
    expect(result.targets).toEqual(check === 'dropped' ? [] : [{ ...candidate(), check }]);
    expect(f.send.mock.calls.map(([url, auth, method]) => [url, auth, method])).toEqual([
      [WEBID, false, 'GET'],
      [`${POD}/index`, false, 'GET'],
      [TARGET, true, 'GET'],
      ...urls.map((url) => [url, true, 'GET']),
    ]);
  });

  it('takes eight RDF members newest first, skipping non-RDF, and ignores unrelated modification triples', async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `${TARGET}${i}`);
    const f = fixture({
      [TARGET]:
        listing(urls) +
        urls
          .map(
            (url, i) =>
              `<${url}> dct:modified "2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z"^^xsd:dateTime .`,
          )
          .join('\n') +
        `<${urls[0]}> <https://example.org/modified> "2030-01-01T00:00:00Z"^^xsd:dateTime .`,
      ...Object.fromEntries(
        urls.map((url, i) => [url, i === 11 ? { text: 'image', type: 'image/png' } : good]),
      ),
    });
    expect((await f.resolve()).targets[0].check).toBe('conforms');
    expect(f.send.mock.calls.slice(3).map(([url]) => url)).toEqual(urls.slice(3).reverse());
  });

  it.each([
    '',
    '<#unrelated> ldp:contains <one> .',
    listing([`${TARGET}photo`]),
  ])('empty or non-RDF-only listings stay unchecked (%#)', async (body) => {
    const f = fixture({ [TARGET]: body, [`${TARGET}photo`]: { text: 'photo', type: 'image/png' } });
    expect((await f.resolve()).targets).toEqual([candidate()]);
  });

  it.each([
    'application/ld+json',
    'application/rdf+xml',
    'application/trix',
  ])('unparsed RDF %s is incomplete', async (type) => {
    const f = fixture({
      [TARGET]: listing([`${TARGET}one`, `${TARGET}two`]),
      [`${TARGET}one`]: good,
      [`${TARGET}two`]: { text: 'unsupported serialization', type },
    });
    expect((await f.resolve()).targets).toEqual([candidate()]);
  });

  it.each([
    'Text/Turtle; charset=UTF-8',
    'text/n3',
    'application/trig',
    'application/n-triples',
    'application/n-quads',
  ])('checks N3-supported RDF media type %s', async (type) => {
    const triple = `<${TARGET}one#focus> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${CLASS}>`;
    const text =
      type === 'application/n-quads'
        ? `${triple} <urn:graph> .`
        : type === 'application/trig'
          ? `<urn:graph> { ${triple} . }`
          : `${triple} .`;
    const f = fixture({ [TARGET]: listing([`${TARGET}one`]), [`${TARGET}one`]: { text, type } });
    expect((await f.resolve()).targets).toEqual([{ ...candidate(), check: 'conforms' }]);
  });

  it.each([
    'throw',
    '404',
    'malformed',
    'unsupported-listing',
    'non-rdf-listing',
  ])('read problems stay unchecked: %s', async (problem) => {
    const f = fixture({ [TARGET]: listing([`${TARGET}one`]), [`${TARGET}one`]: good });
    if (problem === 'throw')
      f.send.mockImplementation(async () => {
        throw new Error('offline');
      });
    else if (problem === '404') delete f.docs[`${TARGET}one`];
    else if (problem === 'malformed') f.docs[`${TARGET}one`] = 'invalid turtle';
    else
      f.docs[TARGET] = {
        text: 'unsupported',
        type: problem === 'unsupported-listing' ? 'application/ld+json' : 'text/html',
      };
    if (problem === 'throw') {
      // Invoke sampling on an already-discovered candidate to isolate transport failure.
      expect(
        (await checkClassCandidates(CLASS, [candidate()], new Map(), f.read, f.budget)).targets,
      ).toEqual([candidate()]);
    } else expect((await f.resolve()).targets).toEqual([candidate()]);
  });

  it('refuses foreign, nested, sibling, unlisted and ambiguous member URLs before egress', async () => {
    const names = [
      'one',
      'deep/nested',
      '../outside',
      '%2fescape',
      'x?query',
      'x#fragment',
      'x?',
      'x#',
    ].map((s) => TARGET + s);
    names.push('https://evil.example/one', `${POD}/data/contacts-other/one`, TARGET);
    const f = fixture({ [TARGET]: listing(names), [`${TARGET}one`]: good });
    expect((await f.resolve()).targets[0].check).toBe('conforms');
    expect(f.send.mock.calls.slice(3).map(([url]) => url)).toEqual([`${TARGET}one`]);
    expect((await f.read.fetch(`${TARGET}unlisted`, true)).ok).toBe(false);
  });

  it.each([
    '?',
    '#',
    '?query',
    '#fragment',
  ])('refuses member delimiter %s before admission or egress', async (suffix) => {
    const url = `${TARGET}one${suffix}`;
    const f = fixture({ [TARGET]: listing([url]), [url]: good });
    expect(directMember(candidate(), url)).toBeNull();
    expect(directMember(candidate(TARGET + suffix), `${TARGET}one`)).toBeNull();
    expect((await f.resolve()).targets).toEqual([candidate()]);
    f.read.allowMember(candidate(), url);
    expect((await f.read.fetch(url, true)).ok).toBe(false);
    f.read.allowMember(candidate(), `${TARGET}one`);
    expect((await f.read.fetch(url, true)).ok).toBe(false);
    expect(f.send.mock.calls.map(([url]) => url)).toEqual([WEBID, `${POD}/index`, TARGET]);
  });

  it('does not follow a member redirect to an unconfined sibling', async () => {
    const f = fixture({ [TARGET]: listing([`${TARGET}one`]) });
    const send = f.send.getMockImplementation()!;
    f.send.mockImplementation(async (...args) =>
      args[0] === `${TARGET}one`
        ? new Response(null, { status: 302, headers: { location: `${TARGET}unlisted` } })
        : send(...args),
    );
    expect((await f.resolve()).targets).toEqual([candidate()]);
    expect(f.send.mock.calls.some(([url]) => url.endsWith('unlisted'))).toBe(false);
  });

  it.each([
    good,
    bad,
    'invalid turtle',
  ])('checks instance targets through the same evidence path (%#)', async (text) => {
    const url = `${POD}/instance`;
    const f = fixture({
      [`${POD}/index`]: `<#r> solid:forClass <${CLASS}>; solid:instance <${url}> .`,
      [url]: text,
    });
    const result = await f.resolve();
    expect(result.targets).toEqual(
      text === bad
        ? []
        : [{ ...candidate(url, 'instance'), check: text === good ? 'conforms' : 'unchecked' }],
    );
    expect(f.send.mock.calls.map(([url]) => url)).toEqual([WEBID, `${POD}/index`, url]);
  });

  it('uses the exact external C3 shape for both SAI and Type Index candidates, exposes only its IRI', async () => {
    const instance = `${POD}/instance`;
    const f = fixture({
      [WEBID]: `<${WEBID}> i:hasRegistrySet <${POD}/set>; solid:publicTypeIndex <${POD}/index> .`,
      [`${POD}/set`]: `<${POD}/set> i:hasDataRegistry <${POD}/data/> .`,
      [`${POD}/data/`]: `<${POD}/data/> i:hasDataRegistration <${TARGET}> .`,
      [TARGET]: `<${TARGET}> i:registeredShapeTree <${TREE}> .${listing([`${TARGET}one`])}`,
      [`${TARGET}one`]: good,
      [TREE.split('#')[0]]: `<${TREE}> st:shape <${SHAPE}> .`,
      [SHAPE.split('#')[0]]:
        shape +
        `<https://trees.example/shapes#Other> a sh:NodeShape; sh:targetClass <${CLASS}>; sh:sparql [] .`,
      [`${POD}/index`]: `<#r> solid:forClass <${CLASS}>; solid:instanceContainer <${TARGET}>; solid:instance <${instance}> .`,
      [instance]: `<#typedButMissingName> a <${CLASS}> .`,
    });
    const result = await f.resolve();
    expect(result).toEqual({
      shape: SHAPE,
      truncated: false,
      targets: [
        { ...candidate(), source: 'sai', sources: ['sai', 'type-index'], check: 'conforms' },
      ],
    });
    const urls = f.send.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url === TARGET)).toHaveLength(1);
    expect(urls.filter((url) => url === SHAPE)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('Alice');
    expect(JSON.stringify(result)).not.toContain('store');
  });

  it.each([
    'sh:node <https://example.org/nested>',
    'sh:sparql []',
  ])('unsupported shape %s overrides a pass or failure', async (extra) => {
    const f = fixture({
      [TARGET]: listing([`${TARGET}one`, `${TARGET}two`]),
      [`${TARGET}one`]: good,
      [`${TARGET}two`]: bad,
    });
    const shapes = new Map<string, ClassShape>([
      [
        `container ${TARGET}`,
        { iri: SHAPE, store: f.budget.parse(SHAPE, `${PREFIX + shape}<${SHAPE}> ${extra} .`) },
      ],
    ]);
    expect(await checkClassCandidates(CLASS, [candidate()], shapes, f.read, f.budget)).toEqual({
      shape: SHAPE,
      targets: [candidate()],
    });
  });

  it.each([
    ['rdf:first "bad"', 'Alice'],
    ['rdf:first "bad"', 'Nobody'],
    ['rdf:rest rdf:nil', 'Alice'],
    ['rdf:rest rdf:nil', 'Nobody'],
    ['rdf:first "bad"; rdf:rest rdf:nil', 'Alice'],
    ['rdf:first "bad"; rdf:rest rdf:nil', 'Nobody'],
  ])('polluted rdf:nil (%s, sample %s) keeps the target unchecked', async (pollution, name) => {
    const f = fixture({
      [TARGET]: listing([`${TARGET}one`]),
      [`${TARGET}one`]: `<#one> a <${CLASS}>; <https://example.org/name> "${name}" .`,
    });
    const store = f.budget.parse(
      SHAPE,
      `${PREFIX}<${SHAPE}> sh:property [
      sh:path <https://example.org/name>; sh:in ("Alice") ] . rdf:nil ${pollution} .`,
    );
    const shapes = new Map([[`container ${TARGET}`, { iri: SHAPE, store }]]);
    expect(await checkClassCandidates(CLASS, [candidate()], shapes, f.read, f.budget)).toEqual({
      shape: SHAPE,
      targets: [candidate()],
    });
    expect(f.send.mock.calls.map(([url]) => url)).toEqual([TARGET, `${TARGET}one`]);
  });

  it.each([
    ['int', 'nonsense'],
    ['int', '2147483648'],
    ['unsignedByte', 'nonsense'],
    ['unsignedByte', '999'],
  ])('unsupported datatype %s with value %s keeps the target unchecked', async (type, value) => {
    const f = fixture({
      [TARGET]: listing([`${TARGET}one`]),
      [`${TARGET}one`]: `<#one> a <${CLASS}>; <https://example.org/value> "${value}"^^xsd:${type} .`,
    });
    const store = f.budget.parse(
      SHAPE,
      `${PREFIX}<${SHAPE}> sh:property [
      sh:path <https://example.org/value>; sh:datatype xsd:${type} ] .`,
    );
    const shapes = new Map([[`container ${TARGET}`, { iri: SHAPE, store }]]);
    expect(
      (await checkClassCandidates(CLASS, [candidate()], shapes, f.read, f.budget)).targets,
    ).toEqual([candidate()]);
  });

  it('does not sample the built-in Storage class', async () => {
    const f = fixture({
      [WEBID]: `<${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${POD}/> .`,
    });
    expect((await f.resolve(PIM_STORAGE_CLASS)).targets).toHaveLength(1);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
});

describe('whole-resolution limits and adversarial sampling', () => {
  it('exhaustion after one passing member keeps every discovered target unchecked', async () => {
    const f = fixture({
      [TARGET]: listing([`${TARGET}one`, `${TARGET}two`]),
      [`${TARGET}one`]: good,
      [`${TARGET}two`]: good,
    });
    for (let n = 0; n < RESOLUTION_LIMITS.documents - 4; n++) f.budget.document();
    expect(await f.resolve()).toMatchObject({ truncated: true, targets: [candidate()] });
    expect(f.send.mock.calls.map(([url]) => url)).toEqual([
      WEBID,
      `${POD}/index`,
      TARGET,
      `${TARGET}one`,
    ]);
    expect(f.budget.signal.aborted).toBe(true);
  });

  it.each(['cancel', 'deadline'])('interrupts a stalled member mid-sample (%s)', async (reason) => {
    vi.useFakeTimers();
    const c = new AbortController();
    const f = fixture(
      { [TARGET]: listing([`${TARGET}one`, `${TARGET}two`]), [`${TARGET}one`]: good },
      c.signal,
    );
    const send = f.send.getMockImplementation()!;
    let reached!: () => void;
    const atSecond = new Promise<void>((resolve) => {
      reached = resolve;
    });
    f.send.mockImplementation(async (...args) => {
      if (args[0] === `${TARGET}two`) {
        reached();
        return new Promise(() => {});
      }
      return send(...args);
    });
    const pending = f.resolve();
    await atSecond;
    if (reason === 'cancel') c.abort();
    else await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result).toMatchObject({ truncated: reason === 'deadline', targets: [candidate()] });
    expect(f.send.mock.calls.at(-1)![3].aborted).toBe(true);
    expect((await f.read.fetch(`${TARGET}one`, true)).ok).toBe(false);
  });

  it.each([
    'body',
    'quads',
  ])('an oversized %s during sampling leaves unchecked targets', async (kind) => {
    const oversized =
      kind === 'body'
        ? '#'.repeat(RESOLUTION_LIMITS.bytes + 1)
        : '<a> <b> <c> .\n'.repeat(RESOLUTION_LIMITS.quads + 1);
    const f = fixture({ [TARGET]: listing([`${TARGET}one`]), [`${TARGET}one`]: oversized });
    expect(await f.resolve()).toMatchObject({ truncated: true, targets: [candidate()] });
  });

  it('scans a large listing linearly, without graph rescans or unbounded sorting', () => {
    const f = fixture();
    const names = Array.from({ length: 12_000 }, (_, i) => `${TARGET}${i}`);
    const store = f.budget.parse(TARGET, PREFIX + listing(names));
    const reads = vi.spyOn(store, 'readQuads');
    const sorted = vi.spyOn(Array.prototype, 'sort');
    const selected = sampleMembers(store, candidate(), f.budget);
    expect(selected).toHaveLength(128);
    expect(reads).toHaveBeenCalledTimes(names.length + 1);
    expect(sorted).not.toHaveBeenCalled();
  });

  it('checks the deadline inside listing and modification loops', () => {
    const f = fixture();
    const members = Array.from({ length: 1000 }, (_, i) => `${TARGET}${i}`);
    const store = f.budget.parse(
      TARGET,
      PREFIX +
        listing(members) +
        `<${members[0]}> dct:modified "2026-01-01T00:00:00Z"^^xsd:dateTime .`,
    );
    let calls = 0;
    vi.spyOn(f.budget, 'active').mockImplementation(() => {
      if (++calls === 100) f.budget.exhaust();
      return !f.budget.signal.aborted;
    });
    expect(() => sampleMembers(store, candidate(), f.budget)).toThrow();
    expect(calls).toBe(100);
  });

  it('handles invalid modification metadata and retains only safe direct NamedNode members', () => {
    const f = fixture();
    const ttl =
      listing([`${TARGET}one`, `${TARGET}two`]) +
      `<${TARGET}> ldp:contains "bad", [] .
      <${TARGET}one> dct:modified "nonsense"^^xsd:dateTime, "2026-01-01", <urn:wrong> .`;
    expect(sampleMembers(f.budget.parse(TARGET, PREFIX + ttl), candidate(), f.budget)).toEqual([
      `${TARGET}one`,
      `${TARGET}two`,
    ]);
    expect(directMember(candidate('not a url'), `${TARGET}one`)).toBeNull();
    expect(directMember(candidate(TARGET, 'instance'), `${TARGET}one`)).toBeNull();
    expect(directMember(candidate(), `${TARGET}child/`)).toBe(`${TARGET}child/`);
    expect(
      directMember(candidate(), 'https://user:password@pod.example/data/contacts/one'),
    ).toBeNull();
  });

  it('checks cancellation during synchronous listing iteration', () => {
    const c = new AbortController();
    const f = fixture({}, c.signal);
    const store = f.budget.parse(TARGET, PREFIX + listing([`${TARGET}one`]));
    const quad = store.getQuads(null, null, null, null)[0];
    vi.spyOn(store, 'readQuads').mockImplementation(function* () {
      c.abort();
      yield quad;
    });
    expect(() => sampleMembers(store, candidate(), f.budget, c.signal)).toThrow();
  });

  it('accepts a legacy RDF transport without a content type and caches compiled shapes across targets', async () => {
    const f = fixture({
      [TARGET]: listing([`${TARGET}one`]),
      [`${TARGET}one`]: good,
      [`${POD}/instance`]: good,
    });
    const fetch = f.read.fetch;
    const read = {
      ...f.read,
      fetch: async (...args: Parameters<typeof fetch>) => {
        const { contentType: _, ...body } = await fetch(...args);
        return body;
      },
    };
    const s = { iri: SHAPE, store: f.budget.parse(SHAPE, PREFIX + shape) };
    const shapes = new Map([[`container ${TARGET}`, s]]);
    const result = await checkClassCandidates(
      CLASS,
      [candidate(), candidate(`${POD}/instance`, 'instance')],
      shapes,
      read,
      f.budget,
    );
    expect(result.targets.map((t) => t.check)).toEqual(['conforms', 'conforms']);
  });

  it('retains the original candidates when already cancelled, including their shape IRI', async () => {
    const c = new AbortController();
    const f = fixture({}, c.signal);
    const s = { iri: SHAPE, store: f.budget.parse(SHAPE, PREFIX + shape) };
    c.abort();
    expect(
      await checkClassCandidates(CLASS, [candidate()], new Map(), f.read, f.budget, c.signal),
    ).toEqual({ shape: null, targets: [candidate()] });
    expect(
      await checkClassCandidates(
        CLASS,
        [candidate()],
        new Map([[`container ${TARGET}`, s]]),
        f.read,
        f.budget,
        c.signal,
      ),
    ).toEqual({ shape: SHAPE, targets: [candidate()] });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('preserves the shape and unchecked target on deadline exhaustion with a shape', async () => {
    const f = fixture({ [TARGET]: listing([`${TARGET}one`]), [`${TARGET}one`]: good });
    const s = { iri: SHAPE, store: f.budget.parse(SHAPE, PREFIX + shape) };
    const send = f.send.getMockImplementation()!;
    f.send.mockImplementation(async (...args) => {
      const response = await send(...args);
      f.budget.exhaust();
      return response;
    });
    expect(
      await checkClassCandidates(
        CLASS,
        [candidate()],
        new Map([[`container ${TARGET}`, s]]),
        f.read,
        f.budget,
      ),
    ).toEqual({ shape: SHAPE, targets: [candidate()] });
  });

  it('retains unchecked targets if the deadline falls between listing and the first sample', async () => {
    const c = new AbortController();
    const f = fixture({ [TARGET]: listing([`${TARGET}one`]), [`${TARGET}one`]: good }, c.signal);
    const store = f.budget.parse(TARGET, PREFIX + listing([`${TARGET}one`]));
    const quads = [...store.readQuads(null, null, null, null)];
    vi.spyOn(store, 'readQuads').mockImplementation(function* (...args) {
      if (typeof args[1] !== 'string' && args[1]?.value === 'http://www.w3.org/ns/ldp#contains') {
        yield* quads;
        const now = Date.now();
        vi.spyOn(Date, 'now')
          .mockReturnValueOnce(now)
          .mockReturnValue(now + 10_000);
      }
    });
    vi.spyOn(f.budget, 'parse').mockReturnValue(store);
    expect(
      (await checkClassCandidates(CLASS, [candidate()], new Map(), f.read, f.budget, c.signal))
        .targets,
    ).toEqual([candidate()]);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('retains the newest bounded set even when the newest member occurs last', () => {
    const f = fixture();
    const names = Array.from({ length: 129 }, (_, i) => `${TARGET}${i}`);
    const store = f.budget.parse(
      TARGET,
      `${PREFIX + listing(names)}<${names[128]}> dct:modified "2026-01-01T00:00:00Z"^^xsd:dateTime .`,
    );
    const selected = sampleMembers(store, candidate(), f.budget);
    expect(selected[0]).toBe(names[128]);
    expect(selected).toHaveLength(128);
    expect(selected).not.toContain(names[127]);
  });
});
