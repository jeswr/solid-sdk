// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  capabilities,
  deriveFeatures,
  resolveStorageDescription,
} from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { container, entries, etag, text } from "./case-helpers.js";
import { assertIsomorphic, expectStorageError } from "./testing.js";
import type { ConformanceCase, RunningTarget, SupportProbe } from "./types.js";

const BEFORE = '<https://example.org/item> <https://example.org/label> "before" .';
const AFTER = '<https://example.org/item> <https://example.org/label> "after" .';

async function graph(target: RunningTarget, name?: string) {
  const parent = name
    ? await container(target, name)
    : (await target.storage.create(target.root, null, { kind: "container" })).url;
  return target.storage.create(parent, BEFORE, { name: "graph.ttl", contentType: "text/turtle" });
}

async function rdfChange() {
  return {
    kind: "rdf" as const,
    deletes: [...(await parseRdf(BEFORE, "text/turtle"))],
    inserts: [...(await parseRdf(AFTER, "text/turtle"))],
  };
}

async function beforeRequest(target: RunningTarget, operation: () => Promise<unknown>) {
  const count = target.requestCount?.();
  await operation();
  assert.equal(target.requestCount?.(), count, "Unsupported combination sent an HTTP request");
}

const patchProbe: SupportProbe = async (target) => {
  const item = await graph(target);
  const change = await rdfChange();
  // Solid tries N3 even when discovery is unknown; LWS has baseline JSON + RDF RMW.
  await target.storage.patch(item.url, change, { ifMatch: await etag(target.storage, item.url) });
  assertIsomorphic(
    (await target.storage.readRdf(item.url)).dataset,
    await parseRdf(AFTER, "text/turtle"),
  );
  return true;
};

const patch: ConformanceCase[] = [
  {
    id: "SC-PATCH-rdf",
    requires: ["patch"],
    checks: { patch: patchProbe },
    async run(target) {
      const item = await graph(target, "patch-rdf");
      const before = await etag(target.storage, item.url);
      const result = await target.storage.patch(item.url, await rdfChange(), { ifMatch: before });
      assert.equal(result.created, false);
      assert.notEqual(await etag(target.storage, result.url), before);
      assertIsomorphic(
        (await target.storage.readRdf(result.url)).dataset,
        await parseRdf(AFTER, "text/turtle"),
      );
      await expectStorageError(
        target.storage.patch(item.url, await rdfChange(), { ifMatch: before }),
        "precondition-failed",
        412,
      );
      assertIsomorphic(
        (await target.storage.readRdf(result.url)).dataset,
        await parseRdf(AFTER, "text/turtle"),
      );
    },
  },
  {
    id: "SC-PATCH-json",
    requires: ["patch"],
    checks: { patch: patchProbe },
    async run(target) {
      const parent = await container(target, "patch-json");
      const item = await target.storage.create(parent, '{"label":"before"}', {
        name: "data.json",
        contentType: "application/json",
      });
      const options = { ifMatch: await etag(target.storage, item.url) };
      const change = {
        kind: "json" as const,
        ops: [{ op: "replace" as const, path: "/label", value: "after" }],
      };
      const advertised = Object.values(target.storage.features.patch.detail.formats).some(
        (formats) => formats.includes("application/json-patch+json"),
      );
      if (!advertised) {
        await beforeRequest(target, () =>
          expectStorageError(target.storage.patch(item.url, change, options), "unsupported"),
        );
        // Independently exercise the server: an unadvertised working format is a failure.
        const response = await target.fetch(item.url, {
          method: "PATCH",
          redirect: "manual",
          headers: { "Content-Type": "application/json-patch+json", "If-Match": options.ifMatch },
          body: JSON.stringify(change.ops),
        });
        await response.body?.cancel();
        assert(!response.ok, "advertisement-missing:patch-json");
        assert(
          [400, 405, 415, 422].includes(response.status),
          "Unexpected JSON Patch absence response",
        );
        assert.deepEqual(JSON.parse(await (await target.storage.read(item.url)).text()), {
          label: "before",
        });
        return;
      }
      await target.storage.patch(item.url, change, options);
      assert.deepEqual(JSON.parse(await (await target.storage.read(item.url)).text()), {
        label: "after",
      });
    },
  },
  {
    id: "SC-PATCH-where",
    requires: ["patch"],
    checks: { patch: patchProbe },
    async run(target) {
      const item = await graph(target, "patch-where");
      const change = await rdfChange();
      const options = { ifMatch: await etag(target.storage, item.url) };
      const patch = { ...change, where: change.deletes };
      if (
        target.resolveFeatures ||
        target.storage.protocol === "lws" ||
        !target.storage.features.patch.detail.formats["text/turtle"]?.includes("text/n3")
      ) {
        await beforeRequest(target, () =>
          expectStorageError(target.storage.patch(item.url, patch, options), "unsupported"),
        );
        assertIsomorphic(
          (await target.storage.readRdf(item.url)).dataset,
          await parseRdf(BEFORE, "text/turtle"),
        );
      } else {
        await target.storage.patch(item.url, patch, options);
        assertIsomorphic(
          (await target.storage.readRdf(item.url)).dataset,
          await parseRdf(AFTER, "text/turtle"),
        );
        // A where formula with no matching solution must fail without changing content.
        await expectStorageError(
          target.storage.patch(item.url, patch, { ifMatch: await etag(target.storage, item.url) }),
          "conflict",
          target.resolveFeatures ? 409 : undefined,
        );
        assertIsomorphic(
          (await target.storage.readRdf(item.url)).dataset,
          await parseRdf(AFTER, "text/turtle"),
        );
      }
    },
  },
];

