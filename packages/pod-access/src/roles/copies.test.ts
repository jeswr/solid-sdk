// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { bob, memoryAccess, owner, required, root } from "../../test/roles-helpers.js";
import { ACL } from "../rdf.js";
import { addGrant, isRoleError, readGrants, removeCopiedGrants, removeGrant } from "./index.js";
import { MATERIALIZED_FROM, properties } from "./rdf.js";

const folder = `${root}notes/`;
const file = `${folder}a.ttl`;
const sub = `${folder}sub/`;
const nested = `${sub}x.ttl`;
const carol = "https://carol.example/#me";
const dave = "https://dave.example/#me";
const bobRef = { type: "webid", id: bob } as const;

function acl(rules: string): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n${rules}`;
}
function rule(name: string, agents: string[], modes: string, members = true, target = "./") {
  return `<#${name}> a acl:Authorization; ${agents.map((a) => `acl:agent <${a}>`).join("; ")}; acl:accessTo <${target}>; ${members ? `acl:default <${target}>; ` : ""}acl:mode ${modes}.\n`;
}
const ownerRule = rule("owner", [owner], "acl:Read, acl:Write, acl:Control");
function listing(...members: string[]) {
  return `<> <http://www.w3.org/ns/ldp#contains> ${members.map((m) => `<${m}>`).join(", ")}.`;
}

/** A folder sharing Read with Bob (folder and members), and its listing. */
function setup(folderAcl = acl(ownerRule + rule("bob", [bob], "acl:Read"))) {
  const mem = memoryAccess("wac");
  mem.attach(folder, folderAcl);
  mem.put(folder, listing("a.ttl", "sub/"));
  mem.advertise(file);
  mem.advertise(sub);
  mem.put(sub, listing("x.ttl"));
  mem.advertise(nested);
  const options = { ...mem.options, webId: owner };
  return { mem, options };
}
/** Share a place with Carol, which makes the roles layer copy the inherited rules into it. */
async function shareWithCarol(
  options: ReturnType<typeof setup>["options"],
  url: string,
  id = carol,
) {
  const kind = url.endsWith("/") ? ("folder" as const) : ("resource" as const);
  const result = await addGrant(
    [url],
    { agent: { type: "webid", id }, role: "viewer", inherited: false, source: "" },
    { ...options, kind },
  );
  expect(result.failed).toEqual([]);
}
async function agentsOn(mem: ReturnType<typeof setup>["mem"], url: string) {
  const dataset = await parseRdf(required(mem.docs.get(`${url}.acl`)).body, "text/turtle", {
    baseIRI: `${url}.acl`,
  });
  return [...new AclResource(dataset, DataFactory).authorizations]
    .flatMap((auth) => [...properties(auth, dataset).iris(`${ACL}agent`)])
    .sort();
}

