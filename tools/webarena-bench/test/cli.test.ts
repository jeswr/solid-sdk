// AUTHORED-BY Claude Opus 5.5
import { afterEach, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

afterEach(() => vi.restoreAllMocks());
it("accepts pnpm's forwarded separator and provides runnable command syntax", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  await main(["--", "--help"]);
  expect(output).toHaveBeenCalledWith(expect.stringContaining("--planner claude|codex"));
});
it("rejects unavailable sites and missing planner options before reading credentials", async () => {
  await expect(main(["run", "--site", "map"])).rejects.toThrow("--site must");
  await expect(main(["run", "--site", "shopping", "--planner", "invalid"])).rejects.toThrow(
    "--planner claude|codex",
  );
});
