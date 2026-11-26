// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { parseImportArgs } from "./cli.js";
import { watchImports } from "./watch.js";

afterEach(() => vi.useRealTimers());
it("parses default/minimum watch intervals and rejects unsupported flags", () => {
  expect(parseImportArgs(["import", "vesync", "--watch"])).toMatchObject({ watch: 10 });
  expect(parseImportArgs(["import", "vesync", "--watch", "5", "--room", "Office"])).toMatchObject({
    watch: 5,
    room: "Office",
  });
  const slug = `vesync-${"a".repeat(64)}`;
  expect(parseImportArgs(["import", "vesync", "--room", `${slug}=Office`]).room).toEqual({
    [slug]: "Office",
  });
  for (const args of [
    ["import", "vesync", "--watch", "4"],
    ["import", "vesync", "--watch", "NaN"],
    ["import", "vesync", "--watch", "Infinity"],
    ["import", "vesync", "--watch", "1441"],
    ["import", "spotify", "--watch"],
    ["import", "vesync", "--watch", "--since"],
    ["import", "vesync", "--room"],
    ["import", "vesync", "--room", `${slug}=${"x".repeat(257)}`],
    ["import", "vesync", "--room", `${slug}= `],
    ["import", "vesync", "--room", `${slug}=`],
    ["import", "spotify", "--room", "Office"],
  ])
    expect(() => parseImportArgs(args)).toThrow();
});
it("runs until cancelled, backs off after errors, resets on success and removes timers", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const run = vi
    .fn(async () => {})
    .mockRejectedValueOnce(new Error())
    .mockRejectedValueOnce(new Error());
  const errors = vi.fn();
  const pending = watchImports({
    run,
    minutes: 10,
    signal: controller.signal,
    retry: () => true,
    onError: errors,
    random: () => 0.5,
  });
  const check = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10 * 60000);
  expect(run).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(20 * 60000);
  expect(run).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(10 * 60000);
  expect(run).toHaveBeenCalledTimes(4);
  expect(errors).toHaveBeenCalledTimes(2);
  controller.abort();
  await check;
  expect(vi.getTimerCount()).toBe(0);
});
it("does not retry an authentication or checkpoint failure", async () => {
  const run = vi.fn(async () => {
    throw new Error("safe");
  });
  await expect(
    watchImports({ run, minutes: 5, retry: () => false, onError: () => {} }),
  ).rejects.toThrow("safe");
  expect(run).toHaveBeenCalledTimes(1);
});
