// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { bob, fixture, manager, memoryAccess, owner, root } from "../../test/roles-helpers.js";
import { serialize } from "../rdf.js";
import {
  isSealed,
  readAccessModes,
  sealAccess,
  sealDataset,
  setGrants,
  unsealAccess,
} from "./index.js";
import { properties } from "./rdf.js";

const folder = `${root}settings/`;
const acl = `${folder}.acl`;
const SEALED_BY = "https://jeswr.org/ns/pod-access#sealedBy";

async function sealedFixture(webId = owner) {
  const dataset = new Store(
    await parseRdf(await fixture("wac", folder, [manager], true), "text/turtle", { baseIRI: acl }),
  );
  sealDataset(dataset, acl, webId);
  return serialize(dataset);
}
async function aclDataset(body: string) {
  return new Store(await parseRdf(body, "text/turtle", { baseIRI: acl }));
}
const seals = (dataset: Store) =>
  dataset.getQuads(acl, SEALED_BY, null, null).map((quad) => quad.object.value);

describe("access seals", () => {
  it("seals an own access document conditionally, keeping its policy", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await fixture("wac", folder, [manager], true));
    const options = { ...mem.options, kind: "folder" as const, webId: owner };
    const before = await readAccessModes(folder, options);
    expect(await isSealed(folder, options)).toBe(false);
    await sealAccess(folder, options);
    expect(await isSealed(folder, options)).toBe(true);
    const put = mem.writes()[0];
    expect(put?.url).toBe(acl);
    expect(new Headers(put?.init.headers).get("if-match")).toBe('"1"');
    // The policy is unchanged; only the seal statement was added.
    expect((await readAccessModes(folder, options)).members).toEqual(before.members);
    expect(seals(await aclDataset(mem.docs.get(acl)?.body ?? ""))).toEqual([owner]);
    // Sealing twice writes nothing more.
    await sealAccess(folder, options);
    expect(mem.writes()).toHaveLength(1);
  });
  it("counts only the caller's seal, and only on the resource's own document", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await sealedFixture(bob));
    const options = { ...mem.options, kind: "folder" as const, webId: owner };
    expect(await isSealed(folder, options)).toBe(false);
    expect(await isSealed(folder, { ...options, webId: bob })).toBe(true);
    // A child inherits its folder's sealed document, but an inherited seal never counts.
    const child = `${folder}state.json`;
    mem.advertise(child);
    expect(await isSealed(child, { ...options, kind: "file", webId: bob })).toBe(false);
  });
  it("ignores a seal statement about another subject or with a literal value", async () => {
    const mem = memoryAccess();
    const dataset = await aclDataset(await fixture("wac", folder, [manager], true));
    sealDataset(dataset, `${acl}#other`, owner);
    properties(DataFactory.namedNode(acl), dataset)
      .terms(SEALED_BY)
      .add(DataFactory.literal(owner));
    mem.attach(folder, await serialize(dataset));
    const options = { ...mem.options, kind: "folder" as const, webId: owner };
    expect(await isSealed(folder, options)).toBe(false);
  });
  it("survives a role edit, so a seal must be removed before access widens", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await sealedFixture());
    const options = { ...mem.options, kind: "folder" as const, webId: owner };
    const viewer = { agent: { type: "webid" as const, id: bob }, role: "viewer" as const };
    const result = await setGrants(
      [folder],
      [manager, { ...viewer, inherited: false, source: "" }],
      options,
    );
    expect(result.failed).toEqual([]);
    expect(await isSealed(folder, options)).toBe(true);
  });
  it("unseals, keeping the rest of the document, and is a no-op when nothing is sealed", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await sealedFixture());
    const options = { ...mem.options, kind: "folder" as const, webId: owner };
    await unsealAccess(folder, options);
    expect(await isSealed(folder, options)).toBe(false);
    expect((await readAccessModes(folder, options)).members).toEqual([
      { agent: { type: "webid", id: owner }, modes: ["append", "control", "read", "write"] },
    ]);
    const writes = mem.writes().length;
    await unsealAccess(folder, options);
    expect(mem.writes()).toHaveLength(writes);
    // A resource with no own document has nothing to unseal.
    const bare = `${root}bare/`;
    mem.advertise(bare);
    await unsealAccess(bare, { ...options, kind: "folder" });
    expect(mem.writes()).toHaveLength(writes);
  });
  it("refuses to seal a resource that has no own access document", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await fixture("wac", folder, [manager], true));
    const child = `${folder}state.json`;
    mem.advertise(child);
    await expect(
      sealAccess(child, { ...mem.options, kind: "file", webId: owner }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(mem.writes()).toEqual([]);
  });
  it.each([
    ["no", null],
    ["a malformed", "unquoted"],
  ])("refuses to change a seal on a document with %s ETag", async (_label, etag) => {
    const mem = memoryAccess();
    mem.attach(folder);
    mem.put(acl, await fixture("wac", folder, [manager], true), etag);
    const options = { ...mem.options, kind: "folder" as const, webId: owner };
    await expect(sealAccess(folder, options)).rejects.toMatchObject({
      code: "precondition-required",
    });
    expect(mem.writes()).toEqual([]);
  });
  it("fails, writing nothing, when the access document changed since it was read", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await fixture("wac", folder, [manager], true));
    mem.intercept((url, init) => {
      if (url === acl && init.method === "PUT") return new Response(null, { status: 412 });
      return undefined;
    });
    await expect(
      sealAccess(folder, { ...mem.options, kind: "folder", webId: owner }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await isSealed(folder, { ...mem.options, kind: "folder", webId: owner })).toBe(false);
  });
});
