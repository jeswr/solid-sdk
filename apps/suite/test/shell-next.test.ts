// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { START_PAGE, safeNext } from "../src/shell/lib/next";

describe("safeNext", () => {
  it.each([
    null,
    undefined,
    "",
    "//evil.example",
    "/\\evil",
    "https://evil",
    "%2F%2Fevil",
    "javascript:",
    "/%2fevil",
    "/%5cevil",
    "/%0aevil",
    "/\nevil",
    "/\u0000evil",
    "/%252f%252fevil",
    "/%zz",
    "/path//evil",
    "/safe?target=https://evil",
    "/../\\evil",
  ])("rejects %j", (value) => {
    expect(safeNext(value)).toBe(START_PAGE);
  });
  it.each([
    START_PAGE,
    "/drive/my",
    "/drive/f/abc?view=list#item",
    "/search?q=hello%20world",
    "/docs/d/abc/history",
  ])("keeps a local path: %s", (value) => expect(safeNext(value)).toBe(value));
});
