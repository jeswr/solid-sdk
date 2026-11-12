// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountsProvider, useAccounts } from "../src/shell/session/accounts-provider";
import type { SessionBackend, SuiteAccount } from "../src/shell/session/types";
import { OfflineProvider } from "../src/shell/sync/offline-provider";
import { act, h, mount } from "./drive-ui-dom";

vi.mock("next/navigation", () => ({ usePathname: () => "/search" }));
vi.mock("../src/shell/settings/preferences", () => ({
  useAllPreferences: () => ({
    preferences: { offline: true, offlineHintSeen: true },
    ready: true,
  }),
}));
vi.mock("../src/shell/sync/service-worker", () => ({ rememberPage: vi.fn() }));
vi.mock("../src/shell/sync/connection-state", async (original) => ({
  ...(await original<typeof import("../src/shell/sync/connection-state")>()),
  useConnectionState: () => "online",
}));

const one: SuiteAccount = {
  id: "one",
  kind: "solid",
  name: "Avery Reed",
  webId: "https://example.org/one#me",
  storageUrl: "https://example.org/one/",
};
const two: SuiteAccount = {
  id: "two",
  kind: "extension",
  name: "Robin Fern",
  webId: "https://example.com/two#me",
  storageUrl: "https://example.com/two/",
};
let accounts: ReturnType<typeof useAccounts>;
function Probe() {
  accounts = useAccounts();
  return null;
}
function backend(account: SuiteAccount): SessionBackend {
  return {
    kind: account.kind,
    restore: async () => account,
    signIn: async () => account,
    signOut: vi.fn(async () => {}),
    fetchFor: () => fetch,
    onExpired: () => () => {},
  };
}
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "suite.accounts.v1",
    JSON.stringify({ activeId: "one", accounts: [one, two] }),
  );
  for (const id of ["one", "two", "removed"]) localStorage.setItem(`suite.recent.v1.${id}`, "[]");
  localStorage.setItem(
    "suite.outbox.v1.one",
    JSON.stringify({
      pending: [
        {
          id: "unsent",
          label: "Rename",
          where: "Drive",
          state: "pending",
          queuedAt: "2026-11-01T12:00:00Z",
        },
      ],
      conflicts: [],
    }),
  );
});
afterEach(() => vi.useRealTimers());

it("removes only the signed-out account's history and retains its pending outbox even if logout fails", async () => {
  const first = backend(one);
  const failure = vi.spyOn(first, "signOut").mockRejectedValue(new Error("provider unavailable"));
  await mount(h(AccountsProvider, { backends: [first, backend(two)], children: h(Probe) }));
  expect(accounts.status).toBe("ready");
  const outbox = localStorage.getItem("suite.outbox.v1.one");
  await act(async () => {
    await expect(accounts.signOut("one")).rejects.toThrow("provider unavailable");
  });
  expect(failure).toHaveBeenCalledWith(one);
  expect(accounts.active?.id).toBe("two");
  expect(localStorage.getItem("suite.recent.v1.one")).toBeNull();
  expect(localStorage.getItem("suite.recent.v1.two")).toBe("[]");
  expect(localStorage.getItem("suite.outbox.v1.one")).toBe(outbox);
});

it("clears every recent-items key on sign-out-all while preserving unsent changes", async () => {
  await mount(h(AccountsProvider, { backends: [backend(one), backend(two)], children: h(Probe) }));
  const outbox = localStorage.getItem("suite.outbox.v1.one");
  await act(async () => {
    await accounts.signOutAll();
  });
  expect(accounts.status).toBe("signed-out");
  expect(accounts.accounts).toEqual([]);
  expect(Object.keys(localStorage).filter((key) => key.startsWith("suite.recent.v1."))).toEqual([]);
  expect(localStorage.getItem("suite.outbox.v1.one")).toBe(outbox);
});

it.each(
  (["signOut", "signOutAll", "switchTo"] as const).flatMap((transition) =>
    (["timer", "observer"] as const).map((callback) => ({ transition, callback })),
  ),
)("blocks the $callback immediately on $transition, before React commits", async ({
  transition,
  callback,
}) => {
  vi.useFakeTimers();
  document.title = "Search · Solid Suite";
  const view = await mount(
    h(AccountsProvider, {
      backends: [backend(one), backend(two)],
      children: h(OfflineProvider, { children: h(Probe) }),
    }),
  );
  if (callback === "observer") {
    await act(() => vi.advanceTimersByTime(0));
    expect(JSON.parse(localStorage.getItem("suite.recent.v1.one") ?? "[]")).toMatchObject([
      { title: document.title, href: "/search" },
    ]);
  }
  const history = localStorage.getItem("suite.recent.v1.one");
  const outbox = localStorage.getItem("suite.outbox.v1.one");
  await act(async () => {
    // React still exposes the old account to its consumers during these callbacks.
    const pending = transition === "switchTo" ? accounts.switchTo("two") : accounts[transition]();
    expect(accounts.active?.id).toBe("one");
    const afterTransition = localStorage.getItem("suite.recent.v1.one");
    if (callback === "observer") {
      document.title = "A late private title";
      await Promise.resolve();
    } else vi.advanceTimersByTime(0);
    expect(localStorage.getItem("suite.recent.v1.one")).toBe(afterTransition);
    await pending;
  });
  await act(async () => {
    document.title = "A title after React commits";
    vi.advanceTimersByTime(0);
  });
  expect(localStorage.getItem("suite.recent.v1.one")).toBe(
    transition === "switchTo" ? history : null,
  );
  expect(localStorage.getItem("suite.recent.v1.two")).toBe(
    transition === "signOutAll" ? null : "[]",
  );
  expect(localStorage.getItem("suite.outbox.v1.one")).toBe(outbox);
  await view.unmount();
});

it("pins migration fetch to an account and rejects calls and delayed responses after switching", async () => {
  let resolve!: (response: Response) => void;
  const delayedFetch = vi.fn<typeof globalThis.fetch>(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount(
    h(AccountsProvider, {
      backends: [{ ...backend(one), fetchFor: () => delayedFetch }, backend(two)],
      children: h(Probe),
    }),
  );
  const pinned = accounts.fetchFor(one);
  const pending = pinned(one.storageUrl);
  await act(async () => {
    accounts.switchTo("two");
  });
  resolve(new Response("private source"));
  await expect(pending).rejects.toThrow("active account changed");
  await expect(pinned(one.storageUrl)).rejects.toThrow("Sign in to continue");
  expect(delayedFetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    accounts.switchTo("one");
  });
  await expect(pinned(one.storageUrl)).rejects.toThrow("Sign in to continue");
});
