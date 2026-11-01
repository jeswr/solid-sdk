// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6.1-Sol
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
import { PIM_STORAGE_CLASS } from '../src/shared/storage-class';

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

describe('pim:Storage built-in resolution', () => {
  const origin = 'https://alice.pod.example';
  const storage = 'http://www.w3.org/ns/pim/space#storage';

  async function resolve(profile: string, profileUrl = WEBID, allowedOrigins = new Set([origin])) {
    const fetched: Array<{ url: string; authenticated: boolean }> = [];
    const targets = await resolveClassTargets(PIM_STORAGE_CLASS, {
      webId: WEBID,
      allowedOrigins,
      authenticatedOrigins: allowedOrigins,
      fetch: async (url, authenticated) => {
        fetched.push({ url, authenticated });
        return { ok: true, text: profile, url: profileUrl };
      },
    });
    // Even a profile advertising public/private indexes never causes an index fetch.
    expect(fetched).toEqual([{ url: WEBID, authenticated: false }]);
    return targets;
  }

  it('pins multiple normalised, deduplicated storage containers on the WebID subject', async () => {
    expect(
      await resolve(`${PROFILE}
        <${WEBID}> <${storage}> <https://ALICE.pod.example:443/pod/./?view=1#root>,
          <https://alice.pod.example/pod/>, <https://alice.pod.example/second/> .
        <#someone-else> <${storage}> <https://alice.pod.example/unrelated/> .`),
    ).toEqual([
      { url: `${origin}/pod/`, kind: 'container' },
      { url: `${origin}/second/`, kind: 'container' },
    ]);
  });

  it.each([
    '"https://alice.pod.example/pod/"',
    '[]',
    '<ftp://alice.pod.example/pod/>',
    '<urn:pod:root>',
    '<https://evil.example/pod/>',
    '<https://alice.pod.example/pod>',
    '<https://alice.pod.example/pod?path=/>',
    '<https://[invalid]/>',
  ])('drops an unsafe or non-container storage value: %s', async (object) => {
    expect(await resolve(`<${WEBID}> <${storage}> ${object} .`)).toEqual([]);
  });

  it('accepts HTTP containers only when their origin is allowed', async () => {
    const profile = `<${WEBID}> <${storage}> <http://localhost:3000/alice/> .`;
    expect(await resolve(profile)).toEqual([]);
    expect(await resolve(profile, WEBID, new Set(['http://localhost:3000']))).toEqual([
      { url: 'http://localhost:3000/alice/', kind: 'container' },
    ]);
    expect(await resolve(profile, WEBID, new Set())).toEqual([]);
  });

  it("keeps the resolver's optional origin filter and normalises a bare origin to its root container", async () => {
    expect(
      await resolveClassTargets(PIM_STORAGE_CLASS, {
        webId: WEBID,
        fetch: async (url) => ({
          ok: true,
          url,
          text: `<${WEBID}> <${storage}> <https://alice.pod.example> .`,
        }),
      }),
    ).toEqual([{ url: `${origin}/`, kind: 'container' }]);
  });

  it('uses the final profile URL as base while matching the original WebID', async () => {
    const profile = `<${WEBID}> <${storage}> <../../pod/> .
      <#me> <${storage}> <../../other/> .`;
    const finalUrl = 'https://redirect.example/profiles/alice/card#redirected';
    expect(await resolve(profile, finalUrl, new Set(['https://redirect.example']))).toEqual([
      { url: 'https://redirect.example/pod/', kind: 'container' },
    ]);
    expect(await resolve(profile, finalUrl)).toEqual([]);
  });

  it.each([
    PROFILE,
    'not valid Turtle',
  ])('returns no targets without usable storage (%#)', async (profile) => {
    expect(await resolve(profile)).toEqual([]);
  });

  it.each([
    'non-ok',
    'throw',
  ])('fails closed when the profile fetch fails (%s)', async (failure) => {
    expect(
      await resolveClassTargets(PIM_STORAGE_CLASS, {
        webId: WEBID,
        fetch: async (url) => {
          if (failure === 'throw') throw new Error('offline');
          return { ok: false, text: '', url };
        },
      }),
    ).toEqual([]);
  });

  it('resolves a mixed request independently, using the Type Index only for the ordinary class', async () => {
    const fetched: string[] = [];
    const results = [];
    for (const classIRI of [PIM_STORAGE_CLASS, FINANCE]) {
      results.push(
        await resolveClassTargets(classIRI, {
          webId: WEBID,
          allowedOrigins: new Set([origin]),
          fetch: async (url, authenticated) => {
            expect(authenticated).toBe(false);
            fetched.push(url);
            return {
              ok: true,
              url,
              text: url === WEBID ? `${PROFILE}<${WEBID}> <${storage}> </pod/> .` : PUBLIC_INDEX,
            };
          },
        }),
      );
    }
    expect(results).toEqual([
      [{ url: `${origin}/pod/`, kind: 'container' }],
      [
        { url: `${origin}/finance/summary.ttl`, kind: 'instance' },
        { url: `${origin}/finance/`, kind: 'container' },
      ],
    ]);
    expect(fetched).toEqual([WEBID, WEBID, `${origin}/settings/publicTypeIndex.ttl`]);
  });
});
