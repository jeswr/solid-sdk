// AUTHORED-BY GPT-6.1-Sol (Codex)
import type { ClassGrant } from '../src/background/core/class-grant';
import { dpopThumbprint, generateDpopKeyPair } from '../src/background/core/dpop';
import type { LegacyProfile, ProfileSnapshot } from '../src/background/core/profile-store';
import type { StoredSession } from '../src/background/session-store';

export class MemoryProfileDb {
  state: ProfileSnapshot = { records: [], nextId: 1, defaultProfileId: null, migrated: false };
  error: Error | null = null;
  async read(): Promise<ProfileSnapshot> {
    if (this.error) throw this.error;
    return structuredClone(this.state);
  }
  async write(state: ProfileSnapshot): Promise<void> {
    this.state = structuredClone(state);
  }
  close() {}
}

export async function profileCredentials(name = 'alice') {
  const keyPair = await generateDpopKeyPair();
  const session: StoredSession = {
    webId: `https://pod.example/${name}/profile#me`,
    issuer: 'https://issuer.example/',
    tokenEndpoint: 'https://issuer.example/token',
    clientId: 'https://app.example/clientid',
    accessToken: `fixture-access-${name}`,
    refreshToken: `fixture-refresh-${name}`,
    dpopJkt: await dpopThumbprint(keyPair.publicKey),
    expiresAt: Date.now() + 3600_000,
  };
  const display = { webId: session.webId, name, photoUrl: `https://pod.example/${name}.png` };
  return { session, keyPair, display };
}

export function fixtureGrant(webId: string): ClassGrant {
  return {
    grantId: 'fixture-grant',
    origin: 'https://app.example',
    webId,
    dataClass: 'https://schema.org/Person',
    modes: ['read'],
    purpose: null,
    createdAt: 0,
    expiresAt: Date.now() + 3600_000,
    targets: [{ url: 'https://pod.example/private/', kind: 'container' }],
  };
}

export const noLegacy = (): Promise<LegacyProfile> =>
  Promise.resolve({
    session: null,
    display: null,
    keyPair: null,
    grantedOrigins: [],
    podOrigins: [],
    classGrants: [],
  });

/** Explicit parent grants for pre-existing gate/replica test scenarios. This is fixture setup,
 * never production migration: those tests continue to exercise the same class/egress policy. */
export function seedOriginGrantFixtures(storage: Map<string, unknown>, db: MemoryProfileDb): void {
  if (storage.has('solid:origin-grants')) return;
  const records = db.state.records.length
    ? db.state.records
    : [
        {
          profile: { id: '1' },
          session: storage.get('solid:session') as StoredSession | undefined,
          grantedOrigins: (storage.get('solid:granted-origins') ?? []) as string[],
          podOrigins: (storage.get('solid:pod-origins') ?? []) as string[],
          classGrants: (storage.get('solid:class-grants') ?? []) as ClassGrant[],
        },
      ];
  const grants = records.flatMap((r) => {
    if (!r.session) return [];
    const pods = [
      ...new Set([
        new URL(r.session.webId).origin,
        new URL(r.session.issuer).origin,
        ...r.podOrigins,
      ]),
    ];
    const explicit = r.grantedOrigins.map((origin) => new URL(origin).origin);
    const origins = [...new Set([...explicit, ...r.classGrants.map((g) => g.origin)])];
    return origins.map((origin) => ({
      origin,
      profileId: r.profile.id,
      createdAt: Date.now(),
      scope: {
        pods,
        ...(explicit.includes(origin)
          ? {}
          : { classes: r.classGrants.filter((g) => g.origin === origin) }),
      },
    }));
  });
  storage.set('solid:origin-grants', grants);
}
