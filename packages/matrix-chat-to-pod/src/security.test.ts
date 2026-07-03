// AUTHORED-BY Claude Fable 5
/**
 * Adversarial security regression tests for the import path:
 *  - n3.Writer IRI-injection is neutralised end-to-end (an injection-carrying
 *    author/WebID cannot inject extra triples into the written LongChat resource,
 *    and cannot inject a public grant into the owner-only ACL);
 *  - the owner-only ACL builder FAILS CLOSED on an unsafe container/ownerWebId;
 *  - pod writes REFUSE a redirect (3xx / opaqueredirect) rather than follow it;
 *  - a write URL outside the configured container base is REFUSED (scope guard);
 *  - control characters in an untrusted body are STRIPPED from the stored resource.
 */

import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import { plainMessage } from "../test/fixtures/events.js";
import { buildOwnerOnlyAclTurtle, importRoom } from "./import.js";
import type { MatrixEvent, MatrixMessagesResponse } from "./matrix.js";

const HOMESERVER = "https://matrix.example.org";
const ROOM = "!room:example.org";
const CONTAINER = "https://alice.pod.example/chat/matrix/";
const OWNER = "https://alice.pod.example/profile/card#me";
const TOKEN = "syt_secret_access_token";
const ACL = "http://www.w3.org/ns/auth/acl#";

interface CapturedWrite {
  url: string;
  body: string;
}

