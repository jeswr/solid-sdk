// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { grant, policy } from "../../test/helpers.js";
import { bob, fixture, manager, memoryAccess, owner, root } from "../../test/roles-helpers.js";
import { writeWac } from "../index.js";
import type { Grant, Mode } from "../types.js";
import { isGrantableTarget, readAccessModes, readGrants, setGrants } from "./index.js";

const mallory = "https://mallory.example/#me";
const folder = `${root}groups/`;
const doc = `${folder}team.ttl`;
const rule = (who: Grant["who"], modes: Mode[], appliesTo: Grant["appliesTo"] = "both") =>
  grant(who, { modes: new Set(modes), appliesTo });
/** The review's probe: owner R/W/C, public Read, authenticated Append, mallory Write. */
const probe = (appliesTo: Grant["appliesTo"] = "both") =>
  policy(
    rule([[{ kind: "agent", webId: owner }]], ["read", "write", "control"], appliesTo),
    rule([[{ kind: "public" }]], ["read"], appliesTo),
    rule([[{ kind: "authenticated" }]], ["append"], appliesTo),
    rule([[{ kind: "agent", webId: mallory }]], ["write"], appliesTo),
  );

describe("readAccessModes", () => {
  it("reports principals that readGrants drops because their modes map to no role", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await writeWac(probe(), folder, `${folder}.acl`));
    const options = { ...mem.options, kind: "folder" as const };
    expect((await readGrants(folder, options)).grants.map((g) => g.agent)).toEqual([
      { type: "webid", id: owner },
      { type: "public" },
    ]);
    const modes = await readAccessModes(folder, options);
    const expected = [
      { agent: { type: "webid", id: owner }, modes: ["append", "control", "read", "write"] },
      { agent: { type: "public" }, modes: ["read"] },
      { agent: { type: "authenticated" }, modes: ["append"] },
      { agent: { type: "webid", id: mallory }, modes: ["append", "write"] },
    ];
    expect(modes.resource).toEqual(expected);
    expect(modes.members).toEqual(expected);
    // The token is readGrants' token, so it guards a later setGrants.
    expect(modes.version).toBe((await readGrants(folder, options)).version);
  });
  it("returns a version token that guards setGrants", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await fixture("wac", folder, [manager], true));
    const options = { ...mem.options, kind: "folder" as const, webId: owner };
    const stale = await readAccessModes(folder, options);
    const viewer = { agent: { type: "webid" as const, id: bob }, role: "viewer" as const };
    const grants = [manager, { ...viewer, inherited: false, source: "" }];
    expect(
      (await setGrants([folder], grants, { ...options, expected: { [folder]: stale.version } }))
        .failed,
    ).toEqual([]);
    expect((await readAccessModes(folder, options)).members).toEqual([
      { agent: { type: "webid", id: owner }, modes: ["append", "control", "read", "write"] },
      { agent: { type: "webid", id: bob }, modes: ["read"] },
    ]);
    const conflict = await setGrants([folder], [manager], {
      ...options,
      expected: { [folder]: stale.version },
    });
    expect(conflict.failed[0]?.error).toMatchObject({ code: "conflict" });
  });
  it("separates a container's own scope from members-only acl:default rules", async () => {
    const mem = memoryAccess();
    mem.attach(
      folder,
      await writeWac(
        policy(
          rule([[{ kind: "agent", webId: owner }]], ["read", "write", "control"]),
          rule([[{ kind: "authenticated" }]], ["append"], "members"),
          rule([[{ kind: "agent", webId: bob }]], ["read"], "resource"),
        ),
        folder,
        `${folder}.acl`,
      ),
    );
    // readGrants refuses this folder outright (partial scope); the raw read reports both scopes.
    await expect(readGrants(folder, { ...mem.options, kind: "folder" })).rejects.toMatchObject({
      code: "partial-scope",
    });
    const modes = await readAccessModes(folder, { ...mem.options, kind: "folder" });
    expect(modes.resource.map((row) => row.agent)).toEqual([
      { type: "webid", id: owner },
      { type: "webid", id: bob },
    ]);
    expect(modes.members).toEqual([
      { agent: { type: "webid", id: owner }, modes: ["append", "control", "read", "write"] },
      { agent: { type: "authenticated" }, modes: ["append"] },
    ]);
  });
  it("reads an inherited ancestor's default rules for a document without its own ACL", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await writeWac(probe("members"), folder, `${folder}.acl`));
    mem.advertise(doc);
    const modes = await readAccessModes(doc, mem.options);
    expect(modes.members).toEqual([]);
    expect(modes.resource).toContainEqual({ agent: { type: "authenticated" }, modes: ["append"] });
    expect(modes.resource).toContainEqual({
      agent: { type: "webid", id: mallory },
      modes: ["append", "write"],
    });
  });
  it("reads a document's own ACL, ignoring the container's defaults", async () => {
    const mem = memoryAccess();
    mem.attach(folder, await writeWac(probe(), folder, `${folder}.acl`));
    mem.attach(doc, await fixture("wac", doc));
    expect((await readAccessModes(doc, mem.options)).resource).toEqual([
      { agent: { type: "webid", id: owner }, modes: ["append", "control", "read", "write"] },
    ]);
  });
  it("matches readGrants' token when a comments container is read", async () => {
    const mem = memoryAccess();
    const comments = `${root}comments/`;
    mem.attach(doc, await fixture("wac", doc));
    mem.attach(comments, await fixture("wac", comments, [manager], true));
    const options = { ...mem.options, commentsContainer: comments };
    expect((await readAccessModes(doc, options)).version).toBe(
      (await readGrants(doc, options)).version,
    );
    expect((await readAccessModes(doc, options)).version).not.toBe(
      (await readAccessModes(doc, mem.options)).version,
    );
  });
  it("refuses conditional rules instead of reporting them unconditionally", async () => {
    const mem = memoryAccess();
    mem.attach(
      doc,
      await writeWac(
        policy(
          rule([[{ kind: "agent", webId: owner }]], ["read", "write", "control"], "resource"),
          rule(
            [[{ kind: "agent", webId: mallory }], [{ kind: "agent", webId: bob }]],
            ["write"],
            "resource",
          ),
        ),
        doc,
        `${doc}.acl`,
      ),
    );
    // Two principals in one rule split into separate rows, never merged into one.
    expect((await readAccessModes(doc, mem.options)).resource).toHaveLength(3);
    mem.intercept((url, init) =>
      url === `${doc}.acl` && init.method !== "HEAD"
        ? new Response(
            `<#r> a <http://www.w3.org/ns/auth/acl#Authorization>;
  <http://www.w3.org/ns/auth/acl#accessTo> <${doc}>;
  <http://www.w3.org/ns/auth/acl#agent> <${mallory}>;
  <http://www.w3.org/ns/auth/acl#origin> <https://app.example>;
  <http://www.w3.org/ns/auth/acl#mode> <http://www.w3.org/ns/auth/acl#Write>.`,
            { headers: { "content-type": "text/turtle", etag: '"9"' } },
          )
        : undefined,
    );
    await expect(readAccessModes(doc, mem.options)).rejects.toMatchObject({
      code: "unsupported",
    });
  });
});

