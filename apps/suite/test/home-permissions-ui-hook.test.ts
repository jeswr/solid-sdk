// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentRow, PermissionsSnapshot } from "../src/apps/home/lib/permissions";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  session: undefined as unknown as PodSession,
  load: vi.fn(),
  apply: vi.fn(),
  client: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => mocks.session }));
vi.mock("@jeswr/suite-ui", () => ({
  toast: { success: mocks.success, error: mocks.error, info: mocks.info },
}));
vi.mock("../src/apps/home/lib/permissions", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  loadPermissions: mocks.load,
  applyRevoke: mocks.apply,
  resolveClientName: mocks.client,
}));

import { PartialRevokeError, RestoreConflictError } from "../src/apps/home/lib/permissions";
import { type PermissionsBinding, usePermissions } from "../src/apps/home/state/permissions";

const ROOT = "https://pod.test/";
const bob: AgentRow = {
  key: "bob",
  kind: "person",
  id: "https://bob.test/card#me",
  lines: [
    {
      key: "files",
      dataType: { id: "files", label: "Files" },
      domainId: "documents",
      role: "viewer",
      modes: ["read"],
      inherited: false,
      resources: [
        {
          url: `${ROOT}drive/Work/`,
          isContainer: true,
          modes: ["read"],
          inherited: false,
          source: `${ROOT}drive/Work/.acl`,
          node: `${ROOT}drive/Work/.acl#bob`,
          system: "wac",
          subject: { kind: "agent", webId: "https://bob.test/card#me" },
        },
      ],
    },
  ],
};
const snapshot: PermissionsSnapshot = {
  rows: [bob],
  failures: [],
  truncated: false,
  summary: { people: 1, apps: 0, publicItems: 0 },
};
let binding: PermissionsBinding;
let listeners: Set<(url: string) => void>;
let observeRender: ((state: PermissionsBinding) => void) | undefined;
function Probe() {
  binding = usePermissions();
  observeRender?.(binding);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  observeRender = undefined;
  listeners = new Set();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  const sessionFetch = vi.fn<typeof fetch>(
    async () => new Response("", { headers: { "content-type": "text/turtle" } }),
  );
  mocks.session = {
    mode: "demo",
    webId: `${ROOT}profile#me`,
    displayName: "Alice",
    storageUrl: ROOT,
    fetch: sessionFetch,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: async () => {},
  };
  mocks.load.mockResolvedValue(snapshot);
  mocks.apply.mockResolvedValue({ undo: { changes: [], restore: [] } });
  mocks.client.mockResolvedValue({ name: "Coach" });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => {
      throw new Error("Public profile unavailable");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
});

it("loads with session fetch, resolves foreign names publicly, and debounces subscription events", async () => {
  await mount(h(Probe));
  expect(binding.status).toBe("ready");
  expect(mocks.load).toHaveBeenCalledWith(
    expect.objectContaining({
      fetch: mocks.session.fetch,
      webId: mocks.session.webId,
      storage: ROOT,
    }),
  );
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "https://bob.test/card",
    expect.objectContaining({ credentials: "omit", redirect: "error" }),
  );
  expect(
    (mocks.session.fetch as ReturnType<typeof vi.fn>).mock.calls.every(([url]) =>
      String(url).startsWith(ROOT),
    ),
  ).toBe(true);
  vi.useFakeTimers();
  for (let i = 0; i < 3; i++) for (const listener of listeners) listener(`${ROOT}drive/file`);
  await act(() => vi.advanceTimersByTimeAsync(249));
  expect(mocks.load).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(mocks.load).toHaveBeenCalledTimes(2);
});

