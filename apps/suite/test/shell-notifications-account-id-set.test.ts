// AUTHORED-BY Claude Opus 5.5
import { afterEach, expect, it, vi } from "vitest";
import { createAccountIdSet } from "../src/lib/account-id-set";

function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}
afterEach(() => vi.unstubAllGlobals());

it.each([
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
])("rejects a bound that would not cap storage: %s", (max) => {
  expect(() => createAccountIdSet("key", "me", max, memory())).toThrow(RangeError);
});

it("merges newest IDs under the bound and keeps account identity", () => {
  const storage = memory();
  const set = createAccountIdSet("key", "me", 2, storage);
  set.save(new Set(["a", "b"]));
  set.save(new Set(["a", "c"]));
  expect([...set.load()]).toEqual(["a", "c"]);
  set.save(new Set());
  expect([...set.load()]).toEqual(["a", "c"]);
  expect([...createAccountIdSet("key", "other", 2, storage).load()]).toEqual([]);
  storage.setItem("key", JSON.stringify({ version: 1, accountId: "me", ids: ["x", "y", "z"] }));
  expect([...set.load()]).toEqual(["y", "z"]);
});

it.each([
  "not JSON",
  JSON.stringify({ version: 2, accountId: "me", ids: [] }),
  JSON.stringify({ version: 1, accountId: "me", ids: "a" }),
  JSON.stringify({ version: 1, accountId: "me", ids: [1] }),
])("treats invalid saved values as cache misses: %s", (value) => {
  const storage = memory();
  storage.setItem("key", value);
  expect([...createAccountIdSet("key", "me", 5, storage).load()]).toEqual([]);
});

it("ignores signed-out and denied storage, and defaults to localStorage", () => {
  const storage = memory();
  const anonymous = createAccountIdSet("key", "", 5, storage);
  anonymous.save(new Set(["a"]));
  expect(storage.values.size).toBe(0);
  expect(anonymous.load().size).toBe(0);
  const denied = createAccountIdSet("key", "me", 5, {
    getItem: () => null,
    setItem: () => {
      throw new Error("Denied");
    },
  });
  expect(() => denied.save(new Set(["a"]))).not.toThrow();
  const local = memory();
  vi.stubGlobal("localStorage", local);
  createAccountIdSet("key", "me", 5).save(new Set(["a"]));
  expect(JSON.parse(local.values.get("key") ?? "null").ids).toEqual(["a"]);
});
