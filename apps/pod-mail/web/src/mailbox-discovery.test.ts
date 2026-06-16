// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for the inbox mailbox-DOCUMENT discovery + the conventional fallback.
//
// These pin the two app-specific behaviours roborev flagged on the host shell:
//   1. `conventionalMailbox` always yields the mailbox DOCUMENT
//      (`<podRoot>mail/folders/inbox.ttl`), never a bare container — the shape
//      `<Inbox mailboxUrl />` requires.
//   2. `discoverMailbox` returns a Type-Index registration's inbox document when
//      one exists, and otherwise the conventional fallback with `isFallback`
//      — so an authenticated user is never stranded without an inbox to render.
//
// All RDF here is built by serialising Turtle to a parsed dataset via the data
// layer's own parser path (n3) — no hand-built quads in the assertions either.
import { folderDocument, WellKnownFolders } from "@jeswr/pod-mail";
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { conventionalMailbox, discoverMailbox } from "./mailbox-discovery";

const POD_ROOT = "https://alice.example/pod/";
const WEBID = "https://alice.example/profile/card#me";

/** Parse Turtle into a DatasetCore (an n3 Store) for the discovery readers. */
function datasetFromTurtle(turtle: string): Store {
  return new Store(new Parser({ baseIRI: WEBID }).parse(turtle));
}

describe("conventionalMailbox", () => {
  it("yields the mailbox DOCUMENT under <podRoot>mail/folders/, not a container", () => {
    const mb = conventionalMailbox(POD_ROOT);
    expect(mb.mailboxUrl).toBe(`${POD_ROOT}mail/folders/inbox.ttl`);
    expect(mb.mailboxUrl).toBe(folderDocument(POD_ROOT, WellKnownFolders.inbox));
    expect(mb.mailboxUrl.endsWith(".ttl")).toBe(true);
    expect(mb.mailboxUrl.endsWith("/")).toBe(false);
    expect(mb.isFallback).toBe(true);
    expect(mb.source).toBe("convention");
  });
});

describe("discoverMailbox", () => {
  it("falls back to the conventional inbox document when the profile has no Type Index", async () => {
    const profile = datasetFromTurtle(`
      <${WEBID}> <http://www.w3.org/ns/pim/space#storage> <${POD_ROOT}> .
    `);
    const mb = await discoverMailbox(WEBID, POD_ROOT, profile);
    expect(mb.mailboxUrl).toBe(`${POD_ROOT}mail/folders/inbox.ttl`);
    expect(mb.isFallback).toBe(true);
    expect(mb.source).toBe("convention");
  });

  it("derives the inbox document inside a discovered mail container from the public Type Index", async () => {
    const indexUrl = `${POD_ROOT}settings/publicTypeIndex.ttl`;
    const mailContainer = `${POD_ROOT}mail/`;
    const profile = datasetFromTurtle(`
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${WEBID}> solid:publicTypeIndex <${indexUrl}> .
    `);
    const indexTurtle = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix schema: <http://schema.org/> .
      <${indexUrl}#reg> a solid:TypeRegistration ;
        solid:forClass schema:EmailMessage ;
        solid:instanceContainer <${mailContainer}> .
    `;
    // Stub fetch: serve the Type-Index document; everything else 404s.
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === indexUrl) {
        return new Response(indexTurtle, {
          status: 200,
          headers: { "content-type": "text/turtle" },
        });
      }
      return new Response("", { status: 404 });
    };
    const mb = await discoverMailbox(WEBID, POD_ROOT, profile, fetchImpl);
    expect(mb.mailboxUrl).toBe(`${mailContainer}folders/inbox.ttl`);
    expect(mb.isFallback).toBe(false);
    expect(mb.source).toBe("type-index");
  });

  it("falls back to the convention when the Type-Index document is unreadable", async () => {
    const indexUrl = `${POD_ROOT}settings/publicTypeIndex.ttl`;
    const profile = datasetFromTurtle(`
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <${WEBID}> solid:publicTypeIndex <${indexUrl}> .
    `);
    const fetchImpl: typeof fetch = async () => new Response("", { status: 403 });
    const mb = await discoverMailbox(WEBID, POD_ROOT, profile, fetchImpl);
    expect(mb.mailboxUrl).toBe(`${POD_ROOT}mail/folders/inbox.ttl`);
    expect(mb.isFallback).toBe(true);
    expect(mb.source).toBe("convention");
  });
});
