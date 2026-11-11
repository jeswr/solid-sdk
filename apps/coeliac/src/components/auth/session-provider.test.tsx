// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6
import { IssuerChoiceRequiredError, publicFetch } from "@jeswr/app-session";
import {
  deferred,
  fakePodAuth,
  identity,
  ISSUER,
  POD_ROOT,
  WEB_ID,
} from "@jeswr/app-session/testing";
import type { Identity } from "@jeswr/pod-auth";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiaryStore } from "@/lib/cache/diary-store";
import { defaultKv, MemoryKv } from "@/lib/cache/kv";
import { newMealRecord } from "@/lib/diary/log";
import { flushOutbox } from "@/lib/diary/sync";
import { ensureDiaryReady } from "@/lib/pod/pod-fs";
import { registerDiaryTypes } from "@/lib/pod/type-index";
import { anonymousSession, type SessionValue, useSession } from "@/lib/session/context";
import { NoStorageError, useDiaryActions } from "@/lib/session/use-diary-actions";
import { SessionProvider } from "./session-provider";

vi.mock("@/lib/pod/pod-fs", () => ({
  ensureDiaryReady: vi.fn(async () => {}),
  resetDiaryReadyMemo: vi.fn(),
}));
vi.mock("@/lib/pod/type-index", () => ({ registerDiaryTypes: vi.fn(async () => {}) }));
vi.mock("@/lib/diary/sync", () => ({ flushOutbox: vi.fn(async () => {}) }));
vi.mock("@/lib/cache/kv", async (original) => {
  const actual = await original<typeof import("@/lib/cache/kv")>();
  return { ...actual, defaultKv: vi.fn() };
});

let current: SessionValue;
let actions: ReturnType<typeof useDiaryActions>;
function Diary() {
  const session = useSession();
  const diaryActions = useDiaryActions();
  useEffect(() => {
    current = session;
    actions = diaryActions;
  }, [session, diaryActions]);
  return <p>Private diary for {session.webId}</p>;
}
const readProfile = vi.fn(async (webId: string) => ({
  webId,
  name: "Alice",
  storages: ["https://unverified.example/"],
  oidcIssuers: [],
}));
let fake: ReturnType<typeof fakePodAuth>;
function mount(strict = false) {
  const tree = (
    <SessionProvider auth={fake.auth} readProfile={readProfile}>
      <Diary />
    </SessionProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}
async function restore(active: Identity = identity) {
  fake.auth.restore.mockResolvedValue(active);
  fake.auth.identity.mockResolvedValue(active);
  mount(true);
  await screen.findByText(`Private diary for ${active.webId}`);
  await waitFor(() => expect(flushOutbox).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  current = { ...anonymousSession };
  vi.mocked(defaultKv).mockReturnValue(new MemoryKv());
  fake = fakePodAuth();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  vi.mocked(ensureDiaryReady).mockResolvedValue(undefined);
  vi.mocked(registerDiaryTypes).mockResolvedValue({ registered: true });
  vi.mocked(flushOutbox).mockResolvedValue({ synced: 0, failed: 0 });
});
afterEach(cleanup);

it("restores once in StrictMode and threads the verified root and fetch into all diary work", async () => {
  const globalFetch = globalThis.fetch;
  await restore();
  expect(fake.auth.restore).toHaveBeenCalledTimes(1);
  expect(ensureDiaryReady).toHaveBeenCalledWith(fake.auth.fetch, POD_ROOT, WEB_ID);
  expect(registerDiaryTypes).toHaveBeenCalledWith(fake.auth.fetch, {
    webId: WEB_ID,
    storageRoot: POD_ROOT,
  });
  expect(flushOutbox).toHaveBeenCalledWith(
    { authedFetch: fake.auth.fetch, webId: WEB_ID, storageRoot: POD_ROOT },
    current.store,
  );
  expect(current.authedFetch).toBe(fake.auth.fetch);
  expect(current.publicFetch).toBe(publicFetch);
  expect(readProfile).toHaveBeenCalledWith(WEB_ID, publicFetch);
  expect(globalThis.fetch).toBe(globalFetch);
  vi.mocked(flushOutbox).mockClear();
  fireEvent(window, new Event("online"));
  await waitFor(() => expect(flushOutbox).toHaveBeenCalledTimes(1));
});

it("cleans only this app's exact legacy entries once, preserving data, theme and other apps", async () => {
  const deleteDatabase = vi.fn();
  vi.stubGlobal("indexedDB", { deleteDatabase });
  for (const key of [
    "coeliac-diary:last-account",
    "coeliac-diary:accounts",
    "coeliac-diary:theme",
    "pod-docs:accounts",
  ])
    localStorage.setItem(key, "keep-or-delete");
  sessionStorage.setItem("coeliac-diary:unrelated", "keep");
  mount(true);
  await screen.findByRole("heading", { name: "Sign in" });
  expect(deleteDatabase.mock.calls).toEqual([["coeliac-diary-session"]]);
  expect(localStorage.getItem("coeliac-diary:last-account")).toBeNull();
  expect(localStorage.getItem("coeliac-diary:accounts")).toBeNull();
  expect(localStorage.getItem("coeliac-diary:theme")).toBe("keep-or-delete");
  expect(localStorage.getItem("pod-docs:accounts")).toBe("keep-or-delete");
  expect(sessionStorage.getItem("coeliac-diary:unrelated")).toBe("keep");
});

it("uses the shared account list and its abortable login seam", async () => {
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER, displayName: "Alice" }]);
  fake.auth.identity.mockResolvedValue(identity);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
  await screen.findByText(`Private diary for ${WEB_ID}`);
  expect(fake.auth.login).toHaveBeenCalledWith(
    { webId: WEB_ID, issuer: ISSUER },
    { signal: expect.any(AbortSignal) },
  );
});

