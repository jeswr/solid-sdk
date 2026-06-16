// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for the deep-link AUTOLOGIN decision + orchestration (media-kraken#54).
//
// The SolidAuthProvider component itself cannot mount in this oauth/dpop-mocked,
// browser-less harness (it dynamically imports @solid/reactive-authentication + a
// custom element). Following the EXACT pattern the existing webid-token-provider
// tests use for the single-flight gate (FIX 4b), we test the PURE classifier
// (`classifyAutologin`) and the side-effectful orchestration (`runAutologin`) the
// component delegates to — with the provider methods mocked and location/history/
// sessionStorage injected via the callbacks. The component is a thin shell that wires
// these to the live browser APIs, so pinning this logic pins the component behaviour
// the brief requires:
//   (a) `#autologin/<encoded-webid>` + no session ⇒ a REDIRECT login for that WebID;
//   (b) a stored/active session takes precedence (no beginRedirectLogin);
//   (c) bounced-back-still-unauthenticated does NOT loop (sentinel already set ⇒
//       fall through to the login panel, clear the sentinel).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AutologinCallbacks,
  AUTOLOGIN_FRAGMENT_PREFIX,
  AUTOLOGIN_SENTINEL_KEY,
  autologinFragment,
  classifyAutologin,
  cleanedUrl,
  hasAuthCallbackParams,
  parseAutologinFragment,
  runAutologin,
} from "@/lib/solid/autologin";

const WEBID = "https://alice.example/profile/card#me";
const ISSUER_AUTH = "https://issuer.example/auth?client_id=c&redirect_uri=r";
const ORIGIN = "https://app.example";

/** Build a callbacks object backed by an in-memory store the test can assert on. */
function makeCallbacks(opts: {
  href: string;
  beginRedirectLogin?: () => Promise<{ authorizationUrl: string }>;
  completeRedirectLogin?: () => Promise<void>;
  authenticatedWebId?: () => string | undefined;
  readProfile?: (id: string) => Promise<unknown>;
}) {
  let href = opts.href;
  const sentinel: { value: string | null } = { value: null };
  const calls = {
    beginRedirectLogin: vi.fn(
      opts.beginRedirectLogin ?? (async () => ({ authorizationUrl: ISSUER_AUTH })),
    ),
    completeRedirectLogin: vi.fn(opts.completeRedirectLogin ?? (async () => {})),
    reset: vi.fn(),
    authenticatedWebId: vi.fn(opts.authenticatedWebId ?? (() => WEBID)),
    readProfile: vi.fn(
      opts.readProfile ?? (async (id: string) => ({ webId: id })),
    ),
    replaceUrl: vi.fn((url: string) => {
      href = url;
    }),
    assignUrl: vi.fn(),
    setPendingWebId: vi.fn(),
    setSentinel: vi.fn((id: string) => {
      sentinel.value = id;
    }),
    clearSentinel: vi.fn(() => {
      sentinel.value = null;
    }),
    setRestoring: vi.fn(),
    onAuthenticated: vi.fn(),
    onFallback: vi.fn(),
  };
  const cb: AutologinCallbacks = {
    provider: {
      beginRedirectLogin: calls.beginRedirectLogin as never,
      completeRedirectLogin: calls.completeRedirectLogin as never,
      authenticatedWebId: calls.authenticatedWebId as never,
      reset: calls.reset as never,
    },
    readProfile: calls.readProfile,
    href: () => href,
    origin: () => ORIGIN,
    replaceUrl: calls.replaceUrl,
    assignUrl: calls.assignUrl,
    setPendingWebId: calls.setPendingWebId,
    getSentinel: () => sentinel.value,
    setSentinel: calls.setSentinel,
    clearSentinel: calls.clearSentinel,
    setRestoring: calls.setRestoring,
    onAuthenticated: calls.onAuthenticated,
    onFallback: calls.onFallback,
  };
  return { cb, calls, sentinel, getHref: () => href };
}

