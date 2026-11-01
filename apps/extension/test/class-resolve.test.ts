// AUTHORED-BY Claude Opus 4.8
//
// Unit tests for the data-class → target resolver (design §2.3, Type-Index rung). Pure parse
// helpers run against Turtle fixtures; the network walk runs against an injected fetch. Proves
// the fail-closed dropping of foreign-origin / non-NamedNode / non-http targets and that an
// unregistered class resolves to NOTHING (which the gate then denies).

import { describe, expect, it } from 'vitest';
import {
  parseTargetsForClass,
  parseTypeIndexRefs,
  resolveClassTargets,
} from '../src/background/core/class-resolve';

const WEBID = 'https://alice.pod.example/profile/card#me';
const FINANCE = 'https://w3id.org/jeswr/sectors/finance#Transaction';

const PROFILE = `
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
<https://alice.pod.example/profile/card#me>
  solid:publicTypeIndex <https://alice.pod.example/settings/publicTypeIndex.ttl> ;
  solid:privateTypeIndex <https://alice.pod.example/settings/privateTypeIndex.ttl> .
`;

const PUBLIC_INDEX = `
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix fin: <https://w3id.org/jeswr/sectors/finance#> .
<#fin> a solid:TypeRegistration ;
  solid:forClass fin:Transaction ;
  solid:instanceContainer <https://alice.pod.example/finance/> ;
  solid:instance <https://alice.pod.example/finance/summary.ttl> .
<#other> a solid:TypeRegistration ;
  solid:forClass <https://example.org/Other> ;
  solid:instanceContainer <https://alice.pod.example/other/> .
`;

describe('parseTypeIndexRefs', () => {
  it('returns the public + private type-index URLs on the WebID subject', () => {
    expect(parseTypeIndexRefs(WEBID, PROFILE)).toEqual([
      { url: 'https://alice.pod.example/settings/publicTypeIndex.ttl', authenticated: false },
      { url: 'https://alice.pod.example/settings/privateTypeIndex.ttl', authenticated: true },
    ]);
  });
  it('is empty for a profile with no type index', () => {
    expect(parseTypeIndexRefs(WEBID, '<x> <y> <z> .')).toEqual([]);
  });
  it('keeps a public index credential-free when it is also advertised as private', () => {
    expect(
      parseTypeIndexRefs(
        WEBID,
        `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <https://pod.example/index> ;
          <http://www.w3.org/ns/solid/terms#publicTypeIndex> <https://pod.example/index> .`,
      ),
    ).toEqual([{ url: 'https://pod.example/index', authenticated: false }]);
  });
});

describe('parseTargetsForClass', () => {
  it('collects instance + instanceContainer for the matching class only', () => {
    const targets = parseTargetsForClass(
      'https://alice.pod.example/settings/publicTypeIndex.ttl',
      PUBLIC_INDEX,
      FINANCE,
    );
    expect(targets).toEqual([
      { url: 'https://alice.pod.example/finance/summary.ttl', kind: 'instance' },
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ]);
  });
  it('returns NOTHING for an unregistered class', () => {
    expect(
      parseTargetsForClass(
        'https://alice.pod.example/settings/publicTypeIndex.ttl',
        PUBLIC_INDEX,
        'https://x/Nope',
      ),
    ).toEqual([]);
  });
  it('drops a target on a foreign origin when confined to allowedOrigins', () => {
    const evilIndex = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <#fin> a solid:TypeRegistration ;
        solid:forClass <${FINANCE}> ;
        solid:instanceContainer <https://evil.example/exfil/> .`;
    const confined = parseTargetsForClass(
      'https://alice.pod.example/settings/publicTypeIndex.ttl',
      evilIndex,
      FINANCE,
      new Set(['https://alice.pod.example']),
    );
    expect(confined).toEqual([]);
  });
});

