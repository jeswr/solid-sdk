// AUTHORED-BY Codex GPT-6
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
import { readFormFillData } from '../src/background/core/formfill-data';
import { parseWebIdProfile } from '../src/background/core/webid';
import { loadFormFillData } from '../src/background/formfill-data-loader';

const webId = 'https://pod.example/profile/card#me';
const solid = 'http://www.w3.org/ns/solid/terms#';
const vcard = 'http://www.w3.org/2006/vcard/ns#';
const foaf = 'http://xmlns.com/foaf/0.1/';
afterEach(() => vi.restoreAllMocks());

describe('shared RDF parsing', () => {
  it('rejects malformed whole documents before exposing otherwise valid fields or targets', () => {
    const malformed = `<${webId}> <${vcard}fn> "Alex" ; <${solid}publicTypeIndex> <index> . not turtle .`;
    expect(() => parseWebIdProfile(webId, malformed)).toThrow();
    expect(() => parseTypeIndexRefs(webId, malformed)).toThrow();
    expect(() => parseTargetsForClass(webId, malformed, 'https://schema.org/Person')).toThrow();
    expect(() => readFormFillData(webId, malformed, webId)).toThrow();
  });

  it('retains lexical profile fallbacks and foaf precedence around strict typed accessors', () => {
    const profile = parseWebIdProfile(
      webId,
      `<${webId}>
      <${foaf}name> <#name> ; <${vcard}fn> "Fallback" ;
      <${foaf}img> "legacy-photo" ; <${vcard}hasPhoto> <#photo> ;
      <${solid}oidcIssuer> "bad", <https://issuer.example/>, _:bad .`,
    );
    expect(profile).toEqual({
      name: 'https://pod.example/profile/card#name',
      photoUrl: 'legacy-photo',
      issuers: ['https://issuer.example/'],
    });
    expect(parseWebIdProfile(webId, `<${webId}> <${foaf}name> "First", "Second" .`).name).toBe(
      'First',
    );
  });

  it('still rejects JSON-LD in Turtle-only formfill readers', async () => {
    const text = JSON.stringify({ '@context': { fn: `${vcard}fn` }, '@id': webId, fn: 'Alex' });
    expect(() => readFormFillData(webId, text, webId)).toThrow();
    const fetch = vi.fn(async () => ({
      ok: true,
      text,
      url: webId,
      contentType: 'application/ld+json',
    }));
    await expect(
      loadFormFillData(webId, new Set(['https://pod.example']), fetch),
    ).rejects.toThrow();
    expect(fetch.mock.calls).toEqual([[webId, false]]);
  });

  it('propagates malformed linked formfill RDF and keeps one-hop credential choices', async () => {
    const fetch = vi.fn(async (url: string, _authenticated: boolean) => ({
      ok: true,
      url,
      text:
        url === webId
          ? `<${webId}> <${vcard}hasAddress> <https://pod.example/address> .`
          : 'not turtle .',
    }));
    await expect(
      loadFormFillData(webId, new Set(['https://pod.example']), fetch),
    ).rejects.toThrow();
    expect(fetch.mock.calls).toEqual([
      [webId, false],
      ['https://pod.example/address', true],
    ]);
  });

  it('accepts exactly 1 MiB of UTF-8 and rejects the next byte through the shared parser', () => {
    const budget = new ResolutionBudget();
    try {
      const text = `#${'é'.repeat((RESOLUTION_LIMITS.bytes - 2) / 2)}\n`;
      expect(new TextEncoder().encode(text)).toHaveLength(RESOLUTION_LIMITS.bytes);
      expect(budget.parse(webId, text).size).toBe(0);
      expect(() => budget.parse(webId, `${text} `)).toThrow();
      expect(budget.truncated).toBe(true);
    } finally {
      budget.dispose();
    }
  });

  it('counts duplicate triples before deduplication and accepts the exact 50,000 limit', () => {
    const budget = new ResolutionBudget();
    try {
      const text = '<a> <b> <c>.'.repeat(RESOLUTION_LIMITS.quads);
      expect(budget.parse(webId, text).size).toBe(1);
      expect(() => budget.parse(webId, `${text}<a> <b> <c>.`)).toThrow();
      expect(budget.truncated).toBe(true);
    } finally {
      budget.dispose();
    }
  });

  it('does not return a cached parsed document after parent cancellation', () => {
    const parent = new AbortController();
    const budget = new ResolutionBudget(parent.signal);
    try {
      expect(budget.parse(webId, '<a> <b> <c>.').size).toBe(1);
      parent.abort();
      expect(() => budget.parse(webId, '<a> <b> <c>.')).toThrow();
      expect(budget.truncated).toBe(false);
    } finally {
      budget.dispose();
    }
  });

  it('drops malformed SAI documents without following their links or blocking the type index', async () => {
    const interop = 'http://www.w3.org/ns/solid/interop#';
    const fetch = vi.fn(async (url: string, _authenticated: boolean) => ({
      ok: true,
      url,
      text:
        url === webId
          ? `<${webId}> <${interop}hasRegistrySet> <https://pod.example/set> ; <${solid}publicTypeIndex> <https://pod.example/index> .`
          : url.endsWith('/set')
            ? `<${url}> <${interop}hasDataRegistry> <https://pod.example/must-not-read/> . not turtle .`
            : `<#reg> <${solid}forClass> <https://schema.org/Person> ; <${solid}instanceContainer> <https://pod.example/people/> .`,
    }));
    expect(
      await resolveClassTargets('https://schema.org/Person', {
        webId,
        fetch,
        authenticatedOrigins: new Set(['https://pod.example']),
      }),
    ).toMatchObject({
      targets: [{ url: 'https://pod.example/people/', source: 'type-index' }],
      truncated: false,
    });
    expect(fetch.mock.calls).toEqual([
      [webId, false],
      ['https://pod.example/set', true],
      ['https://pod.example/index', false],
    ]);
  });
});
