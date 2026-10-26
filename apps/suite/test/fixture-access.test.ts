// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import { fixturesEnabled } from "../src/app/dev/components/fixture-access";

test("fixtures are hidden in production unless explicitly opted in", () => {
  expect(fixturesEnabled("production", undefined)).toBe(false);
  expect(fixturesEnabled("production", "0")).toBe(false);
  expect(fixturesEnabled("production", "1")).toBe(true);
  expect(fixturesEnabled("development", undefined)).toBe(true);
  expect(fixturesEnabled("test", undefined)).toBe(true);
});
