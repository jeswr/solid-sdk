// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from 'vitest';
import { type ResolveOptions, resolveClassTargets } from '../src/background/core/class-resolve';
import { memoiseResolveFetch } from '../src/background/core/class-resolve-sai';
import { buildPendingConsent, consentDecisionToGrants } from '../src/background/core/consent';

const POD = 'https://alice.pod.example';
const WEBID = `${POD}/profile/card#me`;
const SET = `${POD}/registries#set`;
const REGISTRY = `${POD}/data/`;
const CONTACTS = `${REGISTRY}contacts/`;
const CLASS = 'http://www.w3.org/2006/vcard/ns#Individual';
// Verified ActivityPods SAI mapping; see the shipped table's source comments.
const KNOWN_TREE = 'https://shapes.activitypods.org/shapetrees/as/Profile';
const TREE = 'https://trees.example/contact#tree';
const I = 'http://www.w3.org/ns/solid/interop#';
const ST = 'http://www.w3.org/ns/shapetrees#';
const SH = 'http://www.w3.org/ns/shacl#';
const SOLID = 'http://www.w3.org/ns/solid/terms#';
const UNSAFE_PATHS = [
  '/data/..%2foutside/',
  '/data/..%2Foutside/',
  '/data/%2foutside/',
  '/data/%2Foutside/',
  '/data/%252foutside/',
  '/data/%252Foutside/',
  '/data/%2e%2e/',
  '/data/%2E%2e/contacts/',
  '/data/%5coutside/',
  '/data/%5Coutside/',
  '/data/./contacts/',
  '/data/contacts/../other/',
];

function links(subject: string, predicate: string, objects: string[]) {
  return objects.map((object) => `<${subject}> <${predicate}> <${object}> .`).join('\n');
}

function fixture(overrides: Record<string, string> = {}) {
  const docs: Record<string, string> = {
    [WEBID]: links(WEBID, `${I}hasRegistrySet`, [SET]),
    [SET]: links(SET, `${I}hasDataRegistry`, [REGISTRY]),
    [REGISTRY]: links(REGISTRY, `${I}hasDataRegistration`, [CONTACTS]),
    [CONTACTS]: links(CONTACTS, `${I}registeredShapeTree`, [KNOWN_TREE]),
    ...overrides,
  };
  const fetch = vi.fn(async (url: string, _authenticated: boolean) => ({
    ok: docs[url] !== undefined,
    text: docs[url] ?? '',
    url,
  }));
  const options: ResolveOptions = {
    webId: WEBID,
    fetch,
    authenticatedOrigins: new Set([POD]),
    allowedOrigins: new Set([POD]),
  };
  return { docs, fetch, options };
}

const saiTarget = (url = CONTACTS) => ({
  url,
  kind: 'container',
  source: 'sai',
  sources: ['sai'],
  check: 'unchecked',
});

