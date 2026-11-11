// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import { WalletUnsupportedError } from "@jeswr/solid-wallet";
import { StorageError } from "@jeswr/storage-client";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWallet, WalletProvider } from "@/apps/wallet/state/wallet-context";
import { ExtensionSessionError } from "@/lib/session/extension-pod-session";
import type { PodSession } from "@/lib/session/pod-session";

const seams = vi.hoisted(() => ({ open: vi.fn(), seed: vi.fn(), failure: vi.fn() }));
vi.mock("@/apps/wallet/lib/data/client", () => ({ openWallet: seams.open }));
vi.mock("@/apps/wallet/demo/sample", () => ({ ensureWalletSample: seams.seed }));
vi.mock("@jeswr/suite-ui", () => ({
  toast: { error: seams.failure },
  LoadingSkeleton: () => createElement("p", { role: "status" }, "Loading"),
  ErrorState: ({
    children,
    actions,
  }: {
    children: React.ReactNode;
    actions?: { retry: () => void };
  }) =>
    createElement(
      "div",
      { role: "alert" },
      children,
      actions && createElement("button", { type: "button", onClick: actions.retry }, "Retry"),
    ),
}));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const subscription = vi.fn((_listener: () => void) => vi.fn());
const session = {
  mode: "demo",
  fetch: vi.fn(),
  storageUrl: "https://pod.example/",
  webId: "https://pod.example/profile#me",
  displayName: "Sample",
  subscribe: subscription,
  reset: vi.fn(),
} as unknown as PodSession;
let observed: ReturnType<typeof useWallet> | undefined;
function Content() {
  observed = useWallet();
  const { snapshot } = observed;
  return createElement("p", null, `${snapshot.phase}:${snapshot.items.length}`);
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  seams.seed.mockReset().mockResolvedValue(undefined);
  seams.open.mockReset();
  observed = undefined;
  subscription.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("boots, exposes its account state, subscribes and releases the subscription", async () => {
  const stopped = vi.fn();
  subscription.mockReturnValueOnce(stopped);
  const repository = { initialise: vi.fn(async () => {}), list: vi.fn(async () => []) };
  seams.open.mockResolvedValue({ repository });
  await act(async () => {
    root.render(
      <WalletProvider session={session}>
        <Content />
      </WalletProvider>,
    );
  });
  expect(container.textContent).toBe("ready:0");
  expect(seams.seed).toHaveBeenCalledWith(session);
  expect(subscription).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(stopped).toHaveBeenCalledOnce();
  root = createRoot(container);
});
it("shows a privacy error and retries initialisation", async () => {
  const repository = {
    initialise: vi.fn().mockRejectedValueOnce(new Error("shared")).mockResolvedValue(undefined),
    list: vi.fn(async () => []),
  };
  seams.open.mockResolvedValue({ repository });
  await act(async () => {
    root.render(
      <WalletProvider session={session}>
        <Content />
      </WalletProvider>,
    );
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("private storage");
  await act(async () => container.querySelector("button")?.click());
  expect(container.textContent).toBe("ready:0");
});
it("ignores a delayed boot after unmount and useWallet requires a provider", async () => {
  let finish: (value: unknown) => void = () => {};
  seams.seed.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    root.render(
      <WalletProvider session={session}>
        <Content />
      </WalletProvider>,
    );
  });
  expect(container.textContent).toBe("Loading");
  await act(async () => root.unmount());
  root = createRoot(container);
  seams.open.mockResolvedValue({ repository: { initialise: vi.fn(async () => {}) } });
  await act(async () => finish(undefined));
  expect(subscription).not.toHaveBeenCalled();
  await expect(
    act(async () => {
      root.render(createElement(Content));
    }),
  ).rejects.toThrow(/provider is required/);
});

it("drops boot results at every async session boundary", async () => {
  for (const stage of ["open", "initialise", "list"] as const) {
    let finish: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const repository = { initialise: vi.fn(async () => {}), list: vi.fn(async () => []) };
    if (stage === "open") seams.open.mockReturnValue(pending);
    else seams.open.mockResolvedValue({ repository });
    if (stage === "initialise") repository.initialise.mockReturnValue(pending as Promise<void>);
    if (stage === "list") repository.list.mockReturnValue(pending as Promise<never[]>);
    await act(async () => {
      root.render(
        <WalletProvider session={session}>
          <Content />
        </WalletProvider>,
      );
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () =>
      finish(stage === "open" ? { repository } : stage === "list" ? [] : undefined),
    );
    expect(container.textContent).toBe("");
  }
});
it("ignores late boot failures, refreshes notifications when idle and reports failed optimistic saves", async () => {
  let fail: (error: unknown) => void = () => {};
  seams.seed.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  await act(async () => {
    root.render(
      <WalletProvider session={session}>
        <Content />
      </WalletProvider>,
    );
  });
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => fail(new Error("late")));
  seams.seed.mockResolvedValue(undefined);
  const repository = {
    initialise: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    save: vi.fn().mockRejectedValueOnce(new Error("write failed")),
  };
  seams.open.mockResolvedValue({ repository });
  await act(async () => {
    root.render(
      <WalletProvider session={session}>
        <Content />
      </WalletProvider>,
    );
  });
  const listener = subscription.mock.calls.at(-1)?.[0] as unknown as () => void;
  await act(async () => listener());
  expect(repository.list).toHaveBeenCalledTimes(2);
  await act(async () => {
    await observed?.state
      .save({ name: "New", kind: "certificate", created: new Date(), modified: new Date() })
      .catch(() => {});
  });
  expect(seams.failure).toHaveBeenCalled();
  let finish: (value: unknown) => void = () => {};
  repository.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let saving: Promise<unknown> | undefined;
  await act(async () => {
    saving = observed?.state.save({
      name: "Busy",
      kind: "certificate",
      created: new Date(),
      modified: new Date(),
    });
  });
  const reads = repository.list.mock.calls.length;
  await act(async () => listener());
  expect(repository.list).toHaveBeenCalledTimes(reads);
  await act(async () => {
    finish({
      name: "Busy",
      kind: "certificate",
      created: new Date(),
      modified: new Date(),
      url: "https://pod.example/wallet/one.ttl",
      etag: '"v2"',
    });
    await saving;
  });
});

it("shows an unsupported pod distinctly, without shared-storage or permissions advice", async () => {
  const repository = {
    initialise: vi.fn().mockRejectedValue(new WalletUnsupportedError()),
    list: vi.fn(async () => []),
  };
  seams.open.mockResolvedValue({ repository });
  await act(async () => {
    root.render(
      <WalletProvider session={session}>
        <Content />
      </WalletProvider>,
    );
  });
  const alert = container.querySelector('[role="alert"]')?.textContent ?? "";
  expect(alert).toContain("This pod's access setup isn't supported by Wallet yet.");
  expect(alert).not.toMatch(/shared|private storage|Check Wallet and Settings/);
  expect(container.querySelector("button")).toBeNull();
  expect(repository.list).not.toHaveBeenCalled();
});
it("words a delete that cannot finish after an account switch as not completed", async () => {
  vi.useFakeTimers();
  try {
    const item = {
      name: "Passport",
      kind: "passport" as const,
      created: new Date(),
      modified: new Date(),
      url: "https://pod.example/wallet/one.ttl",
      etag: '"v1"',
    };
    const stale = new ExtensionSessionError("stale");
    const repository = {
      initialise: vi.fn(async () => {}),
      list: vi.fn(async () => [item]),
      remove: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        // storage-client wraps the extension's rejection as a network error.
        .mockRejectedValueOnce(
          new StorageError("network", { method: "DELETE", url: item.url, cause: stale }),
        )
        .mockRejectedValueOnce(new Error("privacy check failed")),
    };
    seams.open.mockResolvedValue({ repository });
    await act(async () => {
      root.render(
        <WalletProvider session={session}>
          <Content />
        </WalletProvider>,
      );
    });
    seams.failure.mockClear();
    await act(async () => {
      observed?.state.remove(item);
      await vi.advanceTimersByTimeAsync(8001);
    });
    expect(seams.failure).toHaveBeenLastCalledWith(expect.stringMatching(/^Couldn't save/));
    await act(async () => {
      observed?.state.remove(item);
      await vi.advanceTimersByTimeAsync(8001);
    });
    expect(seams.failure).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Delete not completed\. "Passport" may still be in your pod/),
    );
    // Unmounting for the new account flushes the pending delete against the old session.
    await act(async () => {
      observed?.state.remove(item);
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(repository.remove).toHaveBeenCalledTimes(3);
    expect(seams.failure).toHaveBeenCalledTimes(3);
    expect(seams.failure).toHaveBeenLastCalledWith(expect.stringMatching(/^Delete not completed/));
  } finally {
    vi.useRealTimers();
  }
});