it("keeps the WebID when the shared card asks for an explicit issuer choice", async () => {
  const second = "https://second.example/";
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
  fake.auth.login.mockRejectedValueOnce(new IssuerChoiceRequiredError([ISSUER, second]));
  fake.auth.identity.mockResolvedValue(identity);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: new RegExp("alice.example") }));
  fireEvent.click(await screen.findByRole("button", { name: /second.example/ }));
  await screen.findByText(`Private diary for ${WEB_ID}`);
  expect(fake.auth.login).toHaveBeenLastCalledWith(
    { webId: WEB_ID, issuer: second },
    { signal: expect.any(AbortSignal) },
  );
});

it("aborts an unmounted login without logging out or forgetting saved sessions", async () => {
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
  const login = deferred<Identity>();
  fake.auth.login.mockReturnValue(login.promise);
  const view = mount();
  fireEvent.click(await screen.findByRole("button", { name: /alice.example/ }));
  await waitFor(() => expect(fake.auth.login).toHaveBeenCalledTimes(1));
  const signal = fake.auth.login.mock.calls[0][1]?.signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => login.resolve(identity));
  expect(fake.auth.logout).not.toHaveBeenCalled();
  expect(ensureDiaryReady).not.toHaveBeenCalled();
});

it("explains that logging needs storage while retaining the signed-in account and cached data", async () => {
  const store = new DiaryStore(defaultKv(), WEB_ID);
  const meal = newMealRecord({ storageRoot: POD_ROOT, items: [{ name: "Rice" }] });
  await store.putMeal(meal);
  const active = { ...identity, storages: [] };
  fake.auth.restore.mockResolvedValue(active);
  fake.auth.identity.mockResolvedValue(active);
  mount();
  await screen.findByText(`Private diary for ${WEB_ID}`);
  expect(current.storageRoot).toBeNull();
  expect(current.status).toBe("authed");
  expect(await current.store!.allMeals()).toEqual([meal]);
  expect(screen.getByRole("alert")).toHaveTextContent("You’re signed in");
  expect(screen.getByRole("alert")).toHaveTextContent("logging and syncing are unavailable");
  await expect(actions.logMeal({ items: [] })).rejects.toThrow(NoStorageError);
  await expect(actions.relogMeal(meal)).rejects.toThrow(NoStorageError);
  await expect(actions.logSymptom({ symptomType: "bloating" })).rejects.toThrow(
    "logging requires a verified pod storage location",
  );
  expect(await current.store!.allMeals()).toEqual([meal]);
  expect(await current.store!.allSymptoms()).toEqual([]);
  expect(fake.auth.fetch).not.toHaveBeenCalled();
  fireEvent(window, new Event("online"));
  await act(async () => {});
  expect(ensureDiaryReady).not.toHaveBeenCalled();
  expect(registerDiaryTypes).not.toHaveBeenCalled();
  expect(flushOutbox).not.toHaveBeenCalled();
});

