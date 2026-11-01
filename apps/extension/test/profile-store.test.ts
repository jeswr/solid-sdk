// AUTHORED-BY GPT-6.1-Sol (Codex)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '../src/background/core/authenticated-fetch';
import { dpopThumbprint, generateDpopKeyPair } from '../src/background/core/dpop';
import { ProfileStore } from '../src/background/core/profile-store';
import { fixtureGrant, MemoryProfileDb, noLegacy, profileCredentials } from './profile-fixtures';

let db: MemoryProfileDb;
let purge: ReturnType<typeof vi.fn<(webId: string) => Promise<void>>>;
let store: ProfileStore;

beforeEach(() => {
  db = new MemoryProfileDb();
  purge = vi.fn(async () => {});
  store = new ProfileStore(db, purge);
});

async function login(name = 'alice') {
  const credentials = await profileCredentials(name);
  const profile = await store.login(credentials.session, credentials.keyPair, credentials.display);
  return { ...credentials, profile };
}

describe('ProfileStore migration', () => {
  it('migrates the legacy session to profile 1 exactly once, preserving its key and grants', async () => {
    const a = await profileCredentials();
    const grants = [fixtureGrant(a.session.webId), fixtureGrant('https://other.example/#me')];
    const load = vi.fn(async () => ({
      ...a,
      grantedOrigins: ['https://app.example'],
      podOrigins: ['https://pod.example'],
      classGrants: grants,
    }));
    const clear = vi.fn(async () => {
      expect(db.state.migrated).toBe(true);
      expect(db.state.records[0].session?.accessToken).toBe(a.session.accessToken);
    });
    await store.initialise(load, clear);
    const record = await store.get('1');
    expect(record.session).toEqual(a.session);
    expect(record.grantedOrigins).toEqual(['https://app.example']);
    expect(record.podOrigins).toEqual(['https://pod.example']);
    expect(record.classGrants).toEqual([grants[0]]);
    expect((await store.list()).defaultProfileId).toBe('1');
    expect(await dpopThumbprint(record.keyPair!.publicKey)).toBe(a.session.dpopJkt);
    expect(record.keyPair!.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', record.keyPair!.privateKey)).rejects.toThrow();
    await new ProfileStore(db, purge).initialise(load, clear);
    expect(load).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('handles an empty install and retries cleanup after a committed migration', async () => {
    const clear = vi
      .fn()
      .mockRejectedValueOnce(new Error('interrupted'))
      .mockResolvedValue(undefined);
    await expect(store.initialise(noLegacy, clear)).rejects.toThrow('interrupted');
    await store.initialise(() => {
      throw new Error('must not re-import');
    }, clear);
    expect(await store.list()).toEqual({ profiles: [], defaultProfileId: null });
    expect(await store.getDefault()).toBeNull();
  });

  it.each([
    'missing',
    'mismatch',
    'extractable',
  ] as const)('requires re-login for a %s legacy key', async (failure) => {
    const a = await profileCredentials();
    const keyPair =
      failure === 'missing'
        ? null
        : failure === 'mismatch'
          ? await generateDpopKeyPair()
          : await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
              'sign',
              'verify',
            ]);
    await store.initialise(
      async () => ({
        ...a,
        keyPair,
        grantedOrigins: ['https://app.example'],
        podOrigins: [],
        classGrants: [],
      }),
      async () => {},
    );
    expect((await store.get('1')).profile.sessionState).toBe('signed-out');
    expect(await store.session('1')).toBeNull();
    expect((await store.get('1')).session).toBeNull();
    expect((await store.get('1')).grantedOrigins).toEqual([]);
    expect(purge).toHaveBeenCalledWith(a.session.webId);
  });

  it('binds a pre-thumbprint session and ignores a mismatched display profile', async () => {
    const a = await profileCredentials();
    await store.initialise(
      async () => ({
        ...a,
        session: { ...a.session, dpopJkt: undefined },
        display: { ...a.display, webId: 'https://other.example/#me' },
        grantedOrigins: [],
        podOrigins: [],
        classGrants: [],
      }),
      async () => {},
    );
    expect((await store.get('1')).session?.dpopJkt).toBe(a.session.dpopJkt);
    expect((await store.get('1')).profile).toMatchObject({
      label: a.session.webId,
      avatar: undefined,
    });
  });

  it('uses the WebID label when the legacy display is absent', async () => {
    const a = await profileCredentials();
    await store.initialise(
      async () => ({ ...a, display: null, grantedOrigins: [], podOrigins: [], classGrants: [] }),
      async () => {},
    );
    expect((await store.get('1')).profile.label).toBe(a.session.webId);
  });
});

describe('ProfileStore lifecycle and adversarial isolation', () => {
  it('keeps defaults, labels and credentials across worker restarts without exposing secrets', async () => {
    const a = await login();
    const b = await login('bob');
    expect((await store.getDefault())?.profile.id).toBe(a.profile.id);
    await store.rename(b.profile.id, ' Bob personal ');
    await store.setDefault(b.profile.id);
    const reopened = new ProfileStore(db, purge);
    expect((await reopened.getDefault())?.profile.label).toBe('Bob personal');
    expect((await reopened.session(a.profile.id))?.session.accessToken).toBe(a.session.accessToken);
    const view = JSON.stringify(await reopened.list());
    expect(view).not.toContain('accessToken');
    expect(view).not.toContain('refreshToken');
    expect(view).not.toContain('privateKey');
    expect(await reopened.session('missing')).toBeNull();
    await expect(reopened.get('missing')).rejects.toThrow('Unknown profile');
  });

  it('never uses P1 tokens or signing keys for P2, even when both share a pod origin', async () => {
    const a = await login();
    const b = await login('bob');
    const seen: string[] = [];
    for (const profile of [a, b]) {
      const ctx = (await store.session(profile.profile.id))!;
      const result = await authenticatedFetch(
        {
          accessToken: ctx.session.accessToken,
          dpopKeyPair: ctx.keyPair,
          allowedOrigins: new Set(['https://pod.example']),
          tokenEndpoint: ctx.session.tokenEndpoint,
        },
        {
          url: 'https://pod.example/shared',
          method: 'GET',
          headers: { Authorization: 'attacker', DPoP: 'attacker' },
          body: null,
          fetchImpl: async (_url, init) => {
            const headers = new Headers(init?.headers);
            seen.push(headers.get('authorization')!);
            const header = JSON.parse(
              atob(headers.get('dpop')!.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')),
            );
            expect(header.jwk.d).toBeUndefined();
            expect(header.jwk.x).toBe(
              (await crypto.subtle.exportKey('jwk', ctx.keyPair.publicKey)).x,
            );
            return new Response('fixture');
          },
        },
      );
      expect(result.response.status).toBe(200);
    }
    expect(seen).toEqual([`DPoP ${a.session.accessToken}`, `DPoP ${b.session.accessToken}`]);
  });

  it('rejects swapped sessions and mismatched, missing or exportable keys', async () => {
    const a = await login();
    const b = await login('bob');
    await expect(store.updateSession(a.profile.id, b.session)).rejects.toThrow('does not belong');
    await expect(
      store.updateSession(a.profile.id, { ...a.session, issuer: 'https://other.example' }),
    ).rejects.toThrow('does not belong');
    await expect(
      store.updateSession(a.profile.id, { ...a.session, dpopJkt: b.session.dpopJkt }),
    ).rejects.toThrow('does not belong');
    await expect(store.login(a.session, b.keyPair, a.display)).rejects.toThrow('Invalid profile');
    db.state.records[0].keyPair = b.keyPair;
    expect(await store.session(a.profile.id)).toBeNull();
    expect((await store.session(b.profile.id))?.session).toEqual(b.session);
    await expect(store.updateSession(a.profile.id, a.session)).rejects.toThrow('does not belong');
    await expect(store.capabilities(a.profile.id, () => {})).rejects.toThrow('not active');
    const newA = await login();
    db.state.records[0].keyPair = null;
    expect(await store.session(newA.profile.id)).toBeNull();
  });

  it.each([
    'webId',
    'issuer',
  ] as const)('rejects a persisted session whose %s was swapped across profiles', async (field) => {
    const a = await login();
    db.state.records[0].session = { ...a.session, [field]: 'https://other.example/#me' };
    expect(await store.session('1')).toBeNull();
  });

  it('returns only the allowlisted profile fields even if a stored display object has extra properties', async () => {
    await login();
    Object.assign(db.state.records[0].profile, { accessToken: 'fixture-must-not-leak' });
    expect(JSON.stringify(await store.list())).not.toContain('fixture-must-not-leak');
  });

  it('updates refreshed tokens only for their owning profile', async () => {
    const a = await login();
    const b = await login('bob');
    await store.updateSession(a.profile.id, { ...a.session, accessToken: 'fixture-rotated' });
    expect((await store.session(a.profile.id))?.session.accessToken).toBe('fixture-rotated');
    expect((await store.session(b.profile.id))?.session.accessToken).toBe(b.session.accessToken);
  });

  it('enforces eight profiles under concurrent additions and permits re-login at the limit', async () => {
    const credentials = await Promise.all(
      Array.from({ length: 9 }, (_, i) => profileCredentials(String(i))),
    );
    const results = await Promise.allSettled(
      credentials.map((c) => store.login(c.session, c.keyPair, c.display)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(8);
    expect(results[8].status).toBe('rejected');
    const a = credentials[0];
    await store.rename('1', 'Personal');
    await store.capabilities('1', (r) => {
      r.grantedOrigins = ['https://app.example'];
    });
    await store.login(a.session, a.keyPair, { ...a.display, name: null, photoUrl: null });
    expect((await store.list()).profiles).toHaveLength(8);
    expect((await store.get('1')).profile.label).toBe('Personal');
    expect((await store.get('1')).grantedOrigins).toEqual(['https://app.example']);
  });

  it.each([
    '',
    '   ',
    'x'.repeat(201),
    null,
  ])('rejects invalid labels without damaging the writer: %s', async (label) => {
    await login();
    await expect(store.rename('1', label as string)).rejects.toThrow('label');
    await store.rename('1', 'Valid');
    expect((await store.get('1')).profile.label).toBe('Valid');
  });

  it('revokes before purging, removes only the chosen profile and assigns a surviving default', async () => {
    const a = await login();
    const b = await login('bob');
    await store.capabilities('1', (r) => {
      r.grantedOrigins = ['https://app.example'];
      r.classGrants = [fixtureGrant(a.session.webId)];
    });
    purge.mockImplementation(async () => {
      const removing = await store.get('1');
      expect(removing.profile.sessionState).toBe('removing');
      expect(removing.session).toBeNull();
      expect(removing.keyPair).toBeNull();
      expect(removing.grantedOrigins).toEqual([]);
      expect(removing.classGrants).toEqual([]);
      expect(await store.session('1')).toBeNull();
    });
    await store.remove('1');
    expect(purge).toHaveBeenCalledWith(a.session.webId);
    expect((await store.getDefault())?.profile.id).toBe('2');
    expect((await store.session('2'))?.session).toEqual(b.session);
    purge.mockResolvedValue(undefined);
    await store.remove('2');
    expect(await store.getDefault()).toBeNull();
    expect((await login('carol')).profile.id).toBe('3');
  });

  it('retains a different default when removing a non-default profile', async () => {
    await login();
    await login('bob');
    await store.remove('2');
    expect((await store.list()).defaultProfileId).toBe('1');
  });

  it('fails closed on purge failure and resumes removal after suspension', async () => {
    const a = await login();
    db.state.migrated = true;
    purge.mockRejectedValueOnce(new Error('cache unavailable'));
    await expect(store.remove('1')).rejects.toThrow('cache unavailable');
    expect(await store.session('1')).toBeNull();
    await expect(store.setDefault('1')).rejects.toThrow('removal pending');
    await expect(store.login(a.session, a.keyPair, a.display)).rejects.toThrow('removal pending');
    await new ProfileStore(db, purge).initialise(noLegacy, async () => {});
    expect((await store.list()).profiles).toEqual([]);
  });

  it.each([
    'retry',
    'restart',
  ])('preserves pending removal through logout and finishes on %s', async (recovery) => {
    const a = await login();
    const b = await login('bob');
    db.state.migrated = true;
    purge.mockRejectedValue(new Error('cache unavailable'));
    await expect(store.remove(a.profile.id)).rejects.toThrow('cache unavailable');
    await expect(store.signOut(a.profile.id)).rejects.toThrow('cache unavailable');
    expect((await store.get(a.profile.id)).profile.sessionState).toBe('removing');
    expect(await store.session(a.profile.id)).toBeNull();

    purge.mockResolvedValue(undefined);
    await store.signOut(a.profile.id);
    expect((await store.get(a.profile.id)).profile.sessionState).toBe('removing');
    await expect(store.login(a.session, a.keyPair, a.display)).rejects.toThrow('removal pending');
    if (recovery === 'retry') await store.remove(a.profile.id);
    else await new ProfileStore(db, purge).initialise(noLegacy, async () => {});
    expect(await store.list()).toMatchObject({
      profiles: [b.profile],
      defaultProfileId: b.profile.id,
    });
    expect((await store.session(b.profile.id))?.session).toEqual(b.session);
  });

  it('signs out one profile and purges before re-login while retaining its display entry', async () => {
    const a = await login();
    const b = await login('bob');
    await store.signOut('1');
    expect((await store.get('1')).profile.sessionState).toBe('signed-out');
    expect((await store.session('2'))?.session).toEqual(b.session);
    await store.login(a.session, a.keyPair, a.display);
    expect(purge).toHaveBeenCalledTimes(2);
    expect((await store.session('1'))?.session).toEqual(a.session);
  });

  it('rejects unknown profile ids rather than selecting the default', async () => {
    await login();
    await expect(store.rename('absent', 'X')).rejects.toThrow('Unknown profile');
    await expect(store.remove('absent')).rejects.toThrow('Unknown profile');
    await expect(store.setDefault('absent')).rejects.toThrow('Unknown profile');
    await expect(store.signOut('absent')).rejects.toThrow('Unknown profile');
  });
});
