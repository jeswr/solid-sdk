// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, test, vi } from "vitest";
import { createNotifyClient, type NotifyActivity } from "./client.js";

// Public IP literals keep the real guard enabled without depending on DNS or the network.
const webId = "https://8.8.8.8/profile#me";
const inbox = "https://8.8.4.4/inbox/";
const activity: NotifyActivity = {
  type: "Announce",
  actor: "https://alice.example/#me",
  object: "https://pod.example/task#it",
};
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
afterEach(() => vi.unstubAllGlobals());

test.each([
  "Announce",
  "Offer",
  "Accept",
  "Reject",
  "Create",
] as const)("sends %s as JSON-LD through the supplied authenticated transport", async (type) => {
  const fetch = transport();
  const notify = createNotifyClient({ fetch });
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
  expect(new Headers(init?.headers).get("content-type")).toBe("application/ld+json");
  expect(JSON.parse(init?.body as string)).toEqual({
    "@context": "https://www.w3.org/ns/activitystreams",
    ...activity,
    type,
    target: "https://pod.example/tracker#this",
    summary: "Alice assigned you 'Pay \"rent\"'\n💡",
  });
});

test("shares concurrent discovery, caches for exactly ten minutes, and retries every POST", async () => {
  let now = 0;
  const fetch = transport();
  const notify = createNotifyClient({ fetch, clock: () => now });
  await Promise.all([notify(webId, activity), notify(webId, activity)]);
  expect(fetch.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(1);
  now = ttl - 1;
  await notify(webId, activity);
  expect(fetch).toHaveBeenCalledTimes(4);
  now = ttl;
  await notify(webId, activity);
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toEqual({
    "@context": "https://www.w3.org/ns/activitystreams",
    ...activity,
  });
});

test("caches missing inboxes, expires them, and isolates clocks and exact WebID subjects", async () => {
  let now = 0;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => profile(""));
  const notify = createNotifyClient({ fetch, clock: () => now });
  const missing = { delivered: false, inbox: null, reason: "no-inbox" };
  await expect(notify(webId, activity)).resolves.toEqual(missing);
  await expect(notify(webId, activity)).resolves.toEqual(missing);
  expect(fetch).toHaveBeenCalledTimes(1);
  now = ttl;
  await notify(webId, activity);
  await createNotifyClient({ fetch })(webId, activity);
  await notify(webId.replace("#me", "#other"), activity);
  expect(fetch).toHaveBeenCalledTimes(4);
});

test("bounds the cache for sessions that contact many recipients", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => profile(""));
  const notify = createNotifyClient({ fetch, clock: () => 0 });
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
  await expect(createNotifyClient({ fetch })(webId, activity)).resolves.toEqual({
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
  await expect(createNotifyClient({ fetch })(webId, activity)).resolves.toEqual({
    delivered: true,
    inbox: "https://8.8.8.8/inbox/",
  });
});

test.each([
  401, 403, 404, 429, 500, 503,
])("returns a failure for a profile HTTP %i and retries discovery", async (status) => {
  const fetch = transport().mockResolvedValueOnce(new Response(null, { status }));
  const notify = createNotifyClient({ fetch });
  await expect(notify(webId, activity)).resolves.toEqual({
    delivered: false,
    inbox: null,
    reason: status === 401 || status === 403 ? "forbidden" : "network",
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
  const notify = createNotifyClient({ fetch });
  await expect(notify(webId, activity)).resolves.toEqual({
    delivered: false,
    inbox,
    reason: status === 401 || status === 403 ? "forbidden" : "network",
  });
  await expect(notify(webId, activity)).resolves.toEqual({ delivered: true, inbox });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("returns network for thrown discovery/delivery failures and malformed RDF", async () => {
  for (const response of [
    () => Promise.reject(new TypeError("offline")),
    async () => profile("not valid Turtle"),
  ]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(response);
    await expect(createNotifyClient({ fetch })(webId, activity)).resolves.toEqual({
      delivered: false,
      inbox: null,
      reason: "network",
    });
  }
  const fetch = transport()
    .mockResolvedValueOnce(profile())
    .mockRejectedValueOnce(new TypeError("offline"));
  await expect(createNotifyClient({ fetch })(webId, activity)).resolves.toEqual({
    delivered: false,
    inbox,
    reason: "network",
  });
});

test("short-circuits known LWS recipients and handles LWS profile responses", async () => {
  const fetch = transport();
  await expect(
    createNotifyClient({ fetch, recipientProtocol: () => "lws" })(webId, activity),
  ).resolves.toEqual({ delivered: false, inbox: null, reason: "lws-no-ldn" });
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockResolvedValueOnce(
    new Response('{"type":"Container"}', {
      headers: { "content-type": "Application/Lws+Json; charset=utf-8" },
    }),
  );
  await expect(createNotifyClient({ fetch })(webId, activity)).resolves.toEqual({
    delivered: false,
    inbox: null,
    reason: "lws-no-ldn",
  });
  await expect(
    createNotifyClient({ fetch, clock: () => 0, recipientProtocol: async () => "solid" as const })(
      webId,
      activity,
    ),
  ).resolves.toEqual({ delivered: true, inbox });
});

test("does not throw when recipient protocol discovery rejects", async () => {
  const fetch = transport();
  await expect(
    createNotifyClient({
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
  await expect(createNotifyClient({ fetch })(recipient, activity)).resolves.toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
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
  const result = await createNotifyClient({ fetch })(webId, activity);
  expect(result.delivered).toBe(false);
  expect(result.reason).toBe("network");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  301, 302, 303, 307, 308,
])("refuses HTTP %i on profiles and inboxes without forwarding credentials or POST body", async (status) => {
  const redirect = () =>
    new Response(null, { status, headers: { location: "https://169.254.169.254/metadata" } });
  const fetch = transport().mockResolvedValueOnce(redirect());
  expect(await createNotifyClient({ fetch })(webId, activity)).toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockClear().mockResolvedValueOnce(profile()).mockResolvedValueOnce(redirect());
  expect(await createNotifyClient({ fetch })(webId, activity)).toEqual({
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
  expect(await createNotifyClient({ fetch })(webId, activity)).toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  { ...activity, type: "Invite" },
  { ...activity, actor: "bad" },
  { ...activity, object: "bad" },
  { ...activity, target: "bad" },
])("refuses malformed activity before transport: %j", async (invalid) => {
  const fetch = transport();
  expect(await createNotifyClient({ fetch })(webId, invalid as NotifyActivity)).toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("does not silently use the unpinned fallback when a pinned auth transport is supplied", async () => {
  const fetch = transport();
  const pinningFetch = transport();
  expect(await createNotifyClient({ fetch, pinningFetch })(webId, activity)).toEqual({
    delivered: true,
    inbox,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(pinningFetch).toHaveBeenCalledTimes(2);
});
