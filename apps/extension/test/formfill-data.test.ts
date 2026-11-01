// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFormFillData } from '../src/background/core/formfill-data';
import { baseUrl, schemaTurtle, vcardTurtle, webId } from './fixtures/formfill-data';

const prefixes = `@prefix v: <http://www.w3.org/2006/vcard/ns#>. @prefix s: <https://schema.org/>.`;
const read = (turtle: string) => readFormFillData(webId, `${prefixes} ${turtle}`, baseUrl);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readFormFillData', () => {
  it('parses a profile with 20,000 short email IRIs in under 1.5 seconds', () => {
    const emails = Array.from(
      { length: 20_000 },
      (_, index) => `<mailto:user${index}@example.test>`,
    ).join(', ');
    const turtle = `<${webId}> v:hasEmail ${emails}.`;
    const start = performance.now();
    const data = read(turtle);
    const elapsed = performance.now() - start;
    expect(data.contact.email).toBe('user0@example.test');
    expect(elapsed).toBeLessThan(1500);
  });

  it.each([
    ['mailto:alice%2Btag@example.com', 'alice+tag@example.com'],
    ['MAILTO:alice%2btag@example.test', 'alice+tag@example.test'],
    ['mailto:alice+tag@example.test', 'alice+tag@example.test'],
    ['mailto:alice%25tag@example.test', 'alice%tag@example.test'],
    ['mailto:alice%252Btag@example.test', 'alice%2Btag@example.test'],
    ['mailto:alice%3Ftag@example.test', 'alice?tag@example.test'],
    ['mailto:alice%23tag@example.test', 'alice#tag@example.test'],
    ['alice%2Btag@example.test', 'alice%2Btag@example.test'],
    ['alice%tag@example.test', 'alice%tag@example.test'],
  ])('decodes mailto addresses once and preserves percent signs in plain literals: %s', (value, expected) => {
    const objects = [JSON.stringify(value)];
    if (value.toLowerCase().startsWith('mailto:')) objects.push(`<${value}>`);
    for (const object of objects) {
      for (const body of [
        `v:hasEmail ${object}`,
        `s:email ${object}`,
        `v:hasEmail [ v:hasValue ${object} ]`,
        `v:hasEmail [ v:value ${object} ]`,
      ]) {
        expect(read(`<${webId}> ${body}.`).contact.email).toBe(expected);
      }
    }
  });

  it.each([
    'javascript:alert(1)',
    'javascript:alice@example.test',
    'https://alice@example.test',
    'tel:alice@example.test',
    'alice',
    'alice@@example.test',
    'alice@example..test',
    'alice@-example.test',
    '.alice@example.test',
    'alice..smith@example.test',
    'Alice <alice@example.test>',
    'alice@example.test,other@example.test',
    'mailto:alice@example.test?subject=Hello',
    'mailto:alice?tag@example.test',
    'mailto:alice#tag@example.test',
    'mailto:alice%tag@example.test',
    'mailto:alice%2@example.test',
    'mailto:alice%GG@example.test',
    'mailto:alice%FF@example.test',
    'mailto:alice%20tag@example.test',
    'mailto:alice@example.test%0A',
    'mailto:alice%0D%0ABcc%3Aother@example.test',
    'mailto:alice@example.test%2Cother@example.test',
    'mailto:mailto:alice@example.test',
    'alice@example.test\nBcc:other@example.test',
  ])('drops invalid email literals from vCard, schema.org and structured nodes: %s', (value) => {
    for (const body of [
      `v:hasEmail ${JSON.stringify(value)}`,
      `s:email ${JSON.stringify(value)}`,
      `v:hasEmail [ v:hasValue ${JSON.stringify(value)} ]`,
      `v:hasEmail [ v:value ${JSON.stringify(value)} ]`,
    ]) {
      expect(read(`<${webId}> ${body}.`).contact.email).toBeNull();
    }
  });

  it.each([
    'javascript:alert(1)',
    'https://12345',
    'mailto:12345',
    '+44 CALL ME',
    '+123;ext=45',
    '+123/45',
    '--- () + .',
    '+123\n456',
    '+123\t456',
  ])('drops invalid telephone literals from vCard, schema.org and structured nodes: %s', (value) => {
    for (const body of [
      `v:hasTelephone ${JSON.stringify(value)}`,
      `s:telephone ${JSON.stringify(value)}`,
      `v:hasTelephone [ v:hasValue ${JSON.stringify(value)} ]`,
      `v:hasTelephone [ v:value ${JSON.stringify(value)} ]`,
    ]) {
      expect(read(`<${webId}> ${body}.`).contact.tel).toBeNull();
    }
  });

  it('drops invalid communication IRIs and continues to valid fallback values', () => {
    const data = read(`<${webId}>
      v:hasEmail [ v:pref 1; v:hasValue "javascript:alert(1)" ], <mailto:bad@@example.test>;
      s:email "MAILTO:alice.smith+tag@example.test";
      v:hasTelephone <tel:CALL-ME>, "https://12345"; s:telephone "TEL:+44 (0)20-1234.5678".`);
    expect(data.contact.email).toBe('alice.smith+tag@example.test');
    expect(data.contact.tel).toBe('+44 (0)20-1234.5678');
  });

  it('drops oversized strings from every contact and address property', () => {
    const oversized = 'a'.repeat(257);
    const data = read(`<${webId}> v:fn "${'a'.repeat(1_000_000)}";
      v:given-name "${oversized}"; v:family-name "${oversized}";
      v:organization-name "${oversized}"; v:hasEmail "${oversized}@example.test";
      v:hasTelephone "${'1'.repeat(257)}";
      v:hasAddress [ v:street-address "${oversized}"; v:extended-address "${oversized}";
        v:locality "${oversized}"; v:region "${oversized}"; v:postal-code "${oversized}";
        v:country-name "${oversized}" ].`);
    expect(Object.values(data.contact).map((value) => value?.length ?? null)).toEqual(
      Array(6).fill(null),
    );
    expect(Object.values(data.address).map((value) => value?.length ?? null)).toEqual(
      Array(6).fill(null),
    );
  });

  it('accepts 256 characters and falls back past oversized literals, IRIs and structured values', () => {
    const boundary = 'x'.repeat(256);
    const oversized = 'x'.repeat(257);
    const data = read(`<${webId}> v:fn "${oversized}", "${boundary}";
      v:hasName [ v:given-name "${oversized}" ]; s:givenName "Fallback";
      v:hasOrganization [ v:organization-name "${oversized}" ];
      v:hasEmail <mailto:${oversized}@example.test>; s:email "fallback@example.test";
      v:hasTelephone <tel:${'1'.repeat(257)}>; s:telephone "${'1'.repeat(256)}";
      v:hasAddress [ v:street-address "${oversized}" ];
      s:address [ s:streetAddress "${boundary}"; s:postalCode "${oversized}" ].`);
    expect(data.contact).toMatchObject({
      name: boundary,
      givenName: 'Fallback',
      organization: null,
      email: 'fallback@example.test',
      tel: '1'.repeat(256),
    });
    expect(data.address).toMatchObject({ streetAddress: boundary, postalCode: null });
  });

  it('reads vCard values, resolves relative links against the supplied document and honors preference then document order', () => {
    const fetch = vi.fn(() => {
      throw new Error('network is forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    expect(readFormFillData(webId, vcardTurtle, baseUrl)).toEqual({
      contact: {
        name: 'Alice Example',
        givenName: 'Alice',
        familyName: 'Example',
        email: 'preferred@example.test',
        tel: '+441234567890',
        organization: 'Example Ltd',
      },
      address: {
        streetAddress: '12 River Road',
        extendedAddress: 'Flat 3',
        locality: 'Oxford',
        region: 'Oxfordshire',
        postalCode: 'OX1 1AA',
        countryName: 'United Kingdom',
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads schema.org PostalAddress and scalar fallback values', () => {
    expect(readFormFillData(webId, schemaTurtle, baseUrl)).toEqual({
      contact: {
        name: 'Bob Builder',
        givenName: 'Bob',
        familyName: 'Builder',
        email: 'bob@example.test',
        tel: '+12025550123',
        organization: null,
      },
      address: {
        streetAddress: '1 Main Street',
        extendedAddress: null,
        locality: 'Springfield',
        region: 'IL',
        postalCode: '62701',
        countryName: 'US',
      },
    });
  });

  it('supports HTTPS schema.org predicates and per-property vCard precedence', () => {
    const data = read(`<${webId}> v:fn "VC Name"; s:name "Schema Name"; v:given-name "VC Given";
      s:givenName "Schema Given"; s:familyName "Schema Family"; s:email "plain@example.test";
      s:telephone <tel:+123>; s:address [ s:streetAddress "Schema Street"; s:postalCode "12345" ];
      v:hasAddress [ v:street-address "VC Street" ].`);
    expect(data.contact).toEqual({
      name: 'VC Name',
      givenName: 'VC Given',
      familyName: 'Schema Family',
      email: 'plain@example.test',
      tel: '+123',
      organization: null,
    });
    expect(data.address).toMatchObject({ streetAddress: 'VC Street', postalCode: '12345' });
  });

  it('supports structured vCard names and organizations without reading unrelated subjects', () => {
    const data = read(`<${webId}> v:hasName [ v:given-name "  Ada  "; v:family-name "Lovelace" ];
      v:hasOrganization [ v:organization-name "Analytical Engines" ].
      <https://other.example/me> v:fn "Unrelated Name"; v:hasAddress [ v:locality "Elsewhere" ].`);
    expect(data.contact).toMatchObject({
      name: null,
      givenName: 'Ada',
      familyName: 'Lovelace',
      organization: 'Analytical Engines',
    });
    expect(data.address.locality).toBeNull();
  });

  it('takes the first unpreferred value and the first address as a unit', () => {
    const data =
      read(`<${webId}> v:hasEmail <mailto:first@example.test>, <mailto:later@example.test>;
      v:hasTelephone "12345", "67890";
      v:hasAddress [ v:locality "First" ], [ v:street-address "Second street"; v:locality "Second" ].`);
    expect(data.contact.email).toBe('first@example.test');
    expect(data.contact.tel).toBe('12345');
    expect(data.address.locality).toBe('First');
    expect(data.address.streetAddress).toBeNull();
  });

  it('keeps property document order even when later values were already mentioned elsewhere', () => {
    const data = read(`<#later> v:hasValue <mailto:later@example.test>.
      <#other> v:fn "Later Name".
      <${webId}> v:hasEmail <#first>, <#later>; v:fn "First Name", "Later Name".
      <#first> v:hasValue <mailto:first@example.test>.`);
    expect(data.contact.email).toBe('first@example.test');
    expect(data.contact.name).toBe('First Name');
  });

  it('reads legacy Solid address-book vcard:value nodes', () => {
    const data = read(`<${webId}> v:hasEmail [ v:value <mailto:alice@example.test> ];
      v:hasTelephone [ v:value <tel:+441234567890> ].`);
    expect(data.contact.email).toBe('alice@example.test');
    expect(data.contact.tel).toBe('+441234567890');
  });

  it('ignores invalid preferences and treats the lowest positive numeric preference as preferred', () => {
    const data = read(`<${webId}> v:hasEmail
      [ v:pref false, 0, -1, "nonsense"; v:hasValue <mailto:not-preferred@example.test> ],
      [ v:pref 4, 2; v:hasValue <mailto:rank-two@example.test> ],
      [ v:pref 3; v:hasValue <mailto:rank-three@example.test> ].`);
    expect(data.contact.email).toBe('rank-two@example.test');
  });

  it('skips empty, resource-valued text and malformed communication nodes rather than filling node IDs', () => {
    const data = read(`<${webId}> v:fn <https://example.test/not-a-name>, "  ", "Valid";
      v:hasName "not-a-node"; v:hasOrganization "not-a-node"; v:hasAddress "not-a-node";
      v:hasEmail [], <https://example.test/not-an-email>, <mailto:>, "", "mailto:",
        [ v:hasValue [] ], "MAILTO:valid@example.test";
      v:hasTelephone [], <https://example.test/not-a-phone>, "tel:", "  ", "tel:+123".`);
    expect(data.contact).toMatchObject({
      name: 'Valid',
      email: 'valid@example.test',
      tel: '+123',
      givenName: null,
      organization: null,
    });
    expect(Object.values(data.address).every((value) => value === null)).toBe(true);
  });

  it('falls back from unusable vCard communication nodes to schema scalars', () => {
    const data = read(`<${webId}> v:hasEmail [ v:hasValue "" ]; s:email "schema@example.test";
      v:hasTelephone [ v:hasValue <https://example.test/> ]; s:telephone "+321".`);
    expect(data.contact.email).toBe('schema@example.test');
    expect(data.contact.tel).toBe('+321');
  });

  it('returns explicit nulls for absent data and never searches for another person', () => {
    for (const turtle of [
      '',
      '<https://other.example/me> v:fn "Other"; s:email "other@example.test".',
    ]) {
      const data = read(turtle);
      expect(Object.values(data.contact)).toEqual(Array(6).fill(null));
      expect(Object.values(data.address)).toEqual(Array(6).fill(null));
    }
  });

  it('handles full IRIs, a different document base and escaped Turtle literals', () => {
    const data = readFormFillData(
      webId,
      `<${webId}> <http://www.w3.org/2006/vcard/ns#fn> "Alice \\"Ace\\" Example";
      <http://www.w3.org/2006/vcard/ns#hasAddress> <#a>.
      <#a> <http://www.w3.org/2006/vcard/ns#street-address> "1 Main Road\\nBuilding A".`,
      'https://pod.example/different/address-book.ttl',
    );
    expect(data.contact.name).toBe('Alice "Ace" Example');
    expect(data.address.streetAddress).toBe('1 Main Road\nBuilding A');
  });

  it('throws for malformed Turtle so callers cannot fill from a partial parse', () => {
    expect(() => read(`<${webId}> v:fn "Alice";`)).toThrow();
  });
});
