// AUTHORED-BY GPT-6.1-Sol (Codex)
import type { Profile, ProfileRequest, ProfilesResponse } from '../shared/messages';

export interface ProfileViewState {
  readonly profiles: readonly Profile[];
  readonly defaultProfileId: string | null;
  readonly ready: boolean;
  readonly busy: boolean;
  readonly error: string;
  readonly status: string;
}

/** Display metadata only; auth, capacity, default selection and purging stay in the worker. */
export class ProfileController {
  state: ProfileViewState = {
    profiles: [],
    defaultProfileId: null,
    ready: false,
    busy: false,
    error: '',
    status: '',
  };
  private generation = 0;
  private disposed = false;
  private refreshQueued = false;

  constructor(
    private readonly render: (state: ProfileViewState) => void,
    private readonly send: (
      message: ProfileRequest,
    ) => Promise<ProfilesResponse> = sendProfileMessage,
  ) {}

  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.state.busy) {
      this.refreshQueued = true;
      return;
    }
    const generation = ++this.generation;
    try {
      const reply = await this.send({ type: 'SOLID_PROFILES_LIST' });
      if (this.disposed || generation !== this.generation) return;
      this.apply(reply);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.update({ error: errorMessage(error) });
    }
  }

  async retry(): Promise<void> {
    if (this.disposed || this.state.busy) return;
    // A failed removal may have revoked the session before returning an error.
    await this.refresh();
    if (this.disposed || this.state.error) return;
    for (const profile of this.state.profiles) {
      if (profile.sessionState === 'removing' && !(await this.remove(profile.id))) return;
    }
  }

  add(webId: string): Promise<boolean> {
    return this.mutate({ type: 'SOLID_PROFILE_ADD', webId: webId.trim() }, 'Account added.');
  }

  rename(profileId: string, label: string): Promise<boolean> {
    return this.mutate(
      { type: 'SOLID_PROFILE_RENAME', profileId, label: label.trim() },
      'Account renamed.',
    );
  }

  remove(profileId: string): Promise<boolean> {
    return this.mutate({ type: 'SOLID_PROFILE_REMOVE', profileId }, 'Account removed.');
  }

  setDefault(profileId: string): Promise<boolean> {
    return this.mutate(
      { type: 'SOLID_PROFILE_SET_DEFAULT', profileId },
      'Default profile changed.',
    );
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
  }

  private async mutate(message: ProfileRequest, status: string): Promise<boolean> {
    if (this.disposed || this.state.busy) return false;
    // Fence older list reads. Broadcasts during this mutation cannot replace its result.
    this.generation++;
    this.update({ busy: true, error: '', status: 'Updating profiles…' });
    try {
      const reply = await this.send(message);
      if (this.disposed) return false;
      this.apply(reply);
      this.update({ busy: false, status });
      return true;
    } catch (error) {
      if (!this.disposed && message.type === 'SOLID_PROFILE_REMOVE') {
        try {
          // Revocation may already be committed. Reconcile queued broadcasts while still
          // busy, then keep the removal error visible alongside the worker's current list.
          do {
            this.refreshQueued = false;
            const reply = await this.send({ type: 'SOLID_PROFILES_LIST' });
            if (this.disposed) return false;
            this.apply(reply);
          } while (this.refreshQueued);
        } catch {
          // If storage is also unavailable, retain the last list and the removal error.
        }
      }
      if (!this.disposed) this.update({ busy: false, status: '', error: errorMessage(error) });
      return false;
    } finally {
      // A different open surface may have changed profiles while this reply was in flight.
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refresh();
      }
    }
  }

  private apply(reply: ProfilesResponse): void {
    if (reply?.error) throw new Error(reply.error);
    if (!reply?.ok || !Array.isArray(reply.profiles) || reply.defaultProfileId === undefined) {
      throw new Error('Could not load profiles. Try again.');
    }
    this.update({
      profiles: reply.profiles,
      defaultProfileId: reply.defaultProfileId,
      ready: true,
      error: '',
    });
  }

  private update(patch: Partial<ProfileViewState>): void {
    this.state = { ...this.state, ...patch };
    this.render(this.state);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong with that account. Try again.';
}

function sendProfileMessage(message: ProfileRequest): Promise<ProfilesResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply: ProfilesResponse) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message ?? 'Could not contact the extension.'));
      else resolve(reply);
    });
  });
}
