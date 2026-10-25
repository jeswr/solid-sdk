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
      'https://alice.pod.example/settings/publicTypeIndex.ttl',
      'https://alice.pod.example/settings/privateTypeIndex.ttl',
    ]);
  });
  it('is empty for a profile with no type index', () => {
    expect(parseTypeIndexRefs(WEBID, '<x> <y> <z> .')).toEqual([]);
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
      return text === undefined ? { ok: false, text: '' } : { ok: true, text };
    };
  }

  it('walks profile → indexes → unions targets', async () => {
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: fetcher({
        [WEBID]: PROFILE,
        'https://alice.pod.example/settings/publicTypeIndex.ttl': PUBLIC_INDEX,
        // private index unreachable (returns non-ok) — degrades gracefully.
      }),
      allowedOrigins: new Set(['https://alice.pod.example']),
    });
    expect(targets).toEqual([
      { url: 'https://alice.pod.example/finance/summary.ttl', kind: 'instance' },
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ]);
  });

  it('does NOT fetch a type-index ref on a FOREIGN origin when confined (SSRF guard)', async () => {
    const evilProfile = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${WEBID}> solid:publicTypeIndex <https://evil.example/index.ttl> .`;
    const fetched: string[] = [];
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: async (url: string) => {
        fetched.push(url);
        return url === WEBID ? { ok: true, text: evilProfile } : { ok: true, text: PUBLIC_INDEX };
      },
      allowedOrigins: new Set(['https://alice.pod.example']),
    });
    expect(targets).toEqual([]);
    // The foreign index URL was NEVER fetched (only the profile was).
    expect(fetched).toEqual([WEBID]);
  });

  it('returns [] when the profile is unreachable (fail-closed, never throws)', async () => {
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: fetcher({}),
    });
    expect(targets).toEqual([]);
  });

  it('dedupes targets across the public + private indexes', async () => {
    const targets = await resolveClassTargets(FINANCE, {
      webId: WEBID,
      fetch: fetcher({
        [WEBID]: PROFILE,
        'https://alice.pod.example/settings/publicTypeIndex.ttl': PUBLIC_INDEX,
        'https://alice.pod.example/settings/privateTypeIndex.ttl': PUBLIC_INDEX,
      }),
    });
    // Same registrations in both indexes → one entry each.
    expect(targets).toEqual([
      { url: 'https://alice.pod.example/finance/summary.ttl', kind: 'instance' },
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ]);
  });
});
