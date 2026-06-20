// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Tests for the thin `importRoom` orchestration — driven entirely by injected
 * fakes (no live homeserver, no live pod). Verifies: pagination + stop conditions,
 * owner-only ACL written FIRST, message/edit/redaction writes to the right stable
 * resources, the LongChat body is parseable, the access token rides ONLY on the
 * guarded homeserver fetch (never the pod writes / never a URL), and the input
 * validation (https-only homeserver, container trailing slash, ACL needs owner).
 */

import { parseRdf } from "@jeswr/fetch-rdf";
import { longChatToCanonical } from "@jeswr/solid-chat-interop";
import { describe, expect, it } from "vitest";
import {
  editMessage,
  imageMessage,
  plainMessage,
  redactionEvent,
  replyMessage,
} from "../test/fixtures/events.js";
import { importRoom } from "./import.js";
import type { MatrixEvent, MatrixMessagesResponse } from "./matrix.js";

const HOMESERVER = "https://matrix.example.org";
const ROOM = "!room:example.org";
const CONTAINER = "https://alice.pod.example/chat/matrix/";
const OWNER = "https://alice.pod.example/profile/card#me";
const TOKEN = "syt_secret_access_token";

interface CapturedWrite {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

/** Build a fake pod writeFetch that records every request and 201s. */
function fakeWriteFetch(): { fetch: typeof globalThis.fetch; writes: CapturedWrite[] } {
  const writes: CapturedWrite[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h === "object" && !Array.isArray(h)) {
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    }
    writes.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      headers,
    });
    return new Response(null, { status: 201 });
  }) as typeof globalThis.fetch;
  return { fetch, writes };
}

interface CapturedRead {
  url: string;
  headers: Record<string, string>;
}

/** Build a fake guarded homeserver fetch that serves the given pages in order. */
function fakeGuardedFetch(pages: MatrixMessagesResponse[]): {
  fetch: typeof globalThis.fetch;
  reads: CapturedRead[];
} {
  const reads: CapturedRead[] = [];
  let i = 0;
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h === "object" && !Array.isArray(h)) {
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    }
    reads.push({ url, headers });
    const page = pages[Math.min(i, pages.length - 1)] ?? { chunk: [] };
    i++;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, reads };
}

const slug = (eventId: string) => `m-${eventId.replace(/[^A-Za-z0-9._-]/g, "_")}.ttl`;
const resourceUrl = (eventId: string) => `${CONTAINER}${slug(eventId)}`;

describe("importRoom — happy path", () => {
  it("writes the owner-only ACL first, then messages, and pages to the end", async () => {
    const page1: MatrixMessagesResponse = {
      chunk: [plainMessage, replyMessage] as MatrixEvent[],
      end: "t1",
    };
    const page2: MatrixMessagesResponse = {
      chunk: [editMessage, redactionEvent, imageMessage] as MatrixEvent[],
      // no `end` -> stop
    };
    const { fetch: writeFetch, writes } = fakeWriteFetch();
    const { fetch: guardedFetch, reads } = fakeGuardedFetch([page1, page2]);

    const result = await importRoom({
      homeserverUrl: HOMESERVER,
      accessToken: TOKEN,
      roomId: ROOM,
      writeFetch,
      container: CONTAINER,
      ownerWebId: OWNER,
      guardedFetch,
      webIdFor: () => OWNER,
    });

    // 2 plain messages (plain + reply) + 1 edit applied = 3 writes; 1 redaction; 1 skip (image).
    expect(result.written).toBe(3);
    expect(result.redacted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.pages).toBe(2);

    // ACL is the FIRST write and is owner-only.
    expect(writes[0]?.url).toBe(`${CONTAINER}.acl`);
    expect(writes[0]?.body).toContain(OWNER);
    expect(writes[0]?.body).toContain("Control");
    expect(writes[0]?.body).not.toContain("Public");
    expect(writes[0]?.body).not.toContain("foaf:Agent");

    // The plain message landed at its stable resource.
    const plainWrite = writes.find((w) => w.url === resourceUrl("$plain1:example.org"));
    expect(plainWrite).toBeDefined();
    expect(plainWrite?.method).toBe("PUT");

    // The $plain1 resource is rewritten in place across its lifecycle: the
    // original message (page 1), then the edit (page 2, sets dct:isReplacedBy),
    // then the redaction (page 2, redacts $plain1 → schema:dateDeleted tombstone).
    const plain1Writes = writes.filter((w) => w.url === resourceUrl("$plain1:example.org"));
    expect(plain1Writes.length).toBe(3);
    // the edit is the 2nd write and carries the isReplacedBy edge
    expect(plain1Writes[1]?.body).toContain("isReplacedBy");
    // the redaction is the 3rd write and tombstones the resource
    expect(plain1Writes[2]?.body).toContain("dateDeleted");

    // Two homeserver reads (one per page); first has no `from`, second carries t1.
    expect(reads.length).toBe(2);
    expect(reads[0]?.url).not.toContain("from=");
    expect(reads[1]?.url).toContain("from=t1");
  });
});

