// AUTHORED-BY Codex GPT-6.1-Sol
import type { OriginGrant } from '../background/core/origin-grant';
import type { OriginGrantRequest, Profile, ProfilesResponse } from '../shared/messages';

export type GrantsMessage = OriginGrantRequest | { readonly type: 'SOLID_PROFILES_LIST' };
export interface GrantsResponse extends ProfilesResponse {
  readonly grants?: readonly OriginGrant[];
}

export const DURATIONS = [
  { label: 'Until revoked', days: null },
  { label: '1 day', days: 1 },
  { label: '1 month', days: 30 },
  { label: '1 year', days: 365 },
] as const;
export type Duration = (typeof DURATIONS)[number]['label'];

export type Confirmation =
  | { readonly kind: 'revoke'; readonly origin: string }
  | { readonly kind: 'rebind'; readonly origin: string; readonly profileId: string }
  | {
      readonly kind: 'expiry';
      readonly origin: string;
      readonly expiresAt: number;
      readonly duration: Duration;
    };

export interface GrantsState {
  readonly phase: 'loading' | 'ready' | 'confirming' | 'saving' | 'disposed';
  readonly grants: readonly OriginGrant[];
  readonly profiles: readonly Profile[];
  readonly confirmation: Confirmation | null;
  readonly status: string;
  readonly error: string | null;
  readonly loaded: boolean;
}

export interface GrantsDependencies {
  readonly send: (message: GrantsMessage) => Promise<GrantsResponse>;
  readonly subscribe?: (listener: (message: { type: string }) => void) => () => void;
  readonly now?: () => number;
}

/** Pure, token-free state machine. Reads, writes and broadcasts share one serial queue. */
export class GrantsController {
  private snapshot: GrantsState = {
    phase: 'loading',
    grants: [],
    profiles: [],
    confirmation: null,
    status: '',
    error: null,
    loaded: false,
  };
  private readonly listeners = new Set<(state: GrantsState) => void>();
  private tail: Promise<void> = Promise.resolve();
  private refreshPending: Promise<void> | null = null;
  private refreshAgain = false;
  private readonly unsubscribe?: () => void;
  private readonly now: () => number;

  constructor(private readonly dependencies: GrantsDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.unsubscribe = dependencies.subscribe?.((message) => {
      if (message.type === 'SOLID_STATE_CHANGED') void this.refresh();
    });
  }

  get state(): GrantsState {
    return this.snapshot;
  }

  subscribe(listener: (state: GrantsState) => void): () => void {
    if (this.state.phase === 'disposed') return () => {};
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private set(update: Partial<GrantsState>): void {
    if (this.state.phase === 'disposed') return;
    this.snapshot = { ...this.state, ...update };
    for (const listener of this.listeners) listener(this.state);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.tail.then(async () => {
      if (this.state.phase !== 'disposed') await work();
    });
    this.tail = run.catch(() => {});
    return run;
  }

  refresh(): Promise<void> {
    if (this.state.phase === 'disposed') return Promise.resolve();
    if (this.refreshPending) {
      this.refreshAgain = true;
      return this.refreshPending;
    }
    if (this.state.phase !== 'saving') this.set({ phase: 'loading' });
    this.refreshPending = this.enqueue(async () => {
      // Keep the confirmation and existing rows during a background refresh.
      this.set({ phase: 'loading' });
      try {
        const grants = await this.dependencies.send({ type: 'SOLID_ORIGIN_GRANTS_LIST' });
        if (this.state.phase === 'disposed') return;
        const profiles = await this.dependencies.send({ type: 'SOLID_PROFILES_LIST' });
        if (
          grants.error ||
          grants.ok !== true ||
          !grants.grants ||
          profiles.error ||
          !profiles.profiles
        )
          throw new Error('list');
        this.set({
          grants: grants.grants,
          profiles: profiles.profiles,
          loaded: true,
          phase: this.state.confirmation ? 'confirming' : 'ready',
          error: null,
        });
      } catch {
        this.set({
          phase: this.state.confirmation ? 'confirming' : 'ready',
          error: "Couldn't load sites with access. Try refreshing.",
        });
      }
    }).finally(() => {
      this.refreshPending = null;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        void this.refresh();
      }
    });
    return this.refreshPending;
  }