it("optimistically revokes a line, retains it through refresh, and invokes its exact Undo plan", async () => {
  await mount(h(Probe));
  const pending = deferred<{ undo: { changes: []; restore: [] } }>();
  mocks.apply.mockReturnValueOnce(pending.promise);
  let writing!: Promise<void>;
  await act(() => {
    writing = binding.revoke(bob.lines[0] as NonNullable<(typeof bob.lines)[0]>);
  });
  expect(binding.busy).toBe(true);
  expect(binding.removed.files).toBeDefined();
  await act(() => binding.refresh());
  expect(mocks.load).toHaveBeenCalledTimes(1);
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  await act(async () => {
    pending.resolve({ undo: { changes: [], restore: [] } });
    await writing;
  });
  const token = binding.removed.files?.token;
  expect(token).toBeTruthy();
  expect(binding.rows[0]?.lines[0]?.key).toBe("files");
  expect(mocks.success).toHaveBeenCalledWith(
    "bob.test will lose access to your Files",
    expect.objectContaining({ duration: 8000, action: expect.objectContaining({ label: "Undo" }) }),
  );
  mocks.load.mockResolvedValue(snapshot);
  await act(() => binding.undo(token as string));
  expect(mocks.apply.mock.calls[1]?.[0]).toEqual({ changes: [], restore: [] });
  expect(binding.removed).toEqual({});
  expect(binding.busy).toBe(false);
});

it("clears completed removal markers after an external regrant so Revoke all includes it", async () => {
  await mount(h(Probe));
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  await act(() => binding.revoke(bob.lines[0] as NonNullable<(typeof bob.lines)[0]>));
  expect(binding.removed.files?.token).toBeTruthy();
  mocks.load.mockResolvedValue(snapshot);
  await act(() => binding.refresh());
  expect(binding.removed).toEqual({});
  expect(binding.rows[0]?.lines).toEqual(bob.lines);
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  await act(() => binding.revoke(binding.rows[0] as AgentRow));
  expect(mocks.apply.mock.calls[1]?.[0].changes).toEqual([
    expect.objectContaining({ subject: { kind: "agent", webId: bob.id } }),
  ]);
  expect(binding.rows).toEqual([]);
});

it("makePrivate revokes both pseudo-agent grants and preserves named people", async () => {
  const pseudoRows = (["public", "authenticated"] as const).map((kind) => ({
    ...bob,
    key: kind,
    id: kind,
    kind,
    lines: bob.lines.map((line) => ({
      ...line,
      key: kind,
      resources: line.resources.map((resource) => ({ ...resource, subject: { kind } })),
    })),
  }));
  mocks.load.mockResolvedValue({ ...snapshot, rows: [...pseudoRows, bob] });
  await mount(h(Probe));
  mocks.load.mockResolvedValue(snapshot);
  await act(() => binding.revoke("makePrivate"));
  expect(
    mocks.apply.mock.calls[0]?.[0].changes.map((change: { subject: unknown }) => change.subject),
  ).toEqual([{ kind: "public" }, { kind: "authenticated" }]);
  expect(binding.rows).toEqual([bob]);
});

it.each([
  "https://id.test/alice#me",
  "https://pod.test/outside/card#me",
])("uses credential-free profile discovery outside storage: %s", async (webId) => {
  const storage = `${ROOT}alice/`;
  const profile = webId.split("#")[0] as string;
  mocks.session = { ...mocks.session, webId, storageUrl: storage };
  const plain = vi.fn<typeof fetch>(
    async () =>
      new Response(
        `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${storage}index>.`,
        { headers: { "content-type": "text/turtle" } },
      ),
  );
  vi.stubGlobal("fetch", plain);
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  const sessionFetch = vi.mocked(mocks.session.fetch);
  sessionFetch.mockResolvedValue(
    new Response(
      `<#registration> a <http://www.w3.org/ns/solid/terms#TypeRegistration>; <http://www.w3.org/ns/solid/terms#forClass> <https://schema.org/Book>; <http://www.w3.org/ns/solid/terms#instance> <${storage}book>.`,
      { headers: { "content-type": "text/turtle" } },
    ),
  );
  await mount(h(Probe));
  expect(plain).toHaveBeenCalledExactlyOnceWith(
    profile,
    expect.objectContaining({ credentials: "omit", redirect: "error" }),
  );
  expect(sessionFetch).toHaveBeenCalledExactlyOnceWith(
    `${storage}index`,
    expect.objectContaining({ redirect: "error" }),
  );
  expect(mocks.load).toHaveBeenCalledWith(
    expect.objectContaining({
      typeIndex: [{ forClass: "https://schema.org/Book", instance: `${storage}book` }],
    }),
  );
});

