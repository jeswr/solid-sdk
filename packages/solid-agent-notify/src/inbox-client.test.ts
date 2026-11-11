// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { createInboxReader, createNotifyClient } from "./client.js";

const webId = "https://8.8.8.8/profile#me";
const inbox = "https://8.8.4.4/inbox/";
const as = "@prefix as: <https://www.w3.org/ns/activitystreams#>.";
function turtle(body: string) {
  return new Response(body, { headers: { "content-type": "text/turtle" } });
}
function listing(members: string[]) {
  return turtle(
    `<${inbox}> <http://www.w3.org/ns/ldp#contains> ${members.map((url) => `<${url}>`).join(", ")}.`,
  );
}
function note(summary = "hello") {
  return turtle(`${as} <#it> a as:Announce; as:summary "${summary}".`);
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("lists through the authenticated transport, parses members, and preserves newest-first ordering", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => {
    if (url === inbox) return listing([`${inbox}z`, `${inbox}b`, `${inbox}a`, `${inbox}old`]);
    if (url === `${inbox}old`)
      return turtle(
        `${as} <#it> a as:Offer; as:published "2025-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>.`,
      );
    if (url === `${inbox}z`)
      return turtle(
        `${as} <#it> a as:Create; as:actor <${webId}>; as:object <https://pod.example/doc>; as:target <https://pod.example/>; as:summary "new"; as:content "body"; as:published "2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>.`,
      );
    return note();
  });
  const items = await createInboxReader({ fetch }).list(inbox);
  expect(items.map((n) => n.url)).toEqual([`${inbox}z`, `${inbox}old`, `${inbox}a`, `${inbox}b`]);
  expect(items[0]).toEqual({
    url: `${inbox}z`,
    type: "Create",
    actor: webId,
    object: "https://pod.example/doc",
    target: "https://pod.example/",
    summary: "new",
    content: "body",
    published: "2026-01-01T00:00:00.000Z",
  });
  expect(fetch).toHaveBeenCalledTimes(5);
  for (const [, init] of fetch.mock.calls) {
    expect(init?.redirect).toBe("manual");
    expect(init?.method ?? "GET").toBe("GET");
    expect(new Headers(init?.headers).get("accept")).toContain("text/turtle");
  }
});

test("never dereferences foreign origins, parents, subcontainers, encoded slashes, queries or fragments", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      listing([
        `${inbox}ok`,
        "https://1.1.1.1/inbox/evil",
        "https://8.8.4.4/outside",
        `${inbox}../secret`,
        `${inbox}%2e%2e/secret`,
        `${inbox}sub/evil`,
        `${inbox}a%2Fb`,
        `${inbox}a?x=1`,
        `${inbox}a#it`,
        inbox,
      ]),
    )
    .mockImplementation(async () => note());
  expect(await createInboxReader({ fetch }).list(inbox)).toHaveLength(1);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([inbox, `${inbox}ok`]);
});

test.each([undefined, 2, 0])("caps member work at maxItems=%s (default 50)", async (maxItems) => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(listing(Array.from({ length: 60 }, (_, i) => `${inbox}${i}`)))
    .mockImplementation(async () => note());
  const items = await createInboxReader({ fetch, maxItems }).list(inbox);
  expect(items).toHaveLength(maxItems ?? 50);
  expect(fetch).toHaveBeenCalledTimes((maxItems ?? 50) + 1);
});

test.each([
  -1,
  1.2,
  Number.NaN,
  Number.POSITIVE_INFINITY,
])("rejects invalid maxItems=%s", (maxItems) => {
  expect(() => createInboxReader({ fetch: vi.fn(), maxItems })).toThrow(TypeError);
});

test("bounds active member GETs at six", async () => {
  let active = 0;
  let peak = 0;
  const batch = deferred<void>();
  const started = deferred<void>();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(listing(Array.from({ length: 20 }, (_, i) => `${inbox}${i}`)))
    .mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      if (active === 6) started.resolve();
      await batch.promise;
      active--;
      return note();
    });
  const pending = createInboxReader({ fetch }).list(inbox);
  await started.promise;
  expect(fetch).toHaveBeenCalledTimes(7);
  batch.resolve();
  expect(await pending).toHaveLength(20);
  expect(peak).toBe(6);
});

test.each([401, 403, 404])("returns an empty listing for container HTTP %s", async (status) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status }));
  expect(await createInboxReader({ fetch }).list(inbox)).toEqual([]);
  expect(fetch).toHaveBeenCalledOnce();
});

test.each([
  "garbage {",
  "",
  '<> <http://purl.org/dc/terms/title> "Inbox".',
])("returns [] for an unreadable or empty container: %s", async (body) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(turtle(body));
  expect(await createInboxReader({ fetch }).list(inbox)).toEqual([]);
});

test("skips unreadable, malformed and non-activity members", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      listing([
        `${inbox}ok`,
        `${inbox}gone`,
        `${inbox}garbage`,
        `${inbox}not-activity`,
        `${inbox}offline`,
      ]),
    )
    .mockResolvedValueOnce(note())
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(turtle("not { Turtle"))
    .mockResolvedValueOnce(turtle('<> <http://purl.org/dc/terms/title> "No activity".'))
    .mockRejectedValueOnce(new Error("offline"));
  expect(await createInboxReader({ fetch }).list(inbox)).toEqual([
    { url: `${inbox}ok`, type: "Announce", summary: "hello" },
  ]);
});

