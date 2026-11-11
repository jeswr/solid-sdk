// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { container, etag } from "./case-helpers.js";
import { serviceAbsent } from "./optional-cases.js";
import { expectStorageError } from "./testing.js";
import type { ConformanceCase, SupportProbe } from "./types.js";

const NOTE = "https://example.org/ConformanceNote";
const OTHER = "https://example.org/ConformanceOther";

const typeIndexProbe: SupportProbe = async (target) => {
  if (target.storage.protocol === "solid") return true;
  const endpoint = target.serviceEndpoints?.typeSearch;
  assert(endpoint && target.storage.isWithinStorage(endpoint), "Missing TypeSearch probe route");
  const response = await target.fetch(endpoint, {
    method: "QUERY",
    redirect: "manual",
    headers: { Accept: "application/lws+json", "Content-Type": "application/lws-query+json" },
    body: JSON.stringify({ type: [[NOTE]] }),
  });
  await response.body?.cancel();
  return response.ok ? true : serviceAbsent(response.status);
};

const typeIndex: ConformanceCase = {
  id: "SC-TYPEINDEX-register-find",
  requires: ["typeIndex"],
  checks: { typeIndex: typeIndexProbe },
  async run(target) {
    const parent = await container(target, "typeindex-register-find");
    // A disposable profile keeps registration independent of the target owner's profile.
    const profile = await target.storage.create(parent, "", {
      name: "profile.ttl",
      contentType: "text/turtle",
    });
    const index = createTypeIndex({
      storage: target.storage,
      features: target.storage.features,
      profile: `${profile.url}#me`,
      fetch: target.fetch,
    });
    const hint = await index.register(NOTE, { container: parent });
    if (target.storage.protocol === "lws") {
      assert.deepEqual(hint, { links: [{ rel: "type", target: NOTE }] });
      const item = await target.storage.create(parent, "typed", {
        contentType: "text/plain",
        ...hint,
      });
      // The LWS adapter must send QUERY to TypeSearch, rather than crawling containers.
      const found = await index.findAll([NOTE, OTHER]);
      assert(found.get(NOTE)?.includes(item.url));
      assert(!found.get(OTHER)?.includes(item.url));
      assert((await index.find(NOTE)).includes(item.url));
      assert((await index.listClasses()).includes(NOTE));
      await target.storage.delete(item.url, { ifMatch: await etag(target.storage, item.url) });
      assert(!(await index.find(NOTE)).includes(item.url));
      return;
    }
    assert.equal(hint, undefined);
    await index.register(NOTE, { container: parent });
    assert.equal((await index.find(NOTE)).filter((url) => url === parent).length, 1);
    const item = await target.storage.create(parent, "instance", { contentType: "text/plain" });
    await index.register(OTHER, { instance: item.url }, { index: "public" });
    const found = await index.findAll([NOTE, OTHER]);
    assert(found.get(NOTE)?.includes(parent));
    assert(found.get(OTHER)?.includes(item.url));
    await index.unregister(NOTE, { container: parent });
    assert(!(await index.find(NOTE)).includes(parent));
    assert((await index.find(OTHER)).includes(item.url));
    await index.unregister(OTHER, { instance: item.url }, { index: "public" });
    assert(!(await index.find(OTHER)).includes(item.url));
  },
};

const preferences: ConformanceCase = {
  id: "SC-PREFS-create-update-412",
  requires: [],
  async run(target) {
    const parent = await container(target, "prefs-create-update");
    const initial = { version: 1, apps: { drive: { view: "grid" } }, theme: "system" };
    const updated = { ...initial, theme: "dark" };
    const item = await target.storage.create(parent, JSON.stringify(initial), {
      name: "preferences.json",
      contentType: "application/json",
    });
    const read = await target.storage.read(item.url);
    assert.equal(read.contentType, "application/json");
    assert.deepEqual(JSON.parse(await read.text()), initial);
    assert(read.etag);
    // Solid exact-name creation is PUT If-None-Match:*. LWS creates opaque identities by POST.
    if (target.storage.protocol === "solid") {
      await expectStorageError(
        target.storage.create(parent, "{}", {
          name: "preferences.json",
          contentType: "application/json",
        }),
        "conflict",
      );
    }
    const result = await target.storage.write(item.url, JSON.stringify(updated), {
      ifMatch: read.etag,
      contentType: "application/json",
    });
    assert.notEqual(result.etag, read.etag);
    await expectStorageError(
      target.storage.write(item.url, JSON.stringify(initial), {
        ifMatch: read.etag,
        contentType: "application/json",
      }),
      "precondition-failed",
      412,
    );
    const current = await target.storage.read(item.url);
    assert.equal(current.etag, result.etag);
    assert.equal(current.contentType, "application/json");
    assert.deepEqual(JSON.parse(await current.text()), updated);
  },
};

/** App discovery and conditional JSON preferences use the same cases on each protocol. */
export const appCases: readonly ConformanceCase[] = [typeIndex, preferences];