function moveCases(moveProbe: SupportProbe): ConformanceCase[] {
  return [
    {
      id: "SC-MOVE-resource",
      requires: ["move"],
      checks: { move: moveProbe },
      async run(target) {
        const parent = await container(target, "move-source");
        const destination = await container(target, "move-destination");
        const item = await text(target.storage, parent);
        await expectStorageError(
          target.storage.move(item.url, destination, { ifMatch: '"stale"' }),
          "precondition-failed",
          412,
        );
        assert.equal((await entries(target.storage, destination)).length, 0);
        const moved = await target.storage.move(item.url, destination, {
          name: "moved.txt",
          ifMatch: await etag(target.storage, item.url),
        });
        const detail = target.storage.features.move.detail;
        assert.equal(detail.native, target.storage.protocol === "lws");
        if (detail.preservesIdentifier !== null)
          assert.equal(moved.url === item.url, detail.preservesIdentifier);
        if (!detail.native) assert.equal(moved.url, `${destination}moved.txt`);
        assert.equal(await (await target.storage.read(moved.url)).text(), "first draft");
        assert.equal(await target.storage.parentOf(moved.url), destination);
        assert.equal((await entries(target.storage, parent)).length, 0);
        if (moved.url !== item.url)
          await expectStorageError(target.storage.head(item.url), "not-found", 404);
      },
    },
    {
      id: "SC-MOVE-container-cycle",
      requires: ["move"],
      checks: { move: moveProbe },
      async run(target) {
        const parent = await container(target, "move-tree");
        const child = (
          await target.storage.create(parent, null, { name: "child", kind: "container" })
        ).url;
        const item = await text(target.storage, child);
        const destination = await container(target, "move-tree-destination");
        if (!target.storage.features.move.detail.containers) {
          await expectStorageError(
            target.storage.move(parent, destination, {
              ifMatch: await etag(target.storage, parent),
            }),
            "unsupported",
          );
          return;
        }
        const cycle = await expectStorageError(
          target.storage.move(parent, child, { ifMatch: await etag(target.storage, parent) }),
          "conflict",
        );
        assert(cycle.status === null || cycle.status === 409);
        assert.equal(await (await target.storage.read(item.url)).text(), "first draft");
        const moved = await target.storage.move(parent, destination, {
          name: "tree",
          ifMatch: await etag(target.storage, parent),
        });
        const children = await entries(target.storage, moved.url);
        assert.equal(children.length, 1);
        const movedChild = children[0];
        assert(movedChild);
        assert.equal(movedChild.kind, "container");
        const members = await entries(target.storage, movedChild.url);
        assert.equal(members.length, 1);
        const member = members[0];
        assert(member);
        assert.equal(await (await target.storage.read(member.url)).text(), "first draft");
        if (moved.url !== parent)
          await expectStorageError(target.storage.head(parent), "not-found", 404);
      },
    },
  ];
}

