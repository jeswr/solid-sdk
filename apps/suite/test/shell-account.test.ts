// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { accountHue, presenceHues } from "../src/shell/lib/account-hue";
import { routeAfterSwitch } from "../src/shell/lib/account-route";

describe("account colours", () => {
  it("hashes stably into DS-02 presence hues", () => {
    expect(accountHue("https://example.org/profile#me")).toBe(300);
    expect(accountHue("")).toBe(250);
    const hues = new Set(
      Array.from({ length: 1000 }, (_, n) => accountHue(`https://example.org/${n}`)),
    );
    expect([...hues].sort((a, b) => a - b)).toEqual([...presenceHues].sort((a, b) => a - b));
    expect(accountHue("https://example.org/🎨")).toBe(accountHue("https://example.org/🎨"));
  });
});

describe("account switching routes", () => {
  it.each([
    "/drive/f/abc",
    "/drive/p/abc",
    "/docs/d/abc/history",
    "/home/personal/i/abc",
    "/permissions/a/abc",
    "/tasks/p/abc/board",
    "/search",
    "/search?q=project&scope=drive",
    "/settings",
    "/settings/account",
    "/settings/advanced?tab=caps",
  ])("keeps resource and account-independent route %s", (path) => {
    expect(routeAfterSwitch(path)).toBe(path);
  });
  it.each([
    ["/drive/recent", "/drive"],
    ["/drive", "/drive"],
    ["/docs?sort=name", "/docs"],
    ["/home/personal", "/home"],
    ["/permissions/requests", "/permissions"],
    ["/tasks/l/work", "/tasks"],
    ["/drive/f/", "/drive"],
    ["/docs/d", "/docs"],
    ["/settings-other", "/home"],
    ["/unknown", "/home"],
    ["/search/extra", "/home"],
  ])("resets %s to %s", (path, root) => expect(routeAfterSwitch(path)).toBe(root));
});
