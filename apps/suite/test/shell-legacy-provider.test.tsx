// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import {
  createLegacyStore,
  type LegacyPlan,
  LegacyPrivacyError,
  type LegacySnapshot,
  recordActivity,
} from "@jeswr/pod-legacy";
import { createPodClient, StorageError } from "@jeswr/storage-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LegacyBanner } from "../src/shell/legacy/banner";
import {
  LEGACY_CONFLICT,
  LegacyProvider,
  sameContent,
  useLegacy,
} from "../src/shell/legacy/provider";
import { addLocalNotification } from "../src/shell/notifications/local-store";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import { act, deferred, h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { render, screen, waitFor, cleanup } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const accounts = vi.hoisted(() => ({ current: {} as AccountsContextValue }));
vi.mock("../src/shell/session/accounts-provider", () => ({ useAccounts: () => accounts.current }));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));
vi.mock("@jeswr/pod-legacy", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-legacy")>()),
  createLegacyStore: vi.fn(),
}));
vi.mock("../src/shell/notifications/local-store", () => ({
  addLocalNotification: vi.fn(async () => {}),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const alice = {
  id: "legacy-alice",
  name: "Alice",
  kind: "solid" as const,
  storageUrl: "https://alice.example/",
  webId: "https://alice.example/#me",
};
const bob = {
  ...alice,
  id: "legacy-bob",
  webId: "https://bob.example/#me",
  storageUrl: "https://bob.example/",
};
const now = new Date("2026-06-01T12:00:00Z");
const plan = (): LegacyPlan => ({
  owner: alice.webId,
  storage: alice.storageUrl,
  enabled: true,
  inactivityMonths: 6,
  warningDays: [30, 7],
  notifyMeBy: ["settings", "tray"],
  created: new Date("2025-01-01"),
  modified: new Date("2026-01-01T12:00:00Z"),
  lastActivity: new Date("2026-01-01T12:00:00Z"),
  contacts: [
    {
      webId: "https://alex.example/#me",
      displayName: "Alex",
      mode: "read",
      scope: "containers",
      targets: [`${alice.storageUrl}Photos/`],
    },
  ],
});
let actions: ReturnType<typeof useLegacy>;
function Consumer() {
  actions = useLegacy();
  return h(
    "p",
    { "data-testid": "legacy-session" },
    actions.session?.account.id ?? actions.error ?? "loading",
  );
}
const tree = () => h(LegacyProvider, { children: h(Consumer) });
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.spyOn(window, "addEventListener");
  vi.useRealTimers();
  accounts.current = {
    active: alice,
    status: "ready",
    isActiveAccount: (id: string) => accounts.current.active?.id === id,
    fetch: vi.fn(async () => new Response("", { headers: { date: now.toUTCString() } })),
  } as unknown as AccountsContextValue;
  vi.mocked(createPodClient).mockResolvedValue({ storage: {} } as Awaited<
    ReturnType<typeof createPodClient>
  >);
});
function store(snapshot: LegacySnapshot | null) {
  const result = {
    url: `${alice.storageUrl}settings/legacy-plan.ttl`,
    load: vi.fn(async () => {
      const options = vi.mocked(createLegacyStore).mock.calls.at(-1)?.[0];
      await options?.fetch(`${alice.storageUrl}settings/legacy-plan.ttl`);
      return snapshot;
    }),
    save: vi.fn(async (p: LegacyPlan) => ({ plan: p, etag: '"new"' })),
    delete: vi.fn(async () => {}),
  };
  vi.mocked(createLegacyStore).mockReturnValue(result);
  return result;
}
it("does not create a plan when none exists", async () => {
  const backend = store(null);
  render(tree());
  await waitFor(() => expect(screen.getByTestId("legacy-session").textContent).toBe(alice.id));
  expect(backend.save).not.toHaveBeenCalled();
  expect(addLocalNotification).not.toHaveBeenCalled();
});
async function interact() {
  const handler = vi
    .mocked(window.addEventListener)
    .mock.calls.find(([type]) => type === "pointerdown")?.[1];
  expect(handler).toBeTypeOf("function");
  await act(async () => {
    (handler as (event: Event) => void)({ isTrusted: true } as Event);
  });
}
it("records existing activity once and queues an advisory warning without any access mutation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const backend = store({ plan: plan(), etag: '"old"' });
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  expect(backend.save).not.toHaveBeenCalled();
  await interact();
  await waitFor(() => expect(backend.save).toHaveBeenCalledOnce());
  expect(backend.save).toHaveBeenCalledWith(recordActivity(plan(), now), '"old"');
  expect(addLocalNotification).toHaveBeenCalledWith(
    alice.id,
    expect.objectContaining({ href: "/settings/legacy", body: expect.stringContaining("30 days") }),
  );
  await waitFor(() => expect(actions.session?.snapshot?.etag).toBe('"new"'));
  vi.useRealTimers();
});
it("does not rewrite a plan recorded less than 24 hours ago", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const p = plan();
  p.lastActivity = now;
  p.modified = now;
  const backend = store({ plan: p, etag: '"old"' });
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  await interact();
  expect(backend.save).not.toHaveBeenCalled();
  vi.useRealTimers();
});
it("fences delayed plan reads and transport after an account switch", async () => {
  const pending = deferred<Awaited<ReturnType<ReturnType<typeof createLegacyStore>["load"]>>>();
  const backend = store(null);
  backend.load.mockReturnValue(pending.promise);
  const view = render(tree());
  await waitFor(() => expect(backend.load).toHaveBeenCalled());
  const firstFetch = vi.mocked(createPodClient).mock.calls[0]?.[0].fetch;
  accounts.current = { ...accounts.current, active: bob };
  store(null);
  view.rerender(tree());
  pending.resolve({ plan: plan(), etag: '"old"' });
  await waitFor(() => expect(createPodClient).toHaveBeenCalledTimes(2));
  await expect(firstFetch?.("https://alice.example/private")).rejects.toThrow("account changed");
  expect(backend.save).not.toHaveBeenCalled();
  expect(addLocalNotification).not.toHaveBeenCalled();
});
it("shows a privacy refusal and never offers a session containing untrusted data", async () => {
  const backend = store(null);
  backend.load.mockRejectedValue(new Error("Make settings private"));
  render(tree());
  await waitFor(() =>
    expect(screen.getByTestId("legacy-session").textContent).toBe("Make settings private"),
  );
  expect(actions.session).toBeNull();
  expect(backend.save).not.toHaveBeenCalled();
});
it("notifies once when an open session later crosses a warning boundary", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const interval = vi.spyOn(globalThis, "setInterval");
  const p = plan();
  p.lastActivity = now;
  p.modified = now;
  store({ plan: p, etag: '"today"' });
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  const callback = interval.mock.calls.find(([, delay]) => delay === 60000)?.[0];
  expect(typeof callback).toBe("function");
  // Wall-clock time advances (e.g. across a sleep); no monotonic delta is relied on.
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  (callback as () => void)();
  await waitFor(() => expect(addLocalNotification).toHaveBeenCalledOnce());
  (callback as () => void)();
  expect(addLocalNotification).toHaveBeenCalledOnce();
  interval.mockRestore();
  vi.useRealTimers();
});
const precondition = () =>
  new StorageError("precondition-failed", {
    method: "PUT",
    url: `${alice.storageUrl}settings/legacy-plan.ttl`,
    status: 412,
  });
