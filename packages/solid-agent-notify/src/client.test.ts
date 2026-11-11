// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { afterEach, expect, test, vi } from "vitest";
import { createNotifyClient, type NotifyActivity } from "./client.js";
import { parseInboxNotification } from "./inbox.js";

// Public IP literals keep the real guard enabled without depending on DNS or the network.
const webId = "https://8.8.8.8/profile#me";
const inbox = "https://8.8.4.4/inbox/";
const activity: NotifyActivity = {
  type: "Announce",
  actor: "https://alice.example/#me",
  object: "https://pod.example/task#it",
};
async function sent(body: RequestInit["body"]) {
  return parseInboxNotification(
    `${inbox}n`,
    await parseRdf(String(body), "text/turtle", { baseIRI: `${inbox}n` }),
  );
}
const ttl = 600_000;
function profile(body = `<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`) {
  return new Response(body, { headers: { "content-type": "text/turtle" } });
}
function transport() {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(async (_input, init) =>
      init?.method === "POST" ? new Response(null, { status: 201 }) : profile(),
    );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test.each([
  "Announce",
  "Offer",
  "Accept",
  "Reject",
  "Create",
] as const)("sends %s as Turtle through the supplied authenticated transport", async (type) => {
  const fetch = transport();
  // Without an injected clock, as:published is the send time from Date.now.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
  const notify = createNotifyClient({ webId: activity.actor, fetch });
  await expect(
    notify(webId, {
      ...activity,
      type,
      target: "https://pod.example/tracker#this",
      summary: "Alice assigned you 'Pay \"rent\"'\n💡",
    }),
  ).resolves.toEqual({ delivered: true, inbox });
  expect(fetch.mock.calls[0]?.[0]).toBe("https://8.8.8.8/profile");
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("accept")).toBe(
    "text/turtle, application/ld+json;q=0.9",
  );
  const init = fetch.mock.calls[1]?.[1];
  expect(init?.method).toBe("POST");
  expect(init?.redirect).toBe("manual");
  expect(new Headers(init?.headers).get("content-type")).toBe("text/turtle");
  expect(await sent(init?.body)).toEqual({
    url: `${inbox}n`,
    ...activity,
    type,
    target: "https://pod.example/tracker#this",
    summary: "Alice assigned you 'Pay \"rent\"'\n💡",
    published: "2026-11-11T12:00:00.000Z",
  });
});

test("shares concurrent discovery, caches for exactly ten minutes, and retries every POST", async () => {
  let now = 0;
  const fetch = transport();
  const notify = createNotifyClient({ webId: activity.actor, fetch, clock: () => now });
  await Promise.all([notify(webId, activity), notify(webId, activity)]);
  expect(fetch.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(1);
  now = ttl - 1;
  await notify(webId, activity);
  expect(fetch).toHaveBeenCalledTimes(4);
  now = ttl;
  await notify(webId, activity);
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(await sent(fetch.mock.calls[1]?.[1]?.body)).toEqual({
    url: `${inbox}n`,
    ...activity,
    published: "1970-01-01T00:00:00.000Z",
  });
  // Each POST is stamped at its own send time by the injected clock.
  expect((await sent(fetch.mock.calls[5]?.[1]?.body))?.published).toBe(new Date(ttl).toISOString());
});

test("caches missing inboxes, expires them, and isolates clocks and exact WebID subjects", async () => {
  let now = 0;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => profile(""));
  const notify = createNotifyClient({ webId: activity.actor, fetch, clock: () => now });
  const missing = { delivered: false, inbox: null, reason: "no-inbox" };
  await expect(notify(webId, activity)).resolves.toEqual(missing);
  await expect(notify(webId, activity)).resolves.toEqual(missing);
  expect(fetch).toHaveBeenCalledTimes(1);
  now = ttl;
  await notify(webId, activity);
  await createNotifyClient({ webId: activity.actor, fetch })(webId, activity);
  await notify(webId.replace("#me", "#other"), activity);
  expect(fetch).toHaveBeenCalledTimes(4);
});

test("bounds the cache for sessions that contact many recipients", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => profile(""));
  const notify = createNotifyClient({ webId: activity.actor, fetch, clock: () => 0 });
  for (let i = 0; i <= 256; i++) await notify(`${webId}${i}`, activity);
  await notify(`${webId}0`, activity);
  expect(fetch).toHaveBeenCalledTimes(258);
});

