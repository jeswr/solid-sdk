// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFormFillData } from '../src/background/core/formfill-data';
import { FormFillWorker, registerFormFillMenu } from '../src/background/formfill';
import type { FormFillPreviewRequest, FormFillRequest, Profile } from '../src/shared/messages';

const origin = 'https://shop.example';
const extensionId = 'test-extension';
const previewUrl = `chrome-extension://${extensionId}/formfill/preview.html`;
const sender = {
  origin,
  url: `${origin}/checkout`,
  tab: { id: 3, url: `${origin}/checkout` },
  frameId: 0,
} as chrome.runtime.MessageSender;
const trusted = { id: extensionId, url: previewUrl, frameId: 0 };
const request: FormFillRequest = {
  type: 'SOLID_FORMFILL_REQUEST',
  fields: [
    { field: 'name', category: 'contact' },
    { field: 'street-address', category: 'address' },
  ],
};
const profiles = ['1', '2'].map((id) => ({
  id,
  label: `Profile ${id}`,
  sessionState: 'active',
})) as Profile[];
const data = (id: string) =>
  readFormFillData(
    `https://pod.example/${id}#me`,
    `@prefix v: <http://www.w3.org/2006/vcard/ns#>. <https://pod.example/${id}#me> v:fn "Person ${id}"; v:hasAddress [v:street-address "Street ${id}"].`,
    'https://pod.example/',
  );
let storage: Record<string, unknown>;
let worker: FormFillWorker;
let load: ReturnType<typeof vi.fn>;
let listProfiles: ReturnType<typeof vi.fn>;
let current: ReturnType<typeof vi.fn>;
let created: Array<{ url: string }>;
let removed: Set<(id: number) => void>;
let tabRemoved: Set<(id: number) => void>;
let tabUpdated: Set<(id: number, change: chrome.tabs.TabChangeInfo) => void>;
let tabUrl: string;
const grant = (profileId = '1') => ({
  origin,
  profileId,
  categories: ['contact', 'address'],
  createdAt: 1,
});
const read = (requestId: string, profileId?: string) =>
  worker.preview({ type: 'SOLID_FORMFILL_PREVIEW', requestId, profileId }, trusted);
