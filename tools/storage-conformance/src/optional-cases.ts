// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { StorageError } from "@jeswr/storage-client";
import { createTrashClient } from "@jeswr/storage-client/trash";
import { createVersionsClient } from "@jeswr/storage-client/versions";
import { container, entries, etag, text } from "./case-helpers.js";
import { expectStorageError } from "./testing.js";
import type { ConformanceCase, SupportProbe } from "./types.js";

/** Only an explicit missing/unimplemented route establishes service absence. */
export function serviceAbsent(status: number): boolean {
  assert([404, 405, 410, 501].includes(status), "Unexpected optional service probe response");
  return false;
}

/** Probe a real TrashService command, bypassing the SDK advertisement guard on HTTP. */
export const trashProbe: SupportProbe = async (target) => {
  const parent = (await target.storage.create(target.root, null, { kind: "container" })).url;
  const item = await text(target.storage, parent);
  const endpoint = target.serviceEndpoints?.trash;
  assert(endpoint && target.storage.isWithinStorage(endpoint), "Missing trash probe route");
  if (target.resolveFeatures) {
    try {
      await target.storage.create(endpoint, JSON.stringify({ resource: item.url }), {
        contentType: "application/json",
      });
    } catch (error) {
      if (error instanceof StorageError && error.code === "not-found" && error.status === 404)
        return false;
      throw error;
    }
  } else {
    const response = await target.fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: item.url }),
    });
    await response.body?.cancel();
    if (!response.ok) return serviceAbsent(response.status);
  }
  // A generic JSON POST that merely stores the command is not a TrashService.
  try {
    await target.storage.head(item.url);
    return false;
  } catch (error) {
    if (error instanceof StorageError && error.code === "not-found" && error.status === 404)
      return true;
    throw error;
  }
};

/** Probe the history Link/fixture route directly, rather than the feature-gated client. */
export const versioningProbe: SupportProbe = async (target) => {
  const parent = (await target.storage.create(target.root, null, { kind: "container" })).url;
  const item = await text(target.storage, parent);
  await target.storage.write(item.url, "second draft", {
    ifMatch: await etag(target.storage, item.url),
    contentType: "text/plain",
  });
  const head = await target.storage.head(item.url);
  const template = target.serviceEndpoints?.versioning;
  const endpoint =
    head.links.get("version-history")?.[0]?.target ??
    template?.replace("{resource}", encodeURIComponent(item.url));
  assert(endpoint && target.storage.isWithinStorage(endpoint), "Missing versioning probe route");
  if (target.resolveFeatures) {
    try {
      // A real history Link works without an available feature or its URI template.
      const read = await target.storage.read(endpoint);
      await read.body?.cancel();
      assert((await entries(target.storage, endpoint)).length >= 2);
      return true;
    } catch (error) {
      if (error instanceof StorageError && error.code === "not-found" && error.status === 404)
        return false;
      throw error;
    }
  }
  const response = await target.fetch(endpoint, {
    redirect: "manual",
    headers: {
      Accept: target.storage.protocol === "solid" ? "text/turtle" : "application/lws+json",
    },
  });
  await response.body?.cancel();
  // A successful history route is sufficient to reject an absent advertisement;
  // malformed advertised histories are checked by the full scenario below.
  return response.ok ? true : serviceAbsent(response.status);
};

const trash: ConformanceCase = {
  id: "SC-TRASH-roundtrip",
  requires: ["trash"],
  checks: { trash: trashProbe },
  async run(target) {
    const parent = await container(target, "trash-roundtrip");
    const item = await text(target.storage, parent);
    const client = createTrashClient(target.storage);
    const copy = await client.trash(item.url);
    assert(target.storage.isWithinStorage(copy.url));
    assert.notEqual(copy.url, item.url);
    await expectStorageError(target.storage.head(item.url), "not-found", 404);
    assert(!(await entries(target.storage, parent)).some((entry) => entry.url === item.url));
    const entry = (await client.listTrash()).find((entry) => entry.url === copy.url);
    assert(entry, "Trashed item must appear in the service listing");
    assert.equal(entry.original, item.url);
    assert(Number.isFinite(entry.trashedAt.getTime()));
    assert.equal(await (await target.storage.read(copy.url)).text(), "first draft");
    const restored = await client.restore(copy.url);
    assert(target.storage.isWithinStorage(restored.url));
    assert.equal(restored.url === item.url, target.storage.protocol === "solid");
    assert.equal(await (await target.storage.read(restored.url)).text(), "first draft");
    assert.equal(await target.storage.parentOf(restored.url), parent);
    assert(!(await client.listTrash()).some((entry) => entry.url === copy.url));
    const purged = await client.trash(restored.url);
    await client.purge(purged.url);
    await expectStorageError(target.storage.head(purged.url), "not-found", 404);
    assert(!(await client.listTrash()).some((entry) => entry.url === purged.url));
  },
};

const versions: ConformanceCase = {
  id: "SC-VERSIONS-roundtrip",
  requires: ["versioning"],
  checks: { versioning: versioningProbe },
  async run(target) {
    const parent = await container(target, "versions-roundtrip");
    const item = await text(target.storage, parent);
    const client = createVersionsClient(target.storage);
    const first = await client.versions(item.url);
    assert(first.length > 0, "Creation must record an immutable version");
    const original = first[0];
    assert(original);
    assert(original.etag);
    assert(Number.isFinite(original.at.getTime()));
    assert(target.storage.isWithinStorage(original.url));
    assert.equal(await (await target.storage.read(original.url)).text(), "first draft");
    const before = await etag(target.storage, item.url);
    await target.storage.write(item.url, "second draft", {
      contentType: "text/plain",
      ifMatch: before,
    });
    const history = await client.versions(item.url);
    assert(history.length > first.length);
    assert.equal(new Set(history.map((entry) => entry.url)).size, history.length);
    assert.equal(await etag(target.storage, original.url), original.etag);
    assert.equal(await (await target.storage.read(original.url)).text(), "first draft");
    await expectStorageError(
      target.storage.write(item.url, "lost update", {
        contentType: "text/plain",
        ifMatch: before,
      }),
      "precondition-failed",
      412,
    );
    assert.equal((await client.versions(item.url)).length, history.length);
    const restored = await client.restoreVersion(item.url, original.url);
    assert.equal(restored.url, item.url);
    assert.equal(await (await target.storage.read(item.url)).text(), "first draft");
    assert((await client.versions(item.url)).length > history.length);
    const unrelated = await text(target.storage, parent, "unrelated.txt");
    await expectStorageError(client.restoreVersion(item.url, unrelated.url), "not-found");
  },
};

/** Reusable service scenarios, also used by the sparq SQ-8 acceptance group. */
export const optionalServiceCases: readonly ConformanceCase[] = [trash, versions];

/** SQ-8 shares both the operation and its independent absence check with SC groups. */
export const sq8Cases: readonly ConformanceCase[] = optionalServiceCases.map((scenario) => ({
  ...scenario,
  id: scenario.id.replace(/^SC-(TRASH|VERSIONS)/, "SQ-8-$1"),
}));
