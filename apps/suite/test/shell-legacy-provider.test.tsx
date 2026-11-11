// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { createLegacyStore, type LegacyPlan, recordActivity } from "@jeswr/pod-legacy";
import { createPodClient } from "@jeswr/storage-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LegacyProvider, useLegacy } from "../src/shell/legacy/provider";
import { addLocalNotification } from "../src/shell/notifications/local-store";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import { deferred, h } from "./drive-ui-dom";

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
afterEach(cleanup);
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
  vi.useRealTimers();
  accounts.current = {
    active: alice,
    status: "ready",
    isActiveAccount: (id: string) => accounts.current.active?.id === id,
    fetch: vi.fn(async () => new Response("")),
  } as unknown as AccountsContextValue;
  vi.mocked(createPodClient).mockResolvedValue({ storage: {} } as Awaited<
    ReturnType<typeof createPodClient>
  >);
});
function store(snapshot: { plan: LegacyPlan; etag: string } | null) {
  const result = {
    url: `${alice.storageUrl}settings/legacy-plan.ttl`,
    load: vi.fn(async () => snapshot),
    save: vi.fn(async (p: LegacyPlan) => ({ plan: p, etag: '"new"' })),
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
it("records existing activity once and queues an advisory warning without any access mutation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const backend = store({ plan: plan(), etag: '"old"' });
  render(tree());
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
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  (callback as () => void)();
  await waitFor(() => expect(addLocalNotification).toHaveBeenCalledOnce());
  (callback as () => void)();
  expect(addLocalNotification).toHaveBeenCalledOnce();
  interval.mockRestore();
  vi.useRealTimers();
});