it("continues provisioning and flush after best-effort setup failures", async () => {
  vi.mocked(ensureDiaryReady).mockRejectedValueOnce(new Error("offline"));
  vi.mocked(registerDiaryTypes).mockRejectedValueOnce(new Error("no type index"));
  await restore();
  expect(flushOutbox).toHaveBeenCalledTimes(1);
});

it("flushes before revoking, then purges the departed WebID cache", async () => {
  await restore();
  const store = current.store!;
  const purge = vi.spyOn(store, "purge");
  const flush = vi.mocked(flushOutbox).mockClear();
  await act(async () => current.logout());
  expect(flush).toHaveBeenCalledTimes(1);
  expect(fake.auth.logout).toHaveBeenCalledTimes(1);
  expect(purge).toHaveBeenCalledTimes(1);
  expect(flush.mock.invocationCallOrder[0]).toBeLessThan(
    fake.auth.logout.mock.invocationCallOrder[0],
  );
  expect(fake.auth.logout.mock.invocationCallOrder[0]).toBeLessThan(
    purge.mock.invocationCallOrder[0],
  );
  expect(store.isPurged()).toBe(true);
  expect(screen.queryByText(/Private diary/)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps purge and revoke failures independent through both retries", async () => {
  await restore();
  const purge = vi.spyOn(current.store!, "purge").mockRejectedValueOnce(new Error("quota"));
  fake.auth.logout.mockImplementationOnce(async () => {
    fake.emit("logout", null);
    throw new Error("revoke failed");
  });
  await act(async () => current.logout());
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Clear local data" }));
  await waitFor(() => expect(purge).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
  expect(screen.getByRole("alert")).toHaveTextContent("Sign-out may be incomplete");
  fireEvent.click(screen.getByRole("button", { name: "Sign out again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(fake.auth.logout).toHaveBeenCalledTimes(2);
});

it("preserves the purge warning when revocation is retried first", async () => {
  await restore();
  vi.spyOn(current.store!, "purge").mockRejectedValueOnce(new Error("quota"));
  fake.auth.logout.mockRejectedValueOnce(new Error("revocation failed"));
  await act(async () => current.logout());
  fireEvent.click(screen.getByRole("button", { name: "Sign out again" }));
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
  expect(screen.getByRole("alert")).toHaveTextContent("Local health data");
});

it.each(["expired", "no session"])(
  "purges the remembered WebID cache when restore reports %s before any activation",
  async (outcome) => {
    const store = new DiaryStore(defaultKv(), WEB_ID);
    const other = new DiaryStore(defaultKv(), `${WEB_ID}-other`);
    const meal = newMealRecord({ storageRoot: POD_ROOT, items: [{ name: "Rice" }] });
    await store.putMeal(meal);
    await store.putSafetyContext({ kind: "safetyContext", coeliacDiagnosed: true, updatedAt: "now" });
    await other.putMeal(meal);
    fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
    fake.auth.restore.mockImplementationOnce(async () => {
      expect(ensureDiaryReady).not.toHaveBeenCalled();
      expect(screen.queryByText(/Private diary/)).toBeNull();
      // The real core forgets its account pointer before it emits expired.
      fake.auth.remembered.mockResolvedValue([]);
      if (outcome === "expired") fake.emit("expired", null);
      return null;
    });
    mount(true);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(fake.auth.restore).toHaveBeenCalledTimes(1);
    expect(fake.auth.remembered.mock.invocationCallOrder[0]).toBeLessThan(
      fake.auth.restore.mock.invocationCallOrder[0],
    );
    expect(await store.allMeals()).toEqual([]);
    expect(await store.getSafetyContext()).toBeUndefined();
    expect(await other.allMeals()).toEqual([meal]);
    expect(ensureDiaryReady).not.toHaveBeenCalled();
    expect(registerDiaryTypes).not.toHaveBeenCalled();
    expect(flushOutbox).not.toHaveBeenCalled();
    expect(readProfile).not.toHaveBeenCalled();
    expect(fake.auth.logout).not.toHaveBeenCalled();
  },
);

it("waits for restore-time cache deletion before offering sign-in", async () => {
  const deletion = deferred<void>();
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
  const purge = vi.spyOn(DiaryStore.prototype, "purge").mockReturnValueOnce(deletion.promise);
  mount();
  await waitFor(() => expect(purge).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("heading", { name: /Sign in|Choose an account/ })).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Restoring your session");
  await act(async () => deletion.resolve());
  await screen.findByRole("heading", { name: "Choose an account" });
});

it("reports a failed restore-time purge and retries the inactive account's cache", async () => {
  const store = new DiaryStore(defaultKv(), WEB_ID);
  const meal = newMealRecord({ storageRoot: POD_ROOT, items: [] });
  await store.putMeal(meal);
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
  const purge = vi.spyOn(DiaryStore.prototype, "purge").mockRejectedValueOnce(new Error("blocked"));
  mount(true);
  await screen.findByRole("heading", { name: "Choose an account" });
  expect(await store.allMeals()).toEqual([meal]);
  expect(await screen.findByRole("alert")).toHaveTextContent("Local health data");
  fireEvent.click(screen.getByRole("button", { name: "Clear local data" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(purge).toHaveBeenCalledTimes(2);
  expect(await store.allMeals()).toEqual([]);
  expect(fake.auth.logout).not.toHaveBeenCalled();
});

it("retains the remembered account's cache when restore succeeds", async () => {
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
  const store = new DiaryStore(defaultKv(), WEB_ID);
  const meal = newMealRecord({ storageRoot: POD_ROOT, items: [] });
  await store.putMeal(meal);
  await restore();
  expect(await current.store!.allMeals()).toEqual([meal]);
});

it("retains the cache on a thrown transient restore error", async () => {
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
  const store = new DiaryStore(defaultKv(), WEB_ID);
  const meal = newMealRecord({ storageRoot: POD_ROOT, items: [] });
  await store.putMeal(meal);
  fake.auth.restore.mockRejectedValueOnce(new Error("offline"));
  mount();
  await screen.findByRole("heading", { name: "Choose an account" });
  expect(await store.allMeals()).toEqual([meal]);
});

it("still purges when restore emits expired before rejecting", async () => {
  fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
  const store = new DiaryStore(defaultKv(), WEB_ID);
  await store.putMeal(newMealRecord({ storageRoot: POD_ROOT, items: [] }));
  fake.auth.restore.mockImplementationOnce(async () => {
    fake.auth.remembered.mockResolvedValue([]);
    fake.emit("expired", null);
    throw new Error("credential storage failed");
  });
  mount(true);
  await screen.findByRole("heading", { name: "Sign in" });
  expect(await store.allMeals()).toEqual([]);
  expect(ensureDiaryReady).not.toHaveBeenCalled();
});

it("purges an active cache when another caller logs out through the same core", async () => {
  await restore();
  const store = current.store!;
  await act(async () => fake.auth.logout());
  await waitFor(() => expect(store.isPurged()).toBe(true));
  expect(screen.queryByText(/Private diary/)).toBeNull();
  expect(fake.auth.logout).toHaveBeenCalledTimes(1);
});

it("fences background provisioning when logout happens during its first request", async () => {
  const setup = deferred<void>();
  vi.mocked(ensureDiaryReady).mockReturnValueOnce(setup.promise);
  fake.auth.restore.mockResolvedValue(identity);
  fake.auth.identity.mockResolvedValue(identity);
  mount();
  await screen.findByText(`Private diary for ${WEB_ID}`);
  await waitFor(() => expect(current.status).toBe("authed"));
  await act(async () => current.logout());
  vi.mocked(flushOutbox).mockClear();
  await act(async () => setup.resolve());
  expect(registerDiaryTypes).not.toHaveBeenCalled();
  expect(flushOutbox).not.toHaveBeenCalled();
});

it("fences a late identity read after core logout", async () => {
  const pending = deferred<Identity | null>();
  fake.auth.restore.mockResolvedValue(identity);
  fake.auth.identity.mockReturnValue(pending.promise);
  mount();
  await waitFor(() => expect(fake.auth.identity).toHaveBeenCalled());
  expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Restoring your session");
  await act(async () => fake.auth.logout());
  await act(async () => pending.resolve(identity));
  expect(screen.queryByText(/Private diary/)).toBeNull();
  expect(ensureDiaryReady).not.toHaveBeenCalled();
});