describe("classifyAutologin — pure decision", () => {
  const base = {
    ready: true,
    loggedIn: false,
    href: `${ORIGIN}/`,
    hash: "",
    hasPendingRedirect: false,
    sentinel: null as string | null,
  };

  it("does NOTHING until the runtime is ready", () => {
    expect(
      classifyAutologin({ ...base, ready: false, hash: autologinFragment(WEBID) }),
    ).toEqual({ kind: "none" });
  });

  it("(b) a stored/active session takes precedence — never autologin over it", () => {
    // CASE B shape (a fresh deep-link) but already logged in ⇒ none.
    expect(
      classifyAutologin({ ...base, loggedIn: true, hash: autologinFragment(WEBID) }),
    ).toEqual({ kind: "none" });
    // CASE A shape (a callback) but already logged in ⇒ none.
    expect(
      classifyAutologin({
        ...base,
        loggedIn: true,
        hasPendingRedirect: true,
        href: `${ORIGIN}/?code=abc&state=xyz`,
      }),
    ).toEqual({ kind: "none" });
  });

  it("(a) a fresh #autologin/<webid> deep-link (no session, no pending) ⇒ begin-redirect for that WebID", () => {
    expect(
      classifyAutologin({ ...base, hash: autologinFragment(WEBID) }),
    ).toEqual({ kind: "begin-redirect", webId: WEBID });
  });

  it("CASE A: a pending record + `?code&state` ⇒ complete-redirect", () => {
    expect(
      classifyAutologin({
        ...base,
        hasPendingRedirect: true,
        href: `${ORIGIN}/?code=abc&state=xyz`,
      }),
    ).toEqual({ kind: "complete-redirect" });
  });

  it("(c) the loop guard: a deep-link with the sentinel ALREADY set ⇒ loop-guard-fallback (no re-attempt)", () => {
    expect(
      classifyAutologin({
        ...base,
        hash: autologinFragment(WEBID),
        sentinel: WEBID,
      }),
    ).toEqual({ kind: "loop-guard-fallback" });
  });

  it("a malformed fragment is ignored (no payload / bad encoding)", () => {
    expect(
      classifyAutologin({ ...base, hash: AUTOLOGIN_FRAGMENT_PREFIX }),
    ).toEqual({ kind: "none" });
    expect(
      classifyAutologin({ ...base, hash: "#autologin/%E0%A4%A" }),
    ).toEqual({ kind: "none" });
  });

  it("a pending record WITHOUT `?code&state` does NOT classify as complete", () => {
    // e.g. a pending flow but the user navigated to the bare app root — not a callback.
    expect(
      classifyAutologin({ ...base, hasPendingRedirect: true, href: `${ORIGIN}/` }),
    ).toEqual({ kind: "none" });
  });

  it("a fresh deep-link is NOT begun while a redirect record is already pending", () => {
    // hasPendingRedirect short-circuits CASE B (we are returning, not starting fresh).
    expect(
      classifyAutologin({
        ...base,
        hasPendingRedirect: true,
        hash: autologinFragment(WEBID),
        href: `${ORIGIN}/?code=abc&state=xyz`,
      }),
    ).toEqual({ kind: "complete-redirect" });
  });
});

describe("parseAutologinFragment / autologinFragment / hasAuthCallbackParams / cleanedUrl", () => {
  it("round-trips a WebID through the fragment encoding", () => {
    const frag = autologinFragment(WEBID);
    expect(frag.startsWith(AUTOLOGIN_FRAGMENT_PREFIX)).toBe(true);
    expect(parseAutologinFragment(frag)).toBe(WEBID);
  });

  it("decodes a percent-encoded WebID (the Pod-Manager builds it with encodeURIComponent)", () => {
    const frag = `${AUTOLOGIN_FRAGMENT_PREFIX}${encodeURIComponent(WEBID)}`;
    expect(parseAutologinFragment(frag)).toBe(WEBID);
  });

  it("returns null for an empty payload, a non-autologin hash, or a bad encoding", () => {
    expect(parseAutologinFragment(AUTOLOGIN_FRAGMENT_PREFIX)).toBeNull();
    expect(parseAutologinFragment("#something-else")).toBeNull();
    expect(parseAutologinFragment("")).toBeNull();
    expect(parseAutologinFragment("#autologin/%")).toBeNull();
  });

  it("hasAuthCallbackParams requires BOTH code and state", () => {
    expect(hasAuthCallbackParams(`${ORIGIN}/?code=a&state=b`)).toBe(true);
    expect(hasAuthCallbackParams(`${ORIGIN}/?code=a`)).toBe(false);
    expect(hasAuthCallbackParams(`${ORIGIN}/?state=b`)).toBe(false);
    expect(hasAuthCallbackParams(`${ORIGIN}/`)).toBe(false);
  });

  it("cleanedUrl strips query AND fragment, keeping scheme/host/port/path", () => {
    expect(cleanedUrl(`${ORIGIN}/?code=a&state=b#autologin/x`)).toBe(`${ORIGIN}/`);
    expect(cleanedUrl(`${ORIGIN}/foo?x=1#frag`)).toBe(`${ORIGIN}/foo`);
    expect(cleanedUrl("https://app.example:8443/a/b?q=1")).toBe(
      "https://app.example:8443/a/b",
    );
  });
});

