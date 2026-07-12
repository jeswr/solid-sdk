// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// autologin-fragment.test.ts — pins the vendored `autologinFragment` to the EXACT
// `#autologin/<encodeURIComponent(webid)>` byte-shape the create-solid-app reference
// produces (template/lib/solid/autologin.ts), so the producer here stays in lock-step
// with every target app's `parseAutologinFragment`. If this test changes, the
// matching parser shape across the 8 pod-apps + Solid Issues changed too.
import { describe, expect, it } from "vitest";
import { AUTOLOGIN_FRAGMENT_PREFIX, autologinFragment } from "./autologin-fragment";

describe("autologinFragment — the canonical deep-link shape", () => {
  it("is `#autologin/` + encodeURIComponent(webid)", () => {
    const webId = "https://alice.solid-test.jeswr.org/profile/card#me";
    expect(autologinFragment(webId)).toBe(`#autologin/${encodeURIComponent(webId)}`);
  });

  it("uses the exported prefix constant", () => {
    expect(AUTOLOGIN_FRAGMENT_PREFIX).toBe("#autologin/");
    expect(autologinFragment("https://x/me").startsWith(AUTOLOGIN_FRAGMENT_PREFIX)).toBe(true);
  });

  it("percent-encodes the WebID's own `#` and `:` `/` so the parser sees one marker `#`", () => {
    const out = autologinFragment("https://x.example/profile#me");
    expect(out).toContain("%23me"); // the WebID's #me
    expect(out).toContain("https%3A%2F%2F");
    // Exactly one literal `#` — the deep-link prefix.
    expect(out.match(/#/g)?.length).toBe(1);
  });

  it("round-trips through decodeURIComponent back to the WebID", () => {
    const webId = "https://bob.example/card#me";
    const encoded = autologinFragment(webId).slice(AUTOLOGIN_FRAGMENT_PREFIX.length);
    expect(decodeURIComponent(encoded)).toBe(webId);
  });
});
