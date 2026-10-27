// AUTHORED-BY GPT-6.1-Sol (Codex)
import { describe, expect, it } from 'vitest';
import {
  canonicalOrigin,
  liveOriginGrant,
  type OriginGrant,
  OriginGrantStore,
  sanitiseOriginGrants,
} from '../src/background/core/origin-grant';
import { fixtureGrant } from './profile-fixtures';

const grant = (extra: Partial<OriginGrant> = {}): OriginGrant => ({
  origin: 'https://app.example',
  profileId: '1',
  createdAt: 10,
  scope: { pods: ['https://pod.example'] },
  ...extra,
});

describe('origin authority fails closed', () => {
  it.each([
    null,
    1,
    '',
    'broken',
    'file:///tmp/x',
    'https://app.example/path',
    'https://APP.example',
    'https://app.example/',
  ])('rejects noncanonical anchor %s', (raw) => {
    expect(canonicalOrigin(raw)).toBeNull();
  });
  it.each([
    'https://app.example',
    'http://localhost:8080',
  ])('keeps an exact HTTP(S) origin including port', (origin) => {
    expect(canonicalOrigin(origin)).toBe(origin);
  });
  it('drops corrupt records and duplicate bindings', () => {
    expect(sanitiseOriginGrants({})).toEqual([]);
    expect(
      sanitiseOriginGrants([
        null,
        1,
        {},
        grant({ origin: 'broken' }),
        grant({ profileId: '' }),
        grant({ profileId: 4 as unknown as string }),
        grant({ createdAt: NaN }),
        grant({ expiresAt: NaN }),
        grant({ scope: null as unknown as OriginGrant['scope'] }),
        grant({ scope: { pods: null as unknown as string[] } }),
        grant({ scope: { pods: ['file:///tmp'] } }),
        grant({ scope: { pods: [], classes: {} as never } }),
      ]),
    ).toEqual([]);
    expect(sanitiseOriginGrants([grant(), grant({ profileId: '2' })])).toEqual([]);
  });
  it('nests only matching-origin valid classes and retains explicit empty class scope', () => {
    const cls = fixtureGrant('https://pod.example/#me');
    const scoped = grant({
      expiresAt: 100,
      scope: { pods: [], classes: [cls, { ...cls, origin: 'https://other.example' }, {} as never] },
    });
    expect(sanitiseOriginGrants([scoped])[0]).toEqual({
      ...scoped,
      scope: { pods: [], classes: [cls] },
    });
    expect(
      sanitiseOriginGrants([grant({ scope: { pods: [], classes: [] } })])[0].scope.classes,
    ).toEqual([]);
    expect(sanitiseOriginGrants([grant()])).toEqual([grant()]);
  });
  it('denies unknown, revoked, and expired origins at the exact deadline', () => {
    expect(liveOriginGrant([], 'https://app.example', 20)).toBeNull();
    expect(liveOriginGrant([grant()], 'https://other.example', 20)).toBeNull();
    expect(liveOriginGrant([grant()], 'https://app.example', 20)).toEqual(grant());
    const expiring = grant({ expiresAt: 20 });
    expect(liveOriginGrant([expiring], expiring.origin, 19)).toEqual(expiring);
    expect(liveOriginGrant([expiring], expiring.origin, 20)).toBeNull();
  });
  it('serializes profile swaps and recovers the writer after failed persistence', async () => {
    let raw: unknown = [];
    let fail = true;
    const store = new OriginGrantStore({
      read: async () => raw,
      write: async (value) => {
        if (fail) throw new Error('fixture disk failure');
        raw = structuredClone(value);
      },
    });
    await expect(store.update(() => [grant()])).rejects.toThrow('disk failure');
    fail = false;
    await Promise.all([
      store.update(() => [grant()]),
      store.update((all) => all.map((g) => ({ ...g, profileId: '2' }))),
    ]);
    expect(await store.list()).toEqual([grant({ profileId: '2' })]);
  });
});