it.each([
  false,
  true,
])("refuses profile redirects without following them (in storage=%s)", async (withinStorage) => {
  const webId = withinStorage ? mocks.session.webId : "https://id.test/alice#me";
  mocks.session = { ...mocks.session, webId };
  const redirect = new Response(null, {
    status: 302,
    headers: { location: "https://evil.test/card" },
  });
  const plain = vi.fn<typeof fetch>(async () => redirect);
  vi.stubGlobal("fetch", plain);
  vi.mocked(mocks.session.fetch).mockResolvedValue(redirect);
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  await mount(h(Probe));
  const transport = withinStorage ? vi.mocked(mocks.session.fetch) : plain;
  expect(transport).toHaveBeenCalledExactlyOnceWith(
    webId.split("#")[0],
    expect.objectContaining({ redirect: "error" }),
  );
  if (!withinStorage) {
    expect(plain.mock.calls[0]?.[1]?.credentials).toBe("omit");
    expect(mocks.session.fetch).not.toHaveBeenCalled();
  } else expect(plain).not.toHaveBeenCalled();
  expect(binding.status).toBe("ready");
});

it("rolls failed writes back and offers a persistent Undo when only part of a write succeeded", async () => {
  await mount(h(Probe));
  mocks.apply.mockRejectedValueOnce(new Error("write failed"));
  await act(() => binding.revoke(bob.lines[0] as NonNullable<(typeof bob.lines)[0]>));
  expect(binding.removed).toEqual({});
  expect(mocks.error).toHaveBeenCalledWith("Couldn't change access for bob.test", {
    duration: Infinity,
  });
  mocks.apply.mockRejectedValueOnce(
    new PartialRevokeError({ changes: [], restore: [] }, new Error("write failed")),
  );
  await act(() => binding.revoke(bob));
  expect(mocks.error).toHaveBeenLastCalledWith(
    "Couldn't change access for bob.test",
    expect.objectContaining({
      duration: Infinity,
      action: expect.objectContaining({ label: "Undo" }),
    }),
  );
});

it("ignores a stale refresh that finishes after removing an agent", async () => {
  await mount(h(Probe));
  const stale = deferred<PermissionsSnapshot>();
  mocks.load.mockReturnValueOnce(stale.promise);
  let refreshing!: Promise<void>;
  await act(() => {
    refreshing = binding.refresh();
  });
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  await act(() => binding.revoke(bob));
  expect(binding.rows).toEqual([]);
  await act(async () => {
    stale.resolve(snapshot);
    await refreshing;
  });
  expect(binding.rows).toEqual([]);
});

it("blocks offline writes, refreshes on reconnection, and never renders a prior identity's rows", async () => {
  const view = await mount(h(Probe));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  await act(() => window.dispatchEvent(new Event("offline")));
  expect(binding.online).toBe(false);
  await act(() => binding.revoke(bob));
  expect(mocks.apply).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await act(() => window.dispatchEvent(new Event("online")));
  expect(mocks.load).toHaveBeenCalledTimes(2);
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  mocks.session = { ...mocks.session, webId: `${ROOT}other#me` };
  const observed: number[] = [];
  observeRender = (state) => observed.push(state.rows.length);
  await view.render(h(Probe));
  expect(observed.every((count) => count === 0)).toBe(true);
});

it("applies each name as it settles and never fetches a bare origin as a Client ID", async () => {
  const app = (id: string, key: string): AgentRow => ({ ...bob, key, id, kind: "app" });
  mocks.load.mockResolvedValue({
    ...snapshot,
    rows: [bob, app("https://slow.test/client.json", "slow"), app("https://origin.test", "origin")],
  });
  const slow = deferred<{ name: string }>();
  mocks.client.mockReturnValue(slow.promise);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(`<${bob.id}> <http://xmlns.com/foaf/0.1/name> "Bob".`, {
          headers: { "content-type": "text/turtle" },
        }),
    ),
  );
  await mount(h(Probe));
  // The person's name lands while the app's document is still pending.
  expect(binding.rows.find((row) => row.key === "bob")?.name).toBe("Bob");
  expect(binding.rows.find((row) => row.key === "slow")?.name).toBeUndefined();
  expect(mocks.client).toHaveBeenCalledExactlyOnceWith("https://slow.test/client.json");
  await act(async () => slow.resolve({ name: "Slow app" }));
  expect(binding.rows.find((row) => row.key === "slow")?.name).toBe("Slow app");
  expect(binding.clients["https://slow.test/client.json"]).toEqual({ name: "Slow app" });
  expect(binding.rows.find((row) => row.key === "bob")?.name).toBe("Bob");
});

