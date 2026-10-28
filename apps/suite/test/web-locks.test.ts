// AUTHORED-BY Codex
import { expect, it } from "vitest";
import { exclusiveWebLocks } from "./web-locks";

it("queues nested exclusive requests FIFO while unrelated names proceed", async () => {
  const locks = exclusiveWebLocks();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const calls: string[] = [];
  let nested: Promise<string> | undefined;
  const outer = locks.request("same", async (lock) => {
    expect(lock).toEqual({ name: "same", mode: "exclusive" });
    nested = locks.request("same", () => {
      calls.push("nested");
      return "nested result";
    });
    entered.resolve();
    await release.promise;
    calls.push("outer");
  });
  await entered.promise;
  const third = locks.request("same", () => calls.push("third"));
  await locks.request("other", () => calls.push("other"));
  expect(calls).toEqual(["other"]);
  release.resolve();
  await outer;
  expect(await nested).toBe("nested result");
  await third;
  expect(calls).toEqual(["other", "outer", "nested", "third"]);
}, 1_000);

it("releases a rejected exclusive request before the next callback", async () => {
  const locks = exclusiveWebLocks();
  const failed = locks.request("same", () => {
    throw new Error("failed work");
  });
  const next = locks.request("same", () => "next result");
  await expect(failed).rejects.toThrow("failed work");
  expect(await next).toBe("next result");
}, 1_000);