describe('SAI resolution', () => {
  it('reads two registries and keeps only matching registrations, using the table without network', async () => {
    const second = `${POD}/work/`;
    const f = fixture({
      [SET]: links(SET, `${I}hasDataRegistry`, [REGISTRY, second]),
      [second]: links(second, `${I}hasDataRegistration`, [`${second}contacts/`, `${second}other/`]),
      [`${second}contacts/`]: links(`${second}contacts/`, `${I}registeredShapeTree`, [KNOWN_TREE]),
      [`${second}other/`]: links(`${second}other/`, `${I}registeredShapeTree`, [TREE]),
      [TREE]: '<#shape> a <http://www.w3.org/ns/shex#Schema> .',
    });
    expect(await resolveClassTargets(CLASS, f.options)).toEqual({
      targets: [saiTarget(), saiTarget(`${second}contacts/`)],
      truncated: false,
    });
    expect(f.fetch.mock.calls).toContainEqual([WEBID, false]);
    for (const url of [SET, REGISTRY, CONTACTS, second, `${second}contacts/`, `${second}other/`])
      expect(f.fetch.mock.calls).toContainEqual([url, true]);
    expect(f.fetch.mock.calls).toContainEqual([TREE, false]);
    expect(f.fetch.mock.calls.some(([url]) => url === KNOWN_TREE)).toBe(false);
  });

  it.each([
    `${POD}/elsewhere/`,
    `${POD}/data-evil/contacts/`,
    `${POD}/data/../outside/`,
    `${POD}/data/`,
    `${POD}/data/no-slash`,
    `${POD}/data/contacts/?metadata`,
    `${POD}/data/contacts/#metadata`,
    'https://evil.example/data/contacts/',
    'javascript:alert(1)',
  ])('drops out-of-container or non-container registration %s before egress', async (registration) => {
    const f = fixture({
      [REGISTRY]: links(REGISTRY, `${I}hasDataRegistration`, [registration]),
      [registration]: links(registration, `${I}registeredShapeTree`, [KNOWN_TREE]),
    });
    expect((await resolveClassTargets(CLASS, f.options)).targets).toEqual([]);
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([WEBID, SET, REGISTRY]);
  });

  it.each(UNSAFE_PATHS)('rejects unsafe discovery paths before fetching (%s)', async (path) => {
    const unsafe = `${POD}${path}`;
    for (const [parent, predicate, fetched] of [
      [WEBID, `${I}hasRegistrySet`, [WEBID]],
      [SET, `${I}hasDataRegistry`, [WEBID, SET]],
      [REGISTRY, `${I}hasDataRegistration`, [WEBID, SET, REGISTRY]],
    ] as const) {
      const f = fixture({ [parent]: links(parent, predicate, [unsafe]) });
      expect(await resolveClassTargets(CLASS, f.options)).toEqual({
        targets: [],
        truncated: false,
      });
      expect(f.fetch.mock.calls.map(([url]) => url)).toEqual(fetched);
    }
  });

  it.each([
    ...UNSAFE_PATHS,
    '/data/\\contacts/',
  ])('rejects unsafe final URLs from every authenticated discovery document (%s)', async (path) => {
    for (const redirected of [SET, REGISTRY, CONTACTS]) {
      const f = fixture();
      const result = await resolveClassTargets(CLASS, {
        ...f.options,
        fetch: async (url, authenticated) => ({
          ...(await f.fetch(url, authenticated)),
          url: url === redirected ? `${POD}${path}` : url,
        }),
      });
      expect(result.targets).toEqual([]);
      expect(f.fetch.mock.calls.at(-1)).toEqual([redirected, true]);
    }
  });

  it('does not authenticate or read a foreign registry set or registry', async () => {
    const foreignSet = 'https://evil.example/registries';
    const foreignRegistry = 'https://evil.example/data/';
    const f = fixture({
      [WEBID]: links(WEBID, `${I}hasRegistrySet`, [foreignSet, SET]),
      [SET]: links(SET, `${I}hasDataRegistry`, [foreignRegistry, REGISTRY]),
    });
    expect((await resolveClassTargets(CLASS, f.options)).targets).toEqual([saiTarget()]);
    expect(f.fetch.mock.calls.some(([url]) => url.startsWith('https://evil.example'))).toBe(false);
  });

  it('requires authenticatedOrigins for private discovery and allowedOrigins for targets', async () => {
    const f = fixture();
    expect(
      (await resolveClassTargets(CLASS, { ...f.options, authenticatedOrigins: undefined })).targets,
    ).toEqual([]);
    expect(f.fetch.mock.calls).toEqual([[WEBID, false]]);
    expect(
      (await resolveClassTargets(CLASS, { ...f.options, allowedOrigins: new Set() })).targets,
    ).toEqual([]);
  });

  it('uses only the linked subject and NamedNode HTTP(S) objects at every step', async () => {
    for (const [url, predicate] of [
      [WEBID, `${I}hasRegistrySet`],
      [SET, `${I}hasDataRegistry`],
      [REGISTRY, `${I}hasDataRegistration`],
      [CONTACTS, `${I}registeredShapeTree`],
    ]) {
      const f = fixture();
      const original = f.docs[url];
      f.docs[url] =
        original.replace(`<${url}>`, '<https://unrelated.example/subject>') +
        `\n<${url}> <${predicate}> "${KNOWN_TREE}", [], <urn:invalid> .`;
      expect((await resolveClassTargets(CLASS, f.options)).targets).toEqual([]);
    }
  });

  it('caps data registries at four across registry sets and reports truncation', async () => {
    const registries = Array.from({ length: 5 }, (_, n) => `${POD}/data-${n}/`);
    const secondSet = `${POD}/more-registries`;
    const f = fixture({
      [WEBID]: links(WEBID, `${I}hasRegistrySet`, [SET, secondSet]),
      [SET]: links(SET, `${I}hasDataRegistry`, registries.slice(0, 2)),
      [secondSet]: links(secondSet, `${I}hasDataRegistry`, registries.slice(2)),
    });
    for (const registry of registries) f.docs[registry] = '';
    expect(await resolveClassTargets(CLASS, f.options)).toEqual({ targets: [], truncated: true });
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      WEBID,
      SET,
      ...registries.slice(0, 2),
      secondSet,
      ...registries.slice(2, 4),
    ]);
  });

  it('caps registrations at 64 across all registries and reports truncation', async () => {
    const second = `${POD}/work/`;
    const f = fixture({ [SET]: links(SET, `${I}hasDataRegistry`, [REGISTRY, second]) });
    const registrations = [REGISTRY, second].flatMap((registry) => {
      const urls = Array.from({ length: 33 }, (_, n) => `${registry}${n}/`);
      f.docs[registry] = links(registry, `${I}hasDataRegistration`, urls);
      return urls;
    });
    for (const url of registrations)
      f.docs[url] = links(url, `${I}registeredShapeTree`, [KNOWN_TREE]);
    const result = await resolveClassTargets(CLASS, f.options);
    expect(result.truncated).toBe(true);
    expect(result.targets).toEqual(registrations.slice(0, 64).map(saiTarget));
    expect(f.fetch.mock.calls.some(([url]) => url === registrations[64])).toBe(false);
  });
});

