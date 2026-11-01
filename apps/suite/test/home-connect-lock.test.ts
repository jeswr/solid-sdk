// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { withConnectorLock } from "../src/apps/home/lib/connect/import-lock";
import { exclusiveLocks } from "./drive-locks";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

describe("connector import reservations", () => {
  it("uses an exclusive Web Lock scoped to storage and connector and forwards cancellation", async () => {
    const locks = exclusiveLocks();
    const request = vi.spyOn(locks, "request");
    vi.stubGlobal("navigator", { locks });
    const controller = new AbortController();
    const work = vi.fn(async () => "saved");
    expect(
      await withConnectorLock("https://pod.example/", "discord", controller.signal, work),
    ).toBe("saved");
    expect(request).toHaveBeenCalledWith(
      "suite-connector:https://pod.example/:discord",
      { signal: controller.signal },
      expect.any(Function),
    );
    controller.abort();
    await expect(withConnectorLock("pod", "discord", controller.signal, work)).rejects.toThrow();
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("reports a wait only when another sync holds the reservation, with Web Locks and without", async () => {
    for (const locks of [exclusiveLocks(), undefined]) {
      vi.stubGlobal("navigator", locks ? { locks } : {});
      const onWait = vi.fn();
      expect(await withConnectorLock("pod", "discord", signal(), async () => "free", onWait)).toBe(
        "free",
      );
      expect(onWait).not.toHaveBeenCalled();
      const release = deferred();
      const entered = deferred();
      const first = withConnectorLock("pod", "discord", signal(), async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;
      const second = withConnectorLock("pod", "discord", signal(), async () => "after", onWait);
      await vi.waitFor(() => expect(onWait).toHaveBeenCalledOnce());
      release.resolve();
      await first;
      expect(await second).toBe("after");
      expect(onWait).toHaveBeenCalledOnce();
    }
  });
  it("serializes the fallback within one tab, while other connectors and storage roots run independently", async () => {
    vi.stubGlobal("navigator", {});
    const entered = deferred();
    const release = deferred();
    const order: string[] = [];
    const first = withConnectorLock("pod", "discord", signal(), async () => {
      order.push("first");
      entered.resolve();
      await release.promise;
      order.push("saved");
    });
    await entered.promise;
    const second = withConnectorLock("pod", "discord", signal(), async () => {
      order.push("second");
    });
    await withConnectorLock("pod", "spotify", signal(), async () => {
      order.push("spotify");
    });
    await withConnectorLock("other-pod", "discord", signal(), async () => {
      order.push("other-pod");
    });
    expect(order).toEqual(["first", "spotify", "other-pod"]);
    release.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "spotify", "other-pod", "saved", "second"]);
  });
  it("releases failed fallback imports and does not run a cancelled queued callback", async () => {
    vi.stubGlobal("navigator", {});
    const entered = deferred();
    const release = deferred();
    const first = withConnectorLock("pod", "discord", signal(), async () => {
      entered.resolve();
      await release.promise;
      throw new Error("failed");
    });
    const failed = expect(first).rejects.toThrow("failed");
    await entered.promise;
    const controller = new AbortController();
    const work = vi.fn(async () => {});
    const second = withConnectorLock("pod", "discord", controller.signal, work);
    const cancelled = expect(second).rejects.toThrow();
    controller.abort();
    release.resolve();
    await Promise.all([failed, cancelled]);
    expect(work).not.toHaveBeenCalled();
    expect(await withConnectorLock("pod", "discord", signal(), async () => "retry")).toBe("retry");
  });
});
