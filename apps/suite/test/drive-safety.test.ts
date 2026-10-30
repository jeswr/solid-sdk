// AUTHORED-BY Codex
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
} from "../src/apps/drive/lib/client/client";
import {
  type BatchResult,
  copyItem,
  deleteForever,
  listTrash,
  purgeExpired,
  restoreItems,
  trashItems,
} from "../src/apps/drive/lib/operations/operations";
import {
  addTrashRecord,
  emptyTrashIndex,
  serializeTrashIndex,
  type TrashEntry,
  trashEntries,
  trashIndexFrom,
} from "../src/apps/drive/lib/operations/trash-index";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://safety.test/";
const DRIVE = `${ROOT}drive/`;
const FROM = `${DRIVE}source/`;
const TO = `${DRIVE}target/`;
const INDEX = `${DRIVE}.trash/index.ttl`;
const NOW = new Date("2026-10-26T12:00:00Z");

function setup(
  intercept?: (url: string, init: RequestInit | undefined) => Promise<Response | undefined>,
) {
  const pod = createDemoPod({
    root: ROOT,
    now: () => NOW.getTime(),
    seed: [
      { path: "drive/source/a", body: "A", contentType: "text/plain" },
      { path: "drive/source/b", body: "B", contentType: "text/plain" },
    ],
  });
  const fetch = vi.fn<typeof globalThis.fetch>(
    async (input, init) => (await intercept?.(String(input), init)) ?? pod.fetch(input, init),
  );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch });
  return { pod, fetch, client };
}

/** Stop before the second child DELETE, so survivor/recovery comparisons are settled. */
function setupPartial(intercept?: Parameters<typeof setup>[0]) {
  const fixture = setup(intercept);
  const { client, pod } = fixture;
  const move = client.move;
  vi.spyOn(client, "move").mockImplementation(function (
    this: DriveClient,
    from,
    to,
    policy,
    options,
  ) {
    return move.call(this, from, to, policy, {
      ...options,
      beforeDelete: async () => {
        await options?.beforeDelete?.();
        if (from === FROM && !pod.has(`${FROM}a`)) throw new Error("Stopped before second DELETE");
      },
    });
  });
  return fixture;
}

afterEach(() => vi.restoreAllMocks());

