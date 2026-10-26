// AUTHORED-BY GPT-6.1-Sol (Codex)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileController } from '../src/popup/profile-controller';
import type { Profile, ProfilesResponse } from '../src/shared/messages';

const profile: Profile = {
  id: '1',
  webId: 'https://fixture.invalid/me',
  issuer: 'https://fixture.invalid/',
  label: 'Personal',
  sessionState: 'active',
  dpopKeyRef: '1',
};
const snapshot: ProfilesResponse = { ok: true, profiles: [profile], defaultProfileId: '1' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

describe('profile UI controller', () => {
  it('lists display metadata including an empty store', async () => {
    const send = vi.fn().mockResolvedValue(snapshot);
    const render = vi.fn();
    const controller = new ProfileController(render, send);
    await controller.refresh();
    expect(send).toHaveBeenCalledWith({ type: 'SOLID_PROFILES_LIST' });
    expect(controller.state).toMatchObject({
      profiles: [profile],
      defaultProfileId: '1',
      ready: true,
    });
    send.mockResolvedValue({ ok: true, profiles: [], defaultProfileId: null });
    await controller.refresh();
    expect(controller.state.profiles).toEqual([]);
    expect(controller.state.defaultProfileId).toBeNull();
  });

  it('uses only the existing worker operations and applies returned defaults', async () => {
    const send = vi.fn().mockResolvedValue(snapshot);
    const controller = new ProfileController(vi.fn(), send);
    expect(await controller.add(' https://fixture.invalid/me ')).toBe(true);
    expect(send).toHaveBeenLastCalledWith({ type: 'SOLID_PROFILE_ADD', webId: profile.webId });
    await controller.rename('1', ' Work ');
    expect(send).toHaveBeenLastCalledWith({
      type: 'SOLID_PROFILE_RENAME',
      profileId: '1',
      label: 'Work',
    });
    await controller.setDefault('1');
    expect(send).toHaveBeenLastCalledWith({ type: 'SOLID_PROFILE_SET_DEFAULT', profileId: '1' });
    send.mockResolvedValue({ ok: true, profiles: [], defaultProfileId: null });
    await controller.remove('1');
    expect(send).toHaveBeenLastCalledWith({ type: 'SOLID_PROFILE_REMOVE', profileId: '1' });
    expect(controller.state).toMatchObject({ status: 'Profile removed.', defaultProfileId: null });
  });

  it('keeps the current list on cancellation/failure and permits retry', async () => {
    const send = vi.fn().mockResolvedValue(snapshot);
    const controller = new ProfileController(vi.fn(), send);
    await controller.refresh();
    send.mockResolvedValue({ error: 'Sign-in cancelled.' });
    expect(await controller.add(profile.webId)).toBe(false);
    expect(controller.state).toMatchObject({
      profiles: [profile],
      error: 'Sign-in cancelled.',
      busy: false,
    });
    send.mockResolvedValue(snapshot);
    expect(await controller.add(profile.webId)).toBe(true);
    expect(controller.state.error).toBe('');
  });

  it('refreshes before retrying pending removals in sequence and preserves other profiles', async () => {
    let profiles: Profile[] = [
      profile,
      { ...profile, id: '2', sessionState: 'removing' },
      { ...profile, id: '3', sessionState: 'signed-out' },
      { ...profile, id: '4', sessionState: 'removing' },
    ];
    const firstRemoval = deferred<ProfilesResponse>();
    const send = vi.fn(async (message) => {
      if (message.type === 'SOLID_PROFILE_REMOVE') {
        profiles = profiles.filter((p) => p.id !== message.profileId);
        if (message.profileId === '2') return firstRemoval.promise;
      }
      return { ok: true, profiles, defaultProfileId: '1' };
    });
    const controller = new ProfileController(vi.fn(), send);
    const retry = controller.retry();
    await vi.waitFor(() => expect(controller.state.busy).toBe(true));
    await controller.retry();
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'SOLID_PROFILES_LIST' },
      { type: 'SOLID_PROFILE_REMOVE', profileId: '2' },
    ]);
    firstRemoval.resolve({ ok: true, profiles, defaultProfileId: '1' });
    await retry;
    expect(send).toHaveBeenLastCalledWith({ type: 'SOLID_PROFILE_REMOVE', profileId: '4' });
    expect(controller.state.profiles.map((p) => p.id)).toEqual(['1', '3']);
    expect(controller.state).toMatchObject({ busy: false, error: '', defaultProfileId: '1' });
  });

  it('keeps a repeated purge failure visible and permits another removal retry', async () => {
    const pending = { ...profile, sessionState: 'removing' as const };
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ...snapshot, profiles: [pending] })
      .mockResolvedValueOnce({ error: 'Cache unavailable.' })
      .mockResolvedValueOnce({ ...snapshot, profiles: [pending] });
    const controller = new ProfileController(vi.fn(), send);
    await controller.retry();
    expect(controller.state).toMatchObject({
      profiles: [pending],
      busy: false,
      error: 'Cache unavailable.',
    });
    send
      .mockResolvedValueOnce({ ...snapshot, profiles: [pending] })
      .mockResolvedValueOnce({ ok: true, profiles: [], defaultProfileId: null });
    await controller.retry();
    expect(controller.state).toMatchObject({ profiles: [], defaultProfileId: null, error: '' });
  });

  it.each([
    'reply',
    'transport',
  ])('reloads a partially removed profile after a %s error without losing the error', async (failure) => {
    const pending = { ...profile, sessionState: 'removing' as const };
    const reload = deferred<ProfilesResponse>();
    const send = vi.fn().mockResolvedValueOnce(snapshot);
    const controller = new ProfileController(vi.fn(), send);
    await controller.refresh();
    if (failure === 'reply') send.mockResolvedValueOnce({ error: 'Cache unavailable.' });
    else send.mockRejectedValueOnce(new Error('Cache unavailable.'));
    send.mockReturnValueOnce(reload.promise);
    const removing = controller.remove('1');
    await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith({ type: 'SOLID_PROFILES_LIST' }));
    expect(controller.state.busy).toBe(true);
    // A broadcast arriving during reconciliation must not clear the removal error.
    await controller.refresh();
    send.mockResolvedValue({ ...snapshot, profiles: [pending] });
    reload.resolve({ ...snapshot, profiles: [pending] });
    expect(await removing).toBe(false);
    expect(controller.state).toMatchObject({
      profiles: [pending],
      defaultProfileId: '1',
      busy: false,
      error: 'Cache unavailable.',
    });
  });

  it('does not retry removals after a failed refresh or teardown', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ ...snapshot, profiles: [{ ...profile, sessionState: 'removing' }] });
    const controller = new ProfileController(vi.fn(), send);
    await controller.refresh();
    send.mockResolvedValueOnce({ error: 'Storage unavailable.' });
    await controller.retry();
    expect(send).toHaveBeenCalledTimes(2);
    expect(controller.state.error).toBe('Storage unavailable.');
    const pending = deferred<ProfilesResponse>();
    send.mockReturnValueOnce(pending.promise);
    const retry = controller.retry();
    controller.dispose();
    pending.resolve(snapshot);
    await retry;
    await controller.retry();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it.each([
    undefined,
    { ok: false },
    { ok: true, profiles: [] },
    { error: 'Storage unavailable.' },
  ])('handles missing or failed replies: %j', async (reply) => {
    const controller = new ProfileController(vi.fn(), vi.fn().mockResolvedValue(reply));
    await controller.refresh();
    expect(controller.state.ready).toBe(false);
    expect(controller.state.error).not.toBe('');
    expect(await controller.remove('1')).toBe(false);
    expect(controller.state.busy).toBe(false);
  });

  it('ignores stale lists and duplicate actions, then reconciles queued broadcasts', async () => {
    const stale = deferred<ProfilesResponse>();
    const mutation = deferred<ProfilesResponse>();
    const send = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(mutation.promise)
      .mockResolvedValue(snapshot);
    const controller = new ProfileController(vi.fn(), send);
    const refresh = controller.refresh();
    const adding = controller.add(profile.webId);
    expect(await controller.remove('1')).toBe(false);
    await controller.refresh();
    expect(send).toHaveBeenCalledTimes(2);
    mutation.resolve(snapshot);
    await adding;
    expect(send).toHaveBeenCalledTimes(3);
    stale.resolve({ ok: true, profiles: [], defaultProfileId: null });
    await refresh;
    expect(controller.state.profiles).toEqual([profile]);
  });

  it('lets the latest refresh win, including errors', async () => {
    const old = deferred<ProfilesResponse>();
    const send = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(snapshot);
    const controller = new ProfileController(vi.fn(), send);
    const first = controller.refresh();
    await controller.refresh();
    old.resolve({ error: 'Stale failure' });
    await first;
    expect(controller.state.error).toBe('');
    expect(controller.state.profiles).toEqual([profile]);
  });

  it('fences in-flight operations and stops rendering after teardown', async () => {
    const pending = deferred<ProfilesResponse>();
    const render = vi.fn();
    const send = vi.fn().mockReturnValue(pending.promise);
    const controller = new ProfileController(render, send);
    const action = controller.add(profile.webId);
    controller.dispose();
    render.mockClear();
    pending.resolve(snapshot);
    expect(await action).toBe(false);
    await controller.refresh();
    expect(await controller.remove('1')).toBe(false);
    expect(render).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports Chrome transport errors and recovers through the real message adapter', async () => {
    const runtime = {
      lastError: { message: 'Worker unavailable' } as { message: string } | undefined,
      sendMessage: vi.fn((_request, callback) => callback(snapshot)),
    };
    vi.stubGlobal('chrome', { runtime });
    const controller = new ProfileController(vi.fn());
    await controller.refresh();
    expect(controller.state.error).toBe('Worker unavailable');
    runtime.lastError = undefined;
    await controller.refresh();
    expect(controller.state.ready).toBe(true);
    expect(controller.state.error).toBe('');
  });
});
