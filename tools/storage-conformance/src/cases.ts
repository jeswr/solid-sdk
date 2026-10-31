// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { parseRdf } from "@jeswr/fetch-rdf";
import { type Entry, type StorageClient, StorageError } from "@jeswr/storage-client";
import { assertIsomorphic, expectStorageError } from "./testing.js";
import type { ConformanceCase, RunningTarget, SupportProbe } from "./types.js";

async function container(target: RunningTarget, name: string): Promise<string> {
  return (await target.storage.create(target.root, null, { name, kind: "container" })).url;
}

async function text(
  storage: StorageClient,
  parent: string,
  name = "note.txt",
  body = "first draft",
) {
  return storage.create(parent, body, { name, contentType: "text/plain" });
}

async function etag(storage: StorageClient, url: string): Promise<string> {
  const tag = (await storage.head(url)).etag;
  assert(tag, "Target must supply a validator");
  return tag;
}

async function entries(storage: StorageClient, parent: string): Promise<Entry[]> {
  const items: Entry[] = [];
  for await (const item of storage.listAll(parent)) items.push(item);
  return items;
}

/** An absent LWS move must reject the real operation, rather than silently succeeding. */
export const moveProbe: SupportProbe = async (target) => {
  const parent = await container(target, "gate-move");
  const destination = await container(target, "gate-move-destination");
  const item = await text(target.storage, parent);
  if (
    target.storage.protocol === "lws" &&
    !target.resolveFeatures &&
    target.storage.features.move.state !== "available"
  ) {
    // Bypass the SDK's capability refusal when probing the SERVER. Otherwise an
    // unadvertised but working operation would be incorrectly reported as absent.
    const metadata = await target.storage.metadata(item.url);
    assert(metadata.etag, "Move probe needs the linkset validator");
    assert(target.storage.isWithinStorage(metadata.url));
    const raw = metadata.raw as { linkset: { anchor: string }[] };
    const index = raw.linkset.findIndex(
      (context) => new URL(context.anchor, metadata.url).href === item.url,
    );
    assert(index >= 0, "Missing resource context in move probe");
    const response = await target.fetch(metadata.url, {
      method: "PATCH",
      redirect: "manual",
      headers: { "Content-Type": "application/json-patch+json", "If-Match": metadata.etag },
      body: JSON.stringify([
        { op: "test", path: `/linkset/${index}/anchor`, value: raw.linkset[index]?.anchor },
        { op: "replace", path: `/linkset/${index}/up/0/href`, value: destination },
      ]),
    });
    await response.body?.cancel();
    if (response.ok) return true;
    assert(
      [400, 403, 405, 409, 415, 422].includes(response.status),
      "Unexpected move probe response",
    );
    return false;
  }
  try {
    const moved = await target.storage.move(item.url, destination, {
      ifMatch: await etag(target.storage, item.url),
    });
    assert.equal(await (await target.storage.read(moved.url)).text(), "first draft");
    return true;
  } catch (error) {
    if (error instanceof StorageError && error.code === "unsupported" && error.feature === "move")
      return false;
    throw error;
  }
};

/** Both list APIs must preserve exact membership, including multi-page LWS collections. */
function listCase(count: number): ConformanceCase {
  return {
    id: `SC-LIST-${count}`,
    requires: [],
    async run(target) {
      const parent = await container(target, `list-${count}`);
      const expected = new Set<string>();
      for (let i = 0; i < count; i++)
        expected.add((await text(target.storage, parent, `item-${i}.txt`)).url);
      const page = await target.storage.list(parent);
      assert.equal(page.items.length <= count, true);
      assert.equal(new Set(page.items.map((item) => item.url)).size, page.items.length);
      assert(page.items.every((item) => expected.has(item.url) && item.kind === "resource"));
      if (target.storage.protocol === "lws" && count > 100)
        assert(page.next, "LWS must actually paginate");
      else assert.equal(page.next, null);
      const all = await entries(target.storage, parent);
      assert.equal(all.length, count);
      assert.deepEqual(new Set(all.map((item) => item.url)), expected);
    },
  };
}

const listKinds: ConformanceCase = {
  id: "SC-LIST-kinds-types",
  requires: [],
  async run(target) {
    const parent = await container(target, "list-kinds");
    const child = await target.storage.create(parent, null, { name: "child", kind: "container" });
    const item = await target.storage.create(parent, "", {
      name: "typed.txt",
      contentType: "text/plain",
      links: [{ rel: "type", target: "https://schema.org/TextDigitalDocument" }],
    });
    const all = await entries(target.storage, parent);
    assert.equal(all.length, 2);
    assert.equal(all.find((entry) => entry.url === child.url)?.kind, "container");
    const listed = all.find((entry) => entry.url === item.url);
    assert(listed);
    assert.equal(listed.kind, "resource");
    assert(listed.types.every((type) => URL.canParse(type)));
    // Solid create ignores links; LWS initial type metadata is part of its contract.
    if (target.storage.protocol === "lws")
      assert(listed.types.includes("https://schema.org/TextDigitalDocument"));
  },
};

