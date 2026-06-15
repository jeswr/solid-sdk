// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { OutOfScopeError } from "./errors.js";
import {
  CHAT_SLUG,
  type ChatStore,
  createChatStore,
  MESSAGES_SLUG,
  nameFromUrl,
  ROOMS_SLUG,
  toSlug,
} from "./store.js";
import { mockFetch, normaliseHeaders } from "./test-helpers.js";
import { CHAT_ROOM_CLASS } from "./vocab.js";

const WEBID = "https://alice.pod/profile/card#me";
const POD = "https://alice.pod/";
const CHAT = "https://alice.pod/pod-chat/";
const ROOMS = "https://alice.pod/pod-chat/rooms/";
const MESSAGES = "https://alice.pod/pod-chat/messages/";
const ROOM = "https://alice.pod/pod-chat/rooms/general.ttl";
const MSG = "https://alice.pod/pod-chat/messages/m1.ttl";
const BOB = "https://bob.pod/profile/card#me";

function store(fetchImpl?: typeof fetch): ChatStore {
  return createChatStore({ podRoot: POD, webId: WEBID, fetchImpl });
}

describe("slugs", () => {
  it("lower-cases, hyphenates and strips unsafe chars", () => {
    expect(toSlug("Hello, World! 2026")).toBe("hello-world-2026");
  });
  it("strips diacritics", () => {
    expect(toSlug("Café Déjà")).toBe("cafe-deja");
  });
  it("returns empty for undefined or all-unsafe input", () => {
    expect(toSlug(undefined)).toBe("");
    expect(toSlug("!!!")).toBe("");
  });
  it("never contains a colon and is capped in length", () => {
    const slug = toSlug("a".repeat(200));
    expect(slug).not.toContain(":");
    expect(slug.length).toBeLessThanOrEqual(48);
  });
});

describe("ChatStore basics", () => {
  it("exposes the rooms + messages containers under the pod-chat tree", () => {
    expect(store().roomsContainer).toBe(ROOMS);
    expect(store().messagesContainer).toBe(MESSAGES);
    expect(CHAT_SLUG).toBe("pod-chat/");
    expect(ROOMS_SLUG).toBe("rooms/");
    expect(MESSAGES_SLUG).toBe("messages/");
  });

  it("re-exports nameFromUrl", () => {
    expect(nameFromUrl("https://pod/pod-chat/rooms/x.ttl")).toBe("x.ttl");
  });
});

