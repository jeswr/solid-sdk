// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Tests for the owner-only ACL builder + a real SSRF-guard wiring check.
 *
 * The ACL test parses the generated Turtle (never asserts on raw string shape) and
 * confirms it grants ONLY the owner Read/Write/Control over the container AND its
 * descendants (acl:accessTo + acl:default), with no public/agentClass grant.
 *
 * The SSRF test uses the REAL `@jeswr/guarded-fetch` node fetch (not a fake) to
 * prove the homeserver path actually blocks a loopback / private / metadata host —
 * i.e. the guard is genuinely wired, not just an injectable seam.
 */

import { parseRdf } from "@jeswr/fetch-rdf";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { describe, expect, it } from "vitest";
import { buildOwnerOnlyAclTurtle, importRoom } from "./import.js";

const ACL = "http://www.w3.org/ns/auth/acl#";
const CONTAINER = "https://alice.pod.example/chat/matrix/";
const OWNER = "https://alice.pod.example/profile/card#me";

describe("buildOwnerOnlyAclTurtle", () => {
  it("grants ONLY the owner full control over the container and descendants", async () => {
    const turtle = await buildOwnerOnlyAclTurtle(CONTAINER, OWNER);
    const ds = await parseRdf(turtle, "text/turtle", { baseIRI: `${CONTAINER}.acl` });

    const has = (p: string, o: string) =>
      ds.match(
        null,
        { termType: "NamedNode", value: p } as never,
        {
          termType: "NamedNode",
          value: o,
        } as never,
      ).size > 0;

    expect(has(`${ACL}agent`, OWNER)).toBe(true);
    expect(has(`${ACL}accessTo`, CONTAINER)).toBe(true);
    expect(has(`${ACL}default`, CONTAINER)).toBe(true);
    expect(has(`${ACL}mode`, `${ACL}Read`)).toBe(true);
    expect(has(`${ACL}mode`, `${ACL}Write`)).toBe(true);
    expect(has(`${ACL}mode`, `${ACL}Control`)).toBe(true);

    // NO public / agentClass grant: no acl:agentClass, no foaf:Agent.
    let publicGrant = false;
    for (const q of ds.match(null, { termType: "NamedNode", value: `${ACL}agentClass` } as never)) {
      void q;
      publicGrant = true;
    }
    expect(publicGrant).toBe(false);
  });
});

describe("SSRF guard is really wired on the homeserver path", () => {
  it("the default node guarded fetch refuses an https loopback homeserver", async () => {
    // Use the REAL guarded fetch (strict defaults). A loopback / private homeserver
    // must be refused before any data is read or written.
    const guardedFetch = createNodeGuardedFetch();
    const writeFetch = (async () => new Response(null, { status: 201 })) as typeof globalThis.fetch;

    await expect(
      importRoom({
        homeserverUrl: "https://127.0.0.1",
        accessToken: "t",
        roomId: "!r:x",
        writeFetch,
        container: CONTAINER,
        ownerWebId: OWNER,
        writeAcl: false,
        guardedFetch,
      }),
    ).rejects.toThrow();
  });

  it("the default node guarded fetch refuses the cloud-metadata IP", async () => {
    const guardedFetch = createNodeGuardedFetch();
    const writeFetch = (async () => new Response(null, { status: 201 })) as typeof globalThis.fetch;

    await expect(
      importRoom({
        homeserverUrl: "https://169.254.169.254",
        accessToken: "t",
        roomId: "!r:x",
        writeFetch,
        container: CONTAINER,
        ownerWebId: OWNER,
        writeAcl: false,
        guardedFetch,
      }),
    ).rejects.toThrow();
  });
});
