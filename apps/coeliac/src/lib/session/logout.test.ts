// AUTHORED-BY Claude Fable 5
import { describe, expect, it, vi } from "vitest";
import { DiaryStore } from "../cache/diary-store";
import { MemoryKv } from "../cache/kv";
import { newMealRecord } from "../diary/log";
import { performSecureLogout, runSecureLogout } from "./logout";

const ROOT = "https://alice.example/";

function seededStore(): DiaryStore {
  return new DiaryStore(new MemoryKv(), "https://alice.example/#me");
}

describe("performSecureLogout", () => {
  it("runs flush → revoke → purge in order, leaving the cache empty", async () => {
    const store = seededStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const calls: string[] = [];
    const flush = vi.fn(async () => {
      calls.push("flush");
    });
    const revokeCredentials = vi.fn(async () => {
      calls.push("revoke");
    });
    const purgeSpy = vi.spyOn(store, "purge");

    await performSecureLogout({ store, flush, revokeCredentials });

    expect(calls).toEqual(["flush", "revoke"]);
    expect(flush).toHaveBeenCalledOnce();
    expect(revokeCredentials).toHaveBeenCalledOnce();
    expect(purgeSpy).toHaveBeenCalledOnce();
    expect(await store.allMeals()).toHaveLength(0);
  });

  it("swallows a flush failure but STILL revokes + purges (offline logout)", async () => {
    const store = seededStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const revokeCredentials = vi.fn(async () => {});
    const flush = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(performSecureLogout({ store, flush, revokeCredentials })).resolves.toBeUndefined();
    expect(revokeCredentials).toHaveBeenCalledOnce();
    expect(await store.allMeals()).toHaveLength(0); // purged despite the flush failure
  });

  it("swallows a credential-revoke failure but STILL purges (privacy is mandatory)", async () => {
    const store = seededStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const revokeCredentials = vi.fn(async () => {
      throw new Error("revoke blew up");
    });

    await expect(performSecureLogout({ store, revokeCredentials })).resolves.toBeUndefined();
    expect(await store.allMeals()).toHaveLength(0);
  });

  it("propagates a purge failure so the caller can surface an incomplete wipe", async () => {
    const failingKv = new (class extends MemoryKv {
      override async del(): Promise<void> {
        throw new Error("blocked");
      }
    })();
    const store = new DiaryStore(failingKv, "https://alice.example/#me");
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));

    await expect(performSecureLogout({ store })).rejects.toThrow(/failed to delete/);
  });

  it("is a no-op (no throw) when there is no store or callbacks (never signed in)", async () => {
    await expect(performSecureLogout({ store: null })).resolves.toBeUndefined();
  });

  it("does not require flush/revoke — purges when only a store is given", async () => {
    const store = seededStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    await performSecureLogout({ store });
    expect(await store.allMeals()).toHaveLength(0);
  });
});

describe("runSecureLogout (surfaces, never swallows, a purge failure)", () => {
  it("reports purgeFailed:false on a clean purge", async () => {
    const store = seededStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const outcome = await runSecureLogout({ store });
    expect(outcome).toEqual({ purgeFailed: false });
    expect(await store.allMeals()).toHaveLength(0);
  });

  it("SURFACES a purge failure as an outcome (purgeFailed:true + message) instead of swallowing it", async () => {
    const failingKv = new (class extends MemoryKv {
      override async del(): Promise<void> {
        throw new Error("blocked");
      }
    })();
    const store = new DiaryStore(failingKv, "https://alice.example/#me");
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));

    // Never rejects (the UI still goes anonymous) but the failure is RETURNED, not
    // dropped — the caller MUST make it visible on a shared device.
    const outcome = await runSecureLogout({ store });
    expect(outcome.purgeFailed).toBe(true);
    expect(outcome.error).toMatch(/failed to delete/);
  });

  it("still revokes the credential even when the purge fails (never leaves logged in)", async () => {
    const failingKv = new (class extends MemoryKv {
      override async del(): Promise<void> {
        throw new Error("blocked");
      }
    })();
    const store = new DiaryStore(failingKv, "https://alice.example/#me");
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const revokeCredentials = vi.fn(async () => {});
    const outcome = await runSecureLogout({ store, revokeCredentials });
    expect(revokeCredentials).toHaveBeenCalledOnce();
    expect(outcome.purgeFailed).toBe(true);
  });
});