async function open() {
  const previous = created.length;
  const response = worker.request(request, sender);
  await vi.waitFor(() => expect(created.length).toBeGreaterThan(previous));
  const requestId = new URL(created.at(-1)!.url).searchParams.get('requestId')!;
  return { response, requestId };
}
async function decide(
  requestId: string,
  profileId = '1',
  categories: string[] = ['contact'],
  remember = false,
) {
  await worker.preview(
    {
      type: 'SOLID_FORMFILL_DECISION',
      requestId,
      profileId,
      categories,
      remember,
    } as FormFillPreviewRequest,
    trusted,
  );
}
beforeEach(() => {
  storage = {};
  created = [];
  removed = new Set();
  tabRemoved = new Set();
  tabUpdated = new Set();
  tabUrl = sender.tab!.url!;
  current = vi.fn(async () => {});
  load = vi.fn(async (id: string) => ({ data: data(id), current }));
  listProfiles = vi.fn(async () => ({ profiles, defaultProfileId: '1' }));
  vi.stubGlobal('chrome', {
    runtime: {
      id: extensionId,
      getURL: (p: string) => `chrome-extension://${extensionId}/${p}`,
      onInstalled: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: async () => storage,
        set: async (obj: Record<string, unknown>) => {
          Object.assign(storage, obj);
        },
      },
    },
    tabs: {
      get: async () => ({ url: tabUrl }),
      sendMessage: vi.fn(async () => {}),
      onRemoved: {
        addListener: (f: (id: number) => void) => tabRemoved.add(f),
        removeListener: (f: (id: number) => void) => tabRemoved.delete(f),
      },
      onUpdated: {
        addListener: (f: (id: number, change: chrome.tabs.TabChangeInfo) => void) =>
          tabUpdated.add(f),
        removeListener: (f: (id: number, change: chrome.tabs.TabChangeInfo) => void) =>
          tabUpdated.delete(f),
      },
    },
    windows: {
      create: (opts: { url: string }, cb: (w: { id: number }) => void) => {
        created.push(opts);
        cb({ id: created.length });
      },
      remove: vi.fn(async () => {}),
      onRemoved: {
        addListener: (f: (id: number) => void) => removed.add(f),
        removeListener: (f: (id: number) => void) => removed.delete(f),
      },
    },
  });
  worker = new FormFillWorker({
    profiles: listProfiles,
    load,
    commit: async (_id, task) => task(),
  });
});
afterEach(() => {
  expect(removed.size).toBe(0);
  expect(tabRemoved.size).toBe(0);
  expect(tabUpdated.size).toBe(0);
  if (vi.isFakeTimers()) expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('form-fill worker boundary and consent', () => {
  it('uses sender origin, requires secure top-origin frames, and validates categories before loading data', async () => {
    const bad = [
      {},
      { ...sender, origin: 'null' },
      { ...sender, origin: 'https://forged.example' },
      { ...sender, url: 'http://shop.example', origin: 'http://shop.example' },
      { ...sender, frameId: undefined },
      { ...sender, tab: { id: 3 } },
      {
        ...sender,
        frameId: 4,
        origin: 'https://embedded.example',
        url: 'https://embedded.example',
      },
    ];
    for (const source of bad) expect(await worker.request(request, source)).toEqual({ values: [] });
    for (const fields of [
      null,
      [],
      [{ field: 'password', category: 'contact' }],
      [{ field: 'name', category: 'address' }],
      Array(101).fill({ field: 'name', category: 'contact' }),
    ]) {
      expect(await worker.request({ ...request, fields } as FormFillRequest, sender)).toEqual({
        values: [],
      });
    }
    expect(load).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    const { response, requestId } = await open();
    const view = await read(requestId);
    expect(view?.origin).toBe(origin);
    expect(view?.selected).toEqual([]);
    await decide(requestId, '1', []);
    expect(await response).toEqual({ values: [] });
  });
  it('filters approved categories and remembers a separate profile-bound grant without API access', async () => {
    const { response, requestId } = await open();
    expect((await read(requestId))?.values).toHaveLength(2);
    await decide(requestId, '1', ['address', 'password'], true);
    expect(await response).toEqual({
      origin,
      values: [{ field: 'street-address', category: 'address', value: 'Street 1' }],
    });
    expect(storage['solid:formfill-grants']).toEqual([
      { ...grant(), categories: ['address'], createdAt: expect.any(Number) },
    ]);
    expect(storage['solid:origin-grants']).toBeUndefined();
    expect(removed.size).toBe(0);
    const again = await open();
    expect((await read(again.requestId))?.selected).toEqual(['address']);
    await decide(again.requestId, '1', []);
    expect(await again.response).toEqual({ values: [] });
  });
  it('pins the remembered profile despite default changes, and switches data only through the picker', async () => {
    storage['solid:formfill-grants'] = [grant('2')];
    const { response, requestId } = await open();
    expect(load).toHaveBeenCalledWith('2');
    expect((await read(requestId))?.profileId).toBe('2');
    const selected = await read(requestId, '1');
    expect(selected?.selected).toEqual([]);
    expect(selected?.values[0].value).toBe('Person 1');
    await decide(requestId, '2'); // stale picker decision is ignored
    await decide(requestId, '1');
    expect((await response).values[0].value).toBe('Person 1');
  });
  it('refuses preview reads and decisions from page senders and unknown profiles', async () => {
    const { response, requestId } = await open();
    expect(await worker.preview({ type: 'SOLID_FORMFILL_PREVIEW', requestId }, sender)).toBeNull();
    expect(
      await worker.preview(
        { type: 'SOLID_FORMFILL_PREVIEW', requestId },
        { ...trusted, frameId: 2 },
      ),
    ).toBeNull();
    expect(await read(requestId, 'unknown')).toBeNull();
    await worker.preview(
      {
        type: 'SOLID_FORMFILL_DECISION',
        requestId,
        profileId: '1',
        categories: ['contact'],
        remember: true,
      },
      sender,
    );
    await decide(requestId, '1', []);
    expect(await response).toEqual({ values: [] });
    expect(await read(requestId)).toBeNull();
  });
  it('returns no values on cancel, window close, and window creation failure', async () => {
    const cancelled = await open();
    await decide(cancelled.requestId, '1', []);
    expect(await cancelled.response).toEqual({ values: [] });
    created = [];
    const closed = await open();
    for (const fn of removed) fn(1);
    expect(await closed.response).toEqual({ values: [] });
    chrome.windows.create = (() => {
      throw new Error('Window failed');
    }) as typeof chrome.windows.create;
    expect(await worker.request(request, sender)).toEqual({ values: [] });
    expect(storage['solid:formfill-grants']).toBeUndefined();
  });
  it('fails closed on stale preview reads and remembered Fill decisions after a worker restart', async () => {
    vi.useFakeTimers();
    const { requestId } = await open();
    expect((await read(requestId))?.values).toContainEqual({
      field: 'name',
      category: 'contact',
      value: 'Person 1',
    });
    expect(storage).toEqual({});

    // Termination drops the execution context's timers/listeners and pending response.
    // Retain chrome.storage.local, as a real MV3 restart does, without cancelling the request.
    vi.clearAllTimers();
    removed.clear();
    tabRemoved.clear();
    tabUpdated.clear();
    const commit = vi.fn();
    worker = new FormFillWorker({
      profiles: listProfiles,
      load,
      commit: async (id, task) => {
        commit(id);
        return task();
      },
    });
    listProfiles.mockClear();
    load.mockClear();
    current.mockClear();

    expect(await read(requestId)).toBeNull();
    expect(await read(requestId, '2')).toBeNull();
    const staleFill: FormFillPreviewRequest = {
      type: 'SOLID_FORMFILL_DECISION',
      requestId,
      profileId: '1',
      categories: ['contact', 'address'],
      remember: true,
    };
    expect(await worker.preview(staleFill, trusted)).toBeNull();
    expect(listProfiles).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(storage).toEqual({});
    expect(created).toHaveLength(1);

    const fresh = await open();
    expect(fresh.requestId).not.toBe(requestId);
    expect(await worker.preview(staleFill, trusted)).toBeNull();
    expect((await read(fresh.requestId))?.selected).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
    await decide(fresh.requestId, '1', []);
    expect(await fresh.response).toEqual({ values: [] });
    expect(storage).toEqual({});
  });
  it('times out stalled data loads without opening a late preview', async () => {
    vi.useFakeTimers();
    let release!: (value: { data: ReturnType<typeof data>; current: typeof current }) => void;
    load.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const response = worker.request(request, sender);
    let settled = false;
    void response.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    expect(created).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await response).toEqual({ values: [] });
    release({ data: data('1'), current });
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(0);
  });
  it('includes profile discovery in the loading timeout and ignores its late result', async () => {
    vi.useFakeTimers();
    let release!: (value: { profiles: Profile[]; defaultProfileId: string }) => void;
    listProfiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const response = worker.request(request, sender);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await response).toEqual({ values: [] });
    release({ profiles, defaultProfileId: '1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
  it('keeps review open for 24 hours after loading, with only the long safety cap', async () => {
    vi.useFakeTimers();
    let release!: (value: { data: ReturnType<typeof data>; current: typeof current }) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const response = worker.request(request, sender);
    let settled = false;
    void response.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(29_000);
    release({ data: data('1'), current });
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(1);
    const requestId = new URL(created[0].url).searchParams.get('requestId')!;
    await vi.advanceTimersByTimeAsync(20 * 60 * 60_000);
    expect(settled).toBe(false);
    expect((await read(requestId, '2'))?.profileId).toBe('2');
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000 - 1);
    expect(settled).toBe(false);
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await response).toEqual({ values: [] });
    expect(chrome.windows.remove).toHaveBeenCalledWith(1);
    expect(await read(requestId)).toBeNull();
    expect(storage['solid:formfill-grants']).toBeUndefined();
  });
  it('accepts a decision after more than 20 hours of review', async () => {
    vi.useFakeTimers();
    const { response, requestId } = await open();
    await vi.advanceTimersByTimeAsync(21 * 60 * 60_000);
    await decide(requestId, '1', ['contact'], true);
    expect((await response).values[0].value).toBe('Person 1');
    expect(storage['solid:formfill-grants']).toEqual([
      { ...grant(), categories: ['contact'], createdAt: expect.any(Number) },
    ]);
  });
  it('cancels when the requesting tab closes and ignores other tabs closing', async () => {
    const { response, requestId } = await open();
    for (const fn of tabRemoved) fn(99);
    expect(await read(requestId)).not.toBeNull();
    for (const fn of tabRemoved) fn(3);
    expect(await response).toEqual({ values: [] });
    expect(chrome.windows.remove).toHaveBeenCalledWith(1);
    expect(await read(requestId)).toBeNull();
  });
  it.each([
    'https://elsewhere.example/',
    'https://shop.example:444/',
    'http://shop.example/',
    'about:blank',
    'not a URL',
  ])('cancels on navigation to another origin or an invalid destination: %s', async (url) => {
    const { response, requestId } = await open();
    for (const fn of tabUpdated) fn(3, { url });
    expect(await response).toEqual({ values: [] });
    expect(chrome.windows.remove).toHaveBeenCalledWith(1);
    expect(await read(requestId)).toBeNull();
  });
  it('keeps same-origin path, state and hash changes, unrelated tab updates and window closes', async () => {
    const { response, requestId } = await open();
    for (const fn of removed) fn(99);
    for (const fn of tabUpdated) {
      fn(99, { url: 'https://elsewhere.example' });
      fn(3, { status: 'complete' });
      for (const url of [
        `${origin}/checkout#address`,
        `${origin}/checkout?step=2`,
        `${origin}/next`,
        'https://SHOP.example:443/next',
      ]) {
        tabUrl = url;
        fn(3, { url });
      }
    }
    expect(await read(requestId)).not.toBeNull();
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    await decide(requestId);
    expect((await response).values).toHaveLength(1);
  });
  it.each(['close', 'navigation'])('cancels during discovery on tab %s', async (action) => {
    vi.useFakeTimers();
    let release!: (value: { data: ReturnType<typeof data>; current: typeof current }) => void;
    load.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const response = worker.request(request, sender);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();
    if (action === 'close') for (const fn of tabRemoved) fn(3);
    else for (const fn of tabUpdated) fn(3, { url: 'https://elsewhere.example/' });
    expect(await response).toEqual({ values: [] });
    release({ data: data('1'), current });
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(0);
  });
  it('does not apply the loading timeout to profile switches inside an open preview', async () => {
    vi.useFakeTimers();
    const { response, requestId } = await open();
    let release!: (value: { data: ReturnType<typeof data>; current: typeof current }) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const switched = read(requestId, '2');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    release({ data: data('2'), current });
    expect((await switched)?.profileId).toBe('2');
    await decide(requestId, '2');
    expect((await response).values[0].value).toBe('Person 2');
  });
  it('closes a late-created preview after the tab has already closed', async () => {
    let createdWindow!: (window: chrome.windows.Window) => void;
    chrome.windows.create = ((opts, callback) => {
      created.push(opts as { url: string });
      createdWindow = callback!;
    }) as typeof chrome.windows.create;
    const { response } = await open();
    for (const fn of tabRemoved) fn(3);
    expect(await response).toEqual({ values: [] });
    createdWindow({ id: 9 } as chrome.windows.Window);
    expect(chrome.windows.remove).toHaveBeenCalledWith(9);
  });
  it.each([
    'runtime error',
    'missing id',
  ])('cleans up when window creation reports %s', async (mode) => {
    chrome.windows.create = ((_opts, callback) => {
      if (mode === 'runtime error')
        Object.assign(chrome.runtime, { lastError: { message: 'Window failed' } });
      callback!({} as chrome.windows.Window);
    }) as typeof chrome.windows.create;
    expect(await worker.request(request, sender)).toEqual({ values: [] });
  });
  it.each([
    'load',
    'profiles',
    'no active profile',
    'no default profile',
  ])('cleans up when discovery fails: %s', async (failure) => {
    if (failure === 'load') load.mockRejectedValue(new Error('Discovery failed'));
    else if (failure === 'profiles') listProfiles.mockRejectedValue(new Error('Unavailable'));
    else
      listProfiles.mockResolvedValue({
        profiles: failure === 'no active profile' ? [] : profiles,
        defaultProfileId: failure === 'no default profile' ? null : '1',
      });
    expect(await worker.request(request, sender)).toEqual({ values: [] });
    expect(created).toHaveLength(0);
  });
  it('cancels pending requests on profile revocation and drops only that profile grants', async () => {
    storage['solid:formfill-grants'] = [
      grant(),
      { ...grant('2'), origin: 'https://other.example' },
    ];
    const { response } = await open();
    await worker.revokeProfile('1');
    expect(await response).toEqual({ values: [] });
    expect(storage['solid:formfill-grants']).toEqual([
      { ...grant('2'), origin: 'https://other.example' },
    ]);
    await worker.reconcile([{ ...profiles[1], sessionState: 'signed-out' }]);
    expect(storage['solid:formfill-grants']).toEqual([]);
  });
  it.each([
    'removed',
    'signed-out',
  ])('cancels when reconciliation finds the profile %s', async (state) => {
    const { response, requestId } = await open();
    await worker.reconcile(
      state === 'removed' ? [] : [{ ...profiles[0], sessionState: 'signed-out' }],
    );
    expect(await response).toEqual({ values: [] });
    expect(await read(requestId)).toBeNull();
  });
  it('cancels on revocation of a profile still loading through the picker', async () => {
    const { response, requestId } = await open();
    let release!: (value: { data: ReturnType<typeof data>; current: typeof current }) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const switched = read(requestId, '2');
    await worker.revokeProfile('2');
    expect(await response).toEqual({ values: [] });
    release({ data: data('2'), current });
    expect(await switched).toBeNull();
  });
  it('rechecks session, navigation and grant authority before releasing values', async () => {
    for (const mutation of [
      () => {
        tabUrl = 'https://elsewhere.example/';
      },
      () => {
        current.mockRejectedValue(new Error('Signed out'));
      },
      () => {
        storage['solid:formfill-grants'] = [grant('2')];
      },
    ]) {
      created = [];
      tabUrl = sender.tab!.url!;
      storage = {};
      current.mockResolvedValue(undefined);
      const { response, requestId } = await open();
      mutation();
      await decide(requestId, '1', ['contact'], true);
      expect(await response).toEqual({ values: [] });
    }
  });
  it('admits same-origin subframes and loopback development pages', async () => {
    for (const source of [
      { ...sender, frameId: 2 },
      {
        ...sender,
        url: 'http://localhost:3001/form',
        origin: 'http://localhost:3001',
        tab: { id: 3, url: 'http://localhost:3001' },
      },
    ]) {
      created = [];
      tabUrl = source.url!;
      const response = worker.request(request, source as chrome.runtime.MessageSender);
      await vi.waitFor(() => expect(created).toHaveLength(1));
      const id = new URL(created[0].url).searchParams.get('requestId')!;
      await decide(id);
      expect((await response).values).toHaveLength(1);
    }
  });
});
it('registers an editable menu and routes its click to exactly the clicked tab and frame', () => {
  let click!: (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab) => void;
  (chrome as unknown as { contextMenus: unknown }).contextMenus = {
    create: vi.fn(),
    remove: (_id: string, callback: () => void) => callback(),
    onClicked: {
      addListener: (fn: typeof click) => {
        click = fn;
      },
    },
  };
  registerFormFillMenu();
  expect(chrome.contextMenus.create).toHaveBeenCalledWith({
    id: 'solid-fill-from-pod',
    title: 'Fill from pod',
    contexts: ['editable'],
  });
  click(
    { menuItemId: 'solid-fill-from-pod', frameId: 6 } as chrome.contextMenus.OnClickData,
    { id: 3 } as chrome.tabs.Tab,
  );
  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
    3,
    { type: 'SOLID_FORMFILL_TRIGGER' },
    { frameId: 6 },
  );
  click({ menuItemId: 'other' } as chrome.contextMenus.OnClickData, { id: 3 } as chrome.tabs.Tab);
  expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
});
