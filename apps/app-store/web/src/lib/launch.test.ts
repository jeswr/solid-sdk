// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// launch.test.ts — exhaustive tests for the launch-URL seam, with the load-bearing
// NO-TOKEN invariant front and centre: only the public WebID is ever placed in a
// launch URL, never a credential.
import { describe, expect, it } from "vitest";
import type { AppEntry } from "./catalog";
import { launchUrl } from "./launch";

const WEBID = "https://alice.solid-test.jeswr.org/profile/card#me";

/** A live autologin app (the 8 pod-apps + Solid Issues shape). */
const autologinApp: AppEntry = {
  id: "pod-drive",
  name: "Pod Drive",
  description: "File browser over Solid LDP containers.",
  category: "Documents",
  deployedUrl: "https://drive.solid-test.jeswr.org",
  status: "live",
  repo: "https://github.com/jeswr/pod-drive",
  launch: "autologin",
};

/** The Pod Manager shape (prefill / `?webid=`). */
const prefillApp: AppEntry = {
  id: "solid-pod-manager",
  name: "Solid Pod Manager",
  description: "Standalone Solid consumer/management app.",
  category: "Productivity",
  deployedUrl: "https://app.solid-test.jeswr.org",
  status: "live",
  repo: "https://github.com/jeswr/solid-pod-manager",
  launch: "prefill",
};

/** A not-deployed (coming-soon) app. */
const comingSoonApp: AppEntry = {
  id: "accessradar",
  name: "AccessRadar",
  description: "Web accessibility compliance SaaS.",
  category: "Finance",
  deployedUrl: null,
  status: "wip",
  repo: "https://github.com/jeswr/accessradar",
  launch: "none",
};

describe("launchUrl — autologin (#autologin/<webid> fragment SSO)", () => {
  it("appends the #autologin/<encodeURIComponent(webid)> fragment to the app origin", () => {
    const url = launchUrl(autologinApp, WEBID);
    expect(url).toBe(`https://drive.solid-test.jeswr.org/#autologin/${encodeURIComponent(WEBID)}`);
  });

  it("URL-encodes the WebID (the #me fragment + reserved chars round-trip through the parser)", () => {
    const url = launchUrl(autologinApp, WEBID);
    // The raw `#me` and `://` must be percent-encoded inside the fragment value, so the
    // target's parseAutologinFragment sees exactly ONE `#` (the deep-link marker).
    expect(url).toContain("%23me");
    expect(url).toContain("https%3A%2F%2F");
    // Exactly one `#` in the whole URL — the deep-link prefix, not the WebID's own.
    expect((url as string).match(/#/g)?.length).toBe(1);
  });

  it("carries the WebID in the FRAGMENT, not the query (RFC 3986 §3.5 — never sent on the wire)", () => {
    const url = new URL(launchUrl(autologinApp, WEBID) as string);
    expect(url.search).toBe(""); // no query
    expect(url.hash.startsWith("#autologin/")).toBe(true);
  });
});

describe("launchUrl — prefill (?webid= one-click, Pod Manager)", () => {
  it("appends ?webid=<encodeURIComponent(webid)> to the app origin", () => {
    const url = new URL(launchUrl(prefillApp, WEBID) as string);
    expect(url.origin).toBe("https://app.solid-test.jeswr.org");
    expect(url.searchParams.get("webid")).toBe(WEBID);
    expect(url.hash).toBe(""); // prefill uses the query, not a fragment
  });
});

describe("launchUrl — fallbacks (no identity carried)", () => {
  it("logged out → a plain link to the app origin (no fragment, no query)", () => {
    expect(launchUrl(autologinApp, null)).toBe("https://drive.solid-test.jeswr.org");
    expect(launchUrl(autologinApp, undefined)).toBe("https://drive.solid-test.jeswr.org");
    expect(launchUrl(prefillApp)).toBe("https://app.solid-test.jeswr.org");
  });

  it('launch === "none" → a plain link even when logged in', () => {
    const liveNoneApp: AppEntry = { ...autologinApp, launch: "none" };
    expect(launchUrl(liveNoneApp, WEBID)).toBe("https://drive.solid-test.jeswr.org");
  });

  it("a not-deployed app returns null (nothing to launch — UI renders Coming soon)", () => {
    expect(launchUrl(comingSoonApp, WEBID)).toBeNull();
    expect(launchUrl(comingSoonApp, null)).toBeNull();
  });
});

describe("launchUrl — THE SECURITY INVARIANT: only the public WebID, NEVER a token", () => {
  // The forbidden substrings: any credential / secret material that must NEVER
  // appear in a launch URL. We check the produced URL (and its decoded form) for
  // each across all mechanisms + both session states.
  const FORBIDDEN = [
    "access_token",
    "refresh_token",
    "id_token",
    "id_token_hint",
    "token=",
    "code=",
    "dpop",
    "DPoP",
    "Bearer",
    "bearer",
    "client_secret",
    "secret",
    "authorization",
    "Authorization",
    "private_key",
    "eyJ", // a JWT always begins `eyJ` (base64url of `{"`) — catch a leaked token
  ];

  const cases: Array<[string, AppEntry, string | null]> = [
    ["autologin + webid", autologinApp, WEBID],
    ["autologin + logged out", autologinApp, null],
    ["prefill + webid", prefillApp, WEBID],
    ["prefill + logged out", prefillApp, null],
    ["none + webid", { ...autologinApp, launch: "none" }, WEBID],
  ];

  for (const [label, app, webId] of cases) {
    it(`never emits any credential token (${label})`, () => {
      const url = launchUrl(app, webId);
      if (url === null) return; // nothing emitted
      const decoded = decodeURIComponent(url);
      for (const bad of FORBIDDEN) {
        expect(url).not.toContain(bad);
        expect(decoded).not.toContain(bad);
      }
    });
  }

  it("the ONLY identity material present is exactly the public WebID (autologin)", () => {
    const url = launchUrl(autologinApp, WEBID) as string;
    // The decoded URL contains the WebID verbatim and nothing else identity-bearing.
    expect(decodeURIComponent(url)).toContain(WEBID);
  });

  it("the ONLY identity material present is exactly the public WebID (prefill)", () => {
    const url = new URL(launchUrl(prefillApp, WEBID) as string);
    expect(url.searchParams.get("webid")).toBe(WEBID);
    // No other query parameters exist beyond the single `webid`.
    expect([...url.searchParams.keys()]).toEqual(["webid"]);
  });
});
