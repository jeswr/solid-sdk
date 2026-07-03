// AUTHORED-BY Claude Fable 5
import { describe, expect, it, vi } from "vitest";
import {
  type NavigatorLike,
  purgeShellCache,
  registerServiceWorker,
  SERVICE_WORKER_URL,
  unregisterServiceWorkers,
} from "./register-sw";

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
