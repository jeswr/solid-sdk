// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-profile-card> tests: render a WebID profile via @solid/object's Agent typed
// accessors (name / org / role / photo / homepage / issuer), the src→fetch read path,
// the empty state, and the http(s)-only filtering of the photo/website hrefs.

import "../src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JeswrProfileCard } from "../src/index.js";
import { mount, PROFILE_TTL, parseTurtle, waitFor } from "./fixtures.js";

const WEBID = "https://alice.example/profile/card#me";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function ttlFetch(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "Content-Type": "text/turtle" },
    })) as unknown as typeof fetch;
}

describe("<jeswr-profile-card>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("jeswr-profile-card")).toBeDefined();
  });

  it("renders a profile via the @solid/object Agent accessors (store path)", async () => {
    const el = await mount<JeswrProfileCard>("jeswr-profile-card");
    // The subject is the WebID; set src to the WebID so the Agent reads the right node.
    el.src = WEBID;
    el.store = parseTurtle(PROFILE_TTL, WEBID);
    await waitFor(el, (e) => !!e.querySelector('[part="card"]'), "card renders");

    expect(el.querySelector('[part="name"]')?.textContent).toContain("Alice Smith");
    expect(el.querySelector('[part="org"]')?.textContent).toContain("ACME Corp");
    expect(el.querySelector('[part="org"]')?.textContent).toContain("Engineer");

    const photo = el.querySelector('[part="photo"]') as HTMLImageElement | null;
    expect(photo?.getAttribute("src")).toBe("https://alice.example/photo.jpg");
    const website = el.querySelector('[part="website"]') as HTMLAnchorElement | null;
    expect(website?.getAttribute("href")).toBe("https://alice.example/");
    const webid = el.querySelector('[part="webid"]') as HTMLAnchorElement | null;
    expect(webid?.getAttribute("href")).toBe(WEBID);
    expect(el.textContent).toContain("https://idp.example/");
  });

  it("reads from `src` through the injected fetch seam", async () => {
    const el = await mount<JeswrProfileCard>("jeswr-profile-card");
    el.fetch = ttlFetch(PROFILE_TTL);
    el.src = WEBID;
    await waitFor(el, (e) => !!e.querySelector('[part="name"]'), "profile via fetch");
    expect(el.querySelector('[part="name"]')?.textContent).toContain("Alice Smith");
  });

  it("shows the empty state when the document holds no profile fields", async () => {
    const el = await mount<JeswrProfileCard>("jeswr-profile-card");
    el.src = WEBID;
    el.store = parseTurtle("@prefix ex: <https://ex.example/> . ex:a ex:b ex:c .", WEBID);
    await waitFor(el, (e) => !!e.querySelector('[part="empty"]'), "empty state renders");
    expect(el.querySelector('[part="empty"]')?.textContent).toContain("No profile");
  });

  it("drops a non-http(s) photo/website (no img/href to a hostile scheme)", async () => {
    const hostile = `
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<${WEBID}> a foaf:Person ;
  foaf:name "Eve" ;
  foaf:img <javascript:alert(1)> ;
  foaf:homepage <javascript:alert(2)> .
`;
    const el = await mount<JeswrProfileCard>("jeswr-profile-card");
    el.src = WEBID;
    el.store = parseTurtle(hostile, WEBID);
    await waitFor(el, (e) => !!e.querySelector('[part="name"]'), "hostile profile renders");
    expect(el.querySelector('[part="photo"]')).toBeNull();
    expect(el.querySelector('[part="website"]')).toBeNull();
    expect(el.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(el.querySelector('img[src^="javascript:"]')).toBeNull();
  });
});
