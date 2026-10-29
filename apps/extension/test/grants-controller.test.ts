// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from 'vitest';
import {
  GrantsController,
  type GrantsMessage,
  type GrantsResponse,
} from '../src/sidepanel/grants-controller';
import { DAY, NOW, profiles, SITE, siteGrant } from './grants-fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(grants = [siteGrant()]) {
  let broadcast!: (message: { type: string }) => void;
  const unsubscribe = vi.fn();
  const send = vi.fn(async (message: GrantsMessage): Promise<GrantsResponse> => {
    if (message.type === 'SOLID_PROFILES_LIST') return { profiles };
    return { ok: true, grants };
  });
  const controller = new GrantsController({
    send,
    now: () => NOW,
    subscribe: (listener) => {
      broadcast = listener;
      return unsubscribe;
    },
  });
  return {
    controller,
    send,
    unsubscribe,
    broadcast: (type = 'SOLID_STATE_CHANGED') => broadcast({ type }),
  };
}

describe('sites with access controller', () => {
  it('loads site bindings and display-only accounts', async () => {
    const { controller, send } = fixture();
    await controller.refresh();
    expect(send.mock.calls.map(([message]) => message.type)).toEqual([
      'SOLID_ORIGIN_GRANTS_LIST',
      'SOLID_PROFILES_LIST',
    ]);
    expect(controller.state).toMatchObject({
      phase: 'ready',
      loaded: true,
      grants: [siteGrant()],
      profiles,
    });
    expect(JSON.stringify(controller.state)).not.toMatch(/accessToken|refreshToken|privateKey/);
  });

  it('does not revoke until confirmed, and cancelling sends nothing', async () => {
    const { controller, send } = fixture();
    await controller.refresh();
    controller.requestRevoke(SITE);
    expect(controller.state.phase).toBe('confirming');
    expect(send).toHaveBeenCalledTimes(2);
    controller.cancel();
    await controller.confirm();
    expect(send).toHaveBeenCalledTimes(2);
    controller.requestRevoke(SITE);
    send.mockResolvedValueOnce({ ok: true, grants: [] });
    await controller.confirm();
    expect(send).toHaveBeenLastCalledWith({ type: 'SOLID_ORIGIN_GRANT_REVOKE', origin: SITE });
    expect(controller.state.grants).toEqual([]);
    expect(controller.state.status).toContain('Access revoked');
  });

  it('rebinds only after confirmation, using the returned cleared data access', async () => {
    const { controller, send } = fixture();
    await controller.refresh();
    for (const id of ['1', '3', 'unknown']) controller.requestRebind(SITE, id);
    expect(controller.state.confirmation).toBeNull();
    controller.requestRebind(SITE, '2');
    expect(send).toHaveBeenCalledTimes(2);
    const rebound = siteGrant({ profileId: '2', scope: { pods: [], classes: [] } });
    send.mockResolvedValueOnce({ ok: true, grants: [rebound] });
    await controller.confirm();
    expect(send).toHaveBeenLastCalledWith({
      type: 'SOLID_ORIGIN_GRANT_PROFILE',
      origin: SITE,
      profileId: '2',
    });
    expect(controller.state.grants).toEqual([rebound]);
    expect(controller.state.status).toContain('must ask for data access again');
  });

  it('offers only shorter expiry choices and sends an absolute timestamp', async () => {
    const { controller, send } = fixture([siteGrant({ expiresAt: NOW + DAY * 90 })]);
    await controller.refresh();
    const options = controller.durationOptions(controller.state.grants[0]);
    expect(options.map((option) => [option.label, !!option.reason])).toEqual([
      ['Until revoked', true],
      ['1 day', false],
      ['1 month', false],
      ['1 year', true],
    ]);
    controller.requestExpiry(SITE, 'Until revoked');
    controller.requestExpiry(SITE, '1 year');
    expect(controller.state.confirmation).toBeNull();
    controller.requestExpiry(SITE, '1 month');
    expect(send).toHaveBeenCalledTimes(2);
    await controller.confirm();
    expect(send).toHaveBeenLastCalledWith({
      type: 'SOLID_ORIGIN_GRANT_EXPIRY',
      origin: SITE,
      expiresAt: NOW + DAY * 30,
    });
  });

  it('can set an expiry on indefinite access, and never extends an existing one', async () => {
    const { controller } = fixture();
    await controller.refresh();
    expect(controller.durationOptions(siteGrant()).filter((o) => !o.reason)).toHaveLength(3);
    const options = controller.durationOptions(siteGrant({ expiresAt: NOW + DAY }));
    expect(options.every((o) => o.reason !== null)).toBe(true);
  });

  it('serialises broadcasts behind a write and ignores double confirmation', async () => {
    const { controller, send, broadcast } = fixture();
    await controller.refresh();
    const pending = deferred<GrantsResponse>();
    send.mockReturnValueOnce(pending.promise);
    controller.requestRevoke(SITE);
    const first = controller.confirm();
    await controller.confirm();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    broadcast();
    controller.requestRevoke(SITE);
    expect(send).toHaveBeenCalledTimes(3);
    pending.resolve({ ok: true, grants: [] });
    await first;
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(5));
    expect(send.mock.calls.map(([m]) => m.type)).toEqual([
      'SOLID_ORIGIN_GRANTS_LIST',
      'SOLID_PROFILES_LIST',
      'SOLID_ORIGIN_GRANT_REVOKE',
      'SOLID_ORIGIN_GRANTS_LIST',
      'SOLID_PROFILES_LIST',
    ]);
  });

  it('refreshes on state broadcasts, ignores unrelated messages, and refetches a mid-read change', async () => {
    const { controller, send, broadcast } = fixture();
    await controller.refresh();
    broadcast('UNRELATED');
    expect(send).toHaveBeenCalledTimes(2);
    const pending = deferred<GrantsResponse>();
    send.mockReturnValueOnce(pending.promise);
    broadcast();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    broadcast();
    pending.resolve({ ok: true, grants: [] });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(6));
    expect(controller.state.phase).toBe('ready');
  });

  it('keeps confirmation through a broadcast and rejects an action removed by that refresh', async () => {
    const { controller, send, broadcast } = fixture();
    await controller.refresh();
    controller.requestRevoke(SITE);
    send.mockResolvedValueOnce({ ok: true, grants: [] });
    broadcast();
    await vi.waitFor(() => expect(controller.state.phase).toBe('confirming'));
    await controller.confirm();
    expect(send).toHaveBeenCalledTimes(4);
    expect(controller.state.error).toContain("Couldn't update");
  });

  it.each([
    undefined,
    { error: 'Origin grant storage unavailable' },
    { ok: false },
    { ok: true },
  ])('handles a bad list response without exposing worker details: %j', async (response) => {
    const { controller, send } = fixture();
    send.mockResolvedValueOnce(response as GrantsResponse);
    await controller.refresh();
    expect(controller.state).toMatchObject({ phase: 'ready', loaded: false, grants: [] });
    expect(controller.state.error).toBe("Couldn't load sites with access. Try refreshing.");
  });

  it('reports account-list and transport errors, retains existing rows, and recovers', async () => {
    const { controller, send } = fixture();
    await controller.refresh();
    send
      .mockResolvedValueOnce({ ok: true, grants: [] })
      .mockResolvedValueOnce({ error: 'profiles' });
    await controller.refresh();
    expect(controller.state.grants).toEqual([siteGrant()]);
    send.mockRejectedValueOnce(new Error('offline'));
    await controller.refresh();
    expect(controller.state.error).toContain("Couldn't load");
    await controller.refresh();
    expect(controller.state.error).toBeNull();
  });

  it.each([
    { error: 'Invalid origin grant' },
    { ok: false },
    { ok: true },
  ])('reports failed writes and allows retry: %j', async (response) => {
    const { controller, send } = fixture();
    await controller.refresh();
    controller.requestRevoke(SITE);
    send.mockResolvedValueOnce(response);
    await controller.confirm();
    expect(controller.state.error).toBe(
      "Couldn't update this site's access. Refresh and try again.",
    );
    expect(controller.state.grants).toEqual([siteGrant()]);
    controller.requestRevoke(SITE);
    await controller.confirm();
    expect(controller.state.error).toBeNull();
  });

  it('does not send a confirmed expiry that has elapsed while the dialog was open', async () => {
    let now = NOW;
    const send = vi.fn(
      async (): Promise<GrantsResponse> => ({ ok: true, grants: [siteGrant()], profiles }),
    );
    const controller = new GrantsController({ send, now: () => now });
    await controller.refresh();
    controller.requestExpiry(SITE, '1 day');
    now += DAY;
    await controller.confirm();
    expect(send).toHaveBeenCalledTimes(2);
    expect(controller.state.error).toContain("Couldn't update");
  });

  it('disposes subscriptions, queued work and late replies without notifying the view', async () => {
    const { controller, send, broadcast, unsubscribe } = fixture();
    const listener = vi.fn();
    controller.subscribe(listener);
    const pending = deferred<GrantsResponse>();
    send.mockReturnValueOnce(pending.promise);
    const refreshing = controller.refresh();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const before = listener.mock.calls.length;
    controller.dispose();
    controller.dispose();
    broadcast();
    pending.resolve({ ok: true, grants: [siteGrant()] });
    await refreshing;
    await controller.refresh();
    expect(send).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledTimes(before);
    expect(controller.state.phase).toBe('disposed');
    const late = vi.fn();
    controller.subscribe(late)();
    expect(late).not.toHaveBeenCalled();
  });
});
