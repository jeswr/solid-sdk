// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Store } from 'n3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESOLUTION_LIMITS,
  ResolutionBudget,
} from '../src/background/core/class-resolution-budget';
import {
  parseTargetsForClass,
  parseTypeIndexRefs,
  resolveClassTargets,
} from '../src/background/core/class-resolve';
import { createInternalRead } from '../src/background/core/class-resolve-read';
import { PIM_STORAGE_CLASS } from '../src/shared/storage-class';

const pod = 'https://pod.example';
const webId = `${pod}/profile#me`;
const solid = 'http://www.w3.org/ns/solid/terms#';
const pim = 'http://www.w3.org/ns/pim/space#';
const interop = 'http://www.w3.org/ns/solid/interop#';
const dataClass = 'http://www.w3.org/2006/vcard/ns#Individual';
const tree = 'https://shapes.activitypods.org/shapetrees/as/Profile';
const index = (target = `${pod}/contacts/`) =>
  `<#r> <${solid}forClass> <${dataClass}>; <${solid}instanceContainer> <${target}> .`;
const budgets: ResolutionBudget[] = [];
function harness(docs: Record<string, string> = {}, signal?: AbortSignal) {
  const budget = new ResolutionBudget();
  budgets.push(budget);
  const send = vi.fn(
    async (url: string, _auth: boolean, _method: string, _signal: AbortSignal) =>
      new Response(docs[url] ?? '', { status: url in docs ? 200 : 404 }),
  );
  const origins = new Set([pod]);
  const read = createInternalRead({
    webId,
    budget,
    signal,
    authenticatedOrigins: origins,
    allowedOrigins: origins,
    send,
  });
  const resolve = (cls = dataClass) =>
    resolveClassTargets(cls, {
      webId,
      fetch: read.fetch,
      read,
      budget,
      authenticatedOrigins: origins,
      allowedOrigins: origins,
    });
  return { budget, send, read, resolve };
}
afterEach(() => {
  for (const budget of budgets.splice(0)) budget.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('resolver internal capability', () => {
  it.each([
    '?',
    '#',
    '?query',
    '#fragment',
  ])('refuses candidate delimiters %s before egress, including normalized aliases', async (suffix) => {
    for (const kind of ['container', 'instance'] as const) {
      const url = `${pod}/contacts/`;
      const h = harness({ [url]: '', [url + suffix]: '' });
      h.read.allowTarget({ url: url + suffix, kind });
      expect((await h.read.fetch(url + suffix, true)).ok).toBe(false);
      expect((await h.read.fetch(url, true)).ok).toBe(false);
      h.read.allowTarget({ url, kind });
      expect((await h.read.fetch(url + suffix, true)).ok).toBe(false);
      expect(h.send).not.toHaveBeenCalled();
    }
  });

  it.each([
    '?',
    '#',
    '?query',
    '#fragment',
  ])('refuses delimiter %s on target/member redirect hops before egress', async (suffix) => {
    for (const member of [false, true]) {
      const h = harness();
      const target = { url: `${pod}/contacts/`, kind: 'container' as const };
      const source = member ? `${target.url}one` : target.url;
      const destination = `${target.url}two`;
      h.read.allowTarget(target);
      h.read.allowMember(target, source);
      // Even a discovery document cannot relax confinement of a member redirect.
      h.read.allowDocument(destination + suffix, true);
      h.send.mockResolvedValue(
        new Response(null, { status: 302, headers: { location: destination + suffix } }),
      );
      expect((await h.read.fetch(source, true)).ok).toBe(false);
      expect(h.send.mock.calls.map(([url]) => url)).toEqual([source]);
    }
  });

  it('does not reuse a discovery redirect cache after a document becomes a candidate', async () => {
    const source = `${pod}/contacts/`;
    const destination = `${pod}/metadata#shape`;
    const h = harness({ [destination]: 'discovery bytes' });
    h.read.allowDocument(source, true);
    h.read.allowDocument(destination, true);
    const send = h.send.getMockImplementation()!;
    h.send.mockImplementation(async (...args) =>
      args[0] === source
        ? new Response(null, { status: 302, headers: { location: destination } })
        : send(...args),
    );
    expect((await h.read.fetch(source, true)).ok).toBe(true);
    h.send.mockClear();
    h.read.allowTarget({ url: source, kind: 'container' });
    expect((await h.read.fetch(source, true)).ok).toBe(false);
    expect(h.send.mock.calls.map(([url]) => url)).toEqual([source]);
  });

  it.each([
    '?',
    '#',
    '?query',
    '#fragment',
  ])('drops Type Index candidates with delimiter %s before sampling', async (suffix) => {
    const url = `${pod}/contacts/`;
    const h = harness({
      [webId]: `<${webId}> <${solid}publicTypeIndex> <${pod}/index> .`,
      [`${pod}/index`]: `${index(url + suffix)} <#r> <${solid}instance> <${url + suffix}> .`,
      [url]: '',
      [url + suffix]: '',
    });
    expect((await h.resolve()).targets).toEqual([]);
    expect(h.send.mock.calls.map(([url]) => url)).toEqual([webId, `${pod}/index`]);
  });

  it.each([
    '?',
    '#',
    '?query',
    '#fragment',
  ])('drops storage targets with delimiter %s', async (suffix) => {
    const h = harness({ [webId]: `<${webId}> <${pim}storage> <${pod}/${suffix}> .` });
    expect((await h.resolve(PIM_STORAGE_CLASS)).targets).toEqual([]);
    expect(h.send.mock.calls.map(([url]) => url)).toEqual([webId]);
  });

  it.each([
    '?',
    '#',
    '?query',
    '#fragment',
  ])('refuses SAI registry/registration delimiters %s before egress', async (suffix) => {
    for (const badRegistry of [false, true]) {
      const registry = `${pod}/data/${badRegistry ? suffix : ''}`;
      const registration = `${pod}/data/contact/${badRegistry ? '' : suffix}`;
      const h = harness({
        [webId]: `<${webId}> <${interop}hasRegistrySet> <${pod}/set> .`,
        [`${pod}/set`]: `<${pod}/set> <${interop}hasDataRegistry> <${registry}> .`,
        [registry]: `<${registry}> <${interop}hasDataRegistration> <${registration}> .`,
        [registration]: `<${registration}> <${interop}registeredShapeTree> <${tree}> .`,
      });
      expect((await h.resolve()).targets).toEqual([]);
      expect(h.send.mock.calls.map(([url]) => url)).toEqual(
        badRegistry ? [webId, `${pod}/set`] : [webId, `${pod}/set`, registry],
      );
    }
  });

  it.each([
    '?',
    '#',
  ])('refuses an empty delimiter %s on SAI registry redirect hops', async (suffix) => {
    const registry = `${pod}/data/`;
    const destination = `${pod}/other/`;
    const h = harness({
      [webId]: `<${webId}> <${interop}hasRegistrySet> <${pod}/set> .`,
      [`${pod}/set`]: `<${pod}/set> <${interop}hasDataRegistry> <${registry}> .`,
    });
    h.read.allowDocument(destination + suffix, true);
    const send = h.send.getMockImplementation()!;
    h.send.mockImplementation(async (...args) =>
      args[0] === registry
        ? new Response(null, { status: 302, headers: { location: destination + suffix } })
        : send(...args),
    );
    expect((await h.resolve()).targets).toEqual([]);
    expect(h.send.mock.calls.map(([url]) => url)).toEqual([webId, `${pod}/set`, registry]);
  });

  it('refuses off-list documents and credential escalation without any send', async () => {
    const h = harness();
    h.read.allowDocument('https://public.example/index', false);
    h.read.allowDocument('https://public.example/private', true);
    for (const [url, auth] of [
      [`${pod}/off-list`, false],
      [webId, true],
      ['https://public.example/index', true],
      ['https://public.example/private', true],
    ] as const) {
      expect(await h.read.fetch(url, auth)).toMatchObject({ ok: false, text: '' });
    }
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    '../escape',
    '/a/%2fescape',
    '/a/%252e',
    '/a/./escape',
    '/a/\\escape',
    '/a/with space',
    'https://evil.example/document',
    '/unlisted',
  ])('refuses redirect hop %s before egress', async (location) => {
    const h = harness();
    h.send.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    expect(await h.read.fetch(webId, false)).toMatchObject({ ok: false, text: '' });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('follows only separately discovered documents, manually, within three redirects', async () => {
    const h = harness();
    const urls = [webId, `${pod}/one`, `${pod}/two`, `${pod}/three`];
    for (const url of urls) h.read.allowDocument(url, false);
    h.send.mockImplementation(async (url) =>
      url === urls[3]
        ? new Response('complete')
        : new Response(null, { status: 302, headers: { location: urls[urls.indexOf(url) + 1] } }),
    );
    expect(await h.read.fetch(webId, false)).toEqual({
      ok: true,
      text: 'complete',
      url: urls[3],
      contentType: 'text/plain;charset=UTF-8',
    });
    expect(h.send).toHaveBeenCalledTimes(4);
    expect(h.budget.truncated).toBe(false);
  });

  it('halts the whole resolution on the fourth redirect', async () => {
    const h = harness();
    h.send.mockImplementation(
      async () => new Response(null, { status: 302, headers: { location: webId } }),
    );
    expect(await h.read.fetch(webId, false)).toMatchObject({ ok: false, text: '' });
    expect(h.send).toHaveBeenCalledTimes(4);
    expect(h.budget.truncated).toBe(true);
  });

  it('refuses opaque redirects without an automatic follow probe', async () => {
    const h = harness();
    h.send.mockResolvedValue(
      Object.defineProperty(new Response(null), 'type', { value: 'opaqueredirect' }),
    );
    expect(await h.read.fetch(webId, false)).toMatchObject({ ok: false, text: '' });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('memoises failures, successes and document fragments', async () => {
    const h = harness({ [webId]: 'body' });
    expect((await h.read.fetch(webId, false)).text).toBe('body');
    expect((await h.read.fetch(`${pod}/profile#other`, false)).text).toBe('body');
    const missing = `${pod}/missing`;
    h.read.allowDocument(missing, true);
    await h.read.fetch(missing, true);
    await h.read.fetch(missing, true);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('permits GET/HEAD only, with HEAD returning no bytes', async () => {
    const h = harness({ [webId]: 'secret body' });
    expect(await h.read.fetch(webId, false, 'POST' as 'GET')).toMatchObject({ ok: false });
    expect(h.send).not.toHaveBeenCalled();
    expect(await h.read.fetch(webId, false, 'HEAD')).toMatchObject({ ok: true, text: '' });
    expect(h.send.mock.calls[0][2]).toBe('HEAD');
  });

  it('confines future sampling to the candidate and its explicitly listed direct members', async () => {
    const h = harness();
    const target = { url: `${pod}/contacts/`, kind: 'container' as const };
    h.read.allowTarget(target);
    h.read.allowMember(target, `${pod}/contacts/one.ttl`);
    for (const url of [
      `${pod}/contacts/deep/two`,
      `${pod}/contacts/../escape`,
      `${pod}/contacts-other/one`,
      'https://foreign.example/contacts/one',
    ])
      h.read.allowMember(target, url);
    h.read.allowMember({ url: `${pod}/other/`, kind: 'container' }, `${pod}/other/one`);
    await h.read.fetch(target.url, true);
    await h.read.fetch(`${pod}/contacts/one.ttl`, true);
    for (const url of [
      `${pod}/contacts/deep/two`,
      `${pod}/contacts-other/one`,
      `${pod}/other/one`,
      `${pod}/contacts/unlisted`,
    ])
      expect((await h.read.fetch(url, true)).ok).toBe(false);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('cancels a stalled transport and prevents later reads', async () => {
    const controller = new AbortController();
    const h = harness({}, controller.signal);
    h.send.mockImplementation(() => new Promise(() => {}));
    const pending = h.read.fetch(webId, false);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, text: '' });
    expect(h.send.mock.calls[0][3].aborted).toBe(true);
    expect((await h.read.fetch(webId, false)).ok).toBe(false);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.budget.truncated).toBe(false);
  });

  it('discards and cancels headers delivered after request cancellation', async () => {
    const controller = new AbortController();
    const h = harness({}, controller.signal);
    let release!: (response: Response) => void;
    h.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = h.read.fetch(webId, false);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, text: '' });
    const cancel = vi.fn();
    release(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(h.send.mock.calls[0][3].aborted).toBe(true);
  });
});

describe('Preferences discovery', () => {
  it('merges private/public indexes from preferences and profile, deduplicating documents', async () => {
    const prefs = `${pod}/settings/prefs`;
    const privateIndex = `${pod}/settings/private`;
    const publicIndex = 'https://public.example/index';
    const h = harness({
      [webId]: `<${webId}> <${pim}preferencesFile> <${prefs}#first>, <${prefs}#second>; <${solid}publicTypeIndex> <${publicIndex}#a> .`,
      [`${prefs}#first`]: `<${webId}> <${solid}privateTypeIndex> <${privateIndex}>, <${publicIndex}#b>; <${solid}publicTypeIndex> <${publicIndex}> .`,
      [privateIndex]: index(),
      [publicIndex]: index(),
    });
    const result = await h.resolve();
    expect(result).toMatchObject({
      truncated: false,
      targets: [{ url: `${pod}/contacts/`, kind: 'container', check: 'unchecked' }],
    });
    expect(h.send.mock.calls.map(([url, auth]) => [url, auth])).toEqual([
      [webId, false],
      [`${prefs}#first`, true],
      [publicIndex, false],
      [privateIndex, true],
      [`${pod}/contacts/`, true],
    ]);
  });

  it.each([
    '"not a pointer"',
    '_:index',
    '<urn:private:index>',
    '<ftp://pod.example/index>',
  ])('follows preferences when the private-index object is %s', async (object) => {
    const h = harness({
      [webId]: `<${webId}> <${solid}privateTypeIndex> ${object}; <${pim}preferencesFile> <${pod}/prefs> .`,
      [`${pod}/prefs`]: `<${webId}> <${solid}privateTypeIndex> <${pod}/private> .`,
      [`${pod}/private`]: index(),
    });
    expect(await h.resolve()).toMatchObject({
      truncated: false,
      targets: [{ url: `${pod}/contacts/` }],
    });
    expect(h.send.mock.calls.map(([url]) => url)).toEqual([
      webId,
      `${pod}/prefs`,
      `${pod}/private`,
      `${pod}/contacts/`,
    ]);
  });

  it('still suppresses preferences when a usable private pointer also has a public declaration', async () => {
    const h = harness({
      [webId]: `<${webId}> <${solid}privateTypeIndex> <${pod}/index>; <${solid}publicTypeIndex> <${pod}/index>; <${pim}preferencesFile> <${pod}/prefs> .`,
      [`${pod}/index`]: index(),
    });
    expect((await h.resolve()).targets).toHaveLength(1);
    expect(h.send.mock.calls.map(([url, auth]) => [url, auth])).toEqual([
      [webId, false],
      [`${pod}/index`, false],
      [`${pod}/contacts/`, true],
    ]);
  });

  it('skips preferences entirely when the profile advertises a private index', async () => {
    const h = harness({
      [webId]: `<${webId}> <${solid}privateTypeIndex> <${pod}/private>; <${pim}preferencesFile> <${pod}/prefs> .`,
      [`${pod}/private`]: index(),
      [`${pod}/prefs`]: 'x'.repeat(RESOLUTION_LIMITS.bytes + 1),
    });
    expect(await h.resolve()).toMatchObject({
      truncated: false,
      targets: [{ url: `${pod}/contacts/` }],
    });
    expect(h.send.mock.calls.map(([url]) => url)).toEqual([
      webId,
      `${pod}/private`,
      `${pod}/contacts/`,
    ]);
  });

  it.each([
    'foreign',
    'unreachable',
    'malformed',
  ])('degrades when preferences are %s', async (failure) => {
    const prefs = failure === 'foreign' ? 'https://foreign.example/prefs' : `${pod}/prefs`;
    const pub = `${pod}/index`;
    const h = harness({
      [webId]: `<${webId}> <${pim}preferencesFile> <${prefs}>; <${solid}publicTypeIndex> <${pub}> .`,
      [pub]: index(),
      ...(failure === 'malformed' ? { [prefs]: 'not Turtle' } : {}),
    });
    expect((await h.resolve()).targets).toHaveLength(1);
    expect(h.send.mock.calls.some(([url]) => url === prefs)).toBe(failure !== 'foreign');
  });

  it('keeps pim:Storage on the profile-only short circuit', async () => {
    const h = harness({
      [webId]: `<${webId}> <${pim}preferencesFile> <${pod}/prefs>; <${pim}storage> <${pod}/> .`,
    });
    expect((await h.resolve(PIM_STORAGE_CLASS)).targets).toMatchObject([{ url: `${pod}/` }]);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});

describe('whole-resolution limits', () => {
  it('charges every uncached redirect hop and rejects the incomplete final chain', async () => {
    const h = harness();
    const urls = Array.from({ length: 33 }, (_, chain) =>
      Array.from({ length: 4 }, (_, hop) => `${pod}/chain${chain}/hop${hop}`),
    );
    for (const chain of urls) for (const url of chain) h.read.allowDocument(url, false);
    // Include the profile in the same request-wide limit, leaving 127 reads for chains.
    await h.read.fetch(webId, false);
    h.send.mockImplementation(async (url) => {
      const chain = urls.find((chain) => chain.includes(url))!;
      const hop = chain.indexOf(url);
      return hop === 3
        ? new Response(index())
        : new Response(null, { status: 302, headers: { location: chain[hop + 1] } });
    });
    for (const chain of urls.slice(0, 31))
      expect(await h.read.fetch(chain[0], false)).toMatchObject({ ok: true });
    expect(await h.read.fetch(urls[31][0], false)).toMatchObject({ ok: false, text: '' });
    expect(h.budget.truncated).toBe(true);
    expect(h.send).toHaveBeenCalledTimes(128);
    expect(h.send.mock.calls.at(-1)![0]).toBe(urls[31][2]);
    expect(await h.read.fetch(urls[32][0], false)).toMatchObject({ ok: false });
    expect(h.send).toHaveBeenCalledTimes(128);
  });

  it('shares 128 documents across SAI, preferences, indexes and subsequent classes', async () => {
    const docs: Record<string, string> = {
      [webId]: `<${webId}> <${interop}hasRegistrySet> <${pod}/set>; <${pim}preferencesFile> <${pod}/prefs>; <${solid}publicTypeIndex> ${Array.from({ length: 140 }, (_, i) => `<${pod}/index${i}>`).join(', ')} .`,
      [`${pod}/set`]: `<${pod}/set> <${interop}hasDataRegistry> <${pod}/data/> .`,
      [`${pod}/data/`]: `<${pod}/data/> <${interop}hasDataRegistration> <${pod}/data/contact/> .`,
      [`${pod}/data/contact/`]: `<${pod}/data/contact/> <${interop}registeredShapeTree> <${tree}> .`,
      [`${pod}/prefs`]: `<${webId}> <${solid}privateTypeIndex> <${pod}/private> .`,
    };
    for (let i = 0; i < 140; i++) docs[`${pod}/index${i}`] = index(`${pod}/target${i}/`);
    const h = harness(docs);
    const result = await h.resolve();
    expect(h.send).toHaveBeenCalledTimes(128);
    expect(result.truncated).toBe(true);
    expect(result.targets).toHaveLength(124); // one SAI candidate plus 123 index documents
    expect(result.targets.every((t) => t.check === 'unchecked')).toBe(true);
    expect(await h.resolve('https://schema.org/Other')).toEqual({ targets: [], truncated: true });
    expect(h.send).toHaveBeenCalledTimes(128);
  });

  it('uses one 10-second deadline across rungs, retains earlier targets, and cancels a slow body', async () => {
    vi.useFakeTimers();
    const h = harness({
      [webId]: `<${webId}> <${interop}hasRegistrySet> <${pod}/set>; <${solid}publicTypeIndex> <${pod}/index> .`,
      [`${pod}/set`]: `<${pod}/set> <${interop}hasDataRegistry> <${pod}/data/> .`,
      [`${pod}/data/`]: `<${pod}/data/> <${interop}hasDataRegistration> <${pod}/data/contact/> .`,
      [`${pod}/data/contact/`]: `<${pod}/data/contact/> <${interop}registeredShapeTree> <${tree}> .`,
    });
    const original = h.send.getMockImplementation()!;
    const cancel = vi.fn();
    let started!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    h.send.mockImplementation(async (...args) => {
      if (args[0] === `${pod}/set`) await new Promise((resolve) => setTimeout(resolve, 6000));
      if (args[0] === `${pod}/index`) {
        started();
        return new Response(new ReadableStream({ cancel }));
      }
      return original(...args);
    });
    const pending = h.resolve();
    await vi.advanceTimersByTimeAsync(6000);
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toMatchObject({
      truncated: true,
      targets: [{ source: 'sai', check: 'unchecked' }],
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(h.send.mock.calls.at(-1)![3].aborted).toBe(true);
  });

  it('aborts a body above 1 MiB and never parses a partial target', async () => {
    const h = harness({ [webId]: `<${webId}> <${solid}publicTypeIndex> <${pod}/index> .` });
    const original = h.send.getMockImplementation()!;
    const cancel = vi.fn();
    h.send.mockImplementation(async (...args) =>
      args[0] === webId
        ? original(...args)
        : new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(index()));
                controller.enqueue(new Uint8Array(RESOLUTION_LIMITS.bytes + 1));
              },
              cancel,
            }),
          ),
    );
    expect(await h.resolve()).toEqual({ targets: [], truncated: true });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('caps quads at 50,000 before accepting any targets from that document', async () => {
    const h = harness({
      [webId]: `<${webId}> <${solid}publicTypeIndex> <${pod}/index> .`,
      [`${pod}/index`]: `${index()}\n${'<a> <b> <c>.\n'.repeat(50_000)}`,
    });
    expect(await h.resolve()).toEqual({ targets: [], truncated: true });
  });

  it('checks deadline during synchronous parsing and before any new document', () => {
    vi.useFakeTimers();
    const h = harness();
    vi.setSystemTime(Date.now() + 10_000);
    expect(() => h.budget.parse(webId, '<a> <b> <c>.')).toThrow();
    expect(h.budget.document()).toBe(false);
    expect(h.budget.truncated).toBe(true);
  });
});

it('keeps the same deadline when another requested class enters SAI shape matching', async () => {
  vi.useFakeTimers();
  const h = harness({
    [webId]: `<${webId}> <${interop}hasRegistrySet> <${pod}/set> .`,
    [`${pod}/set`]: `<${pod}/set> <${interop}hasDataRegistry> <${pod}/data/> .`,
    [`${pod}/data/`]: `<${pod}/data/> <${interop}hasDataRegistration> <${pod}/data/contact/> .`,
    [`${pod}/data/contact/`]: `<${pod}/data/contact/> <${interop}registeredShapeTree> <${tree}> .`,
  });
  const original = h.send.getMockImplementation()!;
  h.send.mockImplementation(async (...args) => {
    if (args[0] === `${pod}/set`) await new Promise((resolve) => setTimeout(resolve, 6000));
    if (args[0] === tree) return new Promise(() => {});
    return original(...args);
  });
  const first = h.resolve();
  await vi.advanceTimersByTimeAsync(6000);
  expect(await first).toMatchObject({ truncated: false, targets: [{ source: 'sai' }] });
  const second = h.resolve('https://schema.org/Event');
  await vi.advanceTimersByTimeAsync(4000);
  expect(await second).toEqual({ targets: [], truncated: true });
  expect(h.send).toHaveBeenCalledTimes(5);
});

it('rejects an entire document when the deadline passes while quads are being constructed', () => {
  const h = harness();
  const now = Date.now();
  let calls = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now + (++calls > 3 ? 10_000 : 0));
  expect(() => h.budget.parse(webId, '<a> <b> <c>, <d>, <e>, <f>.')).toThrow();
  expect(h.budget.truncated).toBe(true);
});

it('reuses an already read redirect destination without a second document fetch', async () => {
  const h = harness({ [`${pod}/index`]: 'cached document' });
  h.read.allowDocument(`${pod}/index`, false);
  await h.read.fetch(`${pod}/index`, false);
  h.send.mockResolvedValue(
    new Response(null, { status: 302, headers: { location: `${pod}/index` } }),
  );
  expect(await h.read.fetch(webId, false)).toEqual({
    ok: true,
    text: 'cached document',
    contentType: 'text/plain;charset=UTF-8',
    url: `${pod}/index`,
  });
  expect(h.send).toHaveBeenCalledTimes(2);
});

// A profile below both per-document caps reproduced a 16.4-second quadratic traversal.
it('discovers 49,990 index links well within the whole-resolution deadline', async () => {
  const profile = `@prefix s: <${solid}> . <${webId}> s:publicTypeIndex ${Array.from(
    { length: 49_990 },
    (_, i) => `<i${i}>`,
  ).join(',')} .`;
  expect(new TextEncoder().encode(profile).length).toBeLessThan(RESOLUTION_LIMITS.bytes);
  const h = harness({ [webId]: profile });
  const send = h.send.getMockImplementation()!;
  h.send.mockImplementation(async (...args) =>
    args[0] === webId ? send(...args) : new Response(index()),
  );
  const started = performance.now();
  expect(await h.resolve()).toMatchObject({
    truncated: true,
    targets: [{ url: `${pod}/contacts/`, check: 'unchecked' }],
  });
  // Leave headroom for the concurrent coverage suite while rejecting the original 16.4s case.
  expect(performance.now() - started).toBeLessThan(RESOLUTION_LIMITS.milliseconds / 2);
  expect(h.send).toHaveBeenCalledTimes(128);
});

it.each([
  'index refs',
  'registration subjects',
  'instances',
  'containers',
  'storage',
] as const)('checks the deadline inside the synchronous %s traversal', async (phase) => {
  const h = harness();
  const now = Date.now();
  let clock = now;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const predicate =
    phase === 'index refs'
      ? `${solid}publicTypeIndex`
      : phase === 'registration subjects'
        ? `${solid}forClass`
        : phase === 'instances'
          ? `${solid}instance`
          : phase === 'containers'
            ? `${solid}instanceContainer`
            : `${pim}storage`;
  const read = Store.prototype.readQuads;
  let visited = 0;
  vi.spyOn(Store.prototype, 'readQuads').mockImplementation(function* (this: Store, ...args) {
    for (const quad of read.apply(this, args)) {
      if (quad.predicate.value === predicate && ++visited === 3) clock += 10_000;
      yield quad;
    }
  });
  const links = Array.from({ length: 100 }, (_, i) => `<${pod}/target${i}/>`).join(',');
  if (phase === 'index refs') {
    expect(
      parseTypeIndexRefs(webId, `<${webId}> <${predicate}> ${links} .`, webId, h.budget),
    ).toHaveLength(2);
  } else if (phase === 'storage') {
    h.send.mockResolvedValue(new Response(`<${webId}> <${predicate}> ${links} .`));
    expect((await h.resolve(PIM_STORAGE_CLASS)).targets).toHaveLength(2);
  } else {
    const text =
      phase === 'registration subjects'
        ? Array.from({ length: 100 }, (_, i) => `<#r${i}> <${predicate}> <${dataClass}> .`).join(
            '\n',
          )
        : `<#r> <${solid}forClass> <${dataClass}>; <${predicate}> ${links} .`;
    expect(
      parseTargetsForClass(`${pod}/index`, text, dataClass, new Set([pod]), h.budget),
    ).toHaveLength(phase === 'registration subjects' ? 0 : 2);
  }
  expect(visited).toBe(3);
  expect(h.budget.truncated).toBe(true);
});

it.each([
  'hasRegistrySet',
  'hasDataRegistry',
  'hasDataRegistration',
  'registeredShapeTree',
  'shape',
])('checks the deadline inside SAI %s traversal', async (predicate) => {
  const urls = {
    set: `${pod}/set`,
    registry: `${pod}/data/`,
    registration: `${pod}/data/contact/`,
    tree: `${pod}/tree`,
  };
  const st = 'http://www.w3.org/ns/shapetrees#';
  const path = [
    [webId, 'hasRegistrySet', urls.set],
    [urls.set, 'hasDataRegistry', urls.registry],
    [urls.registry, 'hasDataRegistration', urls.registration],
    [urls.registration, 'registeredShapeTree', urls.tree],
    [urls.tree, 'shape', `${pod}/tree#shape`],
  ];
  const docs = Object.fromEntries(
    path.map(([subject, pred, object]) => [
      subject,
      `<${subject}> <${pred === 'shape' ? st : interop}${pred}> ${
        pred === predicate
          ? Array.from({ length: 100 }, (_, i) => `<${object}${i}>`).join(',')
          : `<${object}>`
      } .`,
    ]),
  );
  const h = harness(docs);
  let clock = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const read = Store.prototype.readQuads;
  let visited = 0;
  vi.spyOn(Store.prototype, 'readQuads').mockImplementation(function* (this: Store, ...args) {
    for (const quad of read.apply(this, args)) {
      if (
        quad.predicate.value === `${predicate === 'shape' ? st : interop}${predicate}` &&
        ++visited === 3
      )
        clock += 10_000;
      yield quad;
    }
  });
  expect(await h.resolve()).toMatchObject({ truncated: true, targets: [] });
  expect(visited).toBe(3);
});

it('races the budget deadline even when run receives an independent operation signal', async () => {
  vi.useFakeTimers();
  const h = harness();
  const operation = new AbortController();
  let release!: () => void;
  const pending = h.budget.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    operation.signal,
  );
  const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  release();
  expect(operation.signal.aborted).toBe(false);
  expect(h.budget.truncated).toBe(true);
});

it('retains targets discovered before a synchronous target traversal hits its deadline', async () => {
  const h = harness({
    [webId]: `<${webId}> <${solid}publicTypeIndex> <${pod}/index> .`,
    [`${pod}/index`]: `<#r> <${solid}forClass> <${dataClass}>; <${solid}instanceContainer> <${pod}/one/>, <${pod}/two/>, <${pod}/three/> .`,
  });
  let clock = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const read = Store.prototype.readQuads;
  let visited = 0;
  vi.spyOn(Store.prototype, 'readQuads').mockImplementation(function* (this: Store, ...args) {
    for (const quad of read.apply(this, args)) {
      if (quad.predicate.value === `${solid}instanceContainer` && ++visited === 3) clock += 10_000;
      yield quad;
    }
  });
  expect(await h.resolve()).toMatchObject({
    truncated: true,
    targets: [
      { url: `${pod}/one/`, check: 'unchecked' },
      { url: `${pod}/two/`, check: 'unchecked' },
    ],
  });
  expect(visited).toBe(3);
});

it('checks the deadline while inserting parsed quads into the RDF store', () => {
  const h = harness();
  let clock = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const add = Store.prototype.addQuad;
  let inserted = 0;
  vi.spyOn(Store.prototype, 'addQuad').mockImplementation(function (this: Store, ...args) {
    if (++inserted === 2) clock += 10_000;
    return add.apply(this, args);
  });
  expect(() => h.budget.parse(webId, '<a> <b> <c>, <d>, <e>, <f>.')).toThrow();
  expect(inserted).toBe(2);
  expect(h.budget.truncated).toBe(true);
});

it('fences a supplied fetch after operation cancellation even with a separate live budget', async () => {
  const h = harness();
  const operation = new AbortController();
  let release!: (body: { ok: boolean; text: string; url: string }) => void;
  const fetch = vi.fn(
    () =>
      new Promise<{ ok: boolean; text: string; url: string }>((resolve) => {
        release = resolve;
      }),
  );
  const pending = resolveClassTargets(dataClass, {
    webId,
    fetch,
    budget: h.budget,
    signal: operation.signal,
  });
  operation.abort();
  expect(await pending).toEqual({ targets: [], truncated: false });
  release({ ok: true, text: `<${webId}> <${solid}publicTypeIndex> <${pod}/index> .`, url: webId });
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(h.budget.active()).toBe(true);
});
