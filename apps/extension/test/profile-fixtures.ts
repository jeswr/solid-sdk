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