describe("scope guard (rooms)", () => {
  const s = store(mockFetch({}).fetch);
  it("rejects a different origin", async () => {
    await expect(s.readRoom("https://evil.pod/pod-chat/rooms/x.ttl")).rejects.toBeInstanceOf(
      OutOfScopeError,
    );
  });
  it("rejects a path outside the container", async () => {
    await expect(s.readRoom("https://alice.pod/other/x.ttl")).rejects.toBeInstanceOf(
      OutOfScopeError,
    );
  });
  it("rejects the messages container for a room read (cross-container confusion)", async () => {
    await expect(s.readRoom(MSG)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects the container root itself", async () => {
    await expect(s.readRoom(ROOMS)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects a sub-container", async () => {
    await expect(s.readRoom(`${ROOMS}sub/inner.ttl`)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects an encoded slash", async () => {
    await expect(s.readRoom(`${ROOMS}a%2Fb`)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects a query or fragment", async () => {
    await expect(s.readRoom(`${ROOM}?x=1`)).rejects.toBeInstanceOf(OutOfScopeError);
    await expect(s.readRoom(`${ROOM}#frag`)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects an unparseable URL", async () => {
    await expect(s.readRoom("::not a url")).rejects.toBeInstanceOf(OutOfScopeError);
  });
});

describe("scope guard (messages)", () => {
  const s = store(mockFetch({}).fetch);
  it("rejects the rooms container for a message read", async () => {
    await expect(s.readMessage(ROOM)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects an out-of-scope message save/delete before any I/O", async () => {
    const { fetch, calls } = mockFetch({});
    const sc = store(fetch);
    await expect(sc.saveMessage("https://evil/x", { content: "x" })).rejects.toBeInstanceOf(
      OutOfScopeError,
    );
    await expect(sc.removeMessage("https://evil/x")).rejects.toBeInstanceOf(OutOfScopeError);
    expect(calls).toHaveLength(0);
  });
});

describe("readRoom", () => {
  it("parses a room and returns its etag", async () => {
    const body = `
      @prefix pc: <https://w3id.org/jeswr/pod-chat#> .
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      <#it> a as:Collection, pc:ChatRoom ; as:name "General" .
    `;
    const { fetch } = mockFetch({ [`GET ${ROOM}`]: { body, etag: 'W/"r"' } });
    const result = await store(fetch).readRoom(ROOM);
    expect(result?.url).toBe(ROOM);
    expect(result?.etag).toBe('W/"r"');
    expect(result?.data.name).toBe("General");
  });

  it("returns undefined when the resource is not a pc:ChatRoom", async () => {
    const { fetch } = mockFetch({
      [`GET ${ROOM}`]: { body: `<#it> <http://purl.org/dc/terms/title> "x" .` },
    });
    await expect(store(fetch).readRoom(ROOM)).resolves.toBeUndefined();
  });

  it("propagates a 404 as an RdfFetchError", async () => {
    const { fetch } = mockFetch({});
    await expect(store(fetch).readRoom(ROOM)).rejects.toMatchObject({ status: 404 });
  });
});

describe("readMessage", () => {
  it("parses a message and returns its etag", async () => {
    const body = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      <#it> a as:Note ; as:content "hi" .
    `;
    const { fetch } = mockFetch({ [`GET ${MSG}`]: { body, etag: 'W/"m"' } });
    const result = await store(fetch).readMessage(MSG);
    expect(result?.url).toBe(MSG);
    expect(result?.etag).toBe('W/"m"');
    expect(result?.data.content).toBe("hi");
  });

  it("returns undefined when the resource is not an as:Note", async () => {
    const { fetch } = mockFetch({
      [`GET ${MSG}`]: { body: `<#it> <http://purl.org/dc/terms/title> "x" .` },
    });
    await expect(store(fetch).readMessage(MSG)).resolves.toBeUndefined();
  });
});

describe("createRoom", () => {
  it("ensures containers, registers the rooms container, then writes the room create-only", async () => {
    const PrivateIndex = "https://alice.pod/settings/privateTypeIndex.ttl";
    const { fetch, calls } = mockFetch({
      [`GET ${WEBID}`]: {
        body: `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person> .`,
        etag: 'W/"p"',
      },
      [`PUT ${PrivateIndex}`]: { status: 201 },
      [`PUT ${WEBID.replace("#me", "")}`]: { status: 205 },
      [`GET ${PrivateIndex}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <> a solid:TypeIndex .",
        etag: 'W/"i"',
      },
      // container-ensure PUTs (idempotent; the conditional create says "exists")
      [`PUT ${CHAT}`]: { status: 412 },
      [`PUT ${ROOMS}`]: { status: 412 },
      [`PUT ${MESSAGES}`]: { status: 412 },
    });
    // The room PUT URL is dynamic (random); intercept the room resource PUT only.
    const baseFetch = fetch;
    const wrapped = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if ((init?.method ?? "GET") === "PUT" && url.startsWith(ROOMS) && url.endsWith(".ttl")) {
        calls.push({
          url,
          method: "PUT",
          headers: normaliseHeaders(init?.headers),
          body: init?.body as string,
        });
        return new Response(null, { status: 201, headers: { etag: 'W/"new"' } });
      }
      return baseFetch(input, init);
    }) as typeof fetch;

    const { url, etag } = await store(wrapped).createRoom({ name: "General" });
    expect(url.startsWith(`${ROOMS}general-`)).toBe(true);
    expect(etag).toBe('W/"new"');
    const roomPut = calls.find((c) => c.method === "PUT" && c.url === url);
    expect(roomPut?.headers["if-none-match"]).toBe("*");
    // The type-index registration was written for the ChatRoom class.
    expect(calls.some((c) => c.method === "PUT" && c.url === PrivateIndex)).toBe(true);
    expect(roomPut?.body).toContain("pc:ChatRoom");
    // All three containers were ensured (shallowest-first).
    expect(calls.some((c) => c.method === "PUT" && c.url === CHAT)).toBe(true);
    expect(calls.some((c) => c.method === "PUT" && c.url === ROOMS)).toBe(true);
    expect(calls.some((c) => c.method === "PUT" && c.url === MESSAGES)).toBe(true);
  });

  it("registers CHAT_ROOM_CLASS at the rooms container", async () => {
    const PrivateIndex = "https://alice.pod/settings/privateTypeIndex.ttl";
    const indexBody = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <> a solid:TypeIndex .
      <#reg> a solid:TypeRegistration ; solid:forClass <${CHAT_ROOM_CLASS}> ; solid:instanceContainer <${ROOMS}> .
    `;
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (method === "GET" && url === WEBID) {
        return new Response(
          `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${PrivateIndex}> .`,
          { status: 200, headers: { "content-type": "text/turtle", etag: 'W/"p"' } },
        );
      }
      if (method === "GET" && url === PrivateIndex) {
        return new Response(indexBody, {
          status: 200,
          headers: { "content-type": "text/turtle", etag: 'W/"i"' },
        });
      }
      if (method === "PUT" && url.startsWith(CHAT)) {
        return new Response(null, { status: 201, headers: { etag: 'W/"x"' } });
      }
      return new Response("nf", { status: 404 });
    }) as typeof fetch;

    const { url } = await store(fetchImpl).createRoom({ name: "Team Room" });
    expect(url.startsWith(`${ROOMS}team-room-`)).toBe(true);
    // Idempotent registration → no write back to the index.
    expect(calls.some((c) => c.method === "PUT" && c.url === PrivateIndex)).toBe(false);
  });
});

describe("saveRoom", () => {
  it("writes with If-Match and preserves the original dct:created", async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] =
      [];
    const existing = `
      @prefix pc: <https://w3id.org/jeswr/pod-chat#> .
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a as:Collection, pc:ChatRoom ; as:name "Old" ;
            dct:created "2020-03-03T00:00:00.000Z"^^xsd:dateTime .
    `;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        headers: normaliseHeaders(init?.headers),
        body: init?.body as string,
      });
      if (method === "GET" && url === ROOM) {
        return new Response(existing, {
          status: 200,
          headers: { "content-type": "text/turtle", etag: 'W/"v1"' },
        });
      }
      return new Response(null, { status: 205, headers: { etag: 'W/"v2"' } });
    }) as typeof fetch;

    const { etag } = await store(fetchImpl).saveRoom(
      ROOM,
      { name: "Renamed", participants: [{ webId: BOB, name: "Bob" }], messages: [MSG] },
      'W/"v1"',
    );
    expect(etag).toBe('W/"v2"');
    const put = calls.find((c) => c.method === "PUT" && c.url === ROOM);
    expect(put?.headers["if-match"]).toBe('W/"v1"');
    expect(put?.body).toContain("Renamed");
    expect(put?.body).toContain("pc:participant");
    // The original creation timestamp is carried forward, not rewritten to now.
    expect(put?.body).toContain("2020-03-03T00:00:00.000Z");
  });

  it("honours an explicit created over the existing one (no pre-read needed)", async () => {
    let body = "";
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT") body = init?.body as string;
      return new Response(null, { status: 205, headers: { etag: 'W/"v2"' } });
    }) as typeof fetch;
    await store(fetchImpl).saveRoom(ROOM, {
      name: "R",
      created: new Date("2019-01-01T00:00:00.000Z"),
    });
    expect(body).toContain("2019-01-01T00:00:00.000Z");
  });

  it("tolerates a missing room on save (no created to preserve)", async () => {
    const { fetch } = mockFetch({ [`PUT ${ROOM}`]: { status: 201, etag: 'W/"v2"' } });
    // GET ROOM → 404 (mock default); save still succeeds.
    await expect(store(fetch).saveRoom(ROOM, { name: "Fresh" })).resolves.toEqual({
      etag: 'W/"v2"',
    });
  });

  it("propagates a non-404 pre-read failure on save (does not mask it)", async () => {
    const { fetch } = mockFetch({ [`GET ${ROOM}`]: { status: 500, body: "err" } });
    await expect(store(fetch).saveRoom(ROOM, { name: "R" })).rejects.toMatchObject({ status: 500 });
  });

  it("rejects an out-of-scope room save before any I/O", async () => {
    const { fetch, calls } = mockFetch({});
    await expect(store(fetch).saveRoom("https://evil/x", { name: "t" })).rejects.toBeInstanceOf(
      OutOfScopeError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("removeRoom", () => {
  it("deletes a room in scope", async () => {
    const { fetch, calls } = mockFetch({ [`DELETE ${ROOM}`]: { status: 205 } });
    await expect(store(fetch).removeRoom(ROOM)).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });
  it("rejects an out-of-scope room delete before any I/O", async () => {
    const { fetch, calls } = mockFetch({});
    await expect(store(fetch).removeRoom(ROOMS)).rejects.toBeInstanceOf(OutOfScopeError);
    expect(calls).toHaveLength(0);
  });
});

describe("postMessage", () => {
  it("ensures containers, writes the message create-only with an as:context link, no type-index write", async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] =
      [];
    const msgPut: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const headers = normaliseHeaders(init?.headers);
      const body = init?.body as string;
      calls.push({ url, method, headers, body });
      if (method === "PUT" && url.startsWith(MESSAGES) && url.endsWith(".ttl")) {
        msgPut.push({ url, headers, body });
      }
      return new Response(null, { status: 201, headers: { etag: 'W/"m"' } });
    }) as typeof fetch;

    const { url, etag } = await store(fetchImpl).postMessage(
      { content: "hello", author: WEBID, room: `${ROOM}#it` },
      "hello",
    );
    expect(url.startsWith(`${MESSAGES}hello-`)).toBe(true);
    expect(etag).toBe('W/"m"');
    const put = msgPut.find((c) => c.url === url);
    expect(put?.headers["if-none-match"]).toBe("*");
    expect(put?.body).toContain("as:Note");
    expect(put?.body).toContain("as:context");
    // posting a message does not touch the type index
    expect(calls.every((c) => !c.url.includes("TypeIndex"))).toBe(true);
    // containers were ensured first
    expect(calls.some((c) => c.method === "PUT" && c.url === MESSAGES)).toBe(true);
  });

  it("posts an actionable task message that doubles as a wf:Task", async () => {
    let body = "";
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if ((init?.method ?? "GET") === "PUT" && url.endsWith(".ttl") && url.startsWith(MESSAGES)) {
        body = init?.body as string;
      }
      return new Response(null, { status: 201, headers: { etag: 'W/"m"' } });
    }) as typeof fetch;
    await store(fetchImpl).postMessage({
      content: "please do X",
      task: { state: "open", title: "Do X", assignee: BOB },
    });
    expect(body).toContain("as:Note");
    expect(body).toContain("wf:Task");
    expect(body).toContain("wf:assignee");
  });

  it("mints a purely random message name when no slug hint is given", async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 201, headers: { etag: 'W/"m"' } })) as typeof fetch;
    const { url } = await store(fetchImpl).postMessage({ content: "x" });
    expect(url.startsWith(MESSAGES)).toBe(true);
    expect(url.endsWith(".ttl")).toBe(true);
  });
});

