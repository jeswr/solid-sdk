// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../public/auth/callback.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]+)<\/script>/u)?.[1];
const origin = "https://suite.example.org";
const callback = `${origin}/auth/callback.html?code=example&state=test`;
function bridge(opener: unknown, blockedStorage = false) {
  const postMessage = vi.fn();
  const context = {
    window: {
      opener: opener === "same-origin" ? { location: { origin }, postMessage } : opener,
      close: vi.fn(),
    },
    location: { origin, href: callback, replace: vi.fn() },
    sessionStorage: {
      setItem: vi.fn(() => {
        if (blockedStorage) throw new Error("Blocked storage");
      }),
    },
  };
  if (!script) throw new Error("Missing callback script");
  runInNewContext(script, context);
  return { ...context, postMessage };
}
describe("static authentication callback bridge", () => {
  it("ships a visible, self-contained static document", () => {
    expect(html).toContain("Signing you in…");
    expect(html.match(/<script/gu)).toHaveLength(1);
    expect(html).not.toMatch(/<script[^>]+src=/u);
  });
  it("messages only the exact same-origin opener and leaves closure to that opener", () => {
    const result = bridge("same-origin");
    expect(result.postMessage).toHaveBeenCalledWith(
      { type: "solid-suite:auth-callback", url: callback },
      origin,
    );
    expect(result.window.close).not.toHaveBeenCalled();
    expect(result.sessionStorage.setItem).not.toHaveBeenCalled();
    expect(result.location.replace).not.toHaveBeenCalled();
  });
  it("keeps a full-page callback in session storage and returns to sign-in", () => {
    const result = bridge(null);
    expect(result.sessionStorage.setItem).toHaveBeenCalledWith("suite.auth.callback", callback);
    expect(result.location.replace).toHaveBeenCalledWith("/signin?callback=1");
    expect(result.window.close).not.toHaveBeenCalled();
  });
  it("never posts callback data to a foreign opener", () => {
    const postMessage = vi.fn();
    const foreign = bridge({ location: { origin: "https://example.org" }, postMessage });
    expect(postMessage).not.toHaveBeenCalled();
    expect(foreign.location.replace).toHaveBeenCalledWith("/signin?callback=1");
    const inaccessible = bridge({
      get location() {
        throw new Error("Cross-origin access denied");
      },
      postMessage,
    });
    expect(postMessage).not.toHaveBeenCalled();
    expect(inaccessible.location.replace).toHaveBeenCalledWith("/signin?callback=1");
  });
  it("still returns to sign-in when session storage is unavailable", () => {
    expect(bridge(null, true).location.replace).toHaveBeenCalledWith("/signin?callback=1");
  });
});