  durationOptions(grant: OriginGrant) {
    const now = this.now();
    return DURATIONS.map(({ label, days }) => {
      const expiresAt = days === null ? null : now + days * 86_400_000;
      const reason =
        expiresAt === null
          ? grant.expiresAt === undefined
            ? 'Access already lasts until you revoke it.'
            : 'To extend access, this site must ask again.'
          : grant.expiresAt !== undefined && expiresAt >= grant.expiresAt
            ? 'Choose a shorter duration. To extend access, this site must ask again.'
            : null;
      return { label, expiresAt, reason };
    });
  }

  private request(confirmation: Confirmation): void {
    if (
      this.state.phase !== 'ready' ||
      !this.state.grants.some((g) => g.origin === confirmation.origin)
    )
      return;
    this.set({ phase: 'confirming', confirmation, error: null, status: '' });
  }

  requestRevoke(origin: string): void {
    this.request({ kind: 'revoke', origin });
  }

  requestRebind(origin: string, profileId: string): void {
    const grant = this.state.grants.find((g) => g.origin === origin);
    if (
      grant?.profileId === profileId ||
      !this.state.profiles.some((p) => p.id === profileId && p.sessionState === 'active')
    )
      return;
    this.request({ kind: 'rebind', origin, profileId });
  }

  requestExpiry(origin: string, duration: Duration): void {
    const grant = this.state.grants.find((g) => g.origin === origin);
    if (!grant) return;
    const option = this.durationOptions(grant).find((d) => d.label === duration);
    if (!option || option.reason || option.expiresAt === null) return;
    this.request({ kind: 'expiry', origin, expiresAt: option.expiresAt, duration });
  }

  cancel(): void {
    if (this.state.confirmation && this.state.phase !== 'saving')
      this.set({ phase: this.refreshPending ? 'loading' : 'ready', confirmation: null });
  }

  confirm(): Promise<void> {
    const action = this.state.confirmation;
    if (this.state.phase !== 'confirming' || !action) return Promise.resolve();
    // Lock synchronously so double activation cannot submit the same decision twice.
    this.set({ phase: 'saving', confirmation: null, error: null });
    return this.enqueue(async () => {
      this.set({ phase: 'saving' });
      try {
        const grant = this.state.grants.find((g) => g.origin === action.origin);
        if (
          !grant ||
          (action.kind === 'expiry' &&
            (action.expiresAt <= this.now() ||
              (grant.expiresAt !== undefined && action.expiresAt >= grant.expiresAt)))
        )
          throw new Error('stale');
        if (
          action.kind === 'rebind' &&
          !this.state.profiles.some((p) => p.id === action.profileId && p.sessionState === 'active')
        )
          throw new Error('account');
        const message: OriginGrantRequest =
          action.kind === 'revoke'
            ? { type: 'SOLID_ORIGIN_GRANT_REVOKE', origin: action.origin }
            : action.kind === 'rebind'
              ? {
                  type: 'SOLID_ORIGIN_GRANT_PROFILE',
                  origin: action.origin,
                  profileId: action.profileId,
                }
              : {
                  type: 'SOLID_ORIGIN_GRANT_EXPIRY',
                  origin: action.origin,
                  expiresAt: action.expiresAt,
                };
        const response = await this.dependencies.send(message);
        if (response.error || response.ok !== true || !response.grants) throw new Error('save');
        this.set({
          phase: 'ready',
          grants: response.grants,
          status:
            action.kind === 'revoke'
              ? `Access revoked for ${action.origin}.`
              : action.kind === 'rebind'
                ? `Account changed for ${action.origin}. The site must ask for data access again.`
                : `Access expiry updated for ${action.origin}.`,
        });
      } catch {
        this.set({
          phase: 'ready',
          error: "Couldn't update this site's access. Refresh and try again.",
        });
      }
    });
  }

  dispose(): void {
    if (this.state.phase === 'disposed') return;
    this.unsubscribe?.();
    this.snapshot = {
      ...this.state,
      phase: 'disposed',
      confirmation: null,
      grants: [],
      profiles: [],
    };
    this.listeners.clear();
  }
}