describe("saveMessage", () => {
  it("overwrites with If-Match (e.g. closing a task) and preserves as:published", async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] =
      [];
    const existing = `
      @prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a as:Note, wf:Task, wf:Open ; as:content "do X" ;
            as:published "2021-05-05T08:00:00.000Z"^^xsd:dateTime .
    `;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        headers: normaliseHeaders(init?.headers),
        body: init?.body as string,
      });
      if (method === "GET" && url === MSG) {
        return new Response(existing, {
          status: 200,
          headers: { "content-type": "text/turtle", etag: 'W/"m1"' },
        });
      }
      return new Response(null, { status: 205, headers: { etag: 'W/"m2"' } });
    }) as typeof fetch;

    const { etag } = await store(fetchImpl).saveMessage(
      MSG,
      { content: "done", task: { state: "closed", title: "Do X" } },
      'W/"m1"',
    );
    expect(etag).toBe('W/"m2"');
    const put = calls.find((c) => c.method === "PUT" && c.url === MSG);
    expect(put?.headers["if-match"]).toBe('W/"m1"');
    expect(put?.body).toContain("wf:Closed");
    // The original publication timestamp is carried forward.
    expect(put?.body).toContain("2021-05-05T08:00:00.000Z");
  });

  it("honours an explicit published over the existing one", async () => {
    let body = "";
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PUT") body = init?.body as string;
      return new Response(null, { status: 205, headers: { etag: 'W/"m2"' } });
    }) as typeof fetch;
    await store(fetchImpl).saveMessage(MSG, {
      content: "x",
      published: new Date("2018-08-08T00:00:00.000Z"),
    });
    expect(body).toContain("2018-08-08T00:00:00.000Z");
  });

  it("tolerates a missing message on save (no published to preserve)", async () => {
    const { fetch } = mockFetch({ [`PUT ${MSG}`]: { status: 201, etag: 'W/"m2"' } });
    await expect(store(fetch).saveMessage(MSG, { content: "fresh" })).resolves.toEqual({
      etag: 'W/"m2"',
    });
  });
});

