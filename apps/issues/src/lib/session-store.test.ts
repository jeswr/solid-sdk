import { describe, it, expect, vi } from "vitest";
import { txResult } from "./session-store";

/**
 * The session store persists the DPoP refresh token in IndexedDB. The bug
 * (pss-203m / roborev HIGH): `tx()` resolved on the request's `onsuccess`, which
 * fires BEFORE the transaction commits — so `clearSession().finally(reload)`
 * could reload before the delete landed, leaving the token on disk and silently
 * restoring the just-logged-out user. The fix resolves from `transaction.
 * oncomplete` (capturing the request result), and rejects on request error /
 * `transaction.onabort`/`onerror`. These tests exercise that semantics directly
 * against a fake transaction + request, without needing IndexedDB.
 */

/** A minimal fake IDBRequest whose `onsuccess`/`onerror` we can fire manually. */
class FakeRequest<T> {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result!: T;
  error: unknown = null;
  fireSuccess(result: T) {
    this.result = result;
    this.onsuccess?.();
  }
  fireError(error: unknown) {
    this.error = error;
    this.onerror?.();
  }
}

/** A minimal fake IDBTransaction with manually-fired lifecycle events. */
class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: unknown = null;
  complete() {
    this.oncomplete?.();
  }
  errored(error: unknown) {
    this.error = error;
    this.onerror?.();
  }
  aborted(error: unknown = null) {
    this.error = error;
    this.onabort?.();
  }
}

const make = <T>() => {
  const tx = new FakeTransaction();
  const req = new FakeRequest<T>();
  return { tx, req };
};

describe("txResult — resolve on transaction COMMIT, not request onsuccess (silent-restore fix)", () => {
  it("does NOT resolve on request onsuccess alone — only after oncomplete", async () => {
    const { tx, req } = make<string>();
    const onSettled = vi.fn();
    const p = txResult(tx as unknown as IDBTransaction, req as unknown as IDBRequest<string>, onSettled);

    let settled = false;
    void p.then(() => {
      settled = true;
    });

    // Request succeeded — but the transaction has NOT committed yet.
    req.fireSuccess("value");
    await Promise.resolve(); // flush microtasks
    expect(settled).toBe(false); // the bug would have resolved here
    expect(onSettled).not.toHaveBeenCalled();

    // Now the transaction commits — only here is it safe.
    tx.complete();
    await expect(p).resolves.toBe("value");
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("resolves with the request result captured at onsuccess", async () => {
    const { tx, req } = make<{ token: string } | undefined>();
    const p = txResult(tx as unknown as IDBTransaction, req as unknown as IDBRequest<{ token: string } | undefined>, () => {});
    req.fireSuccess({ token: "abc" });
    tx.complete();
    await expect(p).resolves.toEqual({ token: "abc" });
  });

  it("a delete that only commits at oncomplete is awaited fully (no early resolve)", async () => {
    // Models clearSession(): the delete request "succeeds" but the caller's
    // .finally(reload) must wait for the COMMIT.
    const { tx, req } = make<undefined>();
    const reload = vi.fn();
    const p = txResult(tx as unknown as IDBTransaction, req as unknown as IDBRequest<undefined>, () => {})
      .finally(reload);

    req.fireSuccess(undefined);
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled(); // would have reloaded mid-delete in the bug

    tx.complete();
    await p;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("rejects on a request error and still settles (closes the db)", async () => {
    const { tx, req } = make<string>();
    const onSettled = vi.fn();
    const p = txResult(tx as unknown as IDBTransaction, req as unknown as IDBRequest<string>, onSettled);
    const err = new Error("read failed");
    req.fireError(err);
    await expect(p).rejects.toBe(err);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("rejects on transaction onerror", async () => {
    const { tx, req } = make<string>();
    const p = txResult(tx as unknown as IDBTransaction, req as unknown as IDBRequest<string>, () => {});
    req.fireSuccess("value"); // request succeeded…
    const err = new Error("tx failed");
    tx.errored(err); // …but the transaction failed before commit
    await expect(p).rejects.toBe(err);
  });

  it("rejects on transaction onabort (does not resolve with a half-applied result)", async () => {
    const { tx, req } = make<string>();
    const p = txResult(tx as unknown as IDBTransaction, req as unknown as IDBRequest<string>, () => {});
    req.fireSuccess("value");
    tx.aborted(); // aborted with no explicit error → synthesised AbortError
    await expect(p).rejects.toBeInstanceOf(DOMException);
  });

  it("a later oncomplete after a failure does not resolve (no double-settle)", async () => {
    const { tx, req } = make<string>();
    const p = txResult(tx as unknown as IDBTransaction, req as unknown as IDBRequest<string>, () => {});
    const err = new Error("boom");
    req.fireError(err);
    // Even if oncomplete somehow fires afterwards, the promise stays rejected.
    tx.complete();
    await expect(p).rejects.toBe(err);
  });
});
