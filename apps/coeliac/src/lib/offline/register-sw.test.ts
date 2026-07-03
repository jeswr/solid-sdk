// AUTHORED-BY Claude Fable 5
import { describe, expect, it, vi } from "vitest";
import {
  applyServiceWorkerPolicy,
  type CacheStorageLike,
  deleteShellCaches,
  type NavigatorLike,
  purgeShellCache,
  registerServiceWorker,
  SERVICE_WORKER_URL,
  unregisterServiceWorkers,
} from "./register-sw";
import { SHELL_CACHE_NAME, SHELL_CACHE_PREFIX } from "./shell-manifest";

function fakeNavigator(overrides: Partial<NavigatorLike["serviceWorker"]> = {}): {
  navigator: NavigatorLike;
  register: ReturnType<typeof vi.fn>;
} {
  const register = vi.fn(async () => ({ scope: "/" }));
  const navigator: NavigatorLike = {
    serviceWorker: {
      register,
      ...overrides,
    } as NavigatorLike["serviceWorker"],
  };
  return { navigator, register };
}

describe("registerServiceWorker", () => {
  it("registers the root-scoped worker with cache revalidation", async () => {
    const { navigator, register } = fakeNavigator();
    const result = await registerServiceWorker({ navigator });
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, {
      scope: "/",
      updateViaCache: "none",
    });
    expect(result).not.toBeNull();
  });

  it("no-ops (returns null) when disabled", async () => {
    const { navigator, register } = fakeNavigator();
    const result = await registerServiceWorker({ navigator, disabled: true });
    expect(register).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("no-ops when the environment has no serviceWorker container", async () => {
    const result = await registerServiceWorker({ navigator: {} });
    expect(result).toBeNull();
  });

  it("never throws when registration rejects — the app works without the worker", async () => {
    const register = vi.fn(async () => {
      throw new Error("SecurityError");
    });
    const navigator: NavigatorLike = {
      serviceWorker: { register } as NavigatorLike["serviceWorker"],
    };
    await expect(registerServiceWorker({ navigator })).resolves.toBeNull();
  });
});

describe("unregisterServiceWorkers", () => {
  it("unregisters every registration, tolerating individual failures", async () => {
    const good = { unregister: vi.fn(async () => true) };
    const bad = {
      unregister: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const navigator: NavigatorLike = {
      serviceWorker: {
        register: vi.fn(),
        getRegistrations: vi.fn(async () => [good, bad]),
      } as unknown as NavigatorLike["serviceWorker"],
    };
    await expect(unregisterServiceWorkers({ navigator })).resolves.toBeUndefined();
    expect(good.unregister).toHaveBeenCalled();
    expect(bad.unregister).toHaveBeenCalled();
  });

  it("no-ops when getRegistrations is unavailable", async () => {
    const { navigator } = fakeNavigator();
    await expect(unregisterServiceWorkers({ navigator })).resolves.toBeUndefined();
  });
});

describe("purgeShellCache", () => {
  it("messages the controlling worker to drop the shell cache", () => {
    const postMessage = vi.fn();
    const navigator: NavigatorLike = {
      serviceWorker: {
        register: vi.fn(),
        controller: { postMessage },
      } as unknown as NavigatorLike["serviceWorker"],
    };
    purgeShellCache({ navigator });
    expect(postMessage).toHaveBeenCalledWith({ type: "purge-shell" });
  });

  it("no-ops when there is no controller", () => {
    const { navigator } = fakeNavigator();
    expect(() => purgeShellCache({ navigator })).not.toThrow();
  });
});

function fakeCaches(names: string[]): { caches: CacheStorageLike; deleted: string[] } {
  const deleted: string[] = [];
  const caches: CacheStorageLike = {
    keys: vi.fn(async () => names),
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return true;
    }),
  };
  return { caches, deleted };
}

describe("deleteShellCaches", () => {
  it("deletes only shell-prefixed caches, leaving others intact", async () => {
    const { caches, deleted } = fakeCaches([
      SHELL_CACHE_NAME,
      `${SHELL_CACHE_PREFIX}v0`,
      "workbox-precache",
      "some-other-cache",
    ]);
    await deleteShellCaches({ caches });
    expect(deleted).toEqual([SHELL_CACHE_NAME, `${SHELL_CACHE_PREFIX}v0`]);
  });

  it("no-ops when no CacheStorage is available", async () => {
    await expect(deleteShellCaches({})).resolves.toBeUndefined();
  });
});

describe("applyServiceWorkerPolicy", () => {
  it("registers the worker in a production build", async () => {
    const { navigator, register } = fakeNavigator();
    const { caches } = fakeCaches([]);
    const result = await applyServiceWorkerPolicy({ navigator, caches, production: true });
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, {
      scope: "/",
      updateViaCache: "none",
    });
    expect(result).not.toBeNull();
  });

  it("does NOT register in dev — it unregisters any worker AND purges shell caches", async () => {
    const register = vi.fn(async () => ({ scope: "/" }));
    const stale = { unregister: vi.fn(async () => true) };
    const navigator: NavigatorLike = {
      serviceWorker: {
        register,
        getRegistrations: vi.fn(async () => [stale]),
      } as unknown as NavigatorLike["serviceWorker"],
    };
    const { caches, deleted } = fakeCaches([SHELL_CACHE_NAME]);
    const result = await applyServiceWorkerPolicy({ navigator, caches, production: false });
    expect(result).toBeNull();
    expect(register).not.toHaveBeenCalled();
    expect(stale.unregister).toHaveBeenCalled();
    expect(deleted).toEqual([SHELL_CACHE_NAME]);
  });
});
