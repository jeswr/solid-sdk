// AUTHORED-BY Codex GPT-6.1-Sol
import type { Term } from "@rdfjs/types";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  fixtureFetch,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { ConnectorState, FixtureRoute } from "../core/types.js";
import { googleContactsAdapter } from "./adapter.js";
import { CONNECTIONS, PEOPLE, PEOPLE_API } from "./fixtures.js";
import { personSlug } from "./mapping.js";
import { Contact, VCARD } from "./vocab-map.js";

const ROOT = `${TEST_POD_ROOT}integrations/google-contacts/`;
const INDEX = `${ROOT}contacts/people.ttl`;
const route = (json: unknown, status = 200): FixtureRoute => ({ url: PEOPLE_API, json, status });
const expired = {
  error: {
    details: [
      { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "EXPIRED_SYNC_TOKEN" },
    ],
  },
};

class Listing extends TermWrapper {
  get children() {
    return SetFrom.subjectPredicate(
      this,
      "http://www.w3.org/ns/ldp#contains",
      TermAs.term,
      TermFrom.itself,
    );
  }
}

async function listing(url: string, children: Term[]): Promise<string> {
  const dataset = new Store();
  const container = new Listing(url, dataset, DataFactory);
  for (const child of children) container.children.add(child);
  const writer = new Writer();
  writer.addQuads([...dataset]);
  return new Promise((resolve, reject) =>
    writer.end((error, value) => (error ? reject(error) : resolve(value))),
  );
}

function setup() {
  const pod = createMemoryPod();
  const podFetch = vi.fn(pod.fetch);
  const podWriter = createFetchPodWriter({
    adapterId: "google-contacts",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: podFetch,
  });
  function run(routes: FixtureRoute[], state?: ConnectorState) {
    const api = vi.fn(fixtureFetch("google-contacts", routes));
    return {
      api,
      result: runImport({
        adapter: googleContactsAdapter,
        mode: "live",
        sourceAuth: { fetch: api },
        podWriter,
        state,
      }),
    };
  }
  const fn = (id: string, index = false) =>
    new Contact(
      `${ROOT}${personSlug(id)}#this`,
      pod.dataset(index ? INDEX : `${ROOT}${personSlug(id)}`),
      DataFactory,
    ).fn;
  return { pod, podFetch, podWriter, run, fn };
}

