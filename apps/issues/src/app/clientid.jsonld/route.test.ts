// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// AUTHORED-BY GPT-6.1 Sol
// Only the popup callback is registered; account deep links require a click.
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

  it("registers only the popup callback", async () => {
    const { GET } = await import("./route");
    const res = GET();
    const doc = JSON.parse(await res.text());
    expect(doc.redirect_uris).toEqual([`${ORIGIN}/callback.html`]);
  });

  it("keeps client_id byte-equal to the document URL and serves JSON-LD", async () => {
    const { GET } = await import("./route");
    const res = GET();
    expect(res.headers.get("content-type")).toContain("application/ld+json");
    const doc = JSON.parse(await res.text());
    expect(doc.client_id).toBe(`${ORIGIN}/clientid.jsonld`);
    // offline_access permits refresh-based session restore.
    expect(doc.scope).toContain("offline_access");
    expect(doc.grant_types).toContain("refresh_token");
  });
});