const rw: ConformanceCase[] = [
  {
    id: "SC-RW-create",
    requires: [],
    async run(target) {
      const parent = await container(target, "rw-create");
      const named = await text(target.storage, parent, "a space.txt");
      assert.equal(named.created, true);
      assert.equal(await (await target.storage.read(named.url)).text(), "first draft");
      if (target.storage.protocol === "solid") {
        assert.equal(named.url, `${parent}a%20space.txt`);
        await expectStorageError(text(target.storage, parent, "a space.txt"), "conflict");
      } else {
        const second = await text(target.storage, parent, "a space.txt");
        assert.notEqual(second.url, named.url);
      }
      const generated = await target.storage.create(parent, "server named", {
        contentType: "text/plain",
      });
      assert.notEqual(generated.url, named.url);
      assert.equal(await (await target.storage.read(generated.url)).text(), "server named");
    },
  },
  {
    id: "SC-RW-etag",
    requires: [],
    async run(target) {
      const parent = await container(target, "rw-etag");
      const item = await text(target.storage, parent);
      const before = await etag(target.storage, item.url);
      assert.equal(item.etag, before);
      const written = await target.storage.write(item.url, "updated", {
        contentType: "text/plain",
        ifMatch: before,
      });
      assert.equal(written.created, false);
      assert.notEqual(written.etag, before);
      assert.equal(written.etag, await etag(target.storage, item.url));
      await expectStorageError(
        target.storage.write(item.url, "lost update", {
          contentType: "text/plain",
          ifMatch: before,
        }),
        "precondition-failed",
        412,
      );
      assert.equal(await (await target.storage.read(item.url)).text(), "updated");
      const cached = await target.storage.read(item.url, { ifNoneMatch: written.etag as string });
      assert.equal(cached.status, 304);
      assert.equal(cached.body, null);
    },
  },
  {
    id: "SC-RW-wildcard",
    requires: [],
    async run(target) {
      const parent = await container(target, "rw-wildcard");
      const item = await text(target.storage, parent);
      await target.storage.write(item.url, "wildcard", { contentType: "text/plain", ifMatch: "*" });
      assert.equal(await (await target.storage.read(item.url)).text(), "wildcard");
      const missing = `${parent}missing.txt`;
      if (target.storage.protocol === "lws")
        await expectStorageError(
          target.storage.write(missing, "", { contentType: "text/plain", ifMatch: "*" }),
          "not-found",
          404,
        );
      else {
        assert.equal(
          (
            await target.storage.write(missing, "created", {
              contentType: "text/plain",
              ifMatch: "*",
            })
          ).created,
          true,
        );
        assert.equal(await (await target.storage.read(missing)).text(), "created");
      }
    },
  },
  {
    id: "SC-RW-range-head-binary",
    requires: [],
    async run(target) {
      const parent = await container(target, "rw-binary");
      const bytes = Uint8Array.from([0, 1, 255, 128, 13, 10, 42, 0]);
      const item = await target.storage.create(parent, bytes, {
        name: "bytes.bin",
        contentType: "application/octet-stream",
      });
      const head = await target.storage.head(item.url);
      const read = await target.storage.read(item.url);
      assert.equal(head.body, null);
      for (const key of ["etag", "contentType", "kind", "parent", "metadataUrl"] as const)
        assert.deepEqual(head[key], read[key]);
      assert.deepEqual(head.links, read.links);
      assert.deepEqual(head.lastModified, read.lastModified);
      assert.deepEqual(await read.bytes(), bytes);
      const range = await target.storage.read(item.url, { range: { start: 2, end: 5 } });
      assert.equal(range.status, 206);
      assert.deepEqual(await range.bytes(), bytes.slice(2, 6));
      const tail = await target.storage.read(item.url, { range: { start: 6 } });
      assert.deepEqual(await tail.bytes(), bytes.slice(6));
    },
  },
];

// Fixed synthetic RDF only: inline JSON-LD context, language/datatype literals and blank nodes.
const TURTLE =
  '@prefix ex: <https://example.org/> . ex:subject ex:child [ ex:label "hello"@en ; ex:count 7 ] .';