describe("Google Contacts synchronization", () => {
  it("paginates full and incremental syncs with unchanged parameters and final-page cursors", async () => {
    const { run, fn, podFetch } = setup();
    const first = run([
      route({ connections: [PEOPLE[0]], nextPageToken: "page+/=" }),
      route({ connections: [PEOPLE[1]], nextSyncToken: "sync+/=" }),
    ]);
    const initial = await first.result;
    expect(initial.cursor).toBe("sync+/=");
    expect(first.api).toHaveBeenCalledTimes(2);
    expect(new URL(String(first.api.mock.calls[1]?.[0])).searchParams.get("pageToken")).toBe(
      "page+/=",
    );
    const before = podFetch.mock.calls.length;
    const next = run(
      [
        route({
          connections: [{ ...PEOPLE[0], names: [{ displayName: "Alex Updated" }] }],
          nextPageToken: "delta",
        }),
        route({
          connections: [
            { resourceName: "people/c103", names: [{ givenName: "Kim", familyName: "Example" }] },
          ],
          nextSyncToken: "second",
        }),
      ],
      initial.state,
    );
    expect((await next.result).cursor).toBe("second");
    for (const request of [first, next])
      for (const [url] of request.api.mock.calls) {
        const parsed = new URL(String(url));
        expect(parsed.origin + parsed.pathname).toBe(PEOPLE_API);
        expect(parsed.searchParams.get("personFields")).toBe(
          "names,emailAddresses,phoneNumbers,addresses,organizations,birthdays,metadata",
        );
        expect(parsed.searchParams.get("pageSize")).toBe("1000");
        expect(parsed.searchParams.get("requestSyncToken")).toBe("true");
        expect(parsed.searchParams.get("syncToken")).toBe(request === first ? null : "sync+/=");
      }
    expect(fn("c101")).toBe("Alex Updated");
    expect(fn("c102")).toBe("Sam Example");
    expect(fn("c103", true)).toBe("Kim Example");
    const puts = podFetch.mock.calls
      .slice(before)
      .filter(([url, init]) => String(url) === INDEX && init?.method === "PUT");
    expect(puts).toHaveLength(1);
  });

  it("removes incremental deletions and all linked fields while preserving unchanged people", async () => {
    const { run, pod, fn, podFetch } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    const next = await run(
      [
        route({
          connections: [
            { resourceName: "people/c101", metadata: { deleted: true } },
            { resourceName: "people/missing", metadata: { deleted: true } },
          ],
          nextSyncToken: "deleted",
        }),
      ],
      initial.state,
    ).result;
    expect(next.cursor).toBe("deleted");
    expect(pod.get(`${ROOT}${personSlug("c101")}`)).toBeUndefined();
    expect(fn("c101", true)).toBeUndefined();
    expect(fn("c102", true)).toBe("Sam Example");
    const deletion = podFetch.mock.calls.find(
      ([url, init]) => String(url) === `${ROOT}${personSlug("c101")}` && init?.method === "DELETE",
    );
    expect(new Headers(deletion?.[1]?.headers).get("if-match")).toMatch(/^"/);
    await run([route({ nextSyncToken: "empty-increment" })], next.state).result;
    expect(fn("c102", true)).toBe("Sam Example");
  });

  it.each([
    false,
    true,
  ])("recovers unindexed person writes on the next full resync (expired token: %s)", async (hasCheckpoint) => {
    const { run, pod, podFetch, podWriter, fn } = setup();
    const initial = hasCheckpoint ? await run([route(CONNECTIONS)]).result : undefined;
    const orphan = `${ROOT}${personSlug("orphan")}`;
    const onState = vi.fn();
    podFetch.mockImplementation(async (input, init) =>
      String(input) === INDEX && init?.method === "PUT"
        ? new Response(null, { status: 503 })
        : pod.fetch(input, init),
    );
    await expect(
      runImport({
        adapter: googleContactsAdapter,
        mode: "live",
        podWriter,
        state: initial?.state,
        onState,
        sourceAuth: {
          fetch: fixtureFetch("google-contacts", [
            route({
              connections: [{ resourceName: "people/orphan" }],
              nextSyncToken: "failed-write",
            }),
          ]),
        },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(onState.mock.calls[0]?.[0].cursor).toBe(initial?.cursor);
    expect(pod.get(orphan)).toBeDefined();
    expect(fn("orphan", true)).toBeUndefined();
    podFetch.mockImplementation(pod.fetch);
    const full = route({ connections: [PEOPLE[1]], nextSyncToken: "recovered" });
    await run(hasCheckpoint ? [route({}, 410), full] : [full], onState.mock.calls[0]?.[0]).result;
    expect(pod.get(orphan)).toBeUndefined();
    expect(fn("c102", true)).toBe("Sam Example");
    const deletion = podFetch.mock.calls.find(
      ([url, init]) => String(url) === orphan && init?.method === "DELETE",
    );
    expect(new Headers(deletion?.[1]?.headers).get("if-match")).toMatch(/^"/);
  });

  it("confines full-resync traversal to canonical person containers and their index documents", async () => {
    const { run, pod, podFetch } = setup();
    await run([route(CONNECTIONS)]).result;
    const root = `${ROOT}contacts/Person/`;
    const child = `${root}c101/`;
    const foreign = "https://elsewhere.test/contacts/Person/a/";
    const unmanaged = [
      foreign,
      `${root}a/b/`,
      `${root}~ZZ/`,
      `${root}./`,
      `${root}../`,
      `${root}not-container/index.ttl`,
    ];
    await pod.fetch(root, {
      method: "PUT",
      body: await listing(root, [
        ...[child, `${root}missing/`, ...unmanaged].map(DataFactory.namedNode),
        DataFactory.blankNode("foreign"),
        DataFactory.literal(child),
      ]),
    });
    await pod.fetch(child, {
      method: "PUT",
      body: await listing(child, [
        ...[`${child}index.ttl`, `${child}other.ttl`, `${child}nested/`, foreign].map(
          DataFactory.namedNode,
        ),
        DataFactory.blankNode("index"),
        DataFactory.literal(`${child}index.ttl`),
      ]),
    });
    const before = podFetch.mock.calls.length;
    await run([route({ connections: [PEOPLE[1]], nextSyncToken: "confined" })]).result;
    const calls = podFetch.mock.calls.slice(before);
    for (const url of [...unmanaged, `${child}other.ttl`, `${child}nested/`])
      expect(calls.some(([input]) => String(input) === url)).toBe(false);
    expect(pod.get(`${child}index.ttl`)).toBeUndefined();
    expect(pod.get(`${root}c102/index.ttl`)).toBeDefined();
  });

  it("removes former resource names on rename and then deletes the current identity", async () => {
    const { run, pod, fn, podFetch } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    const renamed = await run(
      [
        route({ connections: [PEOPLE[0]], nextPageToken: "rename" }),
        route({
          connections: [
            {
              resourceName: "people/renamed",
              metadata: {
                previousResourceNames: ["people/c101", "people/renamed", "people/c101"],
              },
              names: [{ displayName: "Alex Renamed" }],
            },
          ],
          nextSyncToken: "renamed",
        }),
      ],
      initial.state,
    ).result;
    expect(fn("renamed", true)).toBe("Alex Renamed");
    expect(fn("c101", true)).toBeUndefined();
    expect(pod.get(`${ROOT}${personSlug("c101")}`)).toBeUndefined();
    expect(fn("c102", true)).toBe("Sam Example");
    const deletion = podFetch.mock.calls.find(
      ([url, init]) => String(url) === `${ROOT}${personSlug("c101")}` && init?.method === "DELETE",
    );
    expect(new Headers(deletion?.[1]?.headers).get("if-match")).toMatch(/^"/);
    await run(
      [
        route({
          connections: [{ resourceName: "people/renamed", metadata: { deleted: true } }],
          nextSyncToken: "deleted",
        }),
      ],
      renamed.state,
    ).result;
    expect(pod.get(`${ROOT}${personSlug("renamed")}`)).toBeUndefined();
    expect(fn("renamed", true)).toBeUndefined();
    expect(fn("c101", true)).toBeUndefined();
  });

  it("validates former identifiers and encodes unusual ones before deleting", async () => {
    const { run, pod, fn, podFetch } = setup();
    const id = "../../odd/#?%~>";
    const initial = await run([
      route({ connections: [{ resourceName: `people/${id}` }], nextSyncToken: "initial" }),
    ]).result;
    const result = await run(
      [
        route({
          connections: [
            {
              resourceName: "people/new",
              metadata: {
                previousResourceNames: [
                  null,
                  7,
                  "",
                  "elsewhere/x",
                  "people/",
                  "people/.",
                  "people/..",
                  "people/\ud800",
                  `people/${id}`,
                ],
              },
            },
            { resourceName: "people/ignored", metadata: { previousResourceNames: "people/new" } },
            { metadata: { previousResourceNames: ["people/new"] } },
          ],
          nextSyncToken: "renamed",
        }),
      ],
      initial.state,
    ).result;
    expect(result.skipped).toBe(1);
    expect(fn("new", true)).toBe("(unnamed contact)");
    expect(pod.get(`${ROOT}${personSlug(id)}`)).toBeUndefined();
    const deletes = podFetch.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes.map(([url]) => String(url))).toEqual([`${ROOT}${personSlug(id)}`]);
  });

  it("retains the checkpoint and membership when deleting a former identity fails", async () => {
    const { run, pod, podFetch, podWriter, fn } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    const onState = vi.fn();
    const rename = route({
      connections: [
        { resourceName: "people/new", metadata: { previousResourceNames: ["people/c101"] } },
      ],
      nextSyncToken: "renamed",
    });
    podFetch.mockImplementation(async (input, init) =>
      init?.method === "DELETE" ? new Response(null, { status: 412 }) : pod.fetch(input, init),
    );
    await expect(
      runImport({
        adapter: googleContactsAdapter,
        mode: "live",
        podWriter,
        state: initial.state,
        onState,
        sourceAuth: { fetch: fixtureFetch("google-contacts", [rename]) },
      }),
    ).rejects.toMatchObject({ status: 412 });
    expect(onState.mock.calls[0]?.[0].cursor).toBe(initial.cursor);
    expect(fn("c101", true)).toBe("Dr Alex Morgan Example Jr");
    expect(pod.get(`${ROOT}${personSlug("new")}`)).toBeUndefined();
    podFetch.mockImplementation(pod.fetch);
    await run([rename], onState.mock.calls[0]?.[0]).result;
    expect(fn("c101", true)).toBeUndefined();
    expect(fn("new", true)).toBe("(unnamed contact)");
  });

  it.each([
    410, 400,
  ])("discards partial increments and retries once with a full sync (%s)", async (status) => {
    const { run, fn, pod } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    const reset = run(
      [
        route({
          connections: [
            { ...PEOPLE[1], names: [{ displayName: "Discard this update" }] },
            { resourceName: "people/c101", metadata: { deleted: true } },
            { resourceName: "people/discard", names: [{ displayName: "Discard me" }] },
          ],
          nextPageToken: "stale-page",
        }),
        route(expired, status),
        route({ connections: [PEOPLE[1]], nextPageToken: "full-page" }),
        route({ nextSyncToken: "fresh" }),
      ],
      initial.state,
    );
    expect((await reset.result).cursor).toBe("fresh");
    expect(reset.api).toHaveBeenCalledTimes(4);
    const urls = reset.api.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls[1]?.searchParams.get("pageToken")).toBe("stale-page");
    expect(urls[2]?.searchParams.has("syncToken")).toBe(false);
    expect(urls[2]?.searchParams.has("pageToken")).toBe(false);
    expect(urls[3]?.searchParams.get("pageToken")).toBe("full-page");
    expect(fn("c102")).toBe("Sam Example");
    expect(pod.get(`${ROOT}${personSlug("c101")}`)).toBeUndefined();
    expect(pod.get(`${ROOT}${personSlug("discard")}`)).toBeUndefined();
  });

  it.each([
    401, 403, 429, 500, 400, 410,
  ])("keeps existing data and checkpoint if the retry fails (%s)", async (status) => {
    const { run, pod, podWriter } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    const before = pod
      .urls()
      .filter((url) => url.includes("/contacts/"))
      .map((url) => [url, pod.get(url)]);
    const onState = vi.fn();
    const api = vi.fn(
      fixtureFetch("google-contacts", [
        route({
          connections: [{ resourceName: "people/c101", metadata: { deleted: true } }],
          nextPageToken: "discard-on-failure",
        }),
        route({}, 410),
        route(expired, status),
      ]),
    );
    await expect(
      runImport({
        adapter: googleContactsAdapter,
        mode: "live",
        podWriter,
        state: initial.state,
        onState,
        sourceAuth: { fetch: api },
      }),
    ).rejects.toMatchObject({ status });
    expect(api).toHaveBeenCalledTimes(3);
    for (const [url, body] of before) expect(pod.get(String(url))).toBe(body);
    expect(onState.mock.calls[0]?.[0]).toMatchObject({
      cursor: initial.cursor,
      lastOutcome: "error",
      counts: initial.state?.counts,
    });
  });

  it.each([
    401, 403, 429, 503, 410, 400,
  ])("does not retry errors during a full sync (%s)", async (status) => {
    const { run, pod } = setup();
    const request = run([route(expired, status)]);
    await expect(request.result).rejects.toMatchObject({ status });
    expect(request.api).toHaveBeenCalledTimes(1);
    expect(pod.get(INDEX)).toBeUndefined();
  });

  it.each([
    {},
    null,
    { error: {} },
    { error: { details: {} } },
    { error: { details: [null, {}, { reason: "OTHER" }] } },
    { error: { message: "EXPIRED_SYNC_TOKEN" } },
  ])("requires the documented error details to retry a 400: %j", async (body) => {
    const { run, pod } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    const before = pod.get(INDEX);
    const request = run([route(body, 400)], initial.state);
    await expect(request.result).rejects.toMatchObject({ status: 400 });
    expect(request.api).toHaveBeenCalledTimes(1);
    expect(pod.get(INDEX)).toBe(before);
  });

  it("propagates transport failures and malformed error bodies without a full retry", async () => {
    const { run, podWriter } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    for (const fetch of [
      vi.fn(async () => new Response("not json", { status: 400 })),
      vi.fn(async () => {
        throw new Error("offline");
      }),
    ]) {
      await expect(
        runImport({
          adapter: googleContactsAdapter,
          mode: "live",
          podWriter,
          state: initial.state,
          sourceAuth: { fetch },
        }),
      ).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    null,
    7,
    [],
    { connections: null },
    { connections: {} },
    { nextPageToken: 42 },
    { connections: [] },
    { nextSyncToken: 7 },
    { nextSyncToken: " " },
    { nextPageToken: "loop" },
  ])("rejects incomplete or looping pagination before writing: %j", async (page) => {
    const { run, pod } = setup();
    await expect(run([route(page)]).result).rejects.toThrow();
    expect(pod.get(INDEX)).toBeUndefined();
    expect(pod.get(`${ROOT}contacts/index.ttl`)).toBeUndefined();
  });

  it("fetches a full snapshot when the local index is lost, including an empty address book", async () => {
    const { run, pod } = setup();
    const request = run([route({ nextSyncToken: "empty" })], {
      connectedAt: "2026-01-01T00:00:00Z",
      cursor: "orphan",
      lastOutcome: "success",
      counts: { documents: 1, items: 1, skipped: 0 },
    });
    expect((await request.result).cursor).toBe("empty");
    expect(new URL(String(request.api.mock.calls[0]?.[0])).searchParams.has("syncToken")).toBe(
      false,
    );
    expect(pod.get(INDEX)).toBeDefined();
  });

  it("counts malformed people, safely encodes hostile ids and resolves duplicate changes once", async () => {
    const { run, pod, fn } = setup();
    const id = "../../odd/#?%~>";
    const result = await run([
      route({
        connections: [
          null,
          {},
          { resourceName: 7 },
          { resourceName: "not-people/x" },
          { resourceName: "people/" },
          { resourceName: "people/." },
          { resourceName: "people/.." },
          { resourceName: "people/\ud800" },
          { resourceName: `people/${id}`, names: [{ displayName: "Safe contact" }] },
          { resourceName: "people/c101", names: [{ displayName: "Older" }] },
          { resourceName: "people/c101", names: [{ displayName: "Latest" }] },
        ],
        nextSyncToken: "safe",
      }),
    ]).result;
    expect(result.skipped).toBe(8);
    expect(fn("c101")).toBe("Latest");
    expect(pod.get(`${ROOT}${personSlug(id)}`)).toContain(
      `https://contacts.google.com/person/${encodeURIComponent(id)}`,
    );
    expect(pod.urls().filter((url) => url.includes("Person/"))).toHaveLength(2);
  });

  it("drops fields removed by an update rather than retaining obsolete linked nodes", async () => {
    const { run, pod } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    await run(
      [
        route({
          connections: [{ resourceName: "people/c101", names: [{ displayName: "Alex" }] }],
          nextSyncToken: "updated",
        }),
      ],
      initial.state,
    ).result;
    const dataset = pod.dataset(`${ROOT}${personSlug("c101")}`);
    expect([...dataset].some((quad) => /#(?:email|tel|addr)-/.test(quad.subject.value))).toBe(
      false,
    );
    expect(dataset.getQuads(null, DataFactory.namedNode(`${VCARD}bday`), null, null)).toHaveLength(
      0,
    );
  });

  it("retains the old checkpoint when concurrent writes fail an ETag precondition", async () => {
    const { run, pod, podWriter } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    const onState = vi.fn();
    await expect(
      runImport({
        adapter: googleContactsAdapter,
        mode: "live",
        podWriter,
        state: initial.state,
        onState,
        sourceAuth: {
          fetch: async () => {
            await pod.fetch(INDEX, { method: "PUT", body: pod.get(INDEX) });
            return Response.json({ nextSyncToken: "unused" });
          },
        },
      }),
    ).rejects.toMatchObject({ status: 412 });
    expect(onState.mock.calls[0]?.[0].cursor).toBe(initial.cursor);
  });

  it("ignores unmanaged local membership paths and preserves a managed member with no name", async () => {
    const { run, pod, fn } = setup();
    const initial = await run([route(CONNECTIONS)]).result;
    const dataset = pod.dataset(INDEX);
    new Contact(`${ROOT}${personSlug("c101")}#this`, dataset, DataFactory).fn = undefined;
    for (const subject of [
      DataFactory.blankNode("foreign"),
      DataFactory.namedNode("https://elsewhere.test/contacts/Person/a/index.ttl#this"),
      DataFactory.namedNode(`${ROOT}contacts/Person/a/other.ttl#this`),
      ...[".", "..", "a/b", "~ZZ"].map((part) =>
        DataFactory.namedNode(`${ROOT}contacts/Person/${part}/index.ttl#this`),
      ),
    ])
      new Contact(subject, dataset, DataFactory).inAddressBook = `${ROOT}contacts/index.ttl#this`;
    const body = await new Promise<string>((resolve, reject) => {
      const writer = new Writer();
      writer.addQuads([...dataset]);
      writer.end((error, value) => (error ? reject(error) : resolve(value)));
    });
    await pod.fetch(INDEX, { method: "PUT", body });
    await run([route({ nextSyncToken: "preserved" })], initial.state).result;
    expect(fn("c101", true)).toBe("(unnamed contact)");
    expect(fn("c102", true)).toBe("Sam Example");
    expect(
      pod.dataset(INDEX).getQuads(null, DataFactory.namedNode(`${VCARD}inAddressBook`), null, null),
    ).toHaveLength(2);
  });
});