describe("removeCopiedGrants", () => {
  it("takes a revoked folder grant's copies off files and nested folders, keeping everyone else", async () => {
    const { mem, options } = setup();
    for (const url of [file, sub]) await shareWithCarol(options, url);
    // Carol already reads the nested file through the sub-folder, so share it with Dave.
    await shareWithCarol(options, nested, dave);
    expect(await agentsOn(mem, file)).toEqual([bob, owner, carol].sort());
    expect(await agentsOn(mem, nested)).toEqual([bob, owner, carol, dave].sort());
    // The bug: removing Bob at the folder leaves his copied Read on every child.
    const folderOptions = { ...options, kind: "folder" as const };
    expect((await removeGrant([folder], bobRef, folderOptions)).failed).toEqual([]);
    const before = await readGrants(file, options);
    expect(before.grants.some((g) => g.agent.type === "webid" && g.agent.id === bob)).toBe(true);

    const result = await removeCopiedGrants(folder, bobRef, {
      ...options,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      model: "wac",
      removed: [file, sub, nested],
      remaining: [],
      failed: [],
      incomplete: false,
    });
    for (const url of [file, sub]) expect(await agentsOn(mem, url)).toEqual([owner, carol].sort());
    expect(await agentsOn(mem, nested)).toEqual([owner, carol, dave].sort());
    for (const write of mem.writes().slice(-3))
      expect(new Headers(write.init.headers).get("if-match")).toMatch(/^"\d+"$/);
    // A replay finds nothing left to remove and writes nothing.
    const writes = mem.writes().length;
    expect((await removeCopiedGrants(folder, bobRef, options)).removed).toEqual([]);
    expect(mem.writes()).toHaveLength(writes);
  });

  it("keeps copies while the folder still grants the agent, and reports them", async () => {
    const { mem, options } = setup();
    await shareWithCarol(options, file);
    const writes = mem.writes().length;
    const result = await removeCopiedGrants(folder, bobRef, { ...options, root: undefined });
    expect(result.removed).toEqual([]);
    expect(result.remaining).toEqual([folder, file]);
    expect(mem.writes()).toHaveLength(writes);
  });

  it("reports a folder that grants the agent only on itself", async () => {
    const { options } = setup(acl(ownerRule + rule("bob", [bob], "acl:Read", false)));
    expect((await removeCopiedGrants(folder, bobRef, options)).remaining).toEqual([folder]);
  });

  it("leaves rules held directly, copies from outside the folder, and other principals on a copy", async () => {
    const { mem, options } = setup(acl(ownerRule));
    const outside = `${root}.acl`;
    mem.put(
      `${file}.acl`,
      acl(
        `${rule("owner", [owner], "acl:Read, acl:Write, acl:Control", false, "a.ttl")}` +
          `<#shared> a acl:Authorization; acl:agent <${bob}>, <${dave}>; acl:accessTo <a.ttl>; acl:mode acl:Read; <${MATERIALIZED_FROM}> <${folder}.acl>.\n` +
          `<#outside> a acl:Authorization; acl:agent <${bob}>; acl:accessTo <a.ttl>; acl:mode acl:Write; <${MATERIALIZED_FROM}> <${outside}>.\n`,
      ),
    );
    mem.put(
      `${sub}.acl`,
      acl(
        `${ownerRule}${rule("direct", [bob], "acl:Read")}<#noagent> a acl:Authorization; acl:accessTo <./>; <${MATERIALIZED_FROM}> <${folder}.acl>.\n`,
      ),
    );
    // Sub-folder's own direct grant keeps its children's copies of it.
    mem.put(
      `${nested}.acl`,
      acl(
        `${rule("owner", [owner], "acl:Read, acl:Write, acl:Control", false, "x.ttl")}` +
          `<#copy> a acl:Authorization; acl:agent <${bob}>; acl:accessTo <x.ttl>; acl:mode acl:Read; <${MATERIALIZED_FROM}> <${sub}.acl>.\n`,
      ),
    );
    const result = await removeCopiedGrants(folder, bobRef, options);
    expect(result.removed).toEqual([file]);
    expect(result.remaining).toEqual([file, sub, nested]);
    expect(result.failed).toEqual([]);
    expect(await agentsOn(mem, file)).toEqual([bob, owner, dave].sort());
    expect(await agentsOn(mem, nested)).toEqual([bob, owner].sort());
  });

  it("walks a folder that inherits, and skips access documents in listings", async () => {
    const mem = memoryAccess("wac");
    mem.attach(root, acl(ownerRule));
    mem.advertise(folder);
    mem.put(folder, listing("a.ttl", "a.ttl.acl"));
    mem.advertise(file);
    mem.put(
      `${file}.acl`,
      acl(
        `${rule("owner", [owner], "acl:Read, acl:Write, acl:Control", false, "a.ttl")}` +
          `<#copy> a acl:Authorization; acl:agent <${bob}>; acl:accessTo <a.ttl>; acl:mode acl:Read; <${MATERIALIZED_FROM}> <${root}.acl>.\n`,
      ),
    );
    const result = await removeCopiedGrants(folder, bobRef, { ...mem.options, webId: owner });
    expect(result).toMatchObject({ removed: [], remaining: [file], incomplete: false });
    expect(mem.calls.some((c) => c.url === `${file}.acl.acl`)).toBe(false);
  });

  it("does not walk an ACP folder, which never copies rules", async () => {
    const mem = memoryAccess("acp");
    mem.attach(
      folder,
      `@prefix acp: <http://www.w3.org/ns/solid/acp#>. <> acp:resource <./>; acp:accessControl [ acp:apply [ acp:allow <http://www.w3.org/ns/auth/acl#Read>; acp:allOf [ acp:agent <${owner}> ] ] ].`,
    );
    const result = await removeCopiedGrants(folder, bobRef, { ...mem.options, webId: owner });
    expect(result).toEqual({
      model: "acp",
      removed: [],
      remaining: [],
      failed: [],
      incomplete: false,
    });
    expect(mem.calls.some((c) => c.url === folder && c.init.method !== "HEAD")).toBe(false);
  });

  it("refuses a non-folder, the caller's own WebID, and a URL outside the root", async () => {
    const { options } = setup();
    for (const [url, agent, code] of [
      [file, bobRef, "unsupported"],
      [folder, { type: "webid", id: owner }, "owner-lockout"],
      [folder, { type: "public" }, "unsupported"],
      ["https://elsewhere.example/notes/", bobRef, "scope"],
    ] as const) {
      const error = await removeCopiedGrants(url, agent, options).catch((e: unknown) => e);
      expect(isRoleError(error) && error.code).toBe(code);
    }
  });

  it("reports unreadable listings and places, and keeps walking", async () => {
    const { mem, options } = setup();
    await shareWithCarol(options, file);
    await removeGrant([folder], bobRef, { ...options, kind: "folder" });
    mem.intercept((url, init) => {
      if (url === sub && init.method === "HEAD") return new Response(null, { status: 500 });
      if (url === sub && init.method !== "HEAD") return new Response(null, { status: 403 });
      return undefined;
    });
    const result = await removeCopiedGrants(folder, bobRef, options);
    expect(result.removed).toEqual([file]);
    expect(result.failed.map((f) => f.url)).toEqual([sub, sub]);
    expect(result.incomplete).toBe(true);
  });

  it("marks a listing with unusable members, or an empty body, as incomplete", async () => {
    const { mem, options } = setup();
    mem.put(folder, listing("a.ttl", "https://elsewhere.example/x"));
    expect((await removeCopiedGrants(folder, bobRef, options)).incomplete).toBe(true);
    mem.intercept((url, init) =>
      url === folder && init.method !== "HEAD"
        ? new Response(null, { status: 200, headers: { "content-type": "text/turtle" } })
        : undefined,
    );
    const controller = new AbortController();
    expect(
      await removeCopiedGrants(folder, bobRef, { ...options, signal: controller.signal }),
    ).toMatchObject({ incomplete: true, removed: [] });
  });

  it("loads each place once and skips listed members that are not direct children", async () => {
    const { mem, options } = setup();
    mem.put(folder, listing("a.ttl", "a.ttl", "sub/x.ttl", "sub/"));
    const result = await removeCopiedGrants(folder, bobRef, options);
    expect(result.incomplete).toBe(true);
    const heads = mem.calls.filter((c) => c.url === nested && c.init.method === "HEAD");
    // Once as sub/'s member (its own read only), never as a deeper entry of the folder's listing.
    expect(heads).toHaveLength(1);
    expect(mem.calls.filter((c) => c.url === file && c.init.method === "HEAD")).toHaveLength(1);
  });

  it("keeps a copy of a copy while a nearer source still grants it", async () => {
    const { mem, options } = setup();
    await shareWithCarol(options, sub);
    await shareWithCarol(options, nested, dave);
    // Bob is then made an editor on sub/ directly, and the folder approval is revoked.
    const folderOptions = { ...options, kind: "folder" as const };
    await addGrant(
      [sub],
      { agent: bobRef, role: "editor", inherited: false, source: "" },
      folderOptions,
    );
    await removeGrant([folder], bobRef, folderOptions);
    const result = await removeCopiedGrants(folder, bobRef, options);
    expect(result.removed).toEqual([]);
    expect(result.remaining).toEqual([sub, nested]);
    expect(await agentsOn(mem, nested)).toContain(bob);
  });

  it("treats copies from a folder ACL that is gone as stale once nothing reaches the agent", async () => {
    const { mem, options } = setup();
    await shareWithCarol(options, sub);
    await shareWithCarol(options, nested, dave);
    await removeGrant([folder], bobRef, { ...options, kind: "folder" });
    // sub/ is reset to inherit: its ACL (the copies' source) is deleted.
    mem.docs.delete(`${sub}.acl`);
    const result = await removeCopiedGrants(folder, bobRef, options);
    expect(result).toMatchObject({ removed: [nested], remaining: [], failed: [] });
    expect(await agentsOn(mem, nested)).toEqual([owner, carol, dave].sort());
  });

  it("keeps copies from a deleted folder ACL while the folder above still grants the agent", async () => {
    const { mem, options } = setup();
    await shareWithCarol(options, sub);
    await shareWithCarol(options, nested, dave);
    mem.docs.delete(`${sub}.acl`);
    const result = await removeCopiedGrants(folder, bobRef, { ...options, root: undefined });
    expect(result).toMatchObject({ removed: [], remaining: [folder, nested] });
  });

  it("is not confused by another person's conditional rule, including for copies of copies", async () => {
    const { mem, options } = setup(acl(ownerRule));
    const app = (target: string) =>
      `<#app> a acl:Authorization; acl:agent <${dave}>; acl:origin <https://app.example>; acl:accessTo <${target}>; acl:mode acl:Read.\n`;
    mem.put(
      `${sub}.acl`,
      acl(
        `${ownerRule}${app("./")}` +
          `<#copy> a acl:Authorization; acl:agent <${bob}>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read; <${MATERIALIZED_FROM}> <${folder}.acl>.\n`,
      ),
    );
    mem.put(
      `${nested}.acl`,
      acl(
        `${rule("owner", [owner], "acl:Read, acl:Write, acl:Control", false, "x.ttl")}${app("x.ttl")}` +
          `<#copy> a acl:Authorization; acl:agent <${bob}>; acl:accessTo <x.ttl>; acl:mode acl:Read; <${MATERIALIZED_FROM}> <${folder}.acl>, <${sub}.acl>.\n`,
      ),
    );
    const result = await removeCopiedGrants(folder, bobRef, options);
    expect(result).toMatchObject({ failed: [], remaining: [], removed: [sub, nested] });
    expect(await agentsOn(mem, nested)).toEqual([owner, dave].sort());
  });

  it("fails, never clears, a place where the agent's own rule is conditional", async () => {
    const { mem, options } = setup(acl(ownerRule));
    mem.put(
      `${sub}.acl`,
      acl(
        `${ownerRule}<#app> a acl:Authorization; acl:agent <${bob}>; acl:origin <https://app.example>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read.\n` +
          `<#copy> a acl:Authorization; acl:agent <${bob}>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read; <${MATERIALIZED_FROM}> <${folder}.acl>.\n`,
      ),
    );
    mem.put(
      `${nested}.acl`,
      acl(
        `${rule("owner", [owner], "acl:Read, acl:Write, acl:Control", false, "x.ttl")}` +
          `<#copy> a acl:Authorization; acl:agent <${bob}>; acl:accessTo <x.ttl>; acl:mode acl:Read; <${MATERIALIZED_FROM}> <${sub}.acl>.\n`,
      ),
    );
    const result = await removeCopiedGrants(folder, bobRef, options);
    expect(result.removed).toEqual([sub]);
    expect(result.failed.map((f) => [f.url, isRoleError(f.error) && f.error.code])).toEqual([
      [sub, "unsupported"],
    ]);
    // sub/'s answer is unknown, so the copy made from it is kept, and the sweep has failed.
    expect(await agentsOn(mem, nested)).toContain(bob);
  });

  it("stops at the resource and depth limits", async () => {
    const { options } = setup();
    expect(
      (await removeCopiedGrants(folder, bobRef, { ...options, maxResources: 1 })).incomplete,
    ).toBe(true);
    const shallow = await removeCopiedGrants(folder, bobRef, { ...options, maxDepth: 0 });
    expect(shallow.incomplete).toBe(true);
  });

  it("stops when aborted", async () => {
    const { options } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      removeCopiedGrants(folder, bobRef, { ...options, signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("refuses a change raced by another writer, a missing ETag, a failed save, and a mixed model", async () => {
    const { mem, options } = setup();
    await shareWithCarol(options, file);
    await shareWithCarol(options, sub);
    await removeGrant([folder], bobRef, { ...options, kind: "folder" });
    let reads = 0;
    mem.intercept((url, init) => {
      if (url === `${file}.acl` && init.method === undefined && ++reads === 2) {
        const doc = required(mem.docs.get(url));
        return new Response(doc.body, {
          headers: { "content-type": "text/turtle", etag: '"race"' },
        });
      }
      if (url === `${sub}.acl` && init.method === "PUT") return new Response(null, { status: 500 });
      return undefined;
    });
    const raced = await removeCopiedGrants(folder, bobRef, options);
    expect(raced.removed).toEqual([]);
    expect(raced.failed.map((f) => [f.url, isRoleError(f.error) && f.error.code])).toEqual([
      [file, "conflict"],
      [sub, "invalid-response"],
    ]);
    // The failed folder's copy source is unknown, so its children are not changed either.
    mem.intercept(() => undefined);
    required(mem.docs.get(`${file}.acl`)).etag = null;
    mem.put(
      `${sub}.acl`,
      `@prefix acp: <http://www.w3.org/ns/solid/acp#>. <> acp:resource <./>; acp:accessControl [ acp:apply [ acp:allow <http://www.w3.org/ns/auth/acl#Read>; acp:allOf [ acp:agent <${owner}> ] ] ].`,
    );
    const refused = await removeCopiedGrants(folder, bobRef, options);
    expect(refused.failed.map((f) => [f.url, isRoleError(f.error) && f.error.code])).toEqual([
      [file, "precondition-required"],
      [sub, "unsupported"],
      // Its place inherits from the ACP document below a WAC folder: mixed models, refused.
      [nested, "invalid-response"],
    ]);
  });
});