describe("Drive data-safety regressions", () => {
  it.each([
    "deleted",
    "changed",
    "ignored-precondition",
    "missing-etag",
    "weak-etag",
    "missing-recheck-etag",
  ])("partial restore retains recovery when the compared survivor is no longer verifiable (%s)", async (mode) => {
    let restoring = false;
    let comparedEtag: string | null = null;
    const { pod, client, fetch } = setupPartial(async (url, init) => {
      if (!restoring || url !== `${FROM}b`) return undefined;
      if (!init?.method || init.method === "GET") {
        // Capture the response before the other client removes or changes it.
        const response = await pod.fetch(url, init);
        comparedEtag = response.headers.get("etag");
        if (mode === "deleted") await pod.fetch(url, { method: "DELETE" });
        else if (mode === "changed" || mode === "ignored-precondition")
          await pod.fetch(url, { method: "PUT", body: "unique new survivor contents" });
        else if (mode === "missing-etag") response.headers.delete("etag");
        else if (mode === "weak-etag") response.headers.set("etag", 'W/"weak"');
        return response;
      }
      if (init.method === "HEAD" && new Headers(init.headers).has("if-match")) {
        if (mode === "changed") return new Response(null, { status: 412 });
        // The demo pod ignores HEAD preconditions: verify its returned ETag too.
        const response = await pod.fetch(url, init);
        if (mode === "missing-recheck-etag") response.headers.delete("etag");
        return response;
      }
      return undefined;
    });
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const entries = await listTrash(client, DRIVE);
    const entry = entries[0];
    if (!entry) throw new Error("Missing partial entry");
    restoring = true;
    fetch.mockClear();
    const result = await restoreItems(client, DRIVE, entries);
    restoring = false;
    expect(result.done).toEqual([]);
    expect(result.failed[0]?.error).toMatchObject({
      kind: "trash-restore-partial",
      remaining: [{ url: `${entry.url}b` }],
    });
    expect(
      fetch.mock.calls.filter(
        ([url, init]) => url === `${entry.url}b` && init?.method === "DELETE",
      ),
    ).toEqual([]);
    const checks = fetch.mock.calls.filter(
      ([url, init]) =>
        url === `${FROM}b` && init?.method === "HEAD" && new Headers(init.headers).has("if-match"),
    );
    if (mode === "missing-etag" || mode === "weak-etag") expect(checks).toEqual([]);
    else {
      expect(checks).toHaveLength(1);
      expect(new Headers(checks[0]?.[1]?.headers).get("if-match")).toBe(comparedEtag);
    }
    expect(await (await client.read(`${entry.url}b`)).text()).toBe("B");
    if (mode === "deleted") expect(pod.has(`${FROM}b`)).toBe(false);
    expect(await listTrash(client, DRIVE)).toMatchObject([
      { url: entry.url, status: "partial", remaining: [`${entry.url}b`] },
    ]);
  });

  it("partial restore refuses a comparison GET that replaces the survivor's initial HEAD identity", async () => {
    let restoring = false;
    let comparedEtag: string | null = null;
    const { pod, client, fetch } = setupPartial(async (url, init) => {
      if (!restoring || url !== `${FROM}b`) return undefined;
      if (!init?.method || init.method === "GET") {
        // Even an identical version after the initial stat needs a new decision.
        await pod.fetch(url, { method: "PUT", body: "B" });
        const response = await pod.fetch(url, init);
        comparedEtag = response.headers.get("etag");
        return response;
      }
      if (init.method === "HEAD" && new Headers(init.headers).has("if-match")) {
        const response = await pod.fetch(url, init);
        return new Headers(init.headers).get("if-match") === response.headers.get("etag")
          ? response
          : new Response(null, { status: 412 });
      }
      return undefined;
    });
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const entries = await listTrash(client, DRIVE);
    const entry = entries[0];
    if (!entry) throw new Error("Missing partial entry");
    const before = await client.stat(`${FROM}b`);
    restoring = true;
    fetch.mockClear();
    const result = await restoreItems(client, DRIVE, entries);
    restoring = false;
    expect(result.failed).toHaveLength(1);
    expect(result.done).toEqual([]);
    expect(comparedEtag).not.toBe(before.etag);
    const deletion = fetch.mock.calls.findIndex(
      ([url, init]) => url === `${entry.url}b` && init?.method === "DELETE",
    );
    expect(deletion).toBe(-1);
    expect(await (await client.read(`${FROM}b`)).text()).toBe("B");
    expect(await listTrash(client, DRIVE)).toMatchObject([{ url: entry.url, status: "partial" }]);
    expect(pod.has(entry.url)).toBe(true);
    expect(await (await client.read(`${entry.url}b`)).text()).toBe("B");
  });

  it("partial restore compares bytes when different URLs issue equal ETags", async () => {
    let collide = false;
    const { pod, client } = setupPartial(async (url, init) => {
      if (collide && url.endsWith("/b")) {
        // Model resource-local tags, including the server accepting its own tag.
        const headers = new Headers(init?.headers);
        if (headers.get("if-match") === '"resource-local-revision"') {
          const actual = await pod.fetch(url, { method: "HEAD" });
          headers.set("if-match", actual.headers.get("etag") as string);
        }
        const response = await pod.fetch(url, { ...init, headers });
        response.headers.set("etag", '"resource-local-revision"');
        return response;
      }
      return undefined;
    });
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const entries = await listTrash(client, DRIVE);
    const entry = entries[0];
    if (!entry) throw new Error("Missing partial entry");
    await pod.fetch(`${FROM}b`, { method: "PUT", body: "X" });
    collide = true;
    const result = await restoreItems(client, DRIVE, entries);
    expect(result.done).toEqual([]);
    expect(result.failed[0]?.error).toMatchObject({ kind: "trash-restore-partial" });
    expect(await (await client.read(`${entry.url}b`)).text()).toBe("B");
    expect(await (await client.read(`${FROM}b`)).text()).toBe("X");
    expect(await listTrash(client, DRIVE)).toHaveLength(1);
  });

  it.each([
    "changed",
    "missing-etag",
    "weak-etag",
  ])("partial restore preserves a recovery version it cannot conditionally delete (%s)", async (mode) => {
    let recovery: string | undefined;
    let comparedEtag: string | null = null;
    const { pod, client, fetch } = setupPartial(async (url, init) => {
      if (url === recovery && (!init?.method || init.method === "GET")) {
        const response = await pod.fetch(url, init);
        comparedEtag = response.headers.get("etag");
        if (mode === "changed")
          await pod.fetch(url, { method: "PUT", body: "unique new recovery contents" });
        else if (mode === "missing-etag") response.headers.delete("etag");
        else response.headers.set("etag", 'W/"weak"');
        return response;
      }
      return undefined;
    });
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const entries = await listTrash(client, DRIVE);
    const entry = entries[0];
    if (!entry) throw new Error("Missing partial entry");
    recovery = `${entry.url}b`;
    fetch.mockClear();
    const result = await restoreItems(client, DRIVE, entries);
    recovery = undefined;
    expect(result.done).toEqual([]);
    expect(result.failed[0]?.error).toMatchObject({
      kind: "trash-restore-partial",
      remaining: [
        {
          url: `${entry.url}b`,
          error:
            mode === "changed" ? { kind: "conflict", status: 412 } : { kind: "missing-validator" },
        },
      ],
    });
    const deletes = fetch.mock.calls.filter(
      ([url, init]) => url === `${entry.url}b` && init?.method === "DELETE",
    );
    expect(deletes).toEqual([]);
    if (mode === "changed") {
      expect(
        fetch.mock.calls.some(
          ([url, init]) =>
            url === `${entry.url}b` &&
            init?.method === "HEAD" &&
            new Headers(init.headers).get("if-match") === comparedEtag,
        ),
      ).toBe(true);
    }
    expect(await (await client.read(`${entry.url}b`)).text()).toBe(
      mode === "changed" ? "unique new recovery contents" : "B",
    );
    expect(await (await client.read(`${FROM}b`)).text()).toBe("B");
    expect(await listTrash(client, DRIVE)).toHaveLength(1);
  });

  it.each([
    false,
    true,
  ])("permanent deletion never refreshes the confirmed root after a descendant vanishes (second race: %s)", async (twice) => {
    let recovery: string | undefined;
    let vanished = 0;
    const { pod, client } = setupPartial(async (url, init) => {
      if (
        recovery &&
        url !== recovery &&
        url.startsWith(recovery) &&
        init?.method === "HEAD" &&
        vanished < (twice ? 2 : 1)
      ) {
        vanished += 1;
        await pod.fetch(url, { method: "DELETE" });
      }
      return undefined;
    });
    await client.write(
      `${FROM}c`,
      "C",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    );
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const entries = await listTrash(client, DRIVE);
    const entry = entries[0];
    if (!entry) throw new Error("Missing partial entry");
    recovery = entry.url;
    const remove = vi.spyOn(client, "remove");
    const result = await deleteForever(client, DRIVE, entries);
    recovery = undefined;
    expect(remove.mock.calls.filter(([url]) => url === entry.url)).toHaveLength(2);
    expect(result.done).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(await (await client.read(`${entry.url}c`)).text()).toBe("C");
    const refreshed = await listTrash(client, DRIVE);
    expect(refreshed).toHaveLength(1);
    expect((await deleteForever(client, DRIVE, refreshed)).failed).toEqual([]);
    expect(pod.has(entry.url)).toBe(false);
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });

  it("permanent deletion renews parent confirmation when a descendant 404 has no receipt", async () => {
    let recovery: string | undefined;
    const { pod, client } = setup(async (url, init) => {
      if (recovery && url === `${recovery}b` && init?.method === "DELETE") {
        recovery = undefined;
        await pod.fetch(url, { method: "DELETE" });
        return new Response(null, { status: 404 });
      }
      return undefined;
    });
    const { done: entries } = await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const entry = entries[0];
    if (!entry) throw new Error("Missing entry");
    recovery = entry.url;
    const remove = vi.spyOn(client, "remove");
    expect((await deleteForever(client, DRIVE, entries)).failed).toHaveLength(1);
    expect(remove.mock.calls.filter(([url]) => url === entry.url)).toHaveLength(1);
    expect(pod.has(entry.url)).toBe(true);
    const refreshed = await listTrash(client, DRIVE);
    expect(await deleteForever(client, DRIVE, refreshed)).toEqual({ done: refreshed, failed: [] });
    expect(pod.has(entry.url)).toBe(false);
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });

  it("permanent deletion keeps the record when removal leaves the entry URL present", async () => {
    const { client } = setup();
    const { done: entries } = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    vi.spyOn(client, "remove").mockResolvedValue(undefined);
    expect(await deleteForever(client, DRIVE, entries)).toMatchObject({
      done: [],
      failed: [{ url: entries[0]?.url, error: { kind: "conflict" } }],
    });
    expect(await listTrash(client, DRIVE)).toEqual(entries);
  });

  it.each([
    false,
    true,
  ])("completed trash remains discoverable beside a reused URL (receipt fails: %s)", async (failReceipt) => {
    let writes = 0;
    const { pod, client } = setup(async (url, init) => {
      if (url === INDEX && init?.method === "PUT" && ++writes > 1)
        return new Response(null, { status: 500 });
      if (failReceipt && url.endsWith("/partial.ttl") && init?.method === "PUT")
        return new Response(null, { status: 500 });
      return undefined;
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    const entry = result.done[0];
    if (!entry) throw new Error("Missing completed move");
    expect(result.warnings).toHaveLength(1);
    const receipt = new URL("partial.ttl", entry.url).href;
    expect(pod.has(receipt)).toBe(!failReceipt);
    await client.write(
      `${FROM}a`,
      "unrelated replacement",
      {
        contentType: "text/plain",
        ifNoneMatch: "*",
      },
      { kind: "protect-ancestors" },
    );
    const listed = await listTrash(client, DRIVE);
    expect(listed).toHaveLength(1);
    if (failReceipt) {
      // Refuse to drain recovery until a durable status/receipt can be saved.
      expect((await restoreItems(client, DRIVE, listed)).failed[0]?.error).toMatchObject({
        status: 500,
      });
      expect(await (await client.read(entry.url)).text()).toBe("A");
    } else {
      const restored = await restoreItems(client, DRIVE, listed);
      expect(restored.failed).toEqual([]);
      expect(restored.done[0]).toMatchObject({ url: `${FROM}a%20(restored)`, renamed: true });
      expect(await (await client.read(`${FROM}a%20(restored)`)).text()).toBe("A");
      expect(pod.has(receipt)).toBe(false);
    }
    expect(await (await client.read(`${FROM}a`)).text()).toBe("unrelated replacement");
  });

  it.each([
    "file",
    "nested",
  ])("pending recovery checks the identity of every %s occupant", async (kind) => {
    const { client } = setup();
    await client.write(
      `${FROM}nested/note`,
      "original",
      {
        contentType: "text/plain",
        ifNoneMatch: "*",
      },
      { kind: "protect-ancestors" },
    );
    const copy = client.copy;
    vi.spyOn(client, "move").mockImplementation(async function (this: DriveClient, from, to) {
      await copy.call(this, from, to, { kind: "preserve-source" });
      throw new Error("interrupted before deletion");
    });
    await trashItems(client, DRIVE, [await client.stat(kind === "file" ? `${FROM}a` : FROM)]);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    const changed = kind === "file" ? `${FROM}a` : `${FROM}nested/note`;
    await client.write(
      changed,
      "unrelated replacement",
      {
        contentType: "text/plain",
        ifMatch: (await client.stat(changed)).etag as string,
      },
      { kind: "protect-ancestors" },
    );
    expect(await listTrash(client, DRIVE)).toMatchObject([{ status: "partial" }]);
  });

  it("partial restore finishes with unchanged survivors and clears the recovery slot", async () => {
    const { pod, client } = setupPartial();
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const entries = await listTrash(client, DRIVE);
    const entry = entries[0];
    if (!entry) throw new Error("Missing recovery entry");
    const survivor = await client.stat(`${FROM}b`);
    const result = await restoreItems(client, DRIVE, entries);
    expect(result.failed).toEqual([]);
    expect(result.done).toHaveLength(1);
    expect(await (await client.read(`${FROM}a`)).text()).toBe("A");
    expect(await client.stat(`${FROM}b`)).toEqual(survivor);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    expect(pod.has(new URL("..", entry.url).href)).toBe(false);
  });

  it("confirmed deletion can clear partial recovery without touching surviving originals", async () => {
    const { pod, client } = setupPartial();
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const entries = await listTrash(client, DRIVE);
    expect(entries).toHaveLength(1);
    expect((await deleteForever(client, DRIVE, entries)).failed).toEqual([]);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    expect(pod.has(entries[0]?.url as string)).toBe(false);
    expect(await (await client.read(`${FROM}b`)).text()).toBe("B");
  });

  it.each([
    "legacy",
    "missing-etag",
    "weak-etag",
    "matching-etag",
  ])("compares pending recovery bytes when source identity is unavailable (%s)", async (mode) => {
    const { client } = setup();
    const source = `${FROM}a`;
    const initial = await client.stat(source);
    const copy = client.copy;
    vi.spyOn(client, "move").mockImplementation(async function (this: DriveClient, from, to) {
      await copy.call(this, from, to, { kind: "preserve-source" });
      throw new Error("interrupted");
    });
    const stat = client.stat.bind(client);
    vi.spyOn(client, "stat").mockImplementation(async (url) => {
      const current = await stat(url);
      if (mode === "missing-etag") {
        const { etag: _, ...withoutEtag } = current;
        return withoutEtag;
      }
      if (mode === "weak-etag") return { ...current, etag: 'W/"version"' };
      if (mode === "matching-etag" && url.includes(".trash/"))
        return { ...current, etag: initial.etag as string };
      return current;
    });
    await trashItems(client, DRIVE, [initial]);
    const current = await client.readRdf(INDEX);
    if (!current) throw new Error("Missing intent");
    const index = trashIndexFrom(current.dataset);
    const record = index.records[0];
    if (!record) throw new Error("Missing record");
    if (mode === "legacy" || mode === "matching-etag") {
      expect(record.sourceVersions.size).toBe(1);
      record.sourceVersions.clear();
      await client.write(
        INDEX,
        await serializeTrashIndex(index),
        {
          contentType: "text/turtle",
          ifMatch: current.etag as string,
        },
        { kind: "protect-ancestors" },
      );
    }
    expect(await listTrash(client, DRIVE)).toEqual([]);
    // Same byte length forces actual byte comparison, rather than just size checks.
    await client.write(
      source,
      "X",
      {
        contentType: "text/plain",
        ifMatch: (await stat(source)).etag as string,
      },
      { kind: "protect-ancestors" },
    );
    expect(await listTrash(client, DRIVE)).toMatchObject([{ status: "partial" }]);
  });

  it.each([
    new Error("offline"),
    new DriveError("forbidden", 403, FROM),
  ])("does not move anything when source identity cannot be captured (%s)", async (error) => {
    const { pod, client } = setup();
    const initial = await client.stat(`${FROM}a`);
    vi.spyOn(client, "stat").mockRejectedValue(error);
    const move = vi.spyOn(client, "move");
    const result = await trashItems(client, DRIVE, [initial]);
    expect(result).toMatchObject({ done: [], failed: [{ url: initial.url, error }] });
    expect(move).not.toHaveBeenCalled();
    expect(pod.has(initial.url)).toBe(true);
  });

  it("automatic expiry preserves partial recovery until a user confirms deletion", async () => {
    const { client } = setupPartial();
    await trashItems(client, DRIVE, [await client.stat(FROM)], { now: new Date(0) });
    expect(await purgeExpired(client, DRIVE, { now: NOW })).toEqual({ done: [], failed: [] });
    const entries = await listTrash(client, DRIVE);
    expect(entries).toHaveLength(1);
    expect((await deleteForever(client, DRIVE, entries)).done).toEqual(entries);
  });

  it("confirmed deletion removes a completion receipt while preserving foreign slot resources", async () => {
    let writes = 0;
    const { pod, client } = setup(async (url, init) =>
      url === INDEX && init?.method === "PUT" && ++writes === 2
        ? new Response(null, { status: 500 })
        : undefined,
    );
    const {
      done: [entry],
    } = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    if (!entry) throw new Error("Missing completed entry");
    const receipt = new URL("partial.ttl", entry.url).href;
    const foreign = new URL("foreign", entry.url).href;
    await pod.fetch(foreign, { method: "PUT", body: "another writer's data" });
    expect(pod.has(receipt)).toBe(true);
    expect((await deleteForever(client, DRIVE, [entry])).failed).toEqual([]);
    expect(pod.has(receipt)).toBe(false);
    expect(pod.has(entry.url)).toBe(false);
    expect(await (await client.read(foreign)).text()).toBe("another writer's data");
  });

  it("partial restore drains unchanged survivors while preserving foreign slot resources", async () => {
    const { pod, client } = setupPartial();
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const entries = await listTrash(client, DRIVE);
    const entry = entries[0];
    if (!entry) throw new Error("Missing partial entry");
    const foreign = new URL("../foreign", entry.url).href;
    await pod.fetch(foreign, { method: "PUT", body: "another writer's data" });
    expect((await restoreItems(client, DRIVE, entries)).failed).toEqual([]);
    expect(pod.has(entry.url)).toBe(false);
    expect(await (await client.read(foreign)).text()).toBe("another writer's data");
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });

  it.each([
    "status",
    "original",
    "date",
    "missing-date",
  ])("does not trust a receipt with a mismatched %s", async (field) => {
    let writes = 0;
    const { pod, client } = setup(async (url, init) =>
      url === INDEX && init?.method === "PUT" && ++writes === 2
        ? new Response(null, { status: 500 })
        : undefined,
    );
    const {
      done: [entry],
    } = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    if (!entry) throw new Error("Missing completed entry");
    const receipt = new URL("partial.ttl", entry.url).href;
    const current = await client.readRdf(receipt);
    if (!current) throw new Error("Missing completion receipt");
    const index = trashIndexFrom(current.dataset);
    const record = index.record(entry.url);
    if (field === "status") record.status = "pending";
    else if (field === "original") record.originalLocation = `${FROM}b`;
    else record.trashedAt = field === "date" ? new Date(0) : undefined;
    await client.write(
      receipt,
      await serializeTrashIndex(index),
      {
        contentType: "text/turtle",
        ifMatch: current.etag as string,
      },
      { kind: "protect-ancestors" },
    );
    const entries = await listTrash(client, DRIVE);
    expect(entries).toMatchObject([{ status: "partial" }]);
    expect((await restoreItems(client, DRIVE, entries)).failed).toEqual([]);
    expect(await (await client.read(entry.original)).text()).toBe("A");
    // Invalid receipts are treated like foreign slot resources.
    expect(pod.has(receipt)).toBe(true);
  });

  it("partial restore retains the only recovery copy when an original URL is occupied", async () => {
    const { pod, client } = setupPartial();
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing partial recovery copy");
    await client.write(
      `${FROM}a`,
      "unrelated replacement",
      {
        contentType: "text/plain",
        ifNoneMatch: "*",
      },
      { kind: "protect-ancestors" },
    );
    const result = await restoreItems(client, DRIVE, [entry]);
    expect(result.done).toEqual([]);
    expect(result.failed[0]?.error).toMatchObject({
      message: "1 items could not be restored because their location is in use",
    });
    expect(await (await client.read(`${entry.url}a`)).text()).toBe("A");
    expect(await (await client.read(`${FROM}a`)).text()).toBe("unrelated replacement");
    expect((await listTrash(client, DRIVE))[0]).toMatchObject({ status: "partial" });
    expect(pod.has(entry.url)).toBe(true);
  });

  it("reconciles a stranded pending tree and permits restore even when partial index saves fail", async () => {
    let writes = 0;
    const { client } = setupPartial(async (url, init) => {
      if (url === INDEX && init?.method === "PUT" && ++writes > 1)
        return new Response(null, { status: 500 });
      return undefined;
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const trashed = await trashItems(client, DRIVE, [await client.stat(FROM)]);
    expect(trashed.warnings?.[0]).toMatchObject({ kind: "trash-index-persistence" });
    const current = await client.readRdf(INDEX);
    if (!current) throw new Error("Missing durable intent");
    expect(trashIndexFrom(current.dataset).records[0]?.status).toBe("pending");
    const [entry] = await listTrash(client, DRIVE);
    expect(entry).toMatchObject({ status: "partial", original: FROM });
    if (!entry) throw new Error("Hidden recovery copy");
    const result = await restoreItems(client, DRIVE, [entry]);
    expect(result.failed[0]?.error).not.toMatchObject({ kind: "trash-moving" });
    expect(await (await client.read(`${FROM}a`)).text()).toBe("A");
    expect(result.failed).toEqual([]);
    expect(result.done).toHaveLength(1);
    expect(await (await client.read(`${FROM}b`)).text()).toBe("B");
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });

  it.each([
    "direct",
    "nested",
  ])("reconciles legacy pending recovery after a %s child disappears", async (missing) => {
    let failIndex = false;
    const { client } = setup(async (url, init) =>
      failIndex && url === INDEX && init?.method === "PUT"
        ? new Response(null, { status: 500 })
        : undefined,
    );
    await client.write(
      `${FROM}nested/note`,
      "nested",
      {
        contentType: "text/plain",
        ifNoneMatch: "*",
      },
      { kind: "protect-ancestors" },
    );
    const copy = client.copy;
    vi.spyOn(client, "move").mockImplementation(async function (this: DriveClient, from, to) {
      await copy.call(this, from, to, { kind: "preserve-source" });
      throw new Error("interrupted before deletion");
    });
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    await client.remove(`${FROM}${missing === "direct" ? "a" : "nested/note"}`);
    failIndex = true;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const [entry] = await listTrash(client, DRIVE);
    expect(entry).toMatchObject({ status: "partial" });
    if (!entry) throw new Error("Hidden legacy recovery");
    expect(entry.remaining).toEqual([`${entry.url}a`, `${entry.url}b`, `${entry.url}nested/note`]);
  });

  it("keeps matching pending file copies hidden as in-flight", async () => {
    const { client } = setup();
    const copy = client.copy;
    vi.spyOn(client, "move").mockImplementation(async function (this: DriveClient, from, to) {
      await copy.call(this, from, to, { kind: "preserve-source" });
      throw new Error("interrupted before deletion");
    });
    await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });

  it("keeps recovery visible if both index promotion and the fallback receipt fail, and refuses to drain it", async () => {
    let writes = 0;
    let failReceipt = false;
    const { client } = setupPartial(async (url, init) => {
      if (url === INDEX && init?.method === "PUT" && ++writes > 1)
        return new Response(null, { status: 500 });
      if (failReceipt && url.endsWith("/partial.ttl") && init?.method === "PUT")
        return new Response(null, { status: 500 });
      return undefined;
    });
    failReceipt = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const trashed = await trashItems(client, DRIVE, [await client.stat(FROM)]);
    expect(trashed.warnings).toHaveLength(1);
    const [entry] = await listTrash(client, DRIVE);
    expect(entry).toMatchObject({ status: "partial" });
    if (!entry) throw new Error("Hidden recovery");
    expect((await restoreItems(client, DRIVE, [entry])).failed[0]?.error).toMatchObject({
      status: 500,
    });
    expect(await (await client.read(`${entry.url}a`)).text()).toBe("A");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining("/partial.ttl") }),
    );
  });

  it("removes a fallback receipt and its record only after fully draining the recovery copy", async () => {
    let writes = 0;
    const { pod, client } = setup(async (url, init) =>
      url === INDEX && init?.method === "PUT" && ++writes === 2
        ? new Response(null, { status: 500 })
        : undefined,
    );
    const result = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    const entry = result.done[0];
    if (!entry) throw new Error("Missing entry");
    // Keep the durable intent pending and force its first promotion to fail.
    vi.spyOn(client, "write").mockRejectedValueOnce(new DriveError("failed", 500, INDEX));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await listTrash(client, DRIVE)).toEqual([entry]);
    const slot = new URL(".", entry.url).href;
    expect(pod.has(`${slot}partial.ttl`)).toBe(true);
    const remove = client.remove.bind(client);
    vi.spyOn(client, "remove").mockImplementation(async (url, options) => {
      if (url === slot) throw new DriveError("forbidden", 403, url);
      await remove(url, options);
    });
    expect((await restoreItems(client, DRIVE, [entry])).done).toHaveLength(1);
    expect(pod.has(entry.url)).toBe(false);
    expect(pod.has(`${slot}partial.ttl`)).toBe(false);
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });

  it("keeps the fallback receipt separate from a trashed file named partial.ttl", async () => {
    let writes = 0;
    const { client } = setup(async (url, init) =>
      url === INDEX && init?.method === "PUT" && ++writes > 1
        ? new Response(null, { status: 500 })
        : undefined,
    );
    await client.write(
      `${FROM}partial.ttl`,
      "unique recovery bytes",
      {
        contentType: "text/plain",
        ifNoneMatch: "*",
      },
      { kind: "protect-ancestors" },
    );
    const {
      done: [entry],
    } = await trashItems(client, DRIVE, [await client.stat(`${FROM}partial.ttl`)]);
    if (!entry) throw new Error("Missing entry");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await listTrash(client, DRIVE)).toEqual([entry]);
    expect(await (await client.read(entry.url)).text()).toBe("unique recovery bytes");
    expect((await restoreItems(client, DRIVE, [entry])).done).toHaveLength(1);
    expect(await (await client.read(entry.original)).text()).toBe("unique recovery bytes");
  });

  it.each([
    "changed",
    "missing",
    "no-etag",
    "weak-etag",
    "ignored-condition",
  ])("keeps the source when the destination copy cannot be verified (%s)", async (failure) => {
    const destination = `${TO}a`;
    const { pod, client, fetch } = setup(async (url, init) => {
      if (url === destination && init?.method === "PUT") {
        const response = await pod.fetch(url, init);
        if (failure === "no-etag") response.headers.delete("etag");
        else if (failure === "weak-etag") response.headers.set("etag", 'W/"copy"');
        else if (failure === "missing") await pod.fetch(url, { method: "DELETE" });
        else await pod.fetch(url, { method: "PUT", body: "unrelated" });
        return response;
      }
      if (failure === "ignored-condition" && url === destination && init?.method === "HEAD")
        return pod.fetch(url, { method: "HEAD" });
      return undefined;
    });
    await expect(
      client.move(`${FROM}a`, destination, { kind: "confirm-move" }),
    ).rejects.toMatchObject({
      kind: "partial-failure",
      deletedSources: [],
    });
    expect(await (await client.read(`${FROM}a`)).text()).toBe("A");
    expect(
      fetch.mock.calls.some(([url, init]) => url === `${FROM}a` && init?.method === "DELETE"),
    ).toBe(false);
  });

  it("verifies each recursive destination again before deleting its source child", async () => {
    const { pod, client } = setup(async (url, init) => {
      if (url === `${FROM}a` && init?.method === "DELETE")
        await pod.fetch(`${TO}b`, { method: "PUT", body: "unrelated" });
      return undefined;
    });
    await expect(client.move(FROM, TO, { kind: "confirm-move" })).rejects.toMatchObject({
      kind: "partial-failure",
    });
    expect(await (await client.read(`${FROM}b`)).text()).toBe("B");
    expect(await (await client.read(`${TO}a`)).text()).toBe("A");
  });

  it.each([
    "extra",
    "renamed",
  ])("keeps every source when the copied folder's membership changes (%s)", async (change) => {
    const { pod, client } = setup(async (url, init) => {
      if (url === `${TO}b` && init?.method === "PUT") {
        const response = await pod.fetch(url, init);
        if (change === "renamed") await pod.fetch(`${TO}a`, { method: "DELETE" });
        await pod.fetch(`${TO}foreign`, { method: "PUT", body: "foreign" });
        return response;
      }
      return undefined;
    });
    await expect(client.move(FROM, TO, { kind: "confirm-move" })).rejects.toMatchObject({
      kind: "partial-failure",
      deletedSources: [],
    });
    expect(await (await client.read(`${FROM}a`)).text()).toBe("A");
    expect(await (await client.read(`${FROM}b`)).text()).toBe("B");
  });

  it("lists partial folder trash and restores only missing children without overwriting survivors", async () => {
    const { pod, client, fetch } = setupPartial();
    const result = await trashItems(client, DRIVE, [await client.stat(FROM)]);
    expect(result.failed).toHaveLength(1);
    expect(pod.has(`${FROM}a`)).toBe(false);
    const [entry] = await listTrash(client, DRIVE);
    expect(entry).toMatchObject({ status: "partial", original: FROM });
    if (!entry) throw new Error("Missing partial recovery copy");
    await pod.fetch(`${FROM}b`, { method: "PUT", body: "new B" });
    await pod.fetch(`${FROM}nested/new`, { method: "PUT", body: "new child" });
    const foreign = new URL("../foreign", entry.url).href;
    await pod.fetch(foreign, { method: "PUT", body: "foreign slot child" });
    const restored = await restoreItems(client, DRIVE, [entry]);
    expect(restored.failed[0]?.error).toMatchObject({ kind: "trash-restore-partial" });
    expect(restored.done).toEqual([]);
    expect(await (await client.read(`${FROM}a`)).text()).toBe("A");
    expect(await (await client.read(`${FROM}b`)).text()).toBe("new B");
    expect(await (await client.read(`${FROM}nested/new`)).text()).toBe("new child");
    const write = fetch.mock.calls.find(
      ([url, init]) => url === `${FROM}a` && init?.method === "PUT",
    );
    expect(new Headers(write?.[1]?.headers).get("if-none-match")).toBe("*");
    expect((await listTrash(client, DRIVE))[0]).toMatchObject({
      status: "partial",
      remaining: [`${entry.url}b`],
    });
    expect(await (await client.read(`${entry.url}b`)).text()).toBe("B");
    expect(await (await client.read(foreign)).text()).toBe("foreign slot child");
  });

  it.each([
    "folder-race",
    "file-race",
    "folder-error",
    "file-error",
    "offline",
  ])("restores partial trees safely through %s and keeps recovery on failure", async (failure) => {
    let restoring = false;
    let intervened = false;
    const { pod, client } = setupPartial(async (url, init) => {
      if (
        restoring &&
        !intervened &&
        init?.method === "PUT" &&
        url === (failure.startsWith("folder") ? FROM : `${FROM}a`)
      ) {
        intervened = true;
        if (failure === "offline") throw new Error("offline");
        if (failure.endsWith("error")) return new Response(null, { status: 403 });
        await pod.fetch(url, {
          method: "PUT",
          body: failure === "file-race" ? "concurrent" : "",
          headers: { "content-type": failure === "file-race" ? "text/plain" : "text/turtle" },
        });
      }
      return undefined;
    });
    await client.write(
      `${FROM}nested/note`,
      "nested",
      {
        contentType: "text/plain",
        ifNoneMatch: "*",
      },
      { kind: "protect-ancestors" },
    );
    await trashItems(client, DRIVE, [await client.stat(FROM)]);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery copy");
    restoring = true;
    await client.remove(FROM, { recursive: true });
    const result = await restoreItems(client, DRIVE, [entry]);
    expect(intervened).toBe(true);
    if (failure.endsWith("race")) {
      expect(result.failed).toHaveLength(failure === "file-race" ? 1 : 0);
      expect(await (await client.read(`${FROM}a`)).text()).toBe(
        failure === "file-race" ? "concurrent" : "A",
      );
      expect(await (await client.read(`${FROM}nested/note`)).text()).toBe("nested");
      expect(await listTrash(client, DRIVE)).toHaveLength(failure === "file-race" ? 1 : 0);
    } else {
      expect(result.done).toEqual([]);
      expect(result.failed).toHaveLength(1);
      expect(await (await client.read(`${entry.url}a`)).text()).toBe("A");
      expect((await listTrash(client, DRIVE))[0]).toMatchObject({ status: "partial" });
    }
  });

  it.each([
    "GET",
    "PUT",
  ])("returns every target failed with a typed warning for initial index %s failure", async (method) => {
    const { pod, client } = setup(async (url, init) =>
      url === INDEX && (init?.method ?? "GET") === method
        ? new Response(null, { status: 500 })
        : undefined,
    );
    const items = await Promise.all([client.stat(`${FROM}a`), client.stat(`${FROM}b`)]);
    await expect(trashItems(client, DRIVE, items)).resolves.toMatchObject({
      done: [],
      failed: items.map(({ url }) => ({ url, error: expect.objectContaining({ status: 500 }) })),
      warnings: [{ kind: "trash-index-persistence" }],
    });
    expect(pod.has(`${FROM}a`)).toBe(true);
    expect(pod.has(`${FROM}b`)).toBe(true);
  });

  it.each([
    "restore",
    "delete",
    "purge",
  ])("refuses pending trash %s between destination PUT and source deletion, preserving the moved copy", async (operation) => {
    let observed: { visible: TrashEntry[]; result: BatchResult<unknown> } | undefined;
    let attempted = false;
    const { pod, client } = setup(async (url, init) => {
      if (!attempted && url.includes(".trash/") && url !== INDEX && init?.method === "PUT") {
        attempted = true;
        const response = await pod.fetch(url, init);
        const current = await client.readRdf(INDEX);
        if (!current) throw new Error("Missing trash index");
        const entry = trashEntries(trashIndexFrom(current.dataset))[0];
        if (!entry) throw new Error("Missing pending entry");
        const visible = await listTrash(client, DRIVE);
        const result =
          operation === "restore"
            ? await restoreItems(client, DRIVE, [entry])
            : operation === "delete"
              ? await deleteForever(client, DRIVE, [entry])
              : await purgeExpired(client, DRIVE, { now: NOW });
        observed = { visible, result };
        return response;
      }
      return undefined;
    });
    const result = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)], {
      now: new Date(0),
    });
    expect(attempted).toBe(true);
    expect(result.failed).toEqual([]);
    expect(result.done).toHaveLength(1);
    expect(pod.has(result.done[0]?.url as string)).toBe(true);
    expect(pod.has(`${FROM}a`)).toBe(false);
    expect(observed?.visible).toEqual([]);
    expect(observed?.result.done).toEqual([]);
    if (operation !== "purge")
      expect(observed?.result.failed[0]?.error).toMatchObject({
        kind: "operation-in-progress",
        message: expect.stringContaining("already in progress"),
      });
  });

  it("rechecks the pending intent before deleting the original source", async () => {
    const { pod, client } = setup(async (url, init) => {
      if (url.includes(".trash/") && url !== INDEX && init?.method === "PUT") {
        const response = await pod.fetch(url, init);
        await pod.fetch(INDEX, { method: "DELETE" });
        return response;
      }
      return undefined;
    });
    const result = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    expect(result.done).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(pod.has(`${FROM}a`)).toBe(true);
  });

  it.each([
    "restore",
    "delete",
  ])("returns completed %s results with a typed index warning and reconciles phantoms on load", async (operation) => {
    let fail = false;
    const { pod, client } = setup(async (url, init) =>
      fail && url === INDEX && init?.method === "PUT"
        ? new Response(null, { status: 500 })
        : undefined,
    );
    const {
      done: [entry],
    } = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    if (!entry) throw new Error("Missing trash entry");
    fail = true;
    const result =
      operation === "restore"
        ? await restoreItems(client, DRIVE, [entry])
        : await deleteForever(client, DRIVE, [entry]);
    expect(result.done).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(result).toMatchObject({
      warnings: [
        {
          kind: "trash-index-persistence",
          url: INDEX,
          cause: expect.objectContaining({ status: 500 }),
        },
      ],
    });
    expect(pod.has(entry.url)).toBe(false);
    expect(pod.has(`${FROM}a`)).toBe(operation === "restore");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ kind: "trash-index-persistence" }));
    fail = false;
    expect(await listTrash(client, DRIVE)).toEqual([]);
    const current = await client.readRdf(INDEX);
    if (!current) throw new Error("Missing reconciled index");
    expect(trashEntries(trashIndexFrom(current.dataset))).toEqual([]);
  });

  it("reconciles a pending intent with a missing source to partial before restore", async () => {
    let writes = 0;
    const { client } = setup(async (url, init) =>
      url === INDEX && init?.method === "PUT" && ++writes === 2
        ? new Response(null, { status: 500 })
        : undefined,
    );
    const result = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    const entry = result.done[0];
    if (!entry) throw new Error("Missing moved entry");
    // Legacy completed transfers may have no slot-local completion receipt.
    await client.remove(new URL("partial.ttl", entry.url).href);
    expect(await listTrash(client, DRIVE)).toMatchObject([{ ...entry, status: "partial" }]);
    expect((await restoreItems(client, DRIVE, [entry])).done).toHaveLength(1);
  });

  it.each([
    "removed",
    "changed",
    "partial",
  ])("does not resurrect a pending intent %s by another tab during reconciliation", async (change) => {
    let writes = 0;
    const { client } = setup(async (url, init) =>
      url === INDEX && init?.method === "PUT" && ++writes === 2
        ? new Response(null, { status: 500 })
        : undefined,
    );
    const {
      done: [entry],
    } = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    if (!entry) throw new Error("Missing moved entry");
    await client.remove(new URL("partial.ttl", entry.url).href);
    const read = client.readRdf.bind(client);
    let reads = 0;
    vi.spyOn(client, "readRdf").mockImplementation(async (url) => {
      if (url !== INDEX || ++reads !== 2) return read(url);
      const current = await read(url);
      if (!current) throw new Error("Missing index");
      const index = trashIndexFrom(current.dataset);
      if (change === "removed") index.record(entry.url).clear();
      else if (change === "changed") index.record(entry.url).originalLocation = `${FROM}b`;
      else index.record(entry.url).status = "partial";
      await client.write(
        INDEX,
        await serializeTrashIndex(index),
        { contentType: "text/turtle" },
        { kind: "protect-ancestors" },
      );
      return read(url);
    });
    expect(await listTrash(client, DRIVE)).toMatchObject(
      change === "partial" ? [{ ...entry, status: "partial" }] : [],
    );
  });

  it("copies a folder through the operation API with its trailing slash intact", async () => {
    const { pod, client } = setup();
    expect(await copyItem(client, FROM)).toBe(`${DRIVE}Copy%20of%20source/`);
    expect(pod.has(`${DRIVE}Copy%20of%20source/a`)).toBe(true);
  });

  it.each([
    ".",
    "..",
    "a/b",
  ])("rejects an undiscoverable trash name %s before writing an intent or moving", async (name) => {
    const { pod, client, fetch } = setup();
    await expect(
      trashItems(client, DRIVE, [{ url: `${FROM}a`, name, kind: "file" }]),
    ).rejects.toMatchObject({ kind: "invalid-trash-record" });
    expect(fetch).not.toHaveBeenCalled();
    expect(pod.has(`${FROM}a`)).toBe(true);
  });
  it("purges only the recorded item and preserves unrelated resources in the same UUID slot", async () => {
    const { pod, client } = setup();
    const { done } = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    const entry = done[0];
    if (!entry) throw new Error("missing trash result");
    const foreign = new URL("foreign", entry.url).href;
    await pod.fetch(foreign, { method: "PUT", body: "foreign" });
    expect(await deleteForever(client, DRIVE, [entry])).toEqual({ done: [entry], failed: [] });
    expect(pod.has(entry.url)).toBe(false);
    expect(await (await client.read(foreign)).text()).toBe("foreign");
  });
  it.each([
    undefined,
    'W/"weak"',
  ])("refuses destructive operations without a strong source validator (%s)", async (etag) => {
    const { pod, client } = setup(async (url, init) => {
      if (url.startsWith(FROM) && init?.method !== "DELETE" && init?.method !== "PUT") {
        const response = await pod.fetch(url, init);
        if (etag) response.headers.set("etag", etag);
        else response.headers.delete("etag");
        return response;
      }
      return undefined;
    });
    for (const url of [FROM, `${FROM}a`]) {
      await expect(
        client.move(url, url.endsWith("/") ? TO : `${TO}a`, { kind: "confirm-move" }),
      ).rejects.toMatchObject({
        kind: "missing-validator",
      });
      await expect(client.remove(url, { recursive: true })).rejects.toMatchObject({
        kind: "missing-validator",
      });
    }
    expect(pod.has(TO)).toBe(false);
  });

  it("retains copied folders and reports a missing destination creation ETag", async () => {
    const { pod, client } = setup(async (url, init) => {
      if (url === TO && init?.method === "PUT") {
        const response = await pod.fetch(url, init);
        response.headers.delete("etag");
        return response;
      }
      return undefined;
    });
    await expect(client.copy(FROM, TO, { kind: "preserve-source" })).rejects.toMatchObject({
      kind: "partial-failure",
      cause: { kind: "missing-validator" },
    });
    expect(pod.has(`${TO}a`)).toBe(true);
    expect(pod.has(`${FROM}a`)).toBe(true);
  });

  it("rolls back only its own destinations, leaving an unrelated new child untouched", async () => {
    const { pod, client } = setup(async (url, init) => {
      if (url === `${TO}b` && init?.method === "PUT") {
        await pod.fetch(`${TO}foreign`, { method: "PUT", body: "foreign" });
        return new Response(null, { status: 500 });
      }
      return undefined;
    });
    await expect(client.copy(FROM, TO, { kind: "preserve-source" })).rejects.toMatchObject({
      kind: "partial-failure",
      retainedDestinations: expect.arrayContaining([TO]),
      deletedSources: [],
    });
    expect(pod.has(`${TO}a`)).toBe(false);
    expect(await (await client.read(`${TO}foreign`)).text()).toBe("foreign");
  });

  it.each([
    false,
    true,
  ])("reports recursive delete failures without visiting new children (partial: %s)", async (partial) => {
    const failed = `${FROM}${partial ? "b" : "a"}`;
    const { pod, client } = setup(async (url, init) =>
      url === failed && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
    );
    await expect(client.remove(FROM, { recursive: true })).rejects.toMatchObject({
      kind: partial ? "partial-failure" : "forbidden",
    });
    expect(pod.has(failed)).toBe(true);
  });

  it.each([
    "network",
    "server",
  ])("keeps a recovery copy after an ambiguous source deletion (%s)", async (failure) => {
    let deleting = false;
    const { pod, client } = setup(async (url, init) => {
      if (url === `${FROM}a` && init?.method === "DELETE") {
        deleting = true;
        await pod.fetch(url, init);
        if (failure === "network") throw new Error("lost response");
        return new Response(null, { status: 500 });
      }
      if (deleting && url === `${FROM}a` && init?.method === "HEAD")
        return new Response(null, { status: 200 });
      return undefined;
    });
    await expect(client.move(`${FROM}a`, `${TO}a`, { kind: "confirm-move" })).rejects.toMatchObject(
      {
        kind: "partial-failure",
        retainedDestinations: [`${TO}a`],
      },
    );
    expect(pod.has(`${FROM}a`)).toBe(false);
    expect(await (await client.read(`${TO}a`)).text()).toBe("A");
  });

  it("rejects mismatched file/folder destinations and recursive self copies", async () => {
    const { client } = setup();
    for (const [from, to] of [
      [FROM, `${DRIVE}file`],
      [`${FROM}a`, TO],
      [FROM, `${FROM}nested/`],
    ] as const)
      await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
        kind: "conflict",
      });
  });

  it("keeps pending intents hidden while the source exists and propagates inaccessible sources", async () => {
    const { client } = setup();
    expect(await trashItems(client, DRIVE, [])).toEqual({ done: [], failed: [] });
    vi.spyOn(client, "move").mockRejectedValue(new Error("offline"));
    await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    vi.spyOn(client, "stat").mockRejectedValue(new DriveError("forbidden", 403, INDEX));
    await expect(listTrash(client, DRIVE)).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("warns when listing invalid trash records and reports them alongside a successful purge", async () => {
    const { client } = setup();
    const trashed = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)], {
      now: new Date(0),
    });
    const index = emptyTrashIndex();
    const invalid = {
      url: `${DRIVE}live/old.txt`,
      original: `${FROM}a`,
      name: "old",
      trashedAt: new Date(0),
    };
    addTrashRecord(index, invalid);
    for (const entry of trashed.done) addTrashRecord(index, entry);
    await client.write(
      INDEX,
      await serializeTrashIndex(index),
      { contentType: "text/turtle" },
      { kind: "protect-ancestors" },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await listTrash(client, DRIVE)).toEqual(trashed.done);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ kind: "invalid-trash-record" }));
    const result = await purgeExpired(client, DRIVE, { now: NOW });
    expect(result.done).toEqual(trashed.done);
    expect(result.failed).toHaveLength(1);
  });

  it.each([
    "not a URL",
    "https://other.test/file",
    DRIVE,
    `${DRIVE}.trash/file`,
    `${DRIVE}file?query`,
    `${DRIVE}file#hash`,
    `${DRIVE}folder/`,
    `${DRIVE}%2fescape`,
    `${DRIVE}a/../file`,
  ])("rejects unsafe restore destination %s", async (original) => {
    const { client, fetch } = setup();
    const entry = {
      url: `${DRIVE}.trash/00000000-0000-0000-0000-000000000000/a`,
      original,
      name: "a",
      trashedAt: NOW,
    };
    expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([
      { url: entry.url, error: expect.objectContaining({ kind: "invalid-trash-record" }) },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "%2fescape",
    "%5cescape",
    "%zz",
    "%2e",
    "x?query",
    "x#hash",
  ])("rejects unsafe trash name %s", async (name) => {
    const { client } = setup();
    const entry = {
      url: `${DRIVE}.trash/00000000-0000-0000-0000-000000000000/${name}`,
      original: `${FROM}a`,
      name,
      trashedAt: NOW,
    };
    expect((await deleteForever(client, DRIVE, [entry])).failed).toEqual([
      { url: entry.url, error: expect.objectContaining({ kind: "invalid-trash-record" }) },
    ]);
  });
  it("retains destination copies after a partially deleted folder move", async () => {
    const { pod, client } = setup(async (url, init) =>
      url === `${FROM}b` && init?.method === "DELETE"
        ? new Response(null, { status: 403 })
        : undefined,
    );
    await expect(client.move(FROM, TO, { kind: "confirm-move" })).rejects.toMatchObject({
      kind: "partial-failure",
      deletedSources: [`${FROM}a`],
    });
    expect(pod.has(`${FROM}a`)).toBe(false);
    expect(await (await client.read(`${TO}a`)).text()).toBe("A");
    expect(await (await client.read(`${FROM}b`)).text()).toBe("B");
    expect(pod.has(`${TO}b`)).toBe(true);
  });

  it("preserves an edit made after copying by deleting with the captured ETag", async () => {
    const { pod, client, fetch } = setup(async (url, init) => {
      if (url === `${FROM}a` && init?.method === "DELETE")
        await pod.fetch(url, { method: "PUT", body: "new edit" });
      return undefined;
    });
    await expect(client.move(`${FROM}a`, `${TO}a`, { kind: "confirm-move" })).rejects.toMatchObject(
      {
        kind: "partial-failure",
        cause: { kind: "conflict", status: 412 },
      },
    );
    expect(await (await client.read(`${FROM}a`)).text()).toBe("new edit");
    const deletion = fetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(new Headers(deletion?.[1]?.headers).get("if-match")).toMatch(/^"demo-/);
  });

  it("leaves children added after the snapshot in the source folder", async () => {
    let added = false;
    const { pod, client } = setup(async (url, init) => {
      if (!added && url === `${FROM}a` && init?.method === "DELETE") {
        added = true;
        await pod.fetch(`${FROM}new`, { method: "PUT", body: "new child" });
      }
      return undefined;
    });
    await expect(client.move(FROM, TO, { kind: "confirm-move" })).rejects.toMatchObject({
      kind: "partial-failure",
    });
    expect(await (await client.read(`${FROM}new`)).text()).toBe("new child");
    expect(pod.has(FROM)).toBe(true);
    expect(pod.has(`${TO}new`)).toBe(false);
  });

  it.each([
    "copy",
    "move",
  ] as const)("cleans up a failed %s copy stage and permits an immediate retry", async (operation) => {
    let fail = true;
    const { pod, client } = setup(async (url, init) =>
      fail && url === `${TO}b` && init?.method === "PUT"
        ? new Response(null, { status: 500 })
        : undefined,
    );
    await expect(client[operation](FROM, TO, { kind: "preserve-source" })).rejects.toMatchObject({
      status: 500,
    });
    expect(pod.has(TO)).toBe(false);
    expect(pod.has(`${TO}a`)).toBe(false);
    expect(pod.has(`${FROM}a`)).toBe(true);
    fail = false;
    await client[operation](FROM, TO, { kind: "preserve-source" });
    expect(pod.has(`${TO}b`)).toBe(true);
  });

  it("makes no writes when a later child read fails", async () => {
    const { pod, client, fetch } = setup(async (url, init) =>
      url === `${FROM}b` && !init?.method ? new Response(null, { status: 403 }) : undefined,
    );
    await expect(client.move(FROM, TO, { kind: "confirm-move" })).rejects.toMatchObject({
      status: 403,
    });
    expect(pod.has(TO)).toBe(false);
    expect(
      fetch.mock.calls.filter(([, init]) => ["PUT", "DELETE"].includes(init?.method ?? "")),
    ).toEqual([]);
  });

  it.each([
    `${DRIVE}sibling`,
    "http://[",
    "https://user:password@safety.test/drive/source/a",
    "https://other.test/a",
    `${FROM}nested/grandchild`,
    FROM,
    `${FROM}a?query`,
    `${FROM}a#fragment`,
    `${FROM}%2fescape`,
  ])("rejects hostile listing member %s before any write", async (member) => {
    const { client, fetch } = setup(async (url) =>
      url === FROM
        ? new Response(`<> <http://www.w3.org/ns/ldp#contains> <${member}>.`, {
            headers: { "content-type": "text/turtle", etag: '"listing"' },
          })
        : undefined,
    );
    for (const action of [
      () => client.copy(FROM, TO, { kind: "preserve-source" }),
      () => client.move(FROM, TO, { kind: "confirm-move" }),
      () => client.remove(FROM, { recursive: true }),
    ])
      await expect(action()).rejects.toMatchObject({ kind: "invalid-listing" });
    expect(
      fetch.mock.calls.filter(([, init]) => ["PUT", "DELETE"].includes(init?.method ?? "")),
    ).toEqual([]);
  });

  it.each([
    500, 412,
  ])("aborts trash before moving when index persistence fails with %i", async (status) => {
    const { pod, client } = setup(async (url, init) =>
      url === INDEX && init?.method === "PUT" ? new Response(null, { status }) : undefined,
    );
    await expect(trashItems(client, DRIVE, [await client.stat(`${FROM}a`)])).resolves.toMatchObject(
      {
        done: [],
        failed: [{ url: `${FROM}a`, error: { status } }],
        warnings: [{ kind: "trash-index-persistence" }],
      },
    );
    expect(pod.has(`${FROM}a`)).toBe(true);
    expect(pod.snapshot().resources.some(([url]) => url.includes(".trash/") && url !== INDEX)).toBe(
      false,
    );
  });

  it.each([
    500, 412,
  ])("keeps a discoverable pending record and warns if finalizing the index fails with %i", async (status) => {
    let writes = 0;
    const { pod, client } = setup(async (url, init) => {
      if (url === INDEX && init?.method === "PUT" && ++writes > 1)
        return new Response(null, { status });
      return undefined;
    });
    const result = await trashItems(client, DRIVE, [await client.stat(`${FROM}a`)]);
    expect(result.done).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(result.warnings).toMatchObject([{ kind: "trash-index-persistence", cause: { status } }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await listTrash(client, DRIVE)).toEqual(result.done);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ kind: "trash-index-persistence" }));
    expect(pod.has(`${FROM}a`)).toBe(false);
  });

  it.each([
    `${DRIVE}live/old.txt`,
    "https://other.test/.trash/00000000-0000-0000-0000-000000000000/x",
    `${DRIVE}.trash/not-a-uuid/x`,
    `${DRIVE}.trash/00000000-0000-0000-0000-000000000000/nested/x`,
  ])("reports and ignores unsafe trash record %s during restore and purge", async (url) => {
    const { pod, client, fetch } = setup();
    await pod.fetch(`${DRIVE}live/keep`, { method: "PUT", body: "live" });
    const entry = { url, original: `${FROM}a`, name: "a", trashedAt: new Date(0) };
    const index = emptyTrashIndex();
    addTrashRecord(index, entry);
    await pod.fetch(INDEX, {
      method: "PUT",
      body: await serializeTrashIndex(index),
      headers: { "content-type": "text/turtle" },
    });
    for (const result of [
      await restoreItems(client, DRIVE, [entry]),
      await deleteForever(client, DRIVE, [entry]),
      await purgeExpired(client, DRIVE, { now: NOW }),
    ]) {
      expect(result.done).toEqual([]);
      expect(result.failed).toEqual([
        { url, error: expect.objectContaining({ kind: "invalid-trash-record" }) },
      ]);
    }
    expect(pod.has(`${DRIVE}live/keep`)).toBe(true);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toEqual([]);
  });
});