describe("isGrantableTarget", () => {
  const storage = "https://pod.example/alice/";
  it.each([
    `${storage}drive/notes.md`,
    `${storage}tasks/`,
    `${storage}drive/caf%C3%A9.txt`,
    `${storage}drive/a%20b.txt`,
    `${storage}groupsfolder/x`,
    `${storage}settingsy`,
  ])("allows %s", (target) => {
    expect(isGrantableTarget(target, storage, ["groups"])).toBe(true);
  });
  it.each([
    storage,
    "https://pod.example/alice",
    "https://pod.example/bob/x",
    "https://other.example/alice/x",
    "not a url",
    `${storage}settings`,
    `${storage}settings/`,
    `${storage}Settings/prefs.ttl`,
    `${storage}%53ettings/prefs.ttl`,
    `${storage}groups`,
    `${storage}groups/`,
    `${storage}GROUPS/family.ttl`,
    `${storage}groups/family.ttl`,
    `${storage}drive/x.acl`,
    `${storage}drive/.meta`,
    `${storage}drive/x?q`,
    `${storage}drive/x#y`,
    `${storage}drive//x`,
    `${storage}drive%2fx`,
    `${storage}drive/%ff`,
    `${storage}drive./x`,
    `${storage}drive /x`,
    `${storage}drive/x::$DATA`,
  ])("refuses %s", (target) => {
    expect(isGrantableTarget(target, storage, ["groups"])).toBe(false);
  });
  it("reserves only settings by default and refuses malformed storage roots", () => {
    expect(isGrantableTarget(`${storage}groups/family.ttl`, storage)).toBe(true);
    expect(isGrantableTarget(`${storage}settings/x`, storage)).toBe(false);
    expect(isGrantableTarget(`${storage}x`, "not a url")).toBe(false);
    expect(isGrantableTarget("https://pod.example/alicex/y", "https://pod.example/alice")).toBe(
      false,
    );
    expect(isGrantableTarget("https://pod.example/x", "https://pod.example/%ff/")).toBe(false);
  });
});