describe("removeMessage", () => {
  it("deletes a message in scope", async () => {
    const { fetch, calls } = mockFetch({ [`DELETE ${MSG}`]: { status: 205 } });
    await expect(store(fetch).removeMessage(MSG)).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });
});

describe("listRooms / listMessages", () => {
  const containerTtl = (container: string) => `
    @prefix ldp: <http://www.w3.org/ns/ldp#> .
    @prefix dct: <http://purl.org/dc/terms/> .
    <${container}> a ldp:Container ; ldp:contains
      <${container}>, <${container}b.ttl>, <${container}a.ttl>, <${container}sub/> .
    <${container}a.ttl> a ldp:Resource ; dct:modified "2026-01-01T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
    <${container}b.ttl> a ldp:Resource .
    <${container}sub/> a ldp:Container .
  `;

  it("lists direct resource children, skipping self-description + sub-containers, sorted", async () => {
    const { fetch } = mockFetch({ [`GET ${ROOMS}`]: { body: containerTtl(ROOMS) } });
    const items = await store(fetch).listRooms();
    expect(items.map((i) => i.url)).toEqual([`${ROOMS}a.ttl`, `${ROOMS}b.ttl`]);
    expect(items[0]?.modified).toBe("2026-01-01T00:00:00.000Z");
    expect(items.every((i) => !i.isContainer)).toBe(true);
  });

  it("lists messages the same way", async () => {
    const { fetch } = mockFetch({ [`GET ${MESSAGES}`]: { body: containerTtl(MESSAGES) } });
    const items = await store(fetch).listMessages();
    expect(items.map((i) => i.url)).toEqual([`${MESSAGES}a.ttl`, `${MESSAGES}b.ttl`]);
  });

  it("returns an empty list for a missing (404) or forbidden (403) container", async () => {
    const { fetch: f404 } = mockFetch({});
    await expect(store(f404).listRooms()).resolves.toEqual([]);
    const { fetch: f403 } = mockFetch({ [`GET ${ROOMS}`]: { status: 403, body: "forbidden" } });
    await expect(store(f403).listRooms()).resolves.toEqual([]);
  });

  it("propagates a non-404/403 container read failure", async () => {
    const { fetch } = mockFetch({ [`GET ${MESSAGES}`]: { status: 500, body: "err" } });
    await expect(store(fetch).listMessages()).rejects.toMatchObject({ status: 500 });
  });

  it("returns an empty list for a container with no contained resources", async () => {
    const empty = `@prefix ldp: <http://www.w3.org/ns/ldp#> . <${ROOMS}> a ldp:Container .`;
    const { fetch } = mockFetch({ [`GET ${ROOMS}`]: { body: empty } });
    await expect(store(fetch).listRooms()).resolves.toEqual([]);
  });
});

describe("ensureContainers", () => {
  it("PUTs the pod-chat, rooms and messages containers shallowest-first", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if ((init?.method ?? "GET") === "PUT") seen.push(url);
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    await store(fetchImpl).ensureContainers();
    expect(seen).toEqual([CHAT, ROOMS, MESSAGES]);
  });
});

describe("ensureRegistered", () => {
  it("registers the rooms container for the ChatRoom class (idempotent helper)", async () => {
    const PrivateIndex = "https://alice.pod/settings/privateTypeIndex.ttl";
    const indexBody = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <> a solid:TypeIndex .
      <#reg> a solid:TypeRegistration ; solid:forClass <${CHAT_ROOM_CLASS}> ; solid:instanceContainer <${ROOMS}> .
    `;
    const { fetch, calls } = mockFetch({
      [`GET ${WEBID}`]: {
        body: `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${PrivateIndex}> .`,
        etag: 'W/"p"',
      },
      [`GET ${PrivateIndex}`]: { body: indexBody, etag: 'W/"i"' },
    });
    await expect(store(fetch).ensureRegistered()).resolves.toBeUndefined();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
