// AUTHORED-BY Claude Sonnet 5.5
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsContext } from "../src/shell/session/accounts-context";
import {
  clearRememberedPages,
  RememberedPagesAccountGuard,
  reconcileRememberedPages,
  ServiceWorkerRegistration,
} from "../src/shell/sync/service-worker";
import { act, h, mount } from "./drive-ui-dom";

function caches(names: string[]) {
  const stored = new Set(names);
  return {
    stored,
    keys: async () => [...stored],
    delete: async (name: string) => stored.delete(name),
  };
}
const OWNER = "suite.sw.pages-owner";
const ALL = ["suite-pages-v1", "app-shell-v1", "suite-other", "other"];

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("clearRememberedPages", () => {
  it("deletes only the remembered-page caches", async () => {
    const store = caches(ALL);
    await clearRememberedPages(store);
    expect([...store.stored]).toEqual(["app-shell-v1", "suite-other", "other"]);
  });
  it("tolerates missing or failing cache storage", async () => {
    await clearRememberedPages(undefined);
    await clearRememberedPages({
      keys: async () => {
        throw new Error("blocked");
      },
      delete: async () => true,
    });
  });
});

describe("reconcileRememberedPages", () => {
  it("clears when the account changes or signs out, and keeps them for the same account", async () => {
    const store = caches(ALL);
    expect(await reconcileRememberedPages("alice", localStorage, store)).toBe(true);
    store.stored.add("suite-pages-v1");
    expect(await reconcileRememberedPages("alice", localStorage, store)).toBe(false);
    expect(store.stored.has("suite-pages-v1")).toBe(true);
    expect(await reconcileRememberedPages("bob", localStorage, store)).toBe(true);
    expect(store.stored.has("suite-pages-v1")).toBe(false);
    store.stored.add("suite-pages-v1");
    expect(await reconcileRememberedPages(null, localStorage, store)).toBe(true);
    expect(localStorage.getItem(OWNER)).toBe("");
    expect(store.stored.has("suite-pages-v1")).toBe(false);
  });
  it("clears when storage is blocked", async () => {
    const store = caches(ALL);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(await reconcileRememberedPages("alice", blocked, store)).toBe(true);
    expect(await reconcileRememberedPages("alice", undefined, store)).toBe(true);
  });
});

describe("account change in a live tab", () => {
  it("clears remembered pages when the active account switches or signs out", async () => {
    const store = caches(ALL);
    vi.stubGlobal("caches", store);
    const value = (id: string | null) =>
      ({ status: id ? "ready" : "signed-out", active: id ? { id } : null }) as never;
    const view = (id: string | null) =>
      h(AccountsContext.Provider, { value: value(id) }, h(RememberedPagesAccountGuard));
    const mounted = await mount(view("alice"));
    store.stored.add("suite-pages-v1");
    await mounted.render(view("alice"));
    expect(store.stored.has("suite-pages-v1")).toBe(true);
    await mounted.render(view("bob"));
    await act(async () => {});
    expect(store.stored.has("suite-pages-v1")).toBe(false);
  });
  it("does nothing outside an account provider or while loading", async () => {
    const store = caches(ALL);
    vi.stubGlobal("caches", store);
    await mount(h(RememberedPagesAccountGuard));
    await mount(
      h(
        AccountsContext.Provider,
        { value: { status: "loading", active: null } as never },
        h(RememberedPagesAccountGuard),
      ),
    );
    expect(store.stored.has("suite-pages-v1")).toBe(true);
  });
});

describe("root registration", () => {
  it("clears pages saved for a previous account at load, in production only", async () => {
    const store = caches(ALL);
    vi.stubGlobal("caches", store);
    vi.stubGlobal("location", window.location);
    localStorage.setItem(OWNER, "alice");
    localStorage.setItem("suite.accounts.v1", JSON.stringify({ activeId: "bob", accounts: [] }));
    await mount(h(ServiceWorkerRegistration));
    expect(store.stored.has("suite-pages-v1")).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn(async () => ({})) } });
    await mount(h(ServiceWorkerRegistration));
    await act(async () => {});
    expect(store.stored.has("suite-pages-v1")).toBe(false);
  });
});
