// AUTHORED-BY Claude Opus 4.8
/**
 * Regression test for the auth-probe success criterion (roborev MEDIUM:
 * a PUBLIC 200 with no token attached was being treated as a successful login).
 *
 * The pure decision lives in the template's `lib/solid/login-result.ts`. We test
 * it directly (it is dependency-free) so the rule "what counts as logged in" is
 * pinned: a token must have been MINTED + ATTACHED (a flow actually ran) AND the
 * probe accepted, not merely "some 2xx came back".
 */
import { describe, expect, it } from "vitest";
import { assessLoginProbe } from "../template/lib/solid/login-result.ts";

describe("assessLoginProbe", () => {
  it("PUBLIC 200 with NO token attached is NOT logged in (the bug)", () => {
    // Probing a public storage root / `/` fallback returns 200 without any auth
    // flow running. This must NOT authenticate — no setWebId/setProfile.
    const r = assessLoginProbe({ status: 200, tokenAttached: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("public-no-token");
      expect(r.message).toMatch(/public/i);
    }
  });

  it("a genuine authenticated 2xx (token minted + attached + accepted) is logged in", () => {
    expect(assessLoginProbe({ status: 200, tokenAttached: true })).toEqual({ ok: true });
    // Any 2xx with a real token counts (e.g. 204 No Content).
    expect(assessLoginProbe({ status: 204, tokenAttached: true })).toEqual({ ok: true });
  });

  it("a final 401 is NOT logged in (token absent / popup cancelled)", () => {
    const r = assessLoginProbe({ status: 401, tokenAttached: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rejected");
  });

  it("a final 403 is NOT logged in (token rejected)", () => {
    // Even if a token was attached, a 403 means it was not accepted.
    const r = assessLoginProbe({ status: 403, tokenAttached: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rejected");
  });

  it("any other non-2xx is a probe error, not a login", () => {
    const r = assessLoginProbe({ status: 500, tokenAttached: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("error");
      expect(r.message).toMatch(/500/);
    }
  });
});
