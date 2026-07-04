// AUTHORED-BY Claude Fable 5
import { describe, expect, it, vi } from "vitest";
import { DiaryStore } from "../cache/diary-store";
import { MemoryKv } from "../cache/kv";
import { newMealRecord } from "../diary/log";
import { performSecureLogout, runSecureLogout, SecureLogoutError } from "./logout";

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

  it("STILL purges on a credential-revoke failure (privacy is mandatory) but surfaces it distinctly", async () => {
    const store = seededStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const revokeCredentials = vi.fn(async () => {
      throw new Error("revoke blew up");
    });

    // The purge still runs (data is wiped) but the revoke failure is NOT swallowed —
    // it rejects with a SecureLogoutError flagged as revoke-only (never a clean pass).
    await expect(performSecureLogout({ store, revokeCredentials })).rejects.toBeInstanceOf(
      SecureLogoutError,
    );
    expect(await store.allMeals()).toHaveLength(0);
    try {
      await performSecureLogout({ store: seededStore(), revokeCredentials });
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(SecureLogoutError);
      const e = err as SecureLogoutError;
      expect(e.revokeFailed).toBe(true);
      expect(e.purgeFailed).toBe(false);
      expect(e.revokeError?.message).toMatch(/revoke blew up/);
    }
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

/** A DiaryStore whose purge always fails (its `del` rejects for every key). */
function purgeFailingStore(): DiaryStore {
  const failingKv = new (class extends MemoryKv {
    override async del(): Promise<void> {
      throw new Error("blocked");
    }
  })();
  return new DiaryStore(failingKv, "https://alice.example/#me");
}

describe("runSecureLogout (surfaces, never swallows, purge + revoke failures — distinctly)", () => {
  it("reports purgeFailed:false + revokeFailed:false on a clean sign-out", async () => {
    const store = seededStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const revokeCredentials = vi.fn(async () => {});
    const outcome = await runSecureLogout({ store, revokeCredentials });
    expect(outcome).toEqual({ purgeFailed: false, revokeFailed: false });
    expect(await store.allMeals()).toHaveLength(0);
  });

  it("(b) a purge failure still goes anonymous but surfaces purgeFailed (revokeFailed:false)", async () => {
    const store = purgeFailingStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));

    // Never rejects (the UI still goes anonymous) but the failure is RETURNED, not
    // dropped — the caller MUST make it visible on a shared device.
    const outcome = await runSecureLogout({ store });
    expect(outcome.purgeFailed).toBe(true);
    expect(outcome.revokeFailed).toBe(false);
    expect(outcome.error).toMatch(/failed to delete/);
  });

  it("still revokes the credential even when the purge fails (never leaves logged in)", async () => {
    const store = purgeFailingStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const revokeCredentials = vi.fn(async () => {});
    const outcome = await runSecureLogout({ store, revokeCredentials });
    expect(revokeCredentials).toHaveBeenCalledOnce();
    expect(outcome.purgeFailed).toBe(true);
    expect(outcome.revokeFailed).toBe(false);
  });

  it("(a) SURFACES a revoke failure DISTINCTLY (revokeFailed:true, purgeFailed:false) — NOT a clean sign-out", async () => {
    const store = seededStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const revokeCredentials = vi.fn(async () => {
      throw new Error("revoke endpoint 500");
    });

    const outcome = await runSecureLogout({ store, revokeCredentials });
    // A revoke failure must NOT masquerade as a clean anonymous sign-out.
    expect(outcome).not.toEqual({ purgeFailed: false, revokeFailed: false });
    expect(outcome.revokeFailed).toBe(true);
    expect(outcome.purgeFailed).toBe(false); // the purge itself succeeded…
    expect(outcome.revokeError).toMatch(/revoke endpoint 500/);
    expect(outcome.error).toBeUndefined(); // …so there is no purge-failure message
    expect(await store.allMeals()).toHaveLength(0); // data still wiped
  });

  it("surfaces BOTH a revoke AND a purge failure at once (independent flags)", async () => {
    const store = purgeFailingStore();
    await store.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    const revokeCredentials = vi.fn(async () => {
      throw new Error("revoke down");
    });

    const outcome = await runSecureLogout({ store, revokeCredentials });
    expect(outcome.revokeFailed).toBe(true);
    expect(outcome.purgeFailed).toBe(true);
    expect(outcome.revokeError).toMatch(/revoke down/);
    expect(outcome.error).toMatch(/failed to delete/);
  });
});