function fakeWriteFetch(responder: () => Response = () => new Response(null, { status: 201 })): {
  fetch: typeof globalThis.fetch;
  writes: CapturedWrite[];
} {
  const writes: CapturedWrite[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    writes.push({
      url: typeof input === "string" ? input : input.toString(),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return responder();
  }) as typeof globalThis.fetch;
  return { fetch, writes };
}

function fakeGuardedFetch(pages: MatrixMessagesResponse[]): typeof globalThis.fetch {
  let i = 0;
  return (async () => {
    const page = pages[Math.min(i, pages.length - 1)] ?? { chunk: [] };
    i++;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

// A canonical n3-breakout payload: a `>` closes the `<...>`, a `.` ends the
// statement, and a fresh triple is injected.
const INJECTION =
  "https://evil.example/a>.\n<https://victim.pod/private/.acl#pub> <http://www.w3.org/ns/auth/acl#agentClass> <http://xmlns.com/foaf/0.1/Agent";

describe("IRI-injection is neutralised end-to-end (author via webIdFor)", () => {
  it("an injection-carrying resolved WebID cannot inject triples into the resource", async () => {
    const { fetch: writeFetch, writes } = fakeWriteFetch();
    await importRoom({
      homeserverUrl: HOMESERVER,
      accessToken: TOKEN,
      roomId: ROOM,
      writeFetch,
      container: CONTAINER,
      ownerWebId: OWNER,
      guardedFetch: fakeGuardedFetch([{ chunk: [plainMessage] as MatrixEvent[] }]),
      // A hostile / naive resolver that reflects an injection payload.
      webIdFor: () => INJECTION,
    });

    const messageWrite = writes.find((w) => w.url !== `${CONTAINER}.acl`);
    expect(messageWrite).toBeDefined();
    if (!messageWrite) return;
    // The injection is NEUTRALISED by canonicalisation: the whole payload becomes a
    // single opaque (percent-encoded) IRI, not injected triples. Prove it by
    // PARSING (not string-matching, since the escaped string still literally
    // contains "agentClass" inside the one IRI): exactly ONE subject, and NO
    // acl:agentClass PREDICATE, and no raw angle-bracket breakout.
    const ds = await parseRdf(messageWrite.body, "text/turtle", { baseIRI: messageWrite.url });
    const subjects = new Set<string>();
    let agentClassPredicate = false;
    for (const q of ds) {
      subjects.add(q.subject.value);
      if (q.predicate.value === `${ACL}agentClass`) agentClassPredicate = true;
    }
    expect(subjects.size).toBe(1);
    expect([...subjects][0]).toBe(`${messageWrite.url}#it`);
    expect(agentClassPredicate).toBe(false);
    // The serialized foaf:maker IRI carries no raw `>` breakout.
    for (const q of ds.match(null, {
      termType: "NamedNode",
      value: "http://xmlns.com/foaf/0.1/maker",
    } as never)) {
      expect(q.object.value).not.toContain(">");
    }
  });
});

describe("buildOwnerOnlyAclTurtle is injection-safe + fails closed on a non-IRI owner", () => {
  it("NEUTRALISES an injection-carrying ownerWebId (canonicalised, no public grant injected)", async () => {
    // A valid-prefix http(s) URL carrying a breakout payload is not rejected — it is
    // CANONICALISED into a single safe IRI. Prove no acl:agentClass predicate and no
    // extra subject was injected.
    const turtle = await buildOwnerOnlyAclTurtle(CONTAINER, INJECTION);
    const ds = await parseRdf(turtle, "text/turtle", { baseIRI: `${CONTAINER}.acl` });
    const subjects = new Set<string>();
    let agentClassPredicate = false;
    for (const q of ds) {
      subjects.add(q.subject.value);
      if (q.predicate.value === `${ACL}agentClass`) agentClassPredicate = true;
    }
    expect(subjects.size).toBe(1); // only <...>.acl#owner
    expect([...subjects][0]).toBe(`${CONTAINER}.acl#owner`);
    expect(agentClassPredicate).toBe(false);
  });

  it("throws on a non-http(s) ownerWebId (cannot be a safe IRI)", async () => {
    await expect(buildOwnerOnlyAclTurtle(CONTAINER, "mailto:alice@example.org")).rejects.toThrow(
      /ownerWebId/,
    );
    await expect(buildOwnerOnlyAclTurtle(CONTAINER, "not a url")).rejects.toThrow(/ownerWebId/);
  });

  it("NEUTRALISES an injection-carrying container (percent-encoded, still owner-only)", async () => {
    // `a>x/` canonicalises to `a%3Ex/` — a safe container, no injected triple.
    const turtle = await buildOwnerOnlyAclTurtle("https://alice.pod.example/a>x/", OWNER);
    expect(turtle).not.toContain("a>x"); // the raw `>` is gone
    const ds = await parseRdf(turtle, "text/turtle", {
      baseIRI: "https://alice.pod.example/a%3Ex/.acl",
    });
    let agentClassPredicate = false;
    for (const q of ds) {
      if (q.predicate.value === `${ACL}agentClass`) agentClassPredicate = true;
    }
    expect(agentClassPredicate).toBe(false);
  });

  it("throws on a non-http(s) container", async () => {
    await expect(buildOwnerOnlyAclTurtle("ftp://x.example/c/", OWNER)).rejects.toThrow(/container/);
  });

  it("still produces a valid owner-only ACL for a legitimate owner", async () => {
    const turtle = await buildOwnerOnlyAclTurtle(CONTAINER, OWNER);
    const ds = await parseRdf(turtle, "text/turtle", { baseIRI: `${CONTAINER}.acl` });
    let publicGrant = false;
    for (const _q of ds.match(null, {
      termType: "NamedNode",
      value: `${ACL}agentClass`,
    } as never)) {
      publicGrant = true;
    }
    expect(publicGrant).toBe(false);
    let ownerGrant = false;
    for (const _q of ds.match(
      null,
      { termType: "NamedNode", value: `${ACL}agent` } as never,
      { termType: "NamedNode", value: OWNER } as never,
    )) {
      ownerGrant = true;
    }
    expect(ownerGrant).toBe(true);
  });
});

describe("pod writes refuse a redirect (fail-closed)", () => {
  for (const status of [301, 302, 303, 307, 308]) {
    it(`throws on a ${status} redirect from the ACL write`, async () => {
      const { fetch: writeFetch } = fakeWriteFetch(
        () => new Response(null, { status, headers: { location: "https://attacker.example/" } }),
      );
      await expect(
        importRoom({
          homeserverUrl: HOMESERVER,
          accessToken: TOKEN,
          roomId: ROOM,
          writeFetch,
          container: CONTAINER,
          ownerWebId: OWNER,
          guardedFetch: fakeGuardedFetch([{ chunk: [] }]),
        }),
      ).rejects.toThrow(/refusing to follow a redirect/);
    });
  }

  it("throws on an opaqueredirect response from a pod write", async () => {
    // Simulate what `redirect: "manual"` surfaces: a status-0 opaqueredirect.
    const opaque = { ok: false, status: 0, type: "opaqueredirect", statusText: "" } as Response;
    const { fetch: writeFetch } = fakeWriteFetch(() => opaque);
    await expect(
      importRoom({
        homeserverUrl: HOMESERVER,
        accessToken: TOKEN,
        roomId: ROOM,
        writeFetch,
        container: CONTAINER,
        ownerWebId: OWNER,
        guardedFetch: fakeGuardedFetch([{ chunk: [] }]),
      }),
    ).rejects.toThrow(/refusing to follow a redirect/);
  });
});

describe("container must be unambiguous (query/fragment cannot decoy the ACL)", () => {
  for (const bad of [
    "https://alice.pod.example/chat/?x=/",
    "https://alice.pod.example/chat/#frag/",
    "https://alice.pod.example/chat", // no trailing slash
  ]) {
    it(`rejects a container "${bad}" with NO write`, async () => {
      const { fetch: writeFetch, writes } = fakeWriteFetch();
      await expect(
        importRoom({
          homeserverUrl: HOMESERVER,
          accessToken: TOKEN,
          roomId: ROOM,
          writeFetch,
          container: bad,
          ownerWebId: OWNER,
          guardedFetch: fakeGuardedFetch([{ chunk: [plainMessage] as MatrixEvent[] }]),
        }),
      ).rejects.toThrow(/container/);
      expect(writes.length).toBe(0); // fail-closed: nothing was written anywhere
    });
  }

  it("a clean container writes the ACL at <container>.acl and every message URL is within it", async () => {
    const cleanContainer = "https://alice.pod.example/chat/matrix/";
    const { fetch: writeFetch, writes } = fakeWriteFetch();
    await importRoom({
      homeserverUrl: HOMESERVER,
      accessToken: TOKEN,
      roomId: ROOM,
      writeFetch,
      container: cleanContainer,
      ownerWebId: OWNER,
      guardedFetch: fakeGuardedFetch([{ chunk: [plainMessage] as MatrixEvent[] }]),
    });
    // The ACL is written at exactly `<container>.acl` — not a decoy.
    expect(writes[0]?.url).toBe(`${cleanContainer}.acl`);
    // Every non-ACL write is strictly under the container.
    for (const w of writes.slice(1)) {
      expect(w.url.startsWith(cleanContainer)).toBe(true);
      expect(w.url.length).toBeGreaterThan(cleanContainer.length);
    }
  });
});

describe("scope guard — a write URL outside the container is refused", () => {
  it("throws when a custom messageUrlFor escapes the container (cross-origin)", async () => {
    const { fetch: writeFetch } = fakeWriteFetch();
    await expect(
      importRoom({
        homeserverUrl: HOMESERVER,
        accessToken: TOKEN,
        roomId: ROOM,
        writeFetch,
        container: CONTAINER,
        ownerWebId: OWNER,
        writeAcl: false,
        guardedFetch: fakeGuardedFetch([{ chunk: [plainMessage] as MatrixEvent[] }]),
        messageUrlFor: () => "https://attacker.example/steal.ttl",
      }),
    ).rejects.toThrow(/outside the configured container base/);
  });

  it("throws when a custom messageUrlFor writes to a parent of the container", async () => {
    const { fetch: writeFetch } = fakeWriteFetch();
    await expect(
      importRoom({
        homeserverUrl: HOMESERVER,
        accessToken: TOKEN,
        roomId: ROOM,
        writeFetch,
        container: CONTAINER,
        ownerWebId: OWNER,
        writeAcl: false,
        guardedFetch: fakeGuardedFetch([{ chunk: [plainMessage] as MatrixEvent[] }]),
        messageUrlFor: () => "https://alice.pod.example/other/x.ttl",
      }),
    ).rejects.toThrow(/outside the configured container base/);
  });
});

describe("homeserver read refuses a redirect", () => {
  it("throws on a 3xx from the homeserver fetch", async () => {
    const redirectFetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/" },
      })) as typeof globalThis.fetch;
    const { fetch: writeFetch } = fakeWriteFetch();
    await expect(
      importRoom({
        homeserverUrl: HOMESERVER,
        accessToken: TOKEN,
        roomId: ROOM,
        writeFetch,
        container: CONTAINER,
        ownerWebId: OWNER,
        writeAcl: false,
        guardedFetch: redirectFetch,
      }),
    ).rejects.toThrow(/refusing to follow a redirect/);
  });
});

describe("control characters are stripped from an untrusted body", () => {
  it("a body with NUL/ESC/BEL is sanitised in the stored resource", async () => {
    const nasty: MatrixEvent = {
      type: "m.room.message",
      event_id: "$ctrl1:example.org",
      sender: "@alice:example.org",
      room_id: ROOM,
      origin_server_ts: 1_700_000_000_000,
      content: {
        msgtype: "m.text",
        body: `hi${String.fromCharCode(0)}${String.fromCharCode(27)}[31mthere${String.fromCharCode(7)}`,
      },
    } as MatrixEvent;
    const { fetch: writeFetch, writes } = fakeWriteFetch();
    await importRoom({
      homeserverUrl: HOMESERVER,
      accessToken: TOKEN,
      roomId: ROOM,
      writeFetch,
      container: CONTAINER,
      ownerWebId: OWNER,
      writeAcl: false,
      guardedFetch: fakeGuardedFetch([{ chunk: [nasty] }]),
    });
    const write = writes[0];
    expect(write).toBeDefined();
    if (!write) return;
    // No raw C0 control char survives in the serialized resource.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting controls are absent.
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(write.body)).toBe(false);
    const ds = await parseRdf(write.body, "text/turtle", { baseIRI: write.url });
    let content = "";
    for (const q of ds.match(null, {
      termType: "NamedNode",
      value: "http://rdfs.org/sioc/ns#content",
    } as never)) {
      content = q.object.value;
    }
    expect(content).toBe("hi[31mthere");
  });
});
