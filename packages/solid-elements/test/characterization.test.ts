// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CHARACTERIZATION (golden-master) tests — pin the OBSERVABLE behaviour of the
// pure helpers BEFORE the behaviour-preserving refactor pass touches their
// structure, so a refactor that changes SHAPE but not behaviour is provable
// (these stay green untouched), and an accidental behaviour change is caught.
//
// Scope = the functions whose internals this pass restructures:
//   • parseWwwAuthenticate / isUseDpopNonceChallenge — the RFC 9110 §11.6.1
//     challenge tokeniser+walker (decomposed for cognitive complexity).
//   • initials / initialsOf — the avatar-initials helpers (their shared name-path
//     is extracted to ONE internal helper; both public exports stay).
//   • nextTheme + the <jeswr-theme-toggle> click cycle — deduplicated onto the one
//     exported `nextTheme` (the toggle had its own inline cycle map).
//
// These assert the EXACT outputs (the contract external consumers rely on), not
// implementation details. They must remain byte-identical across the refactor.

import { describe, expect, it } from "vitest";
// The RFC 9110 challenge parser + the nonce predicate are /auth-only exports.
import { isUseDpopNonceChallenge, parseWwwAuthenticate } from "../src/auth/index.js";
// The avatar-initials helpers + the theme cycle are CORE exports.
import { initials, initialsOf, nextTheme, type Theme } from "../src/index.js";

const r = (h: string | null): Response =>
  new Response(null, { status: 401, headers: h === null ? {} : { "WWW-Authenticate": h } });

describe("characterization: parseWwwAuthenticate (RFC 9110 §11.6.1 tokenise+walk)", () => {
  // Lock the STRUCTURE of the parsed challenges array, not just the nonce verdict —
  // so the decomposition into named helpers can be proven to preserve the parse.
  const parse = parseWwwAuthenticate;

  it("parses a single scheme with one quoted param", () => {
    const out = parse('DPoP error="use_dpop_nonce"');
    expect(out.length).toBe(1);
    expect(out[0].scheme).toBe("DPoP");
    expect(out[0].params.get("error")).toBe("use_dpop_nonce");
  });

  it("splits multiple challenges and attributes params to the right scheme", () => {
    const out = parse('Bearer error="invalid_token", DPoP error="use_dpop_nonce"');
    expect(out.map((c) => c.scheme)).toEqual(["Bearer", "DPoP"]);
    expect(out[0].params.get("error")).toBe("invalid_token");
    expect(out[1].params.get("error")).toBe("use_dpop_nonce");
  });

  it("tolerates BWS around '=' and lower-cases param keys", () => {
    const out = parse('DPoP Error = "use_dpop_nonce"');
    expect(out[0].params.get("error")).toBe("use_dpop_nonce");
  });

  it("does not read error= from inside a quoted value", () => {
    const out = parse('DPoP scope="a error=use_dpop_nonce b"');
    expect(out.length).toBe(1);
    expect(out[0].scheme).toBe("DPoP");
    expect(out[0].params.get("error")).toBeUndefined();
    expect(out[0].params.get("scope")).toBe("a error=use_dpop_nonce b");
  });

  it("handles backslash escapes inside quotes", () => {
    const out = parse('DPoP error="a\\"b"');
    expect(out[0].params.get("error")).toBe('a"b');
  });

  it("treats multiple DPoP challenges as separate", () => {
    const out = parse('DPoP error="use_dpop_nonce", DPoP error="invalid_token"');
    expect(out.filter((c) => c.scheme === "DPoP").length).toBe(2);
  });

  it("returns an empty list for an empty header", () => {
    expect(parse("")).toEqual([]);
  });

  it("a bare scheme produces a challenge with no params", () => {
    const out = parse("DPoP");
    expect(out.length).toBe(1);
    expect(out[0].scheme).toBe("DPoP");
    expect(out[0].params.size).toBe(0);
  });
});

describe("characterization: isUseDpopNonceChallenge (unambiguous-nonce rule)", () => {
  it("true only for an unambiguous DPoP use_dpop_nonce", () => {
    expect(isUseDpopNonceChallenge(r('DPoP error="use_dpop_nonce"'))).toBe(true);
    expect(isUseDpopNonceChallenge(r('DPoP error="use_dpop_nonce", algs="ES256"'))).toBe(true);
    expect(isUseDpopNonceChallenge(r('DPoP error = "use_dpop_nonce"'))).toBe(true);
  });

  it("false when any DPoP challenge carries a non-nonce error (ambiguous → force refresh)", () => {
    expect(
      isUseDpopNonceChallenge(r('DPoP error="use_dpop_nonce", DPoP error="invalid_token"')),
    ).toBe(false);
    expect(
      isUseDpopNonceChallenge(r('DPoP error="invalid_token", DPoP error="use_dpop_nonce"')),
    ).toBe(false);
    expect(
      isUseDpopNonceChallenge(r('Bearer error="use_dpop_nonce", DPoP error="invalid_token"')),
    ).toBe(false);
  });

  it("ignores a use_dpop_nonce that belongs to a non-DPoP scheme", () => {
    expect(isUseDpopNonceChallenge(r('Bearer error="use_dpop_nonce"'))).toBe(false);
  });

  it("false for a bare DPoP scheme, a missing header, and a quoted-value red herring", () => {
    expect(isUseDpopNonceChallenge(r("DPoP"))).toBe(false);
    expect(isUseDpopNonceChallenge(r(null))).toBe(false);
    expect(
      isUseDpopNonceChallenge(r('DPoP error="invalid_token", scope="a error=use_dpop_nonce b"')),
    ).toBe(false);
  });
});

describe("characterization: initials (name-only) and initialsOf (URL-aware)", () => {
  it("initials: two-letter uppercase from a display name", () => {
    expect(initials("Jesse Wright")).toBe("JW");
    expect(initials("madonna")).toBe("MA");
    expect(initials("  Ada  Lovelace ")).toBe("AL");
    expect(initials("A B C D")).toBe("AD");
    expect(initials("")).toBe("?");
  });

  it("initialsOf: derives from the host for a URL/WebID", () => {
    expect(initialsOf("https://alice.solidcommunity.net/profile/card#me")).toBe("AL");
    expect(initialsOf("https://www.example.org/me")).toBe("EX");
    expect(initialsOf("https://x.io/")).toBe("X");
    expect(initialsOf("")).toBe("?");
  });

  it("initialsOf on a NON-url equals initials (the shared name-path contract)", () => {
    for (const name of ["Ada Lovelace", "madonna", "  Grace  Hopper ", "A B C D", "x", ""]) {
      expect(initialsOf(name)).toBe(initials(name));
    }
  });
});

describe("characterization: nextTheme cycle (light → dark → system → light)", () => {
  it("cycles in the documented order", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
    expect(nextTheme("system")).toBe("light");
  });

  it("the cycle is a 3-step loop back to the start", () => {
    let t: Theme = "light";
    t = nextTheme(t);
    t = nextTheme(t);
    t = nextTheme(t);
    expect(t).toBe("light");
  });
});
