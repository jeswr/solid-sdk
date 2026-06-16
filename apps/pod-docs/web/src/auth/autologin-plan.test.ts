// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for the PURE autologin decision (planAutologin) + the pure URL helpers the
// SessionProvider effect uses. These cover the three security-critical scenarios the
// feature brief requires WITHOUT a DOM / React test env (the host ships none, and
// adding one is gated):
//   (a) opening with `#autologin/<encoded-webid>` and no session → BEGIN a redirect
//       login for that decoded WebID;
//   (b) a stored/active session takes precedence → autologin is NOT begun;
//   (c) a bounced-back-still-unauthenticated autologin does NOT loop → with the
//       sentinel already set, a repeat `#autologin` falls through (clear-sentinel),
//       NOT a re-begin.
import { describe, expect, it } from "vitest";
import { type AutologinInputs, planAutologin } from "./autologin-plan";
import { cleanedUrl, hasAuthCodeParams, parseAutologinFragment } from "./SessionProvider";

const WEBID = "https://alice.solid-test.jeswr.org/profile/card#me";
const ENCODED = encodeURIComponent(WEBID);

/** A baseline "ready, not logged in, fresh page, nothing pending/seen" input. */
function base(overrides: Partial<AutologinInputs> = {}): AutologinInputs {
  return {
    ready: true,
    hasProvider: true,
    loggedIn: false,
    effectAlreadyRan: false,
    hasPendingRedirect: false,
    pendingRedirectWebId: null,
    hasCodeParams: false,
    fragmentWebId: null,
    sentinel: null,
    ...overrides,
  };
}

describe("parseAutologinFragment", () => {
  it("decodes the WebID from a #autologin/<encoded> deep-link", () => {
    expect(parseAutologinFragment(`#autologin/${ENCODED}`)).toBe(WEBID);
  });

  it("returns null for a non-autologin hash, an empty payload, or bad encoding", () => {
    expect(parseAutologinFragment("")).toBeNull();
    expect(parseAutologinFragment("#documents")).toBeNull();
    expect(parseAutologinFragment("#autologin/")).toBeNull();
    // A lone `%` is invalid percent-encoding → decodeURIComponent throws → null.
    expect(parseAutologinFragment("#autologin/%")).toBeNull();
  });
});

describe("hasAuthCodeParams", () => {
  it("is true only when BOTH code and state are present", () => {
    expect(hasAuthCodeParams("?code=abc&state=xyz")).toBe(true);
    expect(hasAuthCodeParams("?code=abc")).toBe(false);
    expect(hasAuthCodeParams("?state=xyz")).toBe(false);
    expect(hasAuthCodeParams("")).toBe(false);
  });
});

describe("cleanedUrl", () => {
  it("strips BOTH the query and the fragment, keeping the path", () => {
    expect(cleanedUrl("https://app.example/?code=abc&state=xyz")).toBe("https://app.example/");
    expect(cleanedUrl(`https://app.example/#autologin/${ENCODED}`)).toBe("https://app.example/");
    expect(cleanedUrl("https://app.example/docs?x=1#frag")).toBe("https://app.example/docs");
  });
});

describe("planAutologin — guards", () => {
  it("does nothing until the runtime is ready / the provider exists", () => {
    expect(planAutologin(base({ ready: false, fragmentWebId: WEBID })).kind).toBe("none");
    expect(planAutologin(base({ hasProvider: false, fragmentWebId: WEBID })).kind).toBe("none");
  });

  it("does nothing once the once-guard has fired (StrictMode double-mount)", () => {
    expect(planAutologin(base({ effectAlreadyRan: true, fragmentWebId: WEBID })).kind).toBe("none");
  });
});

describe("planAutologin — (a) fresh #autologin deep-link begins a redirect login", () => {
  it("BEGINS a redirect login for the decoded WebID when not logged in + nothing pending", () => {
    const action = planAutologin(base({ fragmentWebId: WEBID }));
    expect(action).toEqual({ kind: "begin", webId: WEBID });
  });
});

describe("planAutologin — (b) a stored/active session takes precedence", () => {
  it("does NOT begin autologin when already logged in, even with a deep-link fragment", () => {
    const action = planAutologin(base({ loggedIn: true, fragmentWebId: WEBID }));
    expect(action.kind).toBe("none");
  });

  it("does NOT complete a returning redirect when already logged in", () => {
    const action = planAutologin(
      base({
        loggedIn: true,
        hasPendingRedirect: true,
        pendingRedirectWebId: WEBID,
        hasCodeParams: true,
      }),
    );
    expect(action.kind).toBe("none");
  });
});

describe("planAutologin — (c) a bounced-back autologin does NOT loop", () => {
  it("with the sentinel already set, a repeat #autologin falls through to clear-sentinel (no re-begin)", () => {
    const action = planAutologin(base({ fragmentWebId: WEBID, sentinel: WEBID }));
    // NOT a re-begin — the loop guard. The effect clears the sentinel + URL and shows login.
    expect(action.kind).toBe("clear-sentinel");
    expect(action).not.toMatchObject({ kind: "begin" });
  });

  it("a clean (no-code, no-fragment) return after a bounce is inert (login screen)", () => {
    // The fragment was already cleaned before the redirect, so on a no-code bounce
    // there is no fragment and no pending record → nothing re-triggers.
    expect(planAutologin(base({ sentinel: WEBID })).kind).toBe("none");
  });
});

describe("planAutologin — CASE A returning from the redirect", () => {
  it("COMPLETES the persisted login when a pending record + ?code&state are present", () => {
    const action = planAutologin(
      base({ hasPendingRedirect: true, pendingRedirectWebId: WEBID, hasCodeParams: true }),
    );
    expect(action).toEqual({ kind: "complete", webId: WEBID });
  });

  it("does NOT treat a fresh deep-link as CASE B while a redirect record is pending", () => {
    // A pending record means we are mid-redirect; a fragment must not start a SECOND
    // begin. Without ?code yet, the plan is inert (waiting for the code-bearing return).
    const action = planAutologin(base({ hasPendingRedirect: true, fragmentWebId: WEBID }));
    expect(action.kind).toBe("none");
  });
});
