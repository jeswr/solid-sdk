// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountsProvider, useAccounts } from "../src/shell/session/accounts-provider";
import { onBeforeSignOut } from "../src/shell/session/sign-out-cleanup";
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

it.each([
  "signOut",
  "signOutAll",
] as const)("silences push before %s revokes credentials and fences sign-in during cleanup", async (action) => {
  const first = backend(one);
  const second = backend(two);
  await mount(h(AccountsProvider, { backends: [first, second], children: h(Probe) }));
  const order: string[] = [];
  let finish = () => {};
  const cleanup = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = onBeforeSignOut(async (account) => {
    order.push(`silence:${account.id}`);
    await cleanup;
  });
  vi.mocked(first.signOut).mockImplementation(async () => {
    order.push("revoke:one");
  });
  let pending = Promise.resolve();
  expect(accounts.fetchFor?.(one)).toBe(fetch);
  try {
    await act(() => {
      pending = accounts[action]();
    });
    expect(order[0]).toBe("silence:one");
    expect(first.signOut).not.toHaveBeenCalled();
    expect(accounts.isActiveAccount("one")).toBe(false);
    // No account-bound fetch can be minted while beforeSignOut is still pending.
    expect(() => accounts.fetchFor?.(one)).toThrow("Sign in to continue");
    if (action === "signOutAll")
      expect(() => accounts.fetchFor?.(two)).toThrow("Sign in to continue");
    else expect(accounts.fetchFor?.(two)).toBe(fetch);
    await expect(accounts.signIn({ issuer: "https://id.example" })).rejects.toThrow("in progress");
    await act(async () => {
      finish();
      await pending;
    });
    expect(order.indexOf("revoke:one")).toBeGreaterThan(order.indexOf("silence:one"));
  } finally {
    stop();
    finish();
    await pending;
  }
});

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

it.each([
  "signOut",
  "signOutAll",
] as const)("completes %s and revocation after rejecting push cleanup, retaining retry metadata", async (action) => {
  const first = backend(one);
  const second = backend(two);
  await mount(h(AccountsProvider, { backends: [first, second], children: h(Probe) }));
  const failure = new Error("Push cleanup pending");
  const retry = { registrationId: "registration", removing: true, topics: ["inbox"] };
  localStorage.setItem("suite.push.v1.https://relay.example", JSON.stringify(retry));
  const cleanup = vi.fn(async (account: SuiteAccount) => {
    expect(accounts.isSignedInAccount?.(account.id)).toBe(false);
    if (account.id === one.id) throw failure;
  });
  const stop = onBeforeSignOut(cleanup);
  try {
    await act(async () => {
      await expect(accounts[action]()).rejects.toBe(failure);
    });
    expect(first.signOut).toHaveBeenCalledExactlyOnceWith(one);
    expect(accounts.isSignedInAccount?.(one.id)).toBe(false);
    expect(localStorage.getItem("suite.recent.v1.one")).toBeNull();
    expect(accounts.accounts).toEqual(action === "signOut" ? [two] : []);
    expect(accounts.status).toBe(action === "signOut" ? "ready" : "signed-out");
    if (action === "signOutAll") {
      expect(second.signOut).toHaveBeenCalledExactlyOnceWith(two);
      expect(cleanup).toHaveBeenCalledTimes(2);
    }
    expect(JSON.parse(localStorage.getItem("suite.push.v1.https://relay.example")!)).toEqual(retry);
    expect(() => accounts.fetchFor?.(one)).toThrow("Sign in");
  } finally {
    stop();
  }
});

it.each([
  "signOut",
  "signOutAll",
] as const)("reports push and credential failures after %s completes", async (action) => {
  const first = backend(one);
  const second = backend(two);
  const pushError = new Error("Push cleanup pending");
  const credentialError = new Error("Revocation failed");
  vi.mocked(first.signOut).mockRejectedValue(credentialError);
  await mount(h(AccountsProvider, { backends: [first, second], children: h(Probe) }));
  const stop = onBeforeSignOut(async (account) => {
    if (account.id === one.id) throw pushError;
  });
  try {
    await act(async () => {
      await expect(accounts[action]()).rejects.toMatchObject({
        errors: [pushError, credentialError],
      });
    });
    if (action === "signOutAll") expect(second.signOut).toHaveBeenCalledWith(two);
    expect(accounts.accounts).toEqual(action === "signOut" ? [two] : []);
  } finally {
    stop();
  }
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
