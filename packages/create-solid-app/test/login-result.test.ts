// AUTHORED-BY Claude Opus 4.8
/**
 * Regression test for the auth-probe success criterion.
 *
 * History of the bug (it keeps being subtle):
 *  - round-1: "any 2xx => logged in" — a PUBLIC 200 (no token, no flow) was
 *    treated as a successful login.
 *  - round-2: required a token to have been attached, but read it from a STICKY
 *    provider-level "session established" boolean.
 *  - round-3 (this fix): that boolean is sticky — once a PRIOR upgrade set it, a
 *    LATER attempt whose probe hits a public 200 (no token attached during THAT
 *    attempt) was still accepted (e.g. after a previous rejected probe, or after
 *    logout→re-login). The detection is now PER-ATTEMPT: the provider exposes a
 *    MONOTONIC token-attachment count, and login proves a token was attached
 *    during THIS attempt by checking the count strictly INCREASED across the
 *    probe (`tokensAttachedAfter > tokensAttachedBefore`).
 *
 * The pure decision lives in the template's `lib/solid/login-result.ts`. We test
 * it directly (it is dependency-free) so the rule "what counts as logged in" is
 * pinned, including the per-attempt delta semantics that a sticky flag failed.
 */
import { describe, expect, it } from "vitest";
import { assessLoginProbe } from "../template/lib/solid/login-result.ts";

describe("assessLoginProbe", () => {
  it("PUBLIC 200 with NO token attached this attempt is NOT logged in (the bug)", () => {
    // Probing a public storage root / `/` fallback returns 200 without any auth
    // flow running, so the attach count does NOT move. This must NOT authenticate.
    const r = assessLoginProbe({
      status: 200,
      tokensAttachedBefore: 0,
      tokensAttachedAfter: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("public-no-token");
      expect(r.message).toMatch(/login attempt|public/i);
    }
  });

  it("a genuine authenticated 2xx (token attached THIS attempt + accepted) is logged in", () => {
    // The probe drove one upgrade(), so the count went up by one across the attempt.
    expect(
      assessLoginProbe({ status: 200, tokensAttachedBefore: 0, tokensAttachedAfter: 1 }),
    ).toEqual({ ok: true });
    // Any 2xx with a real token attached this attempt counts (e.g. 204 No Content).
    expect(
      assessLoginProbe({ status: 204, tokensAttachedBefore: 0, tokensAttachedAfter: 1 }),
    ).toEqual({ ok: true });
  });

  it("ROUND-3: a PRIOR established session + a public 200 with no NEW token is NOT logged in", () => {
    // The provider already attached a token during an EARLIER session, so its
    // running count starts at e.g. 3. THIS login attempt's probe hits a public
    // 200 and never triggers an upgrade — so the count is STILL 3 afterwards.
    // A sticky "established" boolean would (wrongly) say "logged in" here; the
    // per-attempt delta correctly says NO token was attached during this attempt.
    const r = assessLoginProbe({
      status: 200,
      tokensAttachedBefore: 3,
      tokensAttachedAfter: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("public-no-token");
  });

  it("ROUND-3: logout→re-login where the re-login probe attaches NO token is NOT logged in", () => {
    // After a real first login the count is e.g. 5. The user logs out (app state
    // cleared; the provider's monotonic count is unaffected — it is a running
    // total, not session state). A re-login probe that hits a public 200 attaches
    // no new token, so the count stays 5. This must NOT re-authenticate off the
    // earlier session's attachments.
    const r = assessLoginProbe({
      status: 200,
      tokensAttachedBefore: 5,
      tokensAttachedAfter: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("public-no-token");
  });

  it("ROUND-3: a NEW login on top of a prior session (count increments) IS logged in", () => {
    // A genuine re-login after a prior session: the count was 5, this attempt's
    // probe drove one fresh upgrade(), so it is 6 afterwards — a real attachment
    // DURING this attempt, regardless of how high the prior baseline was.
    expect(
      assessLoginProbe({ status: 200, tokensAttachedBefore: 5, tokensAttachedAfter: 6 }),
    ).toEqual({ ok: true });
  });

  it("a final 401 is NOT logged in (token absent / popup cancelled)", () => {
    const r = assessLoginProbe({
      status: 401,
      tokensAttachedBefore: 0,
      tokensAttachedAfter: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rejected");
  });

  it("a final 403 is NOT logged in (token rejected) even if one was attached this attempt", () => {
    // A token was minted + attached (count went up) but the server returned 403:
    // it was not accepted, so this is not a session.
    const r = assessLoginProbe({
      status: 403,
      tokensAttachedBefore: 0,
      tokensAttachedAfter: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rejected");
  });

  it("any other non-2xx is a probe error, not a login", () => {
    const r = assessLoginProbe({
      status: 500,
      tokensAttachedBefore: 0,
      tokensAttachedAfter: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("error");
      expect(r.message).toMatch(/500/);
    }
  });
});