describe('resolveClassTargets — the walk', () => {
  function fetcher(docs: Record<string, string>) {
    return async (url: string) => {
      const text = docs[url];
      return text === undefined ? { ok: false, text: '', url } : { ok: true, text, url };
    };
  }

  it('walks profile → indexes → unions targets', async () => {
    const fetched: Array<{ url: string; authenticated: boolean }> = [];
    const documents = fetcher({
      [WEBID]: PROFILE,
      'https://alice.pod.example/settings/publicTypeIndex.ttl': PUBLIC_INDEX,
      // Private index unreachable (returns non-ok) — degrades gracefully.
    });
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: async (url, authenticated) => {
        fetched.push({ url, authenticated });
        return documents(url);
      },
      authenticatedOrigins: new Set(['https://alice.pod.example']),
      allowedOrigins: new Set(['https://alice.pod.example']),
    });
    expect(targets).toEqual([
      { url: 'https://alice.pod.example/finance/summary.ttl', kind: 'instance' },
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ]);
    expect(fetched).toEqual([
      { url: WEBID, authenticated: false },
      { url: 'https://alice.pod.example/settings/publicTypeIndex.ttl', authenticated: false },
      { url: 'https://alice.pod.example/settings/privateTypeIndex.ttl', authenticated: true },
    ]);
  });

  it('fetches foreign public indexes without credentials while confining targets', async () => {
    const profile = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${WEBID}> solid:publicTypeIndex <http://public.example/index.ttl> ;
        solid:privateTypeIndex <https://evil.example/private.ttl> .`;
    const fetched: Array<{ url: string; authenticated: boolean }> = [];
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: async (url, authenticated) => {
        fetched.push({ url, authenticated });
        return { ok: true, text: url === WEBID ? profile : PUBLIC_INDEX, url };
      },
      authenticatedOrigins: new Set(['https://alice.pod.example']),
      allowedOrigins: new Set(['https://alice.pod.example']),
    });
    expect(targets).toEqual([
      { url: 'https://alice.pod.example/finance/summary.ttl', kind: 'instance' },
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ]);
    expect(fetched).toEqual([
      { url: WEBID, authenticated: false },
      { url: 'http://public.example/index.ttl', authenticated: false },
    ]);
  });

  it('returns [] when the profile is unreachable (fail-closed, never throws)', async () => {
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: fetcher({}),
    });
    expect(targets).toEqual([]);
  });

  it('uses the final profile base for refs and private-origin checks while matching the original WebID', async () => {
    const fetched: Array<{ url: string; authenticated: boolean }> = [];
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: async (url, authenticated) => {
        fetched.push({ url, authenticated });
        return url === WEBID
          ? {
              ok: true,
              url: 'https://public.example/profiles/alice/#redirected',
              text: `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
                <${WEBID}> solid:publicTypeIndex <../../index.ttl> ;
                  solid:privateTypeIndex <../../private.ttl> .
                <#me> solid:publicTypeIndex <../../other.ttl> .`,
            }
          : { ok: true, text: PUBLIC_INDEX, url };
      },
      authenticatedOrigins: new Set(['https://alice.pod.example']),
      allowedOrigins: new Set(['https://alice.pod.example']),
    });
    expect(targets).toEqual([
      { url: 'https://alice.pod.example/finance/summary.ttl', kind: 'instance' },
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ]);
    expect(fetched).toEqual([
      { url: WEBID, authenticated: false },
      { url: 'https://public.example/index.ttl', authenticated: false },
    ]);
  });

  it.each([
    'https://alice.pod.example',
    'https://public.example',
  ])('filters redirected relative targets against allowedOrigins (%s)', async (allowedOrigin) => {
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: async (url) =>
        url === WEBID
          ? { ok: true, text: PROFILE, url }
          : {
              ok: true,
              url: 'https://public.example/settings/index/#redirected',
              text: `<#r> <http://www.w3.org/ns/solid/terms#forClass> <${FINANCE}> ;
                <http://www.w3.org/ns/solid/terms#instanceContainer> <finance/> .`,
            },
      allowedOrigins: new Set([allowedOrigin]),
    });
    expect(targets).toEqual(
      allowedOrigin === 'https://public.example'
        ? [{ url: 'https://public.example/settings/index/finance/', kind: 'container' }]
        : [],
    );
  });

  it('dedupes targets across the public + private indexes', async () => {
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: fetcher({
        [WEBID]: PROFILE,
        'https://alice.pod.example/settings/publicTypeIndex.ttl': PUBLIC_INDEX,
        'https://alice.pod.example/settings/privateTypeIndex.ttl': PUBLIC_INDEX,
      }),
      authenticatedOrigins: new Set(['https://alice.pod.example']),
    });
    // Same registrations in both indexes → one entry each.
    expect(targets).toEqual([
      { url: 'https://alice.pod.example/finance/summary.ttl', kind: 'instance' },
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ]);
  });
});