const metadata: ConformanceCase = {
  id: "SC-META-links",
  requires: [],
  async run(target) {
    const parent = await container(target, "meta-links");
    const item = await text(target.storage, parent);
    const head = await target.storage.head(item.url);
    assert.equal(head.parent, parent);
    assert.equal(await target.storage.parentOf(item.url), parent);
    if (target.storage.protocol === "lws") assert.equal(head.links.get("up")?.[0]?.target, parent);
    if (!head.metadataUrl) {
      await expectStorageError(target.storage.metadata(item.url), "unsupported");
      await expectStorageError(
        target.storage.setMetadata(item.url, [], { ifMatch: '"unused"' }),
        "unsupported",
      );
      return;
    }
    const current = await target.storage.metadata(item.url);
    assert.equal(current.url, head.metadataUrl);
    const rel = "https://example.org/custom-relation";
    const href = "https://example.org/related";
    const ops = [{ op: "add" as const, rel, href }];
    // CSS 7 synthesizes .meta without a validator. The SDK must refuse to invent one.
    if (current.etag === null) {
      assert.equal(target.storage.protocol, "solid", "LWS metadata needs its own validator");
      const failure = await expectStorageError(
        target.storage.setMetadata(item.url, ops, { ifMatch: '"missing-metadata-validator"' }),
        "precondition-failed",
        412,
      );
      assert.equal(failure.etag, null);
      assert.equal(await (await target.storage.read(item.url)).text(), "first draft");
      return;
    }
    await expectStorageError(
      target.storage.setMetadata(item.url, ops, { ifMatch: '"stale"' }),
      "precondition-failed",
      412,
    );
    if (target.storage.protocol === "lws") {
      assert.equal(current.links.get(item.url)?.get("up")?.[0]?.href, parent);
      for (const rel of ["up", "type", "linkset"])
        await expectStorageError(
          target.storage.setMetadata(item.url, [{ op: "add", rel, href }], {
            ifMatch: current.etag,
          }),
          "unsupported",
        );
    }
    await target.storage.setMetadata(item.url, ops, { ifMatch: current.etag });
    const added = await target.storage.metadata(item.url);
    assert(
      added.links
        .get(item.url)
        ?.get(rel)
        ?.some((link) => link.href === href),
    );
    assert(added.etag);
    await target.storage.setMetadata(item.url, [{ op: "remove", rel, href }], {
      ifMatch: added.etag,
    });
    const removed = await target.storage.metadata(item.url);
    assert(
      !removed.links
        .get(item.url)
        ?.get(rel)
        ?.some((link) => link.href === href),
    );
    assert.equal(await (await target.storage.read(item.url)).text(), "first draft");
  },
};

const discovery: ConformanceCase = {
  id: "SC-CAP-discovery-cache",
  requires: [],
  async run(target) {
    if (target.resolveFeatures) {
      assert.equal((await target.resolveFeatures()).protocol, target.storage.protocol);
      return;
    }
    const requests: string[] = [];
    const transport: typeof fetch = (input, init) => {
      requests.push(new Request(input, init).method);
      return target.fetch(input, init);
    };
    const cache = createMemoryCache();
    const description = await resolveStorageDescription(target.root, { fetch: transport, cache });
    assert.equal(description.root, target.root);
    assert.equal(description.protocol, target.storage.protocol);
    const before = requests.length;
    await capabilities(target.root, { fetch: transport, cache });
    const declared = deriveFeatures(description);
    if (
      description.protocol === "solid" &&
      (declared.patch.state === "unknown" || declared.accessControl.state === "unknown")
    ) {
      assert.equal(requests[before], "OPTIONS", "Incomplete Solid descriptions must probe CSS");
      assert(requests.length > before);
    } else {
      assert(description.descriptionUrl, "Advertised description must have a document URL");
      assert.equal(requests.length, before, "An authoritative description must need zero probes");
    }
    const after = requests.length;
    await capabilities(target.root, { fetch: transport, cache });
    assert.equal(requests.length, after, "Fresh discovery must use the cached probes");
  },
};

/** T-081 groups share the same public SDK scenarios across memory and HTTP targets. */
export function extendedCases(moveProbe: SupportProbe): readonly ConformanceCase[] {
  return [...patch, ...moveCases(moveProbe), metadata, discovery];
}