const JSON_LD = JSON.stringify({
  "@context": { ex: "https://example.org/" },
  "@id": "ex:subject",
  "ex:child": {
    "ex:label": { "@value": "hello", "@language": "en" },
    "ex:count": { "@value": "7", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
  },
});

const rdf: ConformanceCase[] = [
  ...(
    [
      ["turtle", "text/turtle", TURTLE],
      ["jsonld", "application/ld+json", JSON_LD],
    ] as const
  ).map(
    ([label, contentType, body]): ConformanceCase => ({
      id: `SC-RDF-${label}`,
      requires: [],
      async run(target) {
        const parent = await container(target, `rdf-${label}`);
        const item = await target.storage.create(parent, body, {
          name: `graph-${label}`,
          contentType,
        });
        const expected = await parseRdf(TURTLE, "text/turtle");
        const read = await target.storage.readRdf(item.url);
        assertIsomorphic(read.dataset, expected);
        const written = await target.storage.writeRdf(item.url, expected, {
          contentType: "text/turtle",
          ifMatch: await etag(target.storage, item.url),
          prefixes: { renamed: "https://example.org/" },
        });
        assertIsomorphic((await target.storage.readRdf(written.url)).dataset, expected);
        const cached = await target.storage.readRdf(written.url, {
          ifNoneMatch: await etag(target.storage, written.url),
        });
        assert.equal(cached.notModified, true);
        assert.equal(cached.dataset.size, 0);
        // The public SDK explicitly refuses JSON-LD serialization until it has a writer.
        await expectStorageError(
          target.storage.writeRdf(written.url, expected, {
            contentType: "application/ld+json",
            ifMatch: await etag(target.storage, written.url),
          }),
          "unsupported",
        );
      },
    }),
  ),
  {
    id: "SC-RDF-not-rdf",
    requires: [],
    async run(target) {
      const parent = await container(target, "rdf-invalid");
      const plain = await text(target.storage, parent);
      await expectStorageError(target.storage.readRdf(plain.url), "not-rdf");
      const malformed = await target.storage.create(parent, "< invalid turtle", {
        name: "bad.ttl",
        contentType: "text/turtle",
      });
      await expectStorageError(target.storage.readRdf(malformed.url), "not-rdf");
    },
  },
];

const deletion: ConformanceCase[] = [
  {
    id: "SC-DEL-conditional",
    requires: [],
    async run(target) {
      const parent = await container(target, "del-conditional");
      const item = await text(target.storage, parent);
      await expectStorageError(
        target.storage.delete(item.url, { ifMatch: '"stale"' }),
        "precondition-failed",
        412,
      );
      assert.equal(await (await target.storage.read(item.url)).text(), "first draft");
      await target.storage.delete(item.url, { ifMatch: await etag(target.storage, item.url) });
      await expectStorageError(target.storage.read(item.url), "not-found", 404);
      assert.equal((await entries(target.storage, parent)).length, 0);
    },
  },
  {
    id: "SC-DEL-nonempty-recursive",
    requires: [],
    async run(target) {
      const parent = await container(target, "del-nonempty");
      const child = (
        await target.storage.create(parent, null, { name: "nested", kind: "container" })
      ).url;
      const item = await text(target.storage, child);
      await expectStorageError(
        target.storage.delete(parent, { ifMatch: await etag(target.storage, parent) }),
        "conflict",
        409,
      );
      assert.equal(await (await target.storage.read(item.url)).text(), "first draft");
      await target.storage.delete(parent, {
        ifMatch: await etag(target.storage, parent),
        recursive: true,
      });
      for (const url of [parent, child, item.url])
        await expectStorageError(target.storage.head(url), "not-found", 404);
    },
  },
];

const errors: ConformanceCase[] = [
  {
    id: "SC-ERR-input-media",
    requires: [],
    async run(target) {
      const parent = await container(target, "err-input-media");
      const item = await text(target.storage, parent);
      await expectStorageError(
        target.storage.read(item.url, { range: { start: 9999 } }),
        "bad-request",
        416,
      );
      await expectStorageError(
        target.storage.patch(
          item.url,
          { kind: "raw", mediaType: "application/x-storage-conformance-unsupported", body: "" },
          { ifMatch: await etag(target.storage, item.url) },
        ),
        "unsupported-media-type",
        415,
      );
    },
  },
  {
    id: "SC-ERR-common",
    requires: [],
    async run(target) {
      const parent = await container(target, "err-common");
      const item = await text(target.storage, parent);
      await expectStorageError(target.storage.read(`${parent}absent`), "not-found", 404);
      await expectStorageError(target.storage.read("https://foreign.example/secret"), "scope");
      await expectStorageError(
        target.storage.write(parent, "invalid", {
          ifMatch: await etag(target.storage, parent),
          contentType: "text/plain",
        }),
        "method-not-allowed",
        405,
      );
      await expectStorageError(
        target.storage.delete(item.url, { ifMatch: '"outdated"' }),
        "precondition-failed",
        412,
      );
      const aborted = new AbortController();
      aborted.abort();
      await expectStorageError(
        target.storage.read(item.url, { signal: aborted.signal }),
        "network",
      );
      // Every supported target is fixed-owner: impersonation must be refused explicitly.
      await expectStorageError(
        target.authFetchFor("https://identity.example/bob#me"),
        "unsupported",
      );
      assert.equal(await target.authFetchFor(target.webId), target.fetch);
    },
  },
  {
    id: "SC-ERR-move-capability",
    requires: ["move"],
    checks: { move: moveProbe },
    async run(target) {
      assert.equal(await moveProbe(target), true);
    },
  },
];

/** T-080 groups only. Later lanes add PATCH/MOVE/META/CAP/NOTIFY/AUTH/ACCESS/SYNC. */
export const storageCases: readonly ConformanceCase[] = [
  ...[0, 1, 25, 1500].map(listCase),
  listKinds,
  ...rw,
  ...rdf,
  ...deletion,
  ...errors,
];
