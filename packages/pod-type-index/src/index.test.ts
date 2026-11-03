// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it, vi } from "vitest";
import { createTypeIndex } from "./index.js";

const ROOT = "https://pod.example/alice/";
const WEBID = `${ROOT}profile/card#me`;
const CLASS = `${NS.POD_DOCS}Document`;
const LOCATION = { container: `${ROOT}documents/` };

async function setup() {
  const storage = createMemoryStorage({ root: ROOT });
  await storage.write(`${ROOT}profile/card`, `<${WEBID}> <${NS.FOAF}name> "Alice".`, {
    contentType: "text/turtle",
    ifMatch: "*",
  });
  return {
    storage,
    index: createTypeIndex({ storage, features: storage.features, profile: WEBID }),
  };
}

describe("Solid Type Index", () => {
  it("bootstraps private preferences/index, preserves profile, and registers idempotently", async () => {
    const { storage, index } = await setup();
    await index.register(CLASS, LOCATION);
    expect(await index.find(CLASS)).toEqual([LOCATION.container]);
    const profile = await storage.readRdf(`${ROOT}profile/card`);
    expect([...profile.dataset].map((q) => q.predicate.value)).toContain(
      `${NS.PIM}preferencesFile`,
    );
    expect(await (await storage.read(`${ROOT}profile/card`)).text()).toContain("Alice");
    expect(await (await storage.read(`${ROOT}settings/privateTypeIndex.ttl`)).text()).toContain(
      "UnlistedDocument",
    );
    const write = vi.spyOn(storage, "writeRdf");
    const create = vi.spyOn(storage, "create");
    await index.register(CLASS, LOCATION);
    expect(write).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("batches both indexes once, resolves aliases, de-duplicates and unregisters exactly", async () => {
    const { storage, index } = await setup();
    await index.register(CLASS, LOCATION);
    await index.register(CLASS, { instance: `${ROOT}one.ttl` }, { index: "public" });
    await index.register(`${NS.TASK}Task`, LOCATION);
    const read = vi.spyOn(storage, "readRdf");
    expect(await index.findAll([CLASS, `${NS.TASK}Task`, "urn:absent"])).toEqual(
      new Map([
        [CLASS, [LOCATION.container, `${ROOT}one.ttl`]],
        [`${NS.TASK}Task`, [LOCATION.container]],
        ["urn:absent", []],
      ]),
    );
    expect(read.mock.calls.map(([url]) => url).sort()).toEqual(
      [
        `${ROOT}profile/card`,
        `${ROOT}settings/prefs.ttl`,
        `${ROOT}settings/privateTypeIndex.ttl`,
        `${ROOT}settings/publicTypeIndex.ttl`,
      ].sort(),
    );
    await index.unregister(CLASS, LOCATION);
    await index.unregister(CLASS, LOCATION);
    expect(await index.find(CLASS)).toEqual([`${ROOT}one.ttl`]);
    expect(await index.find(`${NS.TASK}Task`)).toEqual([LOCATION.container]);
  });
});
