// AUTHORED-BY Claude Opus 5.5
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import { applyJsonPatch, retryOnConflict } from "./helpers.js";

const conflict = () =>
  new StorageError("precondition-failed", { url: "https://p/a", method: "PUT", status: 412 });

describe("retryOnConflict", () => {
  test("passes the read ETag and returns on success", async () => {
    const read = vi.fn(async () => ({ etag: '"1"' }));
    const fn = vi.fn(async (etag: string | null) => `wrote with ${etag}`);
    await expect(retryOnConflict(fn, read)).resolves.toBe('wrote with "1"');
    expect(read).toHaveBeenCalledOnce();
  });

  test("re-reads before each retry after a 412", async () => {
    let version = 0;
    const read = vi.fn(async () => ({ etag: `"${++version}"` }));
    const fn = vi.fn(async (etag: string | null) => {
      if (etag !== '"3"') throw conflict();
      return "ok";
    });
    await expect(retryOnConflict(fn, read)).resolves.toBe("ok");
    expect(fn.mock.calls.map(([etag]) => etag)).toEqual(['"1"', '"2"', '"3"']);
  });

  test("gives up after `attempts` and rethrows the last 412", async () => {
    const read = vi.fn(async () => ({ etag: null }));
    const fn = vi.fn(async () => {
      throw conflict();
    });
    await expect(retryOnConflict(fn, read, 2)).rejects.toMatchObject({
      code: "precondition-failed",
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("other errors propagate immediately", async () => {
    const read = vi.fn(async () => ({ etag: '"1"' }));
    const forbidden = new StorageError("forbidden", { url: "u", method: "PUT", status: 403 });
    await expect(retryOnConflict(async () => Promise.reject(forbidden), read)).rejects.toBe(
      forbidden,
    );
    await expect(retryOnConflict(async () => Promise.reject(new Error("x")), read)).rejects.toThrow(
      "x",
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  test.each([0, -1, 1.5, Number.NaN])("rejects attempts=%s", async (attempts) => {
    await expect(
      retryOnConflict(
        async () => 1,
        async () => ({ etag: null }),
        attempts,
      ),
    ).rejects.toThrow(RangeError);
  });

  test("re-exports the JSON Patch applier", () => {
    expect(applyJsonPatch({}, [{ op: "add", path: "/a", value: 1 }])).toEqual({ a: 1 });
  });
});