async function revokedToken() {
  const view = await mount(h(Probe));
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  await act(() => binding.revoke(bob.lines[0] as NonNullable<(typeof bob.lines)[0]>));
  const token = binding.removed.files?.token as string;
  expect(token).toBeTruthy();
  return { token, view };
}

it("disables an Undo whose rules were changed elsewhere instead of suggesting a retry", async () => {
  const { token } = await revokedToken();
  mocks.apply.mockRejectedValueOnce(new RestoreConflictError());
  await act(() => binding.undo(token));
  expect(mocks.error).toHaveBeenLastCalledWith(
    "This access was changed elsewhere, so it can't be restored here",
  );
  expect(binding.removed.files?.stale).toBe(true);
  expect(binding.busy).toBe(false);
  await act(() => binding.undo(token));
  expect(mocks.apply).toHaveBeenCalledTimes(2);
});

it("keeps only the unrestored documents after a partial Undo, offers Undo remaining, and retires the refused part", async () => {
  const line = bob.lines[0] as NonNullable<(typeof bob.lines)[0]>;
  const resource = line.resources[0] as NonNullable<(typeof line.resources)[0]>;
  const names = ["a", "b", "c", "d", "e"];
  const spread: AgentRow = {
    ...bob,
    lines: [
      {
        ...line,
        resources: names.map((name) => ({
          ...resource,
          url: `${ROOT}${name}/`,
          source: `${ROOT}${name}/.acl`,
          node: `${ROOT}${name}/.acl#bob`,
        })),
      },
    ],
  };
  mocks.load.mockResolvedValue({ ...snapshot, rows: [spread] });
  await mount(h(Probe));
  const restore = names.map((name) => ({ source: `${ROOT}${name}/.acl`, remove: [], add: [] }));
  const [a, b, c, d, e] = restore as [
    (typeof restore)[0],
    (typeof restore)[0],
    (typeof restore)[0],
    (typeof restore)[0],
    (typeof restore)[0],
  ];
  mocks.apply.mockResolvedValueOnce({ undo: { changes: [], restore } });
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  await act(() => binding.revoke(spread.lines[0] as NonNullable<(typeof spread.lines)[0]>));
  const token = binding.removed.files?.token as string;
  expect(token).toBeTruthy();
  const toastUndo = mocks.success.mock.lastCall?.[1]?.action.onClick as () => void;
  const remainingAction = () => {
    const options = mocks.error.mock.lastCall?.[1];
    expect(options?.action.label).toBe("Undo remaining");
    // It outlasts the stale line, so it stays until dismissed.
    expect(options?.duration).toBe(Number.POSITIVE_INFINITY);
    return options?.action.onClick as () => void;
  };
  // A failed write keeps the rest available, from the line and from the toast.
  mocks.apply.mockRejectedValueOnce(
    new PartialRevokeError({ changes: [], restore: [a] }, new Error("offline")),
  );
  await act(async () => toastUndo());
  expect(mocks.error).toHaveBeenLastCalledWith(
    "Access restored for a/. Couldn't restore access to b/, c/, d/, e/. Refresh and try again.",
    expect.anything(),
  );
  expect(binding.removed.files?.stale).toBeUndefined();
  expect(binding.busy).toBe(false);
  // A refused document is retired: its line's Undo goes, the documents after it stay.
  const conflict = new RestoreConflictError();
  conflict.source = c.source;
  mocks.apply.mockRejectedValueOnce(
    new PartialRevokeError({ changes: [], restore: [b] }, conflict),
  );
  await act(async () => remainingAction()());
  expect(mocks.apply.mock.lastCall?.[0]).toEqual({ changes: [], restore: [b, c, d, e] });
  expect(mocks.error).toHaveBeenLastCalledWith(
    "Access restored for b/. Access to c/ was changed elsewhere, so it can't be restored here",
    expect.anything(),
  );
  expect(binding.removed.files?.stale).toBe(true);
  // Without a named document, the first unrestored one is the refused one.
  mocks.apply.mockRejectedValueOnce(
    new PartialRevokeError({ changes: [], restore: [d] }, new RestoreConflictError()),
  );
  await act(async () => remainingAction()());
  expect(mocks.apply.mock.lastCall?.[0]).toEqual({ changes: [], restore: [d, e] });
  expect(mocks.error).toHaveBeenLastCalledWith(
    "Access restored for d/. Access to e/ was changed elsewhere, so it can't be restored here",
  );
  const calls = mocks.apply.mock.calls.length;
  await act(async () => toastUndo());
  expect(mocks.apply).toHaveBeenCalledTimes(calls);
});