describe('shape-tree class matching', () => {
  const inline = `<${TREE}> <${ST}shape> <#shape> .
    <#shape> a <${SH}NodeShape>; <${SH}targetClass> <${CLASS}> .`;

  it('matches a SHACL NodeShape and targetClass in the tree document, without reading members', async () => {
    const f = fixture({
      [CONTACTS]: links(CONTACTS, `${I}registeredShapeTree`, [TREE]),
      [TREE]: inline,
    });
    expect((await resolveClassTargets(CLASS, f.options)).targets).toEqual([saiTarget()]);
    expect(f.fetch.mock.calls).toHaveLength(5);
    expect(f.fetch.mock.calls.at(-1)).toEqual([TREE, false]);
  });

  it('reads an external SHACL shape document publicly', async () => {
    const shape = 'https://shapes.example/contacts#shape';
    const f = fixture({
      [CONTACTS]: links(CONTACTS, `${I}registeredShapeTree`, [TREE]),
      [TREE]: links(TREE, `${ST}shape`, [shape]),
      [shape]: `<${shape}> a <${SH}NodeShape>; <${SH}targetClass> <${CLASS}> .`,
    });
    expect((await resolveClassTargets(CLASS, f.options)).targets).toEqual([saiTarget()]);
    expect(f.fetch.mock.calls.at(-1)).toEqual([shape, false]);
  });

  it.each([
    '',
    'not turtle',
    `<${TREE}> <${ST}shape> <#shape> . <#shape> a <http://www.w3.org/ns/shex#Schema> .`,
    `<${TREE}> <${ST}shape> <#shape> . <#shape> <${SH}targetClass> <${CLASS}> .`,
    `<${TREE}> <${ST}shape> <#shape> . <#shape> a <${SH}NodeShape>; <${SH}targetClass> <https://classes.example/Other> .`,
    `<#other> <${ST}shape> <#shape> . <#shape> a <${SH}NodeShape>; <${SH}targetClass> <${CLASS}> .`,
    `<${TREE}> <${ST}shape> "https://shapes.example/s", [], <file:///s> .`,
  ])('does not guess from names or unrelated/unsupported shapes (%s)', async (tree) => {
    const f = fixture({
      [CONTACTS]: links(CONTACTS, `${I}registeredShapeTree`, [TREE]),
      [TREE]: tree,
    });
    expect((await resolveClassTargets(CLASS, f.options)).targets).toEqual([]);
  });

  it('does not match an unreachable tree', async () => {
    const f = fixture({ [CONTACTS]: links(CONTACTS, `${I}registeredShapeTree`, [TREE]) });
    expect((await resolveClassTargets(CLASS, f.options)).targets).toEqual([]);
  });

  it.each([
    false,
    true,
  ])('caps public tree/shape documents together at 16 (external shapes: %s)', async (external) => {
    const f = fixture();
    const urls = Array.from({ length: 17 }, (_, n) => `${REGISTRY}${n}/`);
    f.docs[REGISTRY] = links(REGISTRY, `${I}hasDataRegistration`, urls);
    for (const [n, url] of urls.entries()) {
      const tree = `https://trees.example/${n}#tree`;
      const shape = external ? `https://shapes.example/${n}#shape` : `${tree.split('#')[0]}#shape`;
      f.docs[url] = links(url, `${I}registeredShapeTree`, [tree]);
      f.docs[tree] =
        links(tree, `${ST}shape`, [shape]) +
        (external ? '' : `\n<${shape}> a <${SH}NodeShape>; <${SH}targetClass> <${CLASS}> .`);
      if (external)
        f.docs[shape] = `<${shape}> a <${SH}NodeShape>; <${SH}targetClass> <${CLASS}> .`;
    }
    const result = await resolveClassTargets(CLASS, f.options);
    expect(result.truncated).toBe(true);
    expect(result.targets).toEqual(urls.slice(0, external ? 8 : 16).map(saiTarget));
    expect(f.fetch.mock.calls.filter(([, authenticated]) => !authenticated)).toHaveLength(17);
  });
});