describe("runAutologin — CASE B (begin-redirect): a fresh deep-link initiates a redirect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("(a) initiates a REDIRECT login for the decoded WebID: cleans the fragment, sets the sentinel, resets, and navigates to the issuer auth URL", async () => {
    const { cb, calls } = makeCallbacks({
      href: `${ORIGIN}/#${AUTOLOGIN_FRAGMENT_PREFIX.slice(1)}${encodeURIComponent(WEBID)}`,
    });
    await runAutologin({ kind: "begin-redirect", webId: WEBID }, cb);

    // The fragment is cleaned BEFORE the redirect so a bounce can't re-trigger and the
    // WebID isn't left in the address bar.
    expect(calls.replaceUrl).toHaveBeenCalledWith(`${ORIGIN}/`);
    // The one-shot loop-guard sentinel is set to the requested WebID.
    expect(calls.setSentinel).toHaveBeenCalledWith(WEBID);
    // doLogin's identity-change reset is mirrored.
    expect(calls.setPendingWebId).toHaveBeenCalledWith(WEBID);
    expect(calls.reset).toHaveBeenCalled();
    // The redirect is begun with the app-root return URI…
    expect(calls.beginRedirectLogin).toHaveBeenCalledWith(`${ORIGIN}/`);
    // …and the full-page navigation targets the resolved issuer's authorization URL.
    expect(calls.assignUrl).toHaveBeenCalledWith(ISSUER_AUTH);
    expect(calls.setRestoring).toHaveBeenCalledWith(true);
    // No completion happened in CASE B.
    expect(calls.completeRedirectLogin).not.toHaveBeenCalled();
  });

  it("the fragment is cleaned BEFORE beginRedirectLogin is called (order matters)", async () => {
    const order: string[] = [];
    const { cb, calls } = makeCallbacks({
      href: `${ORIGIN}/#autologin/${encodeURIComponent(WEBID)}`,
      beginRedirectLogin: async () => {
        order.push("begin");
        return { authorizationUrl: ISSUER_AUTH };
      },
    });
    calls.replaceUrl.mockImplementation(() => order.push("replaceUrl"));
    await runAutologin({ kind: "begin-redirect", webId: WEBID }, cb);
    expect(order[0]).toBe("replaceUrl");
    expect(order).toContain("begin");
    expect(order.indexOf("replaceUrl")).toBeLessThan(order.indexOf("begin"));
  });

  it("a pre-redirect error clears the sentinel, resets, and falls back to the login panel (no navigation)", async () => {
    const { cb, calls } = makeCallbacks({
      href: `${ORIGIN}/#autologin/${encodeURIComponent(WEBID)}`,
      beginRedirectLogin: async () => {
        throw new Error("issuer unreachable");
      },
    });
    await runAutologin({ kind: "begin-redirect", webId: WEBID }, cb);
    expect(calls.assignUrl).not.toHaveBeenCalled();
    expect(calls.clearSentinel).toHaveBeenCalled();
    expect(calls.setPendingWebId).toHaveBeenLastCalledWith(null);
    // onFallback is what the component wires to setAutologinPending(false); the
    // restoring state is cleared THERE, not inside runAutologin's failure path.
    expect(calls.onFallback).toHaveBeenCalledWith("issuer unreachable");
  });
});

describe("runAutologin — CASE A (complete-redirect): returning from the broker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("completes the exchange, reads the profile, sets the session, clears the sentinel, and cleans the URL", async () => {
    const profile = { webId: WEBID, name: "Alice" };
    const { cb, calls } = makeCallbacks({
      href: `${ORIGIN}/?code=abc&state=xyz`,
      authenticatedWebId: () => WEBID,
      readProfile: async () => profile,
    });
    await runAutologin({ kind: "complete-redirect" }, cb);

    expect(calls.completeRedirectLogin).toHaveBeenCalledWith(
      `${ORIGIN}/?code=abc&state=xyz`,
    );
    expect(calls.readProfile).toHaveBeenCalledWith(WEBID);
    // Success: session recorded, sentinel cleared, URL cleaned (no `?code&state`).
    expect(calls.onAuthenticated).toHaveBeenCalledWith(WEBID, profile);
    expect(calls.clearSentinel).toHaveBeenCalled();
    expect(calls.replaceUrl).toHaveBeenCalledWith(`${ORIGIN}/`);
    expect(calls.setRestoring).toHaveBeenCalledWith(true);
    expect(calls.onFallback).not.toHaveBeenCalled();
  });

  it("a failed completion clears the sentinel, cleans the URL, and falls back (no loop, no session)", async () => {
    const { cb, calls } = makeCallbacks({
      href: `${ORIGIN}/?code=abc&state=xyz`,
      completeRedirectLogin: async () => {
        throw new Error("bad state");
      },
    });
    await runAutologin({ kind: "complete-redirect" }, cb);

    expect(calls.onAuthenticated).not.toHaveBeenCalled();
    expect(calls.clearSentinel).toHaveBeenCalled();
    expect(calls.replaceUrl).toHaveBeenCalledWith(`${ORIGIN}/`);
    // onFallback clears the restoring state in the component (setAutologinPending(false)).
    expect(calls.onFallback).toHaveBeenCalledWith("bad state");
  });

  it("a completion that establishes NO authenticated WebID is treated as a failure", async () => {
    const { cb, calls } = makeCallbacks({
      href: `${ORIGIN}/?code=abc&state=xyz`,
      authenticatedWebId: () => undefined,
    });
    await runAutologin({ kind: "complete-redirect" }, cb);
    expect(calls.onAuthenticated).not.toHaveBeenCalled();
    expect(calls.onFallback).toHaveBeenCalled();
  });
});