it("keeps the later documents when the first one is refused before anything is restored", async () => {
  const line = bob.lines[0] as NonNullable<(typeof bob.lines)[0]>;
  const resource = line.resources[0] as NonNullable<(typeof line.resources)[0]>;
  const names = ["a", "b", "c"];
  const spread: AgentRow = {
    ...bob,
    lines: [
      {
        ...line,
        resources: names.map((name) => ({
          ...resource,
          url: `${ROOT}${name}/`,
          source: `${ROOT}${name}/.acl`,
          node: `${ROOT}${name}/.acl#bob`,
        })),
      },
    ],
  };
  mocks.load.mockResolvedValue({ ...snapshot, rows: [spread] });
  await mount(h(Probe));
  const restore = names.map((name) => ({ source: `${ROOT}${name}/.acl`, remove: [], add: [] }));
  mocks.apply.mockResolvedValueOnce({ undo: { changes: [], restore } });
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  await act(() => binding.revoke(spread.lines[0] as NonNullable<(typeof spread.lines)[0]>));
  const token = binding.removed.files?.token as string;
  const conflict = new RestoreConflictError();
  conflict.source = `${ROOT}a/.acl`;
  mocks.apply.mockRejectedValueOnce(conflict);
  await act(() => binding.undo(token));
  expect(mocks.error).toHaveBeenLastCalledWith(
    "Access to a/ was changed elsewhere, so it can't be restored here",
    expect.objectContaining({ duration: Number.POSITIVE_INFINITY }),
  );
  expect(binding.removed.files?.stale).toBe(true);
  mocks.apply.mockResolvedValueOnce({ undo: { changes: [], restore: [] } });
  const remaining = mocks.error.mock.lastCall?.[1]?.action.onClick as () => void;
  await act(async () => remaining());
  expect(mocks.apply.mock.lastCall?.[0]).toEqual({ changes: [], restore: restore.slice(1) });
  expect(mocks.success).toHaveBeenLastCalledWith("Access restored");
});

it("shows the mounted page as saving while an earlier page's Undo holds the lock, and keeps a busy toast Undo open", async () => {
  const { view } = await revokedToken();
  const firstUndo = mocks.success.mock.lastCall?.[1]?.action.onClick as (event?: {
    preventDefault(): void;
  }) => void;
  await view.unmount();
  mocks.load.mockResolvedValue(snapshot);
  await mount(h(Probe));
  expect(binding.busy).toBe(false);
  // A second removal on this page, so a second toast Undo exists.
  mocks.load.mockResolvedValue({ ...snapshot, rows: [] });
  await act(() => binding.revoke(bob.lines[0] as NonNullable<(typeof bob.lines)[0]>));
  const secondUndo = mocks.success.mock.lastCall?.[1]?.action.onClick as (event?: {
    preventDefault(): void;
  }) => void;
  expect(binding.busy).toBe(false);
  const pending = deferred<{ undo: { changes: []; restore: [] } }>();
  mocks.apply.mockReturnValueOnce(pending.promise);
  await act(async () => firstUndo());
  expect(binding.busy).toBe(true);
  const click = { preventDefault: vi.fn() };
  await act(async () => secondUndo(click));
  expect(click.preventDefault).toHaveBeenCalledOnce();
  expect(mocks.info).toHaveBeenCalledWith("Another change is saving. Try again in a moment.");
  expect(mocks.apply).toHaveBeenCalledTimes(3);
  await act(async () => pending.resolve({ undo: { changes: [], restore: [] } }));
  expect(binding.busy).toBe(false);
  // Once the lock is free the same toast Undo applies, and closes as usual.
  const free = { preventDefault: vi.fn() };
  await act(async () => secondUndo(free));
  expect(free.preventDefault).not.toHaveBeenCalled();
  expect(mocks.apply).toHaveBeenCalledTimes(4);
});

