// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { expect, it, vi } from "vitest";
import { Doc, encodeStateAsUpdate } from "yjs";
import { AutomaticVersions, versionDisabledReason } from "../../src/apps/docs/lib/editor/versions";
import { ResourceReadError, ResourceWriteError } from "../../src/apps/docs/lib/model/errors";
import {
  type DocumentVersion,
  DocumentVersionStore,
  versionError,
} from "../../src/apps/docs/lib/model/versions";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import { mockFetch } from "./helpers";

const container = "https://pod.example/docs/plan/versions/";
const webId = "https://pod.example/profile#me";
function doc() {
  const value = new Doc();
  value.getMap("document").set("instanceId", "plan");
  value.getText("text").insert(0, "Old content");
  return value;
}
const entry: DocumentVersion = {
  url: `${container}one.ttl`,
  snapshot: `${container}one.bin`,
  created: "2026-11-10T10:00:00.000Z",
  kind: "named",
  creator: webId,
  name: "First draft",
};

it("publishes full-state binary first, create-only metadata second, and round trips optional fields", async () => {
  const pod = createDemoPod({ root: "https://pod.example/", seed: [] });
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const http: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return pod.fetch(input, init);
  };
  const store = new DocumentVersionStore(container, http);
  const original = doc();
  const older = await store.create(original, {
    kind: "named",
    creator: webId,
    name: 'First "draft"',
    now: new Date(entry.created),
  });
  const latest = await store.create(original, { kind: "automatic" });
  expect(calls.filter(({ init }) => init?.method === "PUT").map(({ url }) => url)).toEqual([
    container,
    older.snapshot,
    older.url,
    container,
    latest.snapshot,
    latest.url,
  ]);
  for (const { init } of calls) expect(new Headers(init?.headers).get("if-none-match")).toBe("*");
  const rows = await store.list();
  expect(rows).toEqual([latest, older]);
  expect(older.url).toMatch(/2026-11-10T10-00-00-000Z-.*\.ttl$/);
  const loaded = await store.load(older, "plan");
  expect(loaded.getText("text").toString()).toBe("Old content");
  expect(loaded).not.toBe(original);
  loaded.destroy();
  original.destroy();
});

it("handles absent/empty containers, rejects access and network errors", async () => {
  const missing = mockFetch({});
  expect(await new DocumentVersionStore(container, missing.fetch).list()).toEqual([]);
  const empty = mockFetch({ [`GET ${container}`]: { body: "" } });
  expect(await new DocumentVersionStore(container, empty.fetch).list()).toEqual([]);
  for (const status of [401, 403, 500]) {
    const http = mockFetch({ [`GET ${container}`]: { status } });
    await expect(new DocumentVersionStore(container, http.fetch).list()).rejects.toBeInstanceOf(
      RdfFetchError,
    );
  }
  await expect(
    new DocumentVersionStore(container, async () => {
      throw new TypeError("offline");
    }).list(),
  ).rejects.toThrow();
});

it("lists only direct valid TTL/bin pairs, isolates malformed entries and sorts ties", async () => {
  const urls = [
    "a",
    "b",
    "old",
    "orphan",
    "foreign",
    "not-bin",
    "missing-date",
    "invalid-date",
    "missing-snapshot",
    "invalid-kind",
    "missing-kind",
    "bad-creator",
    "bad-rdf",
    "vanished",
  ];
  const metadata = (id: string, overrides = "") =>
    `<${container}${id}.ttl> <http://purl.org/dc/terms/created> "${id === "old" ? "2026-01-01" : "2026-11-10"}T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>; <https://jeswr.org/ns/pod-docs#versionKind> "automatic"; <https://jeswr.org/ns/pod-docs#snapshot> <${container}${id}.bin>. ${overrides}`;
  const script: Parameters<typeof mockFetch>[0] = {
    [`GET ${container}`]: {
      body: `<${container}> a <http://www.w3.org/ns/ldp#BasicContainer>; <http://www.w3.org/ns/ldp#contains> ${[...urls.flatMap((id) => [`<${container}${id}.ttl>`, ...(id === "orphan" ? [] : [`<${container}${id}.bin>`])]), `<https://evil.example/remote.ttl>`, '"malformed listing member"', `<${container}nested/a.ttl>`].join(", ")}.`,
    },
  };
  for (const id of urls) script[`GET ${container}${id}.ttl`] = { body: metadata(id) };
  script[`GET ${container}foreign.ttl`] = {
    body: metadata("foreign").replace(
      `${container}foreign.bin`,
      "https://evil.example/payload.bin",
    ),
  };
  script[`GET ${container}not-bin.ttl`] = {
    body: metadata("not-bin").replace("not-bin.bin", "a.ttl"),
  };
  script[`GET ${container}missing-date.ttl`] = {
    body: metadata("missing-date").replace(/<http:\/\/purl.org\/dc\/terms\/created>[^;]+;/, ""),
  };
  script[`GET ${container}invalid-date.ttl`] = {
    body: metadata("invalid-date").replace("2026-11-10T10:00:00Z", "invalid"),
  };
  script[`GET ${container}missing-snapshot.ttl`] = {
    body: metadata("missing-snapshot").replace(
      `; <https://jeswr.org/ns/pod-docs#snapshot> <${container}missing-snapshot.bin>`,
      "",
    ),
  };
  script[`GET ${container}invalid-kind.ttl`] = {
    body: metadata("invalid-kind").replace('"automatic"', '"bogus"'),
  };
  script[`GET ${container}missing-kind.ttl`] = {
    body: metadata("missing-kind").replace(
      /<https:\/\/jeswr.org\/ns\/pod-docs#versionKind> "automatic";/,
      "",
    ),
  };
  script[`GET ${container}bad-creator.ttl`] = {
    body: metadata(
      "bad-creator",
      `<${container}bad-creator.ttl> <http://purl.org/dc/terms/creator> "literal".`,
    ),
  };
  script[`GET ${container}bad-rdf.ttl`] = { body: "garbage" };
  script[`GET ${container}vanished.ttl`] = { status: 404 };
  const http = mockFetch(script);
  const rows = await new DocumentVersionStore(container, http.fetch).list();
  expect(rows.map((row) => row.url)).toEqual([
    `${container}b.ttl`,
    `${container}a.ttl`,
    `${container}old.ttl`,
  ]);
  expect(
    http.calls.every((call) => call.url.startsWith(container) && !call.url.endsWith(".bin")),
  ).toBe(true);
});