describe('the merged resolution ladder', () => {
  it('memoises final redirect URLs within each credential mode', async () => {
    const f = fixture();
    const fetch = memoiseResolveFetch(async (url, authenticated) => ({
      ...(await f.fetch(url, authenticated)),
      url: `${POD}/final`,
    }));
    await fetch(SET, true);
    expect((await fetch(`${POD}/final#shape`, false)).ok).toBe(false);
    expect((await fetch(`${POD}/final`, true)).ok).toBe(true);
    expect(f.fetch.mock.calls).toEqual([
      [SET, true],
      [`${POD}/final#shape`, false],
    ]);
  });

  it('an anonymous SAI shape failure cannot suppress an authenticated Type Index read', async () => {
    const index = `${POD}/private-index`;
    const tree = `${index}#tree`;
    const indexed = `${POD}/indexed/`;
    const f = fixture({
      [CONTACTS]: links(CONTACTS, `${I}registeredShapeTree`, [tree]),
      [index]: `<#r> <${SOLID}forClass> <${CLASS}>; <${SOLID}instanceContainer> <${indexed}> .`,
    });
    f.docs[WEBID] += links(WEBID, `${SOLID}privateTypeIndex`, [index]);
    // The shape read gets an anonymous 401; the same document is readable with credentials.
    f.fetch.mockImplementation(async (url, authenticated) => ({
      ok: url.split('#')[0] !== index || authenticated,
      text: f.docs[url] ?? '',
      url,
    }));
    expect(await resolveClassTargets(CLASS, f.options)).toEqual({
      targets: [{ ...saiTarget(indexed), source: 'type-index', sources: ['type-index'] }],
      truncated: false,
    });
    expect(f.fetch.mock.calls.slice(-2)).toEqual([
      [tree, false],
      [index, true],
    ]);
  });

  it('reads a shared SAI registry and public Type Index separately, without using private bytes', async () => {
    const publicTarget = `${POD}/public/`;
    const privateTarget = `${POD}/private/`;
    const f = fixture();
    f.docs[WEBID] += links(WEBID, `${SOLID}publicTypeIndex`, [REGISTRY]);
    f.docs[REGISTRY] +=
      `<#private> <${SOLID}forClass> <${CLASS}>; <${SOLID}instanceContainer> <${privateTarget}> .`;
    f.fetch.mockImplementation(async (url, authenticated) => ({
      ok: true,
      text:
        url === REGISTRY && !authenticated
          ? `<#public> <${SOLID}forClass> <${CLASS}>; <${SOLID}instanceContainer> <${publicTarget}> .`
          : (f.docs[url] ?? ''),
      url,
    }));
    expect(await resolveClassTargets(CLASS, f.options)).toEqual({
      targets: [
        saiTarget(),
        { ...saiTarget(publicTarget), source: 'type-index', sources: ['type-index'] },
      ],
      truncated: false,
    });
    expect(f.fetch.mock.calls.filter(([url]) => url === REGISTRY)).toEqual([
      [REGISTRY, true],
      [REGISTRY, false],
    ]);
  });

  it.each([
    false,
    true,
  ])('memoises concurrent reads, fragments and failures per credential mode (first: %s)', async (firstMode) => {
    const url = `${POD}/document`;
    const read = vi.fn(async (url: string, authenticated: boolean) => ({
      ok: authenticated,
      text: authenticated ? 'private bytes' : '',
      url,
    }));
    const fetch = memoiseResolveFetch(read);
    for (const mode of [firstMode, !firstMode]) {
      const bodies = await Promise.all([
        fetch(`${url}#one`, mode),
        fetch(`${url}#two`, mode),
        fetch(url, mode),
      ]);
      expect(bodies.map(({ ok, text }) => ({ ok, text }))).toEqual(
        Array.from({ length: 3 }, () => ({
          ok: mode,
          text: mode ? 'private bytes' : '',
        })),
      );
    }
    expect(read.mock.calls).toEqual([
      [`${url}#one`, firstMode],
      [`${url}#one`, !firstMode],
    ]);
  });

  it('memoises a shared SHACL tree across registrations and never matches a different class', async () => {
    const other = `${REGISTRY}other/`;
    const f = fixture({
      [REGISTRY]: links(REGISTRY, `${I}hasDataRegistration`, [CONTACTS, other]),
      [CONTACTS]: links(CONTACTS, `${I}registeredShapeTree`, [TREE]),
      [other]: links(other, `${I}registeredShapeTree`, [TREE]),
      [TREE]: `<${TREE}> <${ST}shape> <#shape> .
        <#shape> a <${SH}NodeShape>; <${SH}targetClass> <${CLASS}> .`,
    });
    expect(await resolveClassTargets(CLASS, f.options)).toEqual({
      targets: [saiTarget(), saiTarget(other)],
      truncated: false,
    });
    expect(f.fetch.mock.calls.filter(([url]) => url === TREE)).toHaveLength(1);
    expect((await resolveClassTargets('https://classes.example/Other', f.options)).targets).toEqual(
      [],
    );
  });

  it.each([
    WEBID,
    REGISTRY,
    CONTACTS,
    TREE,
  ])('skips a failed or unparseable document at %s', async (broken) => {
    for (const failure of ['throw', 'non-ok', 'parse']) {
      const f = fixture({
        [CONTACTS]: links(CONTACTS, `${I}registeredShapeTree`, [TREE]),
        [TREE]: `<${TREE}> <${ST}shape> <#shape> .
          <#shape> a <${SH}NodeShape>; <${SH}targetClass> <${CLASS}> .`,
      });
      const fetch = f.options.fetch;
      const result = await resolveClassTargets(CLASS, {
        ...f.options,
        fetch: async (url, auth) => {
          if (url === broken) {
            if (failure === 'throw') throw new Error('failed document');
            return { ok: failure === 'parse', text: 'invalid turtle', url };
          }
          return fetch(url, auth);
        },
      });
      expect(result).toEqual({ targets: [], truncated: false });
    }
  });

  it('runs SAI before Type Index, dedupes by kind and URL, and retains both sources', async () => {
    const index = `${POD}/index`;
    const f = fixture();
    f.docs[WEBID] += links(WEBID, `${SOLID}publicTypeIndex`, [index]);
    f.docs[index] = `<#r> <${SOLID}forClass> <${CLASS}>;
      <${SOLID}instanceContainer> <${CONTACTS}>, <${POD}/other/>;
      <${SOLID}instance> <${CONTACTS}> .`;
    const result = await resolveClassTargets(CLASS, f.options);
    expect(result).toEqual({
      targets: [
        { ...saiTarget(), sources: ['sai', 'type-index'] },
        { ...saiTarget(), kind: 'instance', source: 'type-index', sources: ['type-index'] },
        { ...saiTarget(`${POD}/other/`), source: 'type-index', sources: ['type-index'] },
      ],
      truncated: false,
    });
    expect(f.fetch.mock.calls.at(-1)).toEqual([index, false]);

    const pending = buildPendingConsent(
      'c',
      'https://app.example',
      WEBID,
      { classes: [CLASS], modes: ['read'], purpose: null, expiresAt: 100 },
      new Map([[CLASS, result]]),
      0,
      (() => {
        let n = 0;
        return () => `t${++n}`;
      })(),
    );
    const ids = pending.classes[0].targets.map((t) => t.id);
    const grants = consentDecisionToGrants(pending, { [CLASS]: ids }, () => 'g');
    expect(JSON.parse(JSON.stringify(grants?.[0].targets))).toEqual([
      { url: CONTACTS, kind: 'container' },
      { url: CONTACTS, kind: 'instance' },
      { url: `${POD}/other/`, kind: 'container' },
    ]);
  });

  it.each([
    'non-ok',
    'throw',
    'parse',
  ])('a failed document contributes nothing and does not defeat the other rung (%s)', async (failure) => {
    for (const broken of [SET, `${POD}/index`]) {
      const f = fixture();
      f.docs[WEBID] += links(WEBID, `${SOLID}publicTypeIndex`, [`${POD}/index`]);
      f.docs[`${POD}/index`] =
        `<#r> <${SOLID}forClass> <${CLASS}>; <${SOLID}instanceContainer> <${POD}/indexed/> .`;
      const fetch = f.options.fetch;
      const result = await resolveClassTargets(CLASS, {
        ...f.options,
        fetch: async (url, auth) => {
          if (url === broken) {
            if (failure === 'throw') throw new Error('unreachable');
            return { ok: failure === 'parse', text: 'invalid turtle', url };
          }
          return fetch(url, auth);
        },
      });
      expect(result.targets.map(({ url, kind }) => ({ url, kind }))).toEqual([
        { url: broken === SET ? `${POD}/indexed/` : CONTACTS, kind: 'container' },
      ]);
    }
  });

  it('memoises documents per credential mode across fragments, duplicate refs, rungs, and failed reads', async () => {
    const f = fixture();
    const tree2 = 'https://trees.example/contact#other';
    f.docs[WEBID] += links(WEBID, `${SOLID}publicTypeIndex`, [REGISTRY]);
    f.docs[SET] += links(SET, `${I}hasDataRegistry`, [REGISTRY]);
    f.docs[REGISTRY] += links(REGISTRY, `${I}hasDataRegistration`, [`${REGISTRY}other/`]);
    f.docs[CONTACTS] = links(CONTACTS, `${I}registeredShapeTree`, [TREE, tree2]);
    f.docs[`${REGISTRY}other/`] = links(`${REGISTRY}other/`, `${I}registeredShapeTree`, [TREE]);
    const result = await resolveClassTargets(CLASS, f.options);
    expect(result.targets).toEqual([]);
    const documentModes = f.fetch.mock.calls.map(([url, mode]) => `${mode} ${url.split('#')[0]}`);
    expect(new Set(documentModes).size).toBe(documentModes.length);
    expect(f.fetch.mock.calls.filter(([url]) => url === REGISTRY)).toEqual([
      [REGISTRY, true],
      [REGISTRY, false],
    ]);
    expect(
      f.fetch.mock.calls.filter(([url]) => url.startsWith('https://trees.example')),
    ).toHaveLength(1);
  });
});
