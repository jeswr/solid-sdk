// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Client Identifier Document drives Solid-OIDC login. For the Pod-Manager
// AUTOLOGIN deep-link the OP must accept a full-page redirect back to the APP ROOT
// (`${origin}/`), so the document MUST register BOTH redirect_uris:
//   - `/callback.html` (the existing popup login), AND
//   - `/`             (the autologin full-page-redirect return target).
// An OP rejects any redirect_uri not listed here, so a missing app-root entry would
// break autologin in production. This test pins both (FIX-1).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORIGIN = "https://issues.solid-test.jeswr.org";

describe("clientid.jsonld route — redirect_uris (FIX-1)", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.APP_ORIGIN;
    process.env.APP_ORIGIN = ORIGIN;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = prev;
  });

  it("emits BOTH the callback AND the app-root redirect_uris", async () => {
    const { GET } = await import("./route");
    const res = GET();
    const doc = JSON.parse(await res.text());
    expect(doc.redirect_uris).toContain(`${ORIGIN}/callback.html`);
    // The app-root return target for the autologin full-page redirect.
    expect(doc.redirect_uris).toContain(`${ORIGIN}/`);
    expect(doc.redirect_uris).toHaveLength(2);
  });

  it("keeps client_id byte-equal to the document URL and serves JSON-LD", async () => {
    const { GET } = await import("./route");
    const res = GET();
    expect(res.headers.get("content-type")).toContain("application/ld+json");
    const doc = JSON.parse(await res.text());
    expect(doc.client_id).toBe(`${ORIGIN}/clientid.jsonld`);
    // offline_access keeps the autologin redirect path able to mint a refresh token.
    expect(doc.scope).toContain("offline_access");
    expect(doc.grant_types).toContain("refresh_token");
  });
});