test.each([
  "",
  `<https://other.example/#me> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`,
  `<${webId}> <http://www.w3.org/ns/ldp#inbox> "${inbox}".`,
  `<${webId}> <http://www.w3.org/ns/ldp#inbox> [].`,
  `<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>, <https://8.8.4.4/other/>.`,
  `<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}#fragment>.`,
])("refuses missing, foreign or ambiguous inbox assertions without a POST: %s", async (body) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(profile(body));
  await expect(
    createNotifyClient({ webId: activity.actor, fetch })(webId, activity),
  ).resolves.toEqual({
    delivered: false,
    inbox: null,
    reason: "no-inbox",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("resolves relative inbox IRIs through the RDF base", async () => {
  const fetch = transport().mockResolvedValueOnce(
    profile(`<${webId}> <http://www.w3.org/ns/ldp#inbox> </inbox/>.`),
  );
  await expect(
    createNotifyClient({ webId: activity.actor, fetch })(webId, activity),
  ).resolves.toEqual({
    delivered: true,
    inbox: "https://8.8.8.8/inbox/",
  });
});

test.each([
  401, 403, 404, 429, 500, 503,
])("returns a failure for a profile HTTP %i and retries discovery", async (status) => {
  const fetch = transport().mockResolvedValueOnce(new Response(null, { status }));
  const notify = createNotifyClient({ webId: activity.actor, fetch });
  await expect(notify(webId, activity)).resolves.toEqual({
    delivered: false,
    inbox: null,
    reason: "profile-unreadable",
    status,
  });
  await expect(notify(webId, activity)).resolves.toEqual({ delivered: true, inbox });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test.each([
  401, 403, 404, 429, 500, 503,
])("returns a failure for an inbox HTTP %i and keeps discovery cached", async (status) => {
  const fetch = transport()
    .mockResolvedValueOnce(profile())
    .mockResolvedValueOnce(new Response(null, { status }));
  const notify = createNotifyClient({ webId: activity.actor, fetch });
  await expect(notify(webId, activity)).resolves.toEqual({
    delivered: false,
    inbox,
    reason: status === 401 || status === 403 ? "forbidden" : "network",
    status,
  });
  await expect(notify(webId, activity)).resolves.toEqual({ delivered: true, inbox });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("returns network for thrown discovery/delivery failures and malformed RDF", async () => {
  for (const [reason, response] of [
    ["network", () => Promise.reject(new TypeError("offline"))],
    ["profile-unreadable", async () => profile("not valid Turtle")],
  ] as const) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(response);
    await expect(
      createNotifyClient({ webId: activity.actor, fetch })(webId, activity),
    ).resolves.toEqual({
      delivered: false,
      inbox: null,
      reason,
    });
  }
  const fetch = transport()
    .mockResolvedValueOnce(profile())
    .mockRejectedValueOnce(new TypeError("offline"));
  await expect(
    createNotifyClient({ webId: activity.actor, fetch })(webId, activity),
  ).resolves.toEqual({
    delivered: false,
    inbox,
    reason: "network",
  });
});

test("short-circuits known LWS recipients and handles LWS profile responses", async () => {
  const fetch = transport();
  await expect(
    createNotifyClient({ webId: activity.actor, fetch, recipientProtocol: () => "lws" })(
      webId,
      activity,
    ),
  ).resolves.toEqual({ delivered: false, inbox: null, reason: "lws-no-ldn" });
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockResolvedValueOnce(
    new Response('{"type":"Container"}', {
      headers: { "content-type": "Application/Lws+Json; charset=utf-8" },
    }),
  );
  await expect(
    createNotifyClient({ webId: activity.actor, fetch })(webId, activity),
  ).resolves.toEqual({
    delivered: false,
    inbox: null,
    reason: "lws-no-ldn",
  });
  await expect(
    createNotifyClient({
      webId: activity.actor,
      fetch,
      clock: () => 0,
      recipientProtocol: async () => "solid" as const,
    })(webId, activity),
  ).resolves.toEqual({ delivered: true, inbox });
});

test("does not throw when recipient protocol discovery rejects", async () => {
  const fetch = transport();
  await expect(
    createNotifyClient({
      webId: activity.actor,
      fetch,
      recipientProtocol: async () => {
        throw new Error("discovery failed");
      },
    })(webId, activity),
  ).resolves.toEqual({ delivered: false, inbox: null, reason: "network" });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "not a URL",
  "http://8.8.8.8/profile#me",
  "https://user:pass@8.8.8.8/profile#me",
  " https://8.8.8.8/profile#me",
  "https://127.0.0.1/profile#me",
  "https://169.254.169.254/profile",
  "https://metadata.google.internal/profile",
  "https://8.8.8.8:8443/profile",
  "https://unresolved.example/profile",
])("refuses unsafe recipient %s before transport", async (recipient) => {
  const fetch = transport();
  await expect(
    createNotifyClient({ webId: activity.actor, fetch })(recipient, activity),
  ).resolves.toEqual({
    delivered: false,
    inbox: null,
    reason: "invalid-target",
  });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "http://8.8.4.4/inbox/",
  "https://user:pass@8.8.4.4/inbox/",
  "https://127.0.0.1/inbox/",
  "https://169.254.169.254/inbox/",
  "https://8.8.4.4:8443/inbox/",
  "https://metadata.google.internal/inbox/",
])("refuses unsafe discovered inbox %s", async (target) => {
  const fetch = transport().mockResolvedValueOnce(
    profile(`<${webId}> <http://www.w3.org/ns/ldp#inbox> <${target}>.`),
  );
  const result = await createNotifyClient({ webId: activity.actor, fetch })(webId, activity);
  expect(result.delivered).toBe(false);
  expect(result.reason).toBe("invalid-target");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  301, 302, 303, 307, 308,
])("refuses HTTP %i on profiles and inboxes without forwarding credentials or POST body", async (status) => {
  const redirect = () =>
    new Response(null, { status, headers: { location: "https://169.254.169.254/metadata" } });
  const fetch = transport().mockResolvedValueOnce(redirect());
  expect(await createNotifyClient({ webId: activity.actor, fetch })(webId, activity)).toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockClear().mockResolvedValueOnce(profile()).mockResolvedValueOnce(redirect());
  expect(await createNotifyClient({ webId: activity.actor, fetch })(webId, activity)).toEqual({
    delivered: false,
    inbox,
    reason: "network",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("refuses oversized profile responses", async () => {
  const fetch = transport().mockResolvedValueOnce(
    new Response("x".repeat(256 * 1024 + 1), { headers: { "content-type": "text/turtle" } }),
  );
  expect(await createNotifyClient({ webId: activity.actor, fetch })(webId, activity)).toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  { ...activity, type: "Unknown" },
])("refuses malformed activity before transport: %j", async (invalid) => {
  const fetch = transport();
  expect(
    await createNotifyClient({ webId: activity.actor, fetch })(webId, invalid as NotifyActivity),
  ).toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("does not silently use the unpinned fallback when a pinned auth transport is supplied", async () => {
  const fetch = transport();
  const pinningFetch = transport();
  expect(
    await createNotifyClient({ webId: activity.actor, fetch, pinningFetch })(webId, activity),
  ).toEqual({
    delivered: true,
    inbox,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(pinningFetch).toHaveBeenCalledTimes(2);
});

test.each([
  "Invite",
  "Update",
] as const)("preserves %s and content for existing collaboration callers", async (type) => {
  const fetch = transport();
  expect(
    await createNotifyClient({ webId: activity.actor, fetch })(webId, {
      type,
      actor: activity.actor,
      content: "https://pod.example/rsvp",
    }),
  ).toEqual({ delivered: true, inbox });
  const body = await sent(fetch.mock.calls[1]?.[1]?.body);
  expect(body).toMatchObject({ type, actor: activity.actor, content: "https://pod.example/rsvp" });
  expect(body).not.toHaveProperty("object");
});

test("binds actor to the authenticated WebID before discovery and snapshots caller data", async () => {
  const fetch = transport();
  const notify = createNotifyClient({ fetch, webId: activity.actor });
  expect(await notify(webId, { ...activity, actor: "https://mallory.example/#me" })).toEqual({
    delivered: false,
    inbox: null,
    reason: "invalid-actor",
  });
  expect(fetch).not.toHaveBeenCalled();
  const mutable = { ...activity, summary: "original", provenance: true };
  const pending = notify(webId, mutable);
  mutable.summary = "changed";
  expect(await pending).toEqual({ delivered: true, inbox });
  const parsed = await sent(fetch.mock.calls[1]?.[1]?.body);
  expect(parsed?.summary).toBe("original");
  const ds = await parseRdf(String(fetch.mock.calls[1]?.[1]?.body), "text/turtle");
  expect(
    [...ds].find((q) => q.predicate.value === "http://www.w3.org/ns/prov#wasAttributedTo")?.object
      .value,
  ).toBe(activity.actor);
  expect(
    [...ds].some((q) => q.predicate.value === "http://www.w3.org/ns/prov#generatedAtTime"),
  ).toBe(true);
});

test("omits non-HTTPS optional object and target links without failing delivery", async () => {
  const fetch = transport();
  await createNotifyClient({ fetch, webId: activity.actor })(webId, {
    ...activity,
    object: "http://pod.example/object",
    target: "javascript:alert(1)",
    content: "body",
  });
  expect(await sent(fetch.mock.calls[1]?.[1]?.body)).toMatchObject({
    actor: activity.actor,
    content: "body",
  });
  expect(await sent(fetch.mock.calls[1]?.[1]?.body)).not.toHaveProperty("object");
  expect(await sent(fetch.mock.calls[1]?.[1]?.body)).not.toHaveProperty("target");
});

test("discovery policy caches cannot promote development or DNS-less results to strict sessions", async () => {
  const localId = "http://localhost:3000/profile#me";
  const localInbox = "http://localhost:3000/inbox/";
  const { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } = await import("@rdfjs/wrapper");
  const { DataFactory, Store } = await import("n3");
  const { serialize } = await import("@jeswr/rdf-serialize");
  const dataset = new Store();
  const doc = new TermWrapper(localId, dataset, DataFactory);
  SetFrom.subjectPredicate(
    doc,
    "http://www.w3.org/ns/ldp#inbox",
    NamedNodeAs.string,
    NamedNodeFrom.string,
  ).add(localInbox);
  const body = await serialize([...dataset]);
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (_url, init) =>
      init?.method === "POST" ? new Response(null, { status: 201 }) : profile(body),
    );
  const notify = createNotifyClient({ fetch, webId: localId, devLoopback: true, dnsLookup: null });
  expect(await notify(localId, { ...activity, actor: localId })).toEqual({
    delivered: true,
    inbox: localInbox,
  });
  expect(await createNotifyClient({ fetch, webId: activity.actor })(localId, activity)).toEqual({
    delivered: false,
    inbox: null,
    reason: "invalid-target",
  });
  expect(
    await createNotifyClient({ fetch, webId: localId })(localId, { ...activity, actor: localId }),
  ).toEqual({ delivered: false, inbox: null, reason: "network" });
});

test.each([
  201, 415, 403,
])("415 retries once with the exact dataset as JSON-LD (retry status %s)", async (status) => {
  const fetch = transport();
  let posts = 0;
  fetch.mockImplementation(async (_url, init) => {
    if (init?.method !== "POST") return profile();
    return new Response("receiver response", { status: ++posts === 1 ? 415 : status });
  });
  const clock = vi.fn(() => 42);
  const notify = createNotifyClient({ fetch, webId: activity.actor, clock });
  const result = await notify(webId, {
    ...activity,
    summary: 'Quoted "text"',
    content: "💡",
    provenance: true,
  });
  expect(result).toEqual(
    status === 201
      ? { delivered: true, inbox }
      : { delivered: false, inbox, status, reason: status === 403 ? "forbidden" : "network" },
  );
  expect(posts).toBe(2);
  const turtle = fetch.mock.calls[1][1];
  const jsonld = fetch.mock.calls[2][1];
  expect(new Headers(jsonld?.headers).get("content-type")).toBe("application/ld+json");
  const first = await parseRdf(String(turtle?.body), "text/turtle", { baseIRI: `${inbox}n` });
  const second = await parseRdf(String(jsonld?.body), "application/ld+json", {
    baseIRI: `${inbox}n`,
  });
  const values = (ds: typeof first) =>
    [...ds]
      .map((q) => [
        q.predicate.value,
        q.object.termType,
        q.object.value,
        q.object.termType === "Literal" ? [q.object.datatype.value, q.object.language] : [],
        q.graph.value,
      ])
      .sort();
  expect(values(second)).toEqual(values(first));
  expect([...second].every((q) => q.subject.termType === "BlankNode")).toBe(true);
});
