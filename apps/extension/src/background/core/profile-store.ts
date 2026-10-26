// AUTHORED-BY GPT-6.1-Sol (Codex)
/** Worker-only profile authority. Credentials are never part of the public projection. */
import type { Profile } from '../../shared/messages';
import type { StoredProfile, StoredSession } from '../session-store';
import type { ClassGrant } from './class-grant';
import { dpopThumbprint } from './dpop';

export interface ProfileRecord {
  profile: Profile;
  session: StoredSession | null;
  keyPair: CryptoKeyPair | null;
  grantedOrigins: string[];
  podOrigins: string[];
  classGrants: ClassGrant[];
}

export interface ProfileSnapshot {
  records: ProfileRecord[];
  defaultProfileId: string | null;
  nextId: number;
  migrated: boolean;
}

export interface ProfilePersistence {
  read(): Promise<ProfileSnapshot>;
  write(state: ProfileSnapshot): Promise<void>;
}

export interface LegacyProfile {
  session: StoredSession | null;
  display: StoredProfile | null;
  keyPair: CryptoKeyPair | null;
  grantedOrigins: string[];
  podOrigins: string[];
  classGrants: ClassGrant[];
}

export const MAX_PROFILES = 8;

export class ProfileStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly persistence: ProfilePersistence,
    private readonly purge: (webId: string) => Promise<void>,
  ) {}

  /** All read/modify/write sequences share one worker-owned writer, including failures. */
  private locked<T>(op: () => Promise<T>): Promise<T> {
    const run = this.tail.then(op);
    this.tail = run.catch(() => {});
    return run;
  }

  /** Commit migration before deleting legacy storage; cleanup is safe to retry on wake. */
  initialise(loadLegacy: () => Promise<LegacyProfile>, clearLegacy: () => Promise<void>) {
    return this.locked(async () => {
      const state = await this.persistence.read();
      if (!state.migrated) {
        const legacy = await loadLegacy();
        if (legacy.session) {
          const { session, keyPair } = legacy;
          const valid = await this.keyMatches(session, keyPair);
          const migrated = valid
            ? { ...session, dpopJkt: await dpopThumbprint((keyPair as CryptoKeyPair).publicKey) }
            : session;
          state.records.push(this.record('1', migrated, valid ? keyPair : null, legacy.display));
          const record = state.records[0];
          if (valid) {
            record.grantedOrigins = legacy.grantedOrigins;
            record.podOrigins = legacy.podOrigins;
            record.classGrants = legacy.classGrants.filter((g) => g.webId === session.webId);
          }
          state.defaultProfileId = '1';
          state.nextId = 2;
        }
        state.migrated = true;
        await this.persistence.write(state);
      }
      await clearLegacy();
      // A worker may have died between revocation and the byte purge. Finish before serving.
      for (const record of state.records) {
        if (record.profile.sessionState === 'removing') await this.finishRemoval(state, record);
        else if (record.profile.sessionState === 'signed-out')
          await this.purge(record.profile.webId);
      }
    });
  }

  async list(): Promise<{ profiles: Profile[]; defaultProfileId: string | null }> {
    const state = await this.persistence.read();
    return {
      profiles: state.records.map(({ profile: p }) => ({
        id: p.id,
        webId: p.webId,
        issuer: p.issuer,
        label: p.label,
        avatar: p.avatar,
        sessionState: p.sessionState,
        dpopKeyRef: p.dpopKeyRef,
      })),
      defaultProfileId: state.defaultProfileId,
    };
  }

  async get(id: string): Promise<ProfileRecord> {
    return this.find(await this.persistence.read(), id);
  }

  async getDefault(): Promise<ProfileRecord | null> {
    const state = await this.persistence.read();
    return state.defaultProfileId === null ? null : this.find(state, state.defaultProfileId);
  }

  /** The supplied id is mandatory: never fall back to a different profile's credentials. */
  async session(id: string): Promise<{ session: StoredSession; keyPair: CryptoKeyPair } | null> {
    const record = (await this.persistence.read()).records.find((r) => r.profile.id === id);
    if (record?.profile.sessionState !== 'active' || !record.session) return null;
    if (
      record.session.webId !== record.profile.webId ||
      record.session.issuer !== record.profile.issuer ||
      !(await this.keyMatches(record.session, record.keyPair))
    ) {
      await this.signOut(id);
      return null;
    }
    return { session: record.session, keyPair: record.keyPair as CryptoKeyPair };
  }

  /** Re-login replaces only the same WebID. New WebIDs get fresh, empty capability scopes. */
  login(session: StoredSession, keyPair: CryptoKeyPair, display: StoredProfile): Promise<Profile> {
    return this.locked(async () => {
      if (!(await this.keyMatches(session, keyPair))) throw new Error('Invalid profile DPoP key.');
      const state = await this.persistence.read();
      const existing = state.records.find((r) => r.profile.webId === session.webId);
      if (existing?.profile.sessionState === 'removing')
        throw new Error('Profile removal pending.');
      if (!existing && state.records.length >= MAX_PROFILES) throw new Error('At most 8 profiles.');
      if (existing?.profile.sessionState === 'signed-out') await this.purge(existing.profile.webId);
      const id = existing ? existing.profile.id : String(state.nextId++);
      const bound = { ...session, dpopJkt: await dpopThumbprint(keyPair.publicKey) };
      const record = this.record(id, bound, keyPair, display);
      if (existing) {
        record.profile = { ...record.profile, label: existing.profile.label };
        record.grantedOrigins = existing.grantedOrigins;
        record.podOrigins = existing.podOrigins;
        record.classGrants = existing.classGrants;
        state.records[state.records.indexOf(existing)] = record;
      } else {
        state.records.push(record);
      }
      state.defaultProfileId ??= id;
      await this.persistence.write(state);
      return { ...record.profile };
    });
  }

  rename(id: string, label: string): Promise<void> {
    return this.change(id, (record) => {
      if (typeof label !== 'string' || !label.trim() || label.length > 200) {
        throw new Error('Profile label must contain 1–200 characters.');
      }
      record.profile = { ...record.profile, label: label.trim() };
    });
  }

  setDefault(id: string): Promise<void> {
    return this.locked(async () => {
      const state = await this.persistence.read();
      const record = this.find(state, id);
      if (record.profile.sessionState === 'removing') throw new Error('Profile removal pending.');
      state.defaultProfileId = id;
      await this.persistence.write(state);
    });
  }

  updateSession(id: string, session: StoredSession): Promise<void> {
    return this.change(id, async (record) => {
      if (
        record.profile.sessionState !== 'active' ||
        session.webId !== record.profile.webId ||
        session.issuer !== record.profile.issuer ||
        !(await this.keyMatches(session, record.keyPair))
      ) {
        throw new Error('Session does not belong to this profile.');
      }
      record.session = session;
    });
  }

  /** Capability writes are internal to the SW; no page-facing message accepts these arrays. */
  capabilities(id: string, update: (record: ProfileRecord) => void | Promise<void>): Promise<void> {
    return this.change(id, (record) => {
      if (record.profile.sessionState !== 'active') throw new Error('Profile is not active.');
      return update(record);
    });
  }

  signOut(id: string): Promise<void> {
    return this.locked(async () => {
      const state = await this.persistence.read();
      const record = this.find(state, id);
      record.profile = { ...record.profile, sessionState: 'signed-out' };
      record.session = null;
      record.keyPair = null;
      record.grantedOrigins = [];
      record.classGrants = [];
      await this.persistence.write(state);
      await this.purge(record.profile.webId);
    });
  }

  remove(id: string): Promise<void> {
    return this.locked(async () => {
      const state = await this.persistence.read();
      const record = this.find(state, id);
      record.profile = { ...record.profile, sessionState: 'removing' };
      record.session = null;
      record.keyPair = null;
      record.grantedOrigins = [];
      record.classGrants = [];
      await this.persistence.write(state);
      await this.finishRemoval(state, record);
    });
  }

  private async finishRemoval(state: ProfileSnapshot, record: ProfileRecord): Promise<void> {
    await this.purge(record.profile.webId);
    state.records = state.records.filter((r) => r !== record);
    if (state.defaultProfileId === record.profile.id) {
      state.defaultProfileId = state.records[0]?.profile.id ?? null;
    }
    await this.persistence.write(state);
  }

  private change(id: string, op: (record: ProfileRecord) => void | Promise<void>): Promise<void> {
    return this.locked(async () => {
      const state = await this.persistence.read();
      await op(this.find(state, id));
      await this.persistence.write(state);
    });
  }

  private find(state: ProfileSnapshot, id: string): ProfileRecord {
    const record = state.records.find((r) => r.profile.id === id);
    if (!record) throw new Error('Unknown profile.');
    return record;
  }

  private async keyMatches(
    session: StoredSession,
    keyPair: CryptoKeyPair | null,
  ): Promise<boolean> {
    if (!keyPair || keyPair.privateKey.extractable) return false;
    return (
      session.dpopJkt === undefined || session.dpopJkt === (await dpopThumbprint(keyPair.publicKey))
    );
  }

  private record(
    id: string,
    session: StoredSession,
    keyPair: CryptoKeyPair | null,
    display: StoredProfile | null,
  ): ProfileRecord {
    const sameDisplay = display?.webId === session.webId;
    return {
      profile: {
        id,
        webId: session.webId,
        issuer: session.issuer,
        label: (sameDisplay && display.name) || session.webId,
        avatar: (sameDisplay && display.photoUrl) || undefined,
        sessionState: keyPair ? 'active' : 'signed-out',
        dpopKeyRef: id,
      },
      session: keyPair ? session : null,
      keyPair,
      grantedOrigins: [],
      podOrigins: [],
      classGrants: [],
    };
  }
}