describe("importRoom — the access token is confined to the homeserver fetch", () => {
  it("sends Bearer token on the read, NEVER on a pod write, NEVER in a URL", async () => {
    const { fetch: writeFetch, writes } = fakeWriteFetch();
    const { fetch: guardedFetch, reads } = fakeGuardedFetch([
      { chunk: [plainMessage] as MatrixEvent[] },
    ]);

    await importRoom({
      homeserverUrl: HOMESERVER,
      accessToken: TOKEN,
      roomId: ROOM,
      writeFetch,
      container: CONTAINER,
      ownerWebId: OWNER,
      guardedFetch,
    });

    // The read carries the Bearer token.
    expect(reads[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    // No read URL leaks the token.
    for (const r of reads) expect(r.url).not.toContain(TOKEN);
    // No pod write carries the token in a header or the URL or the body.
    for (const w of writes) {
      expect(w.headers.authorization).toBeUndefined();
      expect(w.url).not.toContain(TOKEN);
      expect(w.body).not.toContain(TOKEN);
    }
  });
});

describe("importRoom — the written LongChat is parseable round-trip", () => {
  it("a written message parses back to the canonical model", async () => {
    const { fetch: writeFetch, writes } = fakeWriteFetch();
    const { fetch: guardedFetch } = fakeGuardedFetch([{ chunk: [plainMessage] as MatrixEvent[] }]);

    await importRoom({
      homeserverUrl: HOMESERVER,
      accessToken: TOKEN,
      roomId: ROOM,
      writeFetch,
      container: CONTAINER,
      ownerWebId: OWNER,
      guardedFetch,
      webIdFor: () => OWNER,
    });

    const url = resourceUrl("$plain1:example.org");
    const write = writes.find((w) => w.url === url);
    expect(write).toBeDefined();
    if (!write) return;
    const dataset = await parseRdf(write.body, "text/turtle", { baseIRI: url });
    const msg = longChatToCanonical(dataset, `${url}#it`);
    expect(msg).toBeDefined();
    expect(msg?.content).toBe("Hello, world!");
    expect(msg?.author).toBe(OWNER);
  });
});

describe("importRoom — redaction clears the body", () => {
  it("a redaction write carries dateDeleted and no content", async () => {
    const { fetch: writeFetch, writes } = fakeWriteFetch();
    const { fetch: guardedFetch } = fakeGuardedFetch([
      { chunk: [redactionEvent] as MatrixEvent[] },
    ]);

    const result = await importRoom({
      homeserverUrl: HOMESERVER,
      accessToken: TOKEN,
      roomId: ROOM,
      writeFetch,
      container: CONTAINER,
      ownerWebId: OWNER,
      guardedFetch,
    });

    expect(result.redacted).toBe(1);
    const url = resourceUrl("$plain1:example.org");
    const write = writes.find((w) => w.url === url);
    expect(write).toBeDefined();
    expect(write?.body).toContain("dateDeleted");

    // Parse it back: no content, a deletedAt tombstone.
    if (!write) return;
    const dataset = await parseRdf(write.body, "text/turtle", { baseIRI: url });
    const msg = longChatToCanonical(dataset, `${url}#it`);
    expect(msg?.content).toBe("");
    expect(msg?.deletedAt).toBeDefined();
  });
});

describe("importRoom — pagination stop conditions", () => {
  it("stops when the end token is unchanged (timeline edge)", async () => {
    const page: MatrixMessagesResponse = { chunk: [plainMessage] as MatrixEvent[], end: "same" };
    const { fetch: writeFetch } = fakeWriteFetch();
    const { fetch: guardedFetch, reads } = fakeGuardedFetch([
      page,
      { chunk: [replyMessage] as MatrixEvent[], end: "same" },
      { chunk: [], end: "same" },
    ]);

    const result = await importRoom({
      homeserverUrl: HOMESERVER,
      accessToken: TOKEN,
      roomId: ROOM,
      writeFetch,
      container: CONTAINER,
      ownerWebId: OWNER,
      guardedFetch,
    });
    // page 1: end "same" != undefined(from) -> continue; page 2: end "same" == from "same" -> stop.
    expect(result.pages).toBe(2);
    expect(reads.length).toBe(2);
  });

  it("respects maxPages", async () => {
    const { fetch: writeFetch } = fakeWriteFetch();
    const { fetch: guardedFetch, reads } = fakeGuardedFetch([
      { chunk: [plainMessage] as MatrixEvent[], end: "a" },
      { chunk: [replyMessage] as MatrixEvent[], end: "b" },
      { chunk: [editMessage] as MatrixEvent[], end: "c" },
    ]);

    const result = await importRoom({
      homeserverUrl: HOMESERVER,
      accessToken: TOKEN,
      roomId: ROOM,
      writeFetch,
      container: CONTAINER,
      ownerWebId: OWNER,
      guardedFetch,
      maxPages: 2,
    });
    expect(result.pages).toBe(2);
    expect(reads.length).toBe(2);
  });
});

describe("importRoom — input validation", () => {
  const { fetch: writeFetch } = fakeWriteFetch();
  const { fetch: guardedFetch } = fakeGuardedFetch([{ chunk: [] }]);
  const base = {
    accessToken: TOKEN,
    roomId: ROOM,
    writeFetch,
    container: CONTAINER,
    ownerWebId: OWNER,
    guardedFetch,
  };

  it("rejects a non-https homeserver", async () => {
    await expect(
      importRoom({ ...base, homeserverUrl: "http://matrix.example.org" }),
    ).rejects.toThrow(/https/);
  });

  it("rejects a container without a trailing slash", async () => {
    await expect(
      importRoom({ ...base, homeserverUrl: HOMESERVER, container: "https://x/chat" }),
    ).rejects.toThrow(/container/);
  });

  it("rejects writeAcl without an owner WebID", async () => {
    await expect(
      importRoom({ ...base, homeserverUrl: HOMESERVER, ownerWebId: undefined }),
    ).rejects.toThrow(/ownerWebId/);
  });

  it("propagates a homeserver error response", async () => {
    const errFetch = (async () =>
      new Response("nope", { status: 401, statusText: "Unauthorized" })) as typeof globalThis.fetch;
    await expect(
      importRoom({ ...base, homeserverUrl: HOMESERVER, guardedFetch: errFetch, writeAcl: false }),
    ).rejects.toThrow(/Matrix \/messages failed: 401/);
  });

  it("propagates a pod write error", async () => {
    const failWrite = (async () =>
      new Response(null, { status: 403, statusText: "Forbidden" })) as typeof globalThis.fetch;
    await expect(
      importRoom({
        ...base,
        homeserverUrl: HOMESERVER,
        writeFetch: failWrite,
        writeAcl: false,
        guardedFetch: fakeGuardedFetch([{ chunk: [plainMessage] as MatrixEvent[] }]).fetch,
      }),
    ).rejects.toThrow(/pod write failed/);
  });
});