test.each([
  "http://8.8.4.4/inbox/",
  "http://localhost/inbox/",
  `${inbox}#fragment`,
  "https://user:pass@8.8.4.4/inbox/",
  "bad",
])("refuses unsafe inbox URL %s before transport", async (url) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(createInboxReader({ fetch }).list(url)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test("rejects pre-aborted reads with AbortError, including a custom abort reason", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(
    createInboxReader({ fetch }).list(inbox, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "container",
  "members",
])("aborts during %s, starts no further requests, and ignores late responses", async (phase) => {
  const controller = new AbortController();
  const started = deferred<void>();
  const response = deferred<Response>();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
    started.resolve();
    return response.promise;
  });
  if (phase === "members")
    fetch.mockResolvedValueOnce(listing(Array.from({ length: 12 }, (_, i) => `${inbox}${i}`)));
  const pending = createInboxReader({ fetch }).list(inbox, { signal: controller.signal });
  await started.promise;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const calls = fetch.mock.calls.length;
  response.resolve(note());
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(calls).toBeLessThanOrEqual(phase === "container" ? 1 : 7);
});

test("shares profile discovery with the notifier for ten minutes, including concurrent calls", async () => {
  let now = 0;
  const clock = () => now;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? new Response(null, { status: 201 })
        : turtle(`<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`),
    );
  const reader = createInboxReader({ fetch, clock });
  const notify = createNotifyClient({ fetch, clock });
  await Promise.all([
    reader.inbox(webId),
    notify(webId, { type: "Offer", actor: webId, object: inbox }),
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  now = 599_999;
  expect(await reader.inbox(webId)).toBe(inbox);
  expect(fetch).toHaveBeenCalledTimes(2);
  now++;
  expect(await reader.inbox(webId)).toBe(inbox);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("shares default-clock discovery and isolates different transports and pinning assertions", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () =>
      turtle(`<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`),
    );
  await createInboxReader({ fetch }).inbox(webId);
  await createInboxReader({ fetch }).inbox(webId);
  expect(fetch).toHaveBeenCalledOnce();
  await createInboxReader({ fetch, pinningFetch: fetch }).inbox(webId);
  expect(fetch).toHaveBeenCalledTimes(2);
  const other = vi.fn<typeof globalThis.fetch>().mockImplementation(fetch);
  await createInboxReader({ fetch: other }).inbox(webId);
  expect(other).toHaveBeenCalledOnce();
});

test("returns null for LWS or missing profiles and retries transient discovery failures", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => turtle(""))
    .mockResolvedValueOnce(
      new Response("{}", { headers: { "content-type": "application/lws+json" } }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  const reader = createInboxReader({ fetch });
  expect(await reader.inbox(webId)).toBeNull();
  expect(await reader.inbox(`${webId}2`)).toBeNull();
  expect(await reader.inbox(`${webId}2`)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(3);
});

test.each([500, 503])("propagates other container HTTP failures (%s)", async (status) => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      new Response("failed", { status, headers: { "content-type": "text/turtle" } }),
    );
  await expect(createInboxReader({ fetch }).list(inbox)).rejects.toMatchObject({ status });
});

test.each([
  new TypeError("offline"),
  new DOMException("aborted", "AbortError"),
])("propagates container transport failures: %s", async (error) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(error);
  await expect(createInboxReader({ fetch }).list(inbox)).rejects.toThrow();
});

test.each([
  inbox,
  `${inbox}n`,
])("refuses redirects at %s without following the Location", async (target) => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url) =>
      url === target
        ? new Response(null, { status: 302, headers: { location: "https://1.1.1.1/secret" } })
        : listing([`${inbox}n`]),
    );
  const pending = createInboxReader({ fetch }).list(inbox);
  if (target === inbox) await expect(pending).rejects.toThrow();
  else expect(await pending).toEqual([]);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(
    target === inbox ? [inbox] : [inbox, `${inbox}n`],
  );
});

test("rejects oversized containers and skips oversized members", async () => {
  const oversized = () => turtle("x".repeat(256 * 1024 + 1));
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => oversized());
  const reader = createInboxReader({ fetch });
  await expect(reader.list(inbox)).rejects.toThrow();
  fetch.mockResolvedValueOnce(listing([`${inbox}n`]));
  expect(await reader.list(inbox)).toEqual([]);
});

test("coalesces transient discovery failures and safely retries after all observers settle", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockImplementation(async () =>
      turtle(`<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`),
    );
  const reader = createInboxReader({ fetch });
  expect(await Promise.all([reader.inbox(webId), reader.inbox(webId)])).toEqual([null, null]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(await reader.inbox(webId)).toBe(inbox);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("exposes complete eligible member counts and truncation even when fetched members are unreadable", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url) =>
      url === inbox
        ? listing([`${inbox}bad`, `${inbox}later`, "https://1.1.1.1/outside"])
        : new Response(null, { status: 403 }),
    );
  const page = await createInboxReader({ fetch, maxItems: 1 }).listPage(inbox);
  expect(page).toEqual({
    members: [`${inbox}bad`, `${inbox}later`],
    notifications: [],
    truncated: true,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("list remains safe to pass as a detached callback", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(turtle(""));
  const { list } = createInboxReader({ fetch });
  expect(await list(inbox)).toEqual([]);
});