it("keeps the Undo and toast of a revoke that finishes after leaving the page", async () => {
  const line = bob.lines[0] as NonNullable<(typeof bob.lines)[0]>;
  const plan = {
    changes: [],
    restore: [{ source: `${ROOT}drive/Work/.acl`, remove: [], add: [] }],
  };
  const leave = async (
    settle: (pending: ReturnType<typeof deferred<{ undo: typeof plan }>>) => void,
  ) => {
    const view = await mount(h(Probe));
    const pending = deferred<{ undo: typeof plan }>();
    mocks.apply.mockReturnValueOnce(pending.promise);
    let writing!: Promise<void>;
    await act(() => {
      writing = binding.revoke(line);
    });
    await view.unmount();
    await act(async () => {
      settle(pending);
      await writing;
    });
  };
  await leave((pending) => pending.reject(new Error("offline")));
  expect(mocks.error).toHaveBeenLastCalledWith("Couldn't change access for bob.test", {
    duration: Infinity,
  });
  await leave((pending) => pending.reject(new PartialRevokeError(plan, new Error("offline"))));
  expect(mocks.error).toHaveBeenLastCalledWith(
    "Couldn't change access for bob.test",
    expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
  );
  await leave((pending) => pending.resolve({ undo: plan }));
  expect(mocks.success).toHaveBeenLastCalledWith(
    "bob.test will lose access to your Files",
    expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
  );
  const toastUndo = mocks.success.mock.lastCall?.[1]?.action.onClick as () => void;
  await act(async () => toastUndo());
  expect(mocks.apply.mock.lastCall?.[0]).toEqual(plan);
  expect(mocks.success).toHaveBeenLastCalledWith("Access restored");
});

it("holds one write lock per session and refreshes the mounted page when an earlier page's Undo ends", async () => {
  const { token, view } = await revokedToken();
  const toastUndo = mocks.success.mock.lastCall?.[1]?.action.onClick as () => void;
  await view.unmount();
  const pending = deferred<{ undo: { changes: []; restore: [] } }>();
  mocks.apply.mockReturnValueOnce(pending.promise);
  await act(async () => toastUndo());
  expect(token).toBeTruthy();
  await mount(h(Probe));
  expect(binding.busy).toBe(true);
  const loads = mocks.load.mock.calls.length;
  await act(() => binding.revoke(bob));
  await act(() => binding.refresh());
  expect(mocks.apply).toHaveBeenCalledTimes(2);
  expect(mocks.load).toHaveBeenCalledTimes(loads);
  await act(async () => pending.resolve({ undo: { changes: [], restore: [] } }));
  expect(mocks.success).toHaveBeenLastCalledWith("Access restored");
  expect(mocks.load).toHaveBeenCalledTimes(loads + 1);
  expect(binding.busy).toBe(false);
});

it("still announces a toast Undo's result after leaving the page", async () => {
  const { view } = await revokedToken();
  const toastUndo = mocks.success.mock.lastCall?.[1]?.action.onClick as () => void;
  await view.unmount();
  mocks.success.mockClear();
  await act(async () => {
    toastUndo();
    await Promise.resolve();
  });
  expect(mocks.apply).toHaveBeenCalledTimes(2);
  expect(mocks.success).toHaveBeenCalledWith("Access restored");
});