it("fails safely before metadata publication on binary or container failures", async () => {
  const original = doc();
  for (const status of [403, 412]) {
    const http = mockFetch({ [`PUT ${container}`]: {}, [`PUT ${entry.snapshot}`]: { status } });
    await expect(
      new DocumentVersionStore(container, http.fetch).write(entry, encodeStateAsUpdate(original)),
    ).rejects.toMatchObject({ status });
    expect(http.calls.some((call) => call.url === entry.url)).toBe(false);
  }
  const http = mockFetch({ [`PUT ${container}`]: { status: 403 } });
  await expect(
    new DocumentVersionStore(container, http.fetch).write(entry, encodeStateAsUpdate(original)),
  ).rejects.toMatchObject({ status: 403 });
  const network = new DocumentVersionStore(container, async () => {
    throw new Error("offline");
  });
  await expect(network.write(entry, encodeStateAsUpdate(original))).rejects.toThrow("offline");
  const metadata = mockFetch({
    [`PUT ${container}`]: {},
    [`PUT ${entry.snapshot}`]: {},
    [`PUT ${entry.url}`]: { status: 412 },
  });
  await expect(
    new DocumentVersionStore(container, metadata.fetch).write(entry, encodeStateAsUpdate(original)),
  ).rejects.toMatchObject({ status: 412 });
  original.destroy();
});

it("rejects foreign locations, missing binaries, corrupt updates and identity mismatches", async () => {
  const original = doc();
  const http = vi.fn<typeof fetch>(
    async () => new Response(new Uint8Array(encodeStateAsUpdate(original))),
  );
  const store = new DocumentVersionStore(container, http);
  for (const version of [
    { ...entry, url: "https://evil.example/a.ttl" },
    { ...entry, snapshot: `${container}nested/a.bin` },
  ])
    await expect(store.write(version, encodeStateAsUpdate(original))).rejects.toThrow(
      "Invalid version location",
    );
  for (const snapshot of ["https://evil.example/a.bin", `${container}a.ttl`])
    await expect(store.load({ ...entry, snapshot }, "plan")).rejects.toThrow(
      "Invalid version location",
    );
  expect(http).not.toHaveBeenCalled();
  await expect(store.load(entry, "another-document")).rejects.toThrow("different document");
  await expect(
    new DocumentVersionStore(container, async () => new Response(null, { status: 404 })).load(
      entry,
      "plan",
    ),
  ).rejects.toBeInstanceOf(ResourceReadError);
  await expect(
    new DocumentVersionStore(container, async () => new Response(new Uint8Array([255]))).load(
      entry,
      "plan",
    ),
  ).rejects.toThrow();
  original.destroy();
});

it("provides specific permission errors and safe generic failures", () => {
  for (const status of [401, 403])
    expect(versionError(new ResourceWriteError(container, status))).toContain("permission");
  expect(versionError(new Error("Identity mismatch"))).toBe("Identity mismatch");
  expect(versionError(new ResourceWriteError(container, 500))).toContain("500");
  expect(versionError("offline")).toContain("connected");
  expect(versionDisabledReason(false, false, true)).toContain("Save this document");
  expect(versionDisabledReason(true, true, true)).toContain("Read-only");
  expect(versionDisabledReason(true, false, false)).toContain("Reconnect");
  expect(versionDisabledReason(true, false, true)).toBeUndefined();
});

it("throttles automatic versions, counts named snapshots, permits one in flight and logs failures", async () => {
  const original = doc();
  const automatic = new AutomaticVersions();
  const list = vi.fn<DocumentVersionStore["list"]>().mockResolvedValue([]);
  const create = vi.fn<DocumentVersionStore["create"]>().mockResolvedValue(entry);
  const store = { list, create } as unknown as DocumentVersionStore;
  await automatic.afterSave(store, original, false, webId);
  expect(create).not.toHaveBeenCalled();
  await automatic.afterSave(store, original, true, webId);
  expect(create).toHaveBeenCalledOnce();
  list.mockResolvedValue([entry]);
  await automatic.afterSave(
    store,
    original,
    true,
    webId,
    Date.parse(entry.created) + 29 * 60 * 1000,
  );
  expect(create).toHaveBeenCalledOnce();
  await automatic.afterSave(
    store,
    original,
    true,
    webId,
    Date.parse(entry.created) + 30 * 60 * 1000,
  );
  expect(create).toHaveBeenCalledTimes(2);
  let finish!: (entries: DocumentVersion[]) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = automatic.afterSave(store, original, true, webId);
  expect(automatic.afterSave(store, original, true, webId)).toBe(first);
  finish([]);
  await first;
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  list.mockRejectedValueOnce(new Error("forbidden"));
  await expect(automatic.afterSave(store, original, true, webId)).resolves.toBeUndefined();
  create.mockRejectedValueOnce(new Error("quota"));
  list.mockResolvedValue([]);
  await expect(automatic.afterSave(store, original, true, webId)).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledTimes(2);
  log.mockRestore();
  original.destroy();
});