describe("runAutologin — (c) loop-guard-fallback: bounced back unauthenticated does NOT loop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears the sentinel, cleans the fragment, and falls through to the login panel WITHOUT beginning a redirect", async () => {
    const { cb, calls } = makeCallbacks({
      href: `${ORIGIN}/#autologin/${encodeURIComponent(WEBID)}`,
    });
    await runAutologin({ kind: "loop-guard-fallback" }, cb);
    expect(calls.clearSentinel).toHaveBeenCalled();
    expect(calls.replaceUrl).toHaveBeenCalledWith(`${ORIGIN}/`);
    expect(calls.onFallback).toHaveBeenCalled();
    // CRUCIAL: no second redirect attempt (the loop the guard prevents).
    expect(calls.beginRedirectLogin).not.toHaveBeenCalled();
    expect(calls.assignUrl).not.toHaveBeenCalled();
  });
});

describe("runAutologin — none is a no-op", () => {
  it("does nothing for kind: none", async () => {
    const { cb, calls } = makeCallbacks({ href: `${ORIGIN}/` });
    await runAutologin({ kind: "none" }, cb);
    expect(calls.beginRedirectLogin).not.toHaveBeenCalled();
    expect(calls.completeRedirectLogin).not.toHaveBeenCalled();
    expect(calls.replaceUrl).not.toHaveBeenCalled();
    expect(calls.setRestoring).not.toHaveBeenCalled();
  });
});

describe("end-to-end decision → orchestration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("(c) the loop guard prevents a redirect re-attempt across a bounce: classify then run uses the login panel, not a 2nd redirect", async () => {
    // First pass: fresh deep-link, no sentinel ⇒ begin-redirect (the sentinel gets set).
    const first = makeCallbacks({
      href: `${ORIGIN}/#autologin/${encodeURIComponent(WEBID)}`,
    });
    const d1 = classifyAutologin({
      ready: true,
      loggedIn: false,
      href: first.getHref(),
      hash: `#autologin/${encodeURIComponent(WEBID)}`,
      hasPendingRedirect: false,
      sentinel: null,
    });
    expect(d1).toEqual({ kind: "begin-redirect", webId: WEBID });
    await runAutologin(d1, first.cb);
    expect(first.calls.assignUrl).toHaveBeenCalled();
    expect(first.sentinel.value).toBe(WEBID); // sentinel now set

    // Second pass (the bounce-back-unauthenticated): the broker sent us back to the
    // deep-link WITHOUT a session, the sentinel is still set ⇒ loop-guard-fallback.
    const second = makeCallbacks({
      href: `${ORIGIN}/#autologin/${encodeURIComponent(WEBID)}`,
    });
    const d2 = classifyAutologin({
      ready: true,
      loggedIn: false,
      href: second.getHref(),
      hash: `#autologin/${encodeURIComponent(WEBID)}`,
      hasPendingRedirect: false,
      sentinel: WEBID, // the sentinel set by the first pass survives the bounce
    });
    expect(d2).toEqual({ kind: "loop-guard-fallback" });
    await runAutologin(d2, second.cb);
    // The second pass NEVER redirects again — it falls back to the login panel.
    expect(second.calls.beginRedirectLogin).not.toHaveBeenCalled();
    expect(second.calls.assignUrl).not.toHaveBeenCalled();
    expect(second.calls.onFallback).toHaveBeenCalled();
    expect(second.sentinel.value).toBeNull(); // sentinel cleared on fallback
  });

  it("the SENTINEL key is the documented constant", () => {
    expect(AUTOLOGIN_SENTINEL_KEY).toBe("autologin-attempted");
  });
});