it("reloads a heartbeat-only winner after a two-tab 412, skips the losing heartbeat, and keeps the draft", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const backend = store({ plan: plan(), etag: '"old"' });
  backend.save.mockRejectedValueOnce(precondition());
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  const base = actions.session!.snapshot;
  backend.load.mockResolvedValue({
    plan: { ...plan(), modified: now, lastActivity: now },
    etag: '"winner"',
  });
  await interact();
  await waitFor(() => expect(actions.session?.snapshot?.etag).toBe('"winner"'));
  expect(actions.error).toBe("");
  expect(actions.session?.revision).toBe(0); // Content unchanged: the editor is not remounted.
  expect(backend.save).toHaveBeenCalledOnce();
  await interact();
  expect(backend.save).toHaveBeenCalledOnce();
  // A draft edited from the pre-heartbeat snapshot holds the same content, so it may save.
  await act(async () => {
    await actions.session?.save({ ...plan(), enabled: false }, base);
  });
  expect(backend.save.mock.calls[1]).toEqual([
    { ...plan(), enabled: false, lastActivity: now },
    '"winner"',
  ]);
});
it("refuses a stale draft after a heartbeat 412 reveals another tab's content change", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const backend = store({ plan: plan(), etag: '"old"' });
  backend.save.mockRejectedValueOnce(precondition());
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  const stale = actions.session!.snapshot;
  // The other tab removed the only contact and disabled the plan.
  const winner = { ...plan(), enabled: false, contacts: [], modified: now, lastActivity: now };
  backend.load.mockResolvedValue({ plan: winner, etag: '"winner"' });
  await interact();
  await waitFor(() => expect(actions.session?.revision).toBe(1));
  expect(actions.session?.snapshot?.plan).toEqual(winner);
  // The stale draft would re-add the removed contact; it is refused, nothing is written.
  await expect(actions.session!.save(plan(), stale)).rejects.toThrow(LEGACY_CONFLICT);
  await expect(actions.session!.delete(stale)).rejects.toThrow(LEGACY_CONFLICT);
  expect(backend.save).toHaveBeenCalledOnce();
  expect(backend.delete).not.toHaveBeenCalled();
  // A draft based on the winner saves with its ETag.
  const fresh = actions.session!.snapshot;
  await act(async () => {
    await actions.session!.save({ ...winner, enabled: false }, fresh);
  });
  expect(backend.save).toHaveBeenLastCalledWith({ ...winner, enabled: false }, '"winner"');
});
it("observes the winner when a user save hits 412 and never retries it", async () => {
  const backend = store({ plan: plan(), etag: '"old"' });
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  const base = actions.session!.snapshot;
  backend.save.mockRejectedValueOnce(precondition());
  const winner = { ...plan(), inactivityMonths: 12 };
  backend.load.mockResolvedValue({ plan: winner, etag: '"winner"' });
  let failure: unknown;
  await act(async () => {
    failure = await actions.session!.save({ ...plan(), enabled: false }, base).catch((e) => e);
  });
  expect((failure as Error).message).toBe(LEGACY_CONFLICT);
  expect(backend.save).toHaveBeenCalledOnce();
  await waitFor(() => expect(actions.session?.revision).toBe(1));
  expect(actions.session?.snapshot?.etag).toBe('"winner"');
  // Other failures propagate unchanged and do not reload.
  backend.save.mockRejectedValueOnce(new Error("offline"));
  backend.load.mockClear();
  await expect(actions.session!.save(winner, actions.session!.snapshot)).rejects.toThrow("offline");
  expect(backend.load).not.toHaveBeenCalled();
});
it("compares snapshot content, ignoring heartbeat timestamps and placeholder ETags", () => {
  const p = plan();
  expect(sameContent(null, null)).toBe(true);
  expect(sameContent(null, { plan: null, etag: '"empty"' })).toBe(true);
  expect(sameContent({ plan: null, etag: '"a"', invalid: true }, null)).toBe(false);
  expect(
    sameContent(
      { plan: null, etag: '"a"', invalid: true },
      { plan: null, etag: '"b"', invalid: true },
    ),
  ).toBe(true);
  expect(sameContent({ plan: null, etag: '"a"', invalid: true }, { plan: p, etag: '"b"' })).toBe(
    false,
  );
  expect(sameContent({ plan: p, etag: '"a"' }, { plan: null, etag: '"b"', invalid: true })).toBe(
    false,
  );
  expect(sameContent({ plan: p, etag: '"a"' }, null)).toBe(false);
  expect(
    sameContent(
      { plan: p, etag: '"a"' },
      { plan: { ...p, lastActivity: now, modified: now }, etag: '"b"' },
    ),
  ).toBe(true);
  expect(
    sameContent({ plan: p, etag: '"a"' }, { plan: { ...p, enabled: false }, etag: '"a"' }),
  ).toBe(false);
});
it("opens a recoverable placeholder and fills it conditionally", async () => {
  const backend = store({ plan: null, etag: '"empty"' });
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  expect(backend.save).not.toHaveBeenCalled();
  await act(async () => {
    await actions.session?.save(plan(), actions.session.snapshot);
  });
  expect(backend.save).toHaveBeenCalledWith(plan(), '"empty"');
});
it("offers replacement or deletion of an invalid plan without evaluating it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const backend = store({ plan: null, etag: '"broken"', invalid: true });
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  await interact();
  expect(backend.save).not.toHaveBeenCalled(); // No heartbeat for an invalid plan.
  expect(addLocalNotification).not.toHaveBeenCalled();
  const fresh = { ...plan(), created: now, modified: now, lastActivity: now };
  await act(async () => {
    await actions.session?.save(fresh, actions.session.snapshot);
  });
  expect(backend.save).toHaveBeenCalledWith(fresh, '"broken"');
});
it("recovers an interrupted first save in the same session", async () => {
  const backend = store(null);
  backend.save.mockRejectedValueOnce(new Error("offline after create"));
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  await expect(actions.session?.save(plan(), null)).rejects.toThrow("offline");
  backend.load.mockResolvedValueOnce({ plan: null, etag: '"placeholder"' });
  await act(async () => {
    await actions.session?.save(plan(), null);
  });
  expect(backend.save).toHaveBeenLastCalledWith(plan(), '"placeholder"');
});
it("withdraws the plan with its current validator and fences stale deletion", async () => {
  const backend = store({ plan: plan(), etag: '"current"' });
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  const session = actions.session!;
  await act(async () => {
    await session.delete(session.snapshot);
  });
  expect(backend.delete).toHaveBeenCalledExactlyOnceWith('"current"');
  expect(actions.session?.snapshot).toBeNull();
  await session.delete(null);
  expect(backend.delete).toHaveBeenCalledOnce();
  accounts.current = { ...accounts.current, active: bob };
  await expect(session.delete(null)).rejects.toThrow("account changed");
  await expect(session.save(plan(), null)).rejects.toThrow("account changed");
});
it("bounds activity and the banner to an exposed Date header despite a fast device clock", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2035-01-01"));
  accounts.current.fetch = vi.fn(
    async () => new Response("", { headers: { date: now.toUTCString() } }),
  );
  const backend = store({ plan: plan(), etag: '"old"' });
  render(
    h(LegacyProvider, {
      children: [h(Consumer, { key: "consumer" }), h(LegacyBanner, { key: "banner" })],
    }),
  );
  await waitFor(() => expect(actions.session).toBeTruthy());
  expect(screen.getByText(/You haven't been active/).textContent).toContain("30 days");
  expect(screen.queryByText(/Your legacy plan is due/)).toBeNull();
  await interact();
  const heartbeat = backend.save.mock.calls[0]?.[0].lastActivity.getTime();
  expect(heartbeat).toBeGreaterThanOrEqual(now.getTime() + 300_000);
  expect(heartbeat).toBeLessThan(now.getTime() + 301_000);
});
it.each([
  ["a days-old Last-Modified without Date", { "last-modified": "Fri, 29 May 2026 12:00:00 GMT" }],
  ["an invalid Date", { date: "invalid" }],
  ["no clock headers", {}],
])("uses the device clock with %s, so a daily heartbeat still advances", async (_, headers) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  accounts.current.fetch = vi.fn(async () => new Response("", { headers }));
  const p = plan();
  p.lastActivity = new Date("2026-05-29T11:00:00Z"); // Before Last-Modified, three days ago.
  p.modified = p.lastActivity;
  const backend = store({ plan: p, etag: '"old"' });
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  expect(actions.session?.now()).toEqual(now);
  await interact();
  await waitFor(() => expect(backend.save).toHaveBeenCalledOnce());
  expect(backend.save.mock.calls[0]?.[0].lastActivity).toEqual(now);
});
it("creates a new plan after a 404 without a Date header", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  accounts.current.fetch = vi.fn(async () => new Response(null, { status: 404 }));
  const backend = store(null);
  render(tree());
  await waitFor(() => expect(actions.session).toBeTruthy());
  const time = actions.session!.now();
  expect(Number.isFinite(time.getTime())).toBe(true);
  const created: LegacyPlan = {
    ...plan(),
    enabled: false,
    contacts: [],
    created: time,
    modified: time,
    lastActivity: time,
  };
  await act(async () => {
    await actions.session?.save(created, null);
  });
  expect(backend.save).toHaveBeenCalledWith(created, null);
});
it("offers a conditional delete of exactly the plan when privacy cannot be verified, then reloads", async () => {
  const backend = store(null);
  backend.load.mockRejectedValueOnce(new LegacyPrivacyError('"private?"'));
  render(tree());
  await waitFor(() => expect(actions.withdraw).toBeTypeOf("function"));
  expect(actions.session).toBeNull();
  expect(actions.error).toContain("Make settings private");
  await act(async () => {
    await actions.withdraw?.();
  });
  expect(backend.delete).toHaveBeenCalledExactlyOnceWith('"private?"');
  expect(backend.save).not.toHaveBeenCalled();
  await waitFor(() => expect(actions.session?.snapshot).toBeNull());
  expect(actions.error).toBe("");
  expect(actions.withdraw).toBeUndefined();
});
it("does not offer deletion without a known version, and fences it after an account switch", async () => {
  const backend = store(null);
  backend.load.mockRejectedValueOnce(new LegacyPrivacyError());
  const view = render(tree());
  await waitFor(() => expect(actions.error).toContain("Make settings private"));
  expect(actions.withdraw).toBeUndefined();
  cleanup();
  backend.load.mockRejectedValueOnce(new LegacyPrivacyError('"v"'));
  render(tree());
  await waitFor(() => expect(actions.withdraw).toBeTypeOf("function"));
  const withdraw = actions.withdraw!;
  accounts.current = { ...accounts.current, active: bob };
  await expect(withdraw()).rejects.toThrow("account changed");
  expect(backend.delete).not.toHaveBeenCalled();
  view.unmount();
});
