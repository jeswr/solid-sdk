// AUTHORED-BY Claude Opus 5.5
// Real WAC documents through the real pod-access roles layer: no mocked grants. ACL bodies are
// serialised with pod-access writeWac (n3.Writer) and parsed back with fetch-rdf.

import { parseRdf } from "@jeswr/fetch-rdf";
import { type EffectivePolicy, type Grant, readWac, writeWac } from "@jeswr/pod-access";
import { readGrants, sealDataset } from "@jeswr/pod-access/roles";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  GROUP_TARGET,
  GROUP_UNSAFE,
  GROUPS_UNVERIFIED,
  GroupDirectory,
  ownerOnlyAccess,
  SECURING_BLOCKED,
  SECURING_INTERRUPTED,
  SECURING_RACE,
  SETTINGS_UNSAFE,
  SETTINGS_UNVERIFIED,
} from "../src/index.js";

const root = "https://pod.example/owner/";
const owner = "https://pod.example/profile#me";
const bob = "https://bob.example/#me";
const mallory = "https://mallory.example/#me";
const settings = `${root}settings/group-sharing/state.json`;
type Who = Grant["who"][number][number];
const agent = (webId: string): Who => ({ kind: "agent", webId });
const rule = (
  who: Who,
  modes: Grant["modes"] extends Set<infer M> ? M[] : never,
  appliesTo: Grant["appliesTo"] = "both",
): Grant => ({
  who: [[who]],
  modes: new Set(modes),
  except: [],
  appliesTo,
  source: { url: root, node: root },
});
const policy = (...grants: Grant[]): EffectivePolicy => ({ grants, denials: [] });
const ownerRule = (appliesTo: Grant["appliesTo"] = "both") =>
  rule(agent(owner), ["read", "write", "control"], appliesTo);
/** The review's probe: owner R/W/C, public Read, authenticated Append, mallory Write. */
const probe = (appliesTo: Grant["appliesTo"] = "both") =>
  policy(
    ownerRule(appliesTo),
    rule({ kind: "public" }, ["read"], appliesTo),
    rule({ kind: "authenticated" }, ["append"], appliesTo),
    rule(agent(mallory), ["write"], appliesTo),
  );

/**
 * A memory pod whose resources advertise `<url>.acl`, served and conditionally written over HTTP.
 * A document whose own ACL gives the owner nothing is refused to the owner (403), as WAC would.
 */
async function pod(hooks: { beforePut?: (url: string) => Promise<void> } = {}) {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  Object.assign(storage.features.accessControl, { state: "available", detail: { model: "wac" } });
  const acls = new Map<string, { body: string; etag: string }>();
  const lockedOut = async (url: string) => {
    const acl = acls.get(`${url}.acl`);
    if (url.endsWith("/") || !acl) return false;
    const dataset = await parseRdf(acl.body, "text/turtle", { baseIRI: `${url}.acl` });
    return !readWac(dataset, url, `${url}.acl`).grants.some((grant) =>
      grant.who.some((all) => all.some((who) => who.kind === "agent" && who.webId === owner)),
    );
  };
  const guard = async (method: string, url: string) => {
    if (await lockedOut(url)) throw new StorageError("forbidden", { method, url, status: 403 });
  };
  const exists = storage.head.bind(storage);
  vi.spyOn(storage, "head").mockImplementation(async (url, options) => {
    await guard("HEAD", url);
    return {
      ...(await exists(url, options)),
      links: new Map([["acl", [{ target: `${url}.acl`, params: {} }]]]),
    };
  });
  const remove = storage.delete.bind(storage);
  vi.spyOn(storage, "delete").mockImplementation(async (url, options) => {
    await guard("DELETE", url);
    return remove(url, options);
  });
  let version = 0;
  const putAcl = async (resource: string, value: EffectivePolicy) => {
    acls.set(`${resource}.acl`, {
      body: await writeWac(value, resource, `${resource}.acl`),
      etag: `"${++version}"`,
    });
  };
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation(async (url, options) => {
    const acl = acls.get(url);
    if (!url.endsWith(".acl")) return read(url, options);
    if (!acl) return read(url, options);
    return {
      url,
      dataset: await parseRdf(acl.body, "text/turtle", { baseIRI: url }),
      etag: acl.etag,
      contentType: "text/turtle",
    };
  });
  const puts: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (init.method === "HEAD" && (await lockedOut(url)))
      return new Response(null, { status: 403 });
    if (init.method === "HEAD")
      try {
        const head = await exists(url);
        return new Response(null, {
          headers: { link: `<${url}.acl>; rel="acl"`, etag: head.etag ?? '"r"' },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    const acl = acls.get(url);
    if (init.method === "PUT") {
      await hooks.beforePut?.(url);
      const headers = new Headers(init.headers);
      if (acl ? headers.get("if-match") !== acl.etag : headers.get("if-none-match") !== "*")
        return new Response(null, { status: 412 });
      puts.push(url);
      acls.set(url, { body: String(init.body), etag: `"${++version}"` });
      return new Response(null, { status: 201 });
    }
    return acl
      ? new Response(acl.body, { headers: { "content-type": "text/turtle", etag: acl.etag } })
      : new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  await putAcl(root, policy(ownerRule()));
  const notify = vi.fn().mockResolvedValue({ delivered: true, inbox: null });
  const directory = new GroupDirectory({ storage, fetch, webId: owner }, notify);
  return { storage, fetch, acls, puts, putAcl, notify, directory };
}
const doc = (id: string) => id.split("#")[0] as string;

describe("groups folder and documents with real ACLs", () => {
  it("creates, lists and shares through real ACLs with public Read and owner management", async () => {
    const { directory, storage, fetch, acls } = await pod();
    const group = await directory.create("Team", [bob]);
    expect(await directory.list()).toEqual([group]);
    const file = await storage.create(root, "x", { name: "file.txt", contentType: "text/plain" });
    await directory.share(group.id, file.url, "editor");
    expect(acls.get(`${file.url}.acl`)?.body).toContain(group.id);
    expect(
      (await readGrants(file.url, { fetch, root, model: "wac" })).grants.find(
        (grant) => grant.agent.type === "group",
      ),
    ).toMatchObject({ agent: { type: "group", id: group.id }, role: "editor" });
  });
  it.each([
    ["the review probe on both scopes", probe()],
    [
      "acl:default Append for authenticated agents",
      policy(
        ownerRule(),
        rule({ kind: "public" }, ["read"]),
        rule({ kind: "authenticated" }, ["append"], "members"),
      ),
    ],
    [
      "Write without Read on the folder itself",
      policy(ownerRule(), rule({ kind: "public" }, ["read"]), rule(agent(mallory), ["write"])),
    ],
    [
      "Control without edit",
      policy(
        ownerRule(),
        rule({ kind: "public" }, ["read"]),
        rule(agent(mallory), ["read", "control"]),
      ),
    ],
  ])("refuses a groups folder with %s before any grant or edit", async (_name, unsafe) => {
    const { directory, storage, putAcl, puts, notify } = await pod();
    const group = await directory.create("Family", [bob]);
    await putAcl(directory.container, unsafe);
    const before = puts.length;
    const file = await storage.create(root, "x", { name: "file.txt", contentType: "text/plain" });
    await expect(directory.list()).rejects.toThrow(GROUP_UNSAFE);
    await expect(directory.addMember(group.id, mallory)).rejects.toThrow(GROUP_UNSAFE);
    await expect(directory.share(group.id, file.url, "viewer")).rejects.toThrow(GROUP_UNSAFE);
    await expect(
      directory.setupFamily(group.id, [{ key: "x", role: "editor", create: vi.fn() }]),
    ).rejects.toThrow(GROUP_UNSAFE);
    // Provisioning never publishes over a folder that already holds groups.
    await expect(directory.create("Other")).rejects.toThrow(GROUP_UNSAFE);
    expect(puts.slice(before)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect((await storage.readRdf(doc(group.id))).dataset.size).toBeGreaterThan(0);
  });
  it("refuses a group document whose own ACL grants Append or Write to others", async () => {
    const { directory, putAcl } = await pod();
    const group = await directory.create("Family", [bob]);
    await putAcl(doc(group.id), probe("resource"));
    await expect(directory.list()).rejects.toThrow(GROUP_UNSAFE);
    await expect(directory.rename(group.id, "Changed")).rejects.toThrow(GROUP_UNSAFE);
  });
});

describe("owner-only settings with real ACLs", () => {
  async function tampered(value: EffectivePolicy, own = true) {
    const fixture = await pod();
    const { directory, storage, putAcl } = fixture;
    const group = await directory.create("Family", [bob]);
    await directory.setFamily(group.id);
    const current = await storage.read(settings);
    await storage.write(
      settings,
      JSON.stringify({
        family: group.id,
        notices: [],
        spaces: { [JSON.stringify([group.id, "calendar"])]: [root] },
      }),
      { contentType: "application/json", ifMatch: current.etag as string },
    );
    await putAcl(own ? settings : `${root}settings/group-sharing/`, value);
    return { ...fixture, group };
  }
  it.each([
    [
      "Write without Read",
      policy(ownerRule("resource"), rule(agent(mallory), ["write"], "resource")),
    ],
    [
      "Append only",
      policy(ownerRule("resource"), rule({ kind: "authenticated" }, ["append"], "resource")),
    ],
    ["the review probe", probe("resource")],
  ])("refuses state.json whose own ACL grants %s; tampered spaces are never granted", async (_name, value) => {
    const { directory, group, puts, notify } = await tampered(value);
    const before = puts.length;
    await expect(directory.list()).rejects.toThrow("settings must be owner-only");
    await expect(
      directory.setupFamily(group.id, [{ key: "calendar", role: "editor", create: vi.fn() }]),
    ).rejects.toThrow("settings must be owner-only");
    await expect(directory.notifyOnce(group.id, group.id, "Invite")).rejects.toThrow("owner-only");
    expect(puts.slice(before).filter((url) => url === `${root}.acl`)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
  it("refuses state.json inheriting acl:default Append from its folder", async () => {
    const { directory } = await tampered(
      policy(ownerRule(), rule({ kind: "authenticated" }, ["append"], "members")),
      false,
    );
    await expect(directory.list()).rejects.toThrow("settings must be owner-only");
  });
  it.each([
    root,
    `${root}settings/group-sharing/`,
    `${root}Settings/prefs.ttl`,
    `${root}groups/`,
    `${root}groups/x.ttl`,
  ])("refuses a stored Family space %s even in owner-only settings", async (space) => {
    const { directory, storage, puts } = await pod();
    const group = await directory.create("Family", [bob]);
    await directory.setFamily(group.id);
    const current = await storage.read(settings);
    await storage.write(
      settings,
      JSON.stringify({
        family: group.id,
        notices: [],
        spaces: { [JSON.stringify([group.id, "calendar"])]: [space] },
      }),
      { contentType: "application/json", ifMatch: current.etag as string },
    );
    const before = puts.length;
    const create = vi.fn();
    await expect(
      directory.setupFamily(group.id, [{ key: "calendar", role: "viewer", create }]),
    ).rejects.toThrow(GROUP_TARGET);
    expect(create).not.toHaveBeenCalled();
    expect(puts.slice(before).filter((url) => !url.startsWith(`${root}settings/`))).toEqual([]);
  });
});

describe("settings written under an earlier untrusted policy (review round 2)", () => {
  const folder = `${root}settings/group-sharing/`;
  async function preexisting(folderPolicy: EffectivePolicy, ownAcl?: EffectivePolicy) {
    const fixture = await pod();
    const { directory, storage, putAcl } = fixture;
    const group = await directory.create("Family", [bob]);
    await storage.create(root, null, { name: "settings", kind: "container" });
    await storage.create(`${root}settings/`, null, { name: "group-sharing", kind: "container" });
    // Written while the folder still let another agent write: never provisioned by us.
    await storage.create(
      folder,
      JSON.stringify({
        family: group.id,
        notices: [],
        spaces: { [JSON.stringify([group.id, "calendar"])]: [`${root}private/`] },
      }),
      { name: "state.json", contentType: "application/json" },
    );
    await putAcl(folder, folderPolicy);
    if (ownAcl) await putAcl(settings, ownAcl);
    return { ...fixture, group };
  }
  it.each([
    ["Write", policy(ownerRule(), rule(agent(mallory), ["write"]))],
    ["Append", policy(ownerRule(), rule({ kind: "authenticated" }, ["append"]))],
    [
      "members-only Append",
      policy(ownerRule(), rule({ kind: "authenticated" }, ["append"], "members")),
    ],
  ])("refuses pre-existing state.json whose folder grants a non-owner %s, before provisioning would make it owner-only", async (_name, folderPolicy) => {
    const { directory, group, puts, acls, notify } = await preexisting(folderPolicy);
    const before = acls.get(`${folder}.acl`)?.body;
    const create = vi.fn();
    const start = puts.length;
    await expect(
      directory.setupFamily(group.id, [{ key: "calendar", role: "editor", create }]),
    ).rejects.toThrow("settings must be owner-only");
    await expect(directory.setFamily(group.id)).rejects.toThrow("settings must be owner-only");
    await expect(directory.notifyOnce(group.id, group.id, "Invite")).rejects.toThrow("owner-only");
    await expect(directory.list()).rejects.toThrow("settings must be owner-only");
    // Provisioning never ran, so the untrusted content was not laundered into owner-only state.
    expect(puts.slice(start)).toEqual([]);
    expect(acls.get(`${folder}.acl`)?.body).toBe(before);
    expect(create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it("refuses an owner-only state.json ACL inside a folder others can write", async () => {
    const { directory, group, puts } = await preexisting(
      policy(ownerRule(), rule(agent(mallory), ["write"])),
      policy(ownerRule("resource")),
    );
    const start = puts.length;
    await expect(directory.setFamily(group.id)).rejects.toThrow("settings must be owner-only");
    expect(puts.slice(start)).toEqual([]);
  });
  it("refuses legacy settings in an owner-only folder that was never sealed, deleting nothing, until the owner keeps them", async () => {
    // An earlier build wrote them into an owner-only folder without a seal (review round 5).
    const { directory, group, fetch, acls, storage, puts } = await preexisting(policy(ownerRule()));
    await storage.create(root, null, { name: "private", kind: "container" });
    await expect(directory.list()).rejects.toThrow(SETTINGS_UNVERIFIED);
    const create = vi.fn();
    const start = puts.length;
    await expect(
      directory.setupFamily(group.id, [{ key: "calendar", role: "editor", create }]),
    ).rejects.toThrow(SETTINGS_UNVERIFIED);
    expect(create).not.toHaveBeenCalled();
    expect(puts.slice(start)).toEqual([]);
    expect(await storage.read(settings)).toBeDefined();
    // The owner sees the Family group and the space it would be granted before keeping them.
    expect(await directory.unverified()).toEqual([
      {
        folder: "settings",
        documents: [settings],
        contents: [
          {
            url: settings,
            inherits: true,
            kind: "settings",
            family: group.id,
            spaces: [`${root}private/`],
          },
        ],
        planted: false,
        keepable: true,
      },
    ]);
    await directory.verifyFolder("settings", "keep");
    expect(acls.get(`${folder}.acl`)?.body).toContain("sealedBy");
    expect((await directory.list())[0]).toMatchObject({ id: group.id, family: true });
    const grants = (
      await readGrants(`${root}private/`, { fetch, root, model: "wac", kind: "folder" })
    ).grants;
    expect(grants.some((grant) => grant.agent.type === "group")).toBe(false);
  });
});

describe("a groups folder whose seal an external editor dropped (review round 5, PoC V5)", () => {
  const groups = `${root}groups/`;
  async function stripped() {
    const fixture = await pod();
    const family = await fixture.directory.create("Family", [bob]);
    const team = await fixture.directory.create("Team", [mallory]);
    const file = await fixture.storage.create(root, "x", {
      name: "file.txt",
      contentType: "text/plain",
    });
    await fixture.directory.share(family.id, file.url, "viewer");
    expect(fixture.acls.get(`${groups}.acl`)?.body).toContain("sealedBy");
    // The same policy, rewritten without statements the editor doesn't know.
    await fixture.putAcl(groups, policy(ownerRule(), rule({ kind: "public" }, ["read"])));
    expect(fixture.acls.get(`${groups}.acl`)?.body).not.toContain("sealedBy");
    return { ...fixture, family, team, file };
  }
  it("refuses, deletes nothing, and keeps every group on the owner's word", async () => {
    const { directory, storage, family, team, file, fetch } = await stripped();
    const before = [family, team].map((group) => doc(group.id));
    await expect(directory.create("Garden", [bob])).rejects.toThrow(GROUPS_UNVERIFIED);
    await expect(directory.list()).rejects.toThrow(GROUPS_UNVERIFIED);
    for (const url of before) expect(await storage.read(url)).toBeDefined();
    expect(await directory.unverified()).toEqual([
      {
        folder: "groups",
        documents: before.sort(),
        contents: [
          { url: doc(family.id), name: "Family", members: [bob] },
          { url: doc(team.id), name: "Team", members: [mallory] },
        ]
          .sort((a, b) => a.url.localeCompare(b.url))
          .map((preview) => ({ ...preview, kind: "group", inherits: true })),
        planted: false,
        keepable: true,
      },
    ]);
    await directory.verifyFolder("groups", "keep");
    expect((await directory.list()).map((group) => group.id).sort()).toEqual(
      [family.id, team.id].sort(),
    );
    // The group grant made before still names a group that exists.
    expect(
      (await readGrants(file.url, { fetch, root, model: "wac" })).grants.some(
        (grant) => grant.agent.type === "group" && grant.agent.id === family.id,
      ),
    ).toBe(true);
    expect((await directory.create("Garden", [bob])).name).toBe("Garden");
  });
  it("removes every group on the owner's word", async () => {
    const { directory, storage, family, team } = await stripped();
    await directory.verifyFolder("groups", "discard");
    for (const group of [family, team])
      await expect(storage.read(doc(group.id))).rejects.toMatchObject({ code: "not-found" });
    expect(await directory.list()).toEqual([]);
  });
});

describe("collection contents follow the collection's groups (review round 2)", () => {
  it("grants every listed group holding the source Viewer access to added contents", async () => {
    const { directory, storage, fetch, putAcl, puts, acls } = await pod();
    const group = await directory.create("Family", [bob]);
    const other = await directory.create("Unshared", [mallory]);
    const space = await storage.create(root, null, { name: "photos", kind: "container" });
    const album = await storage.create(space.url, "a", {
      name: "album.ttl",
      contentType: "text/turtle",
    });
    const photo = await storage.create(space.url, "p", {
      name: "photo.ttl",
      contentType: "text/turtle",
    });
    const original = await storage.create(space.url, "o", {
      name: "photo.jpg",
      contentType: "image/jpeg",
    });
    // Nothing shared yet: no reads of the contents' access, no writes.
    const start = puts.length;
    expect(await directory.extend(album.url, [photo.url], { within: space.url })).toEqual([]);
    expect(puts.slice(start)).toEqual([]);
    await directory.share(group.id, album.url, "editor");
    expect(await directory.extend(album.url, [], { within: space.url })).toEqual([]);
    expect(
      await directory.extend(album.url, [photo.url, original.url, photo.url], {
        within: space.url,
      }),
    ).toEqual([group.id]);
    for (const url of [photo.url, original.url]) {
      const grants = (await readGrants(url, { fetch, root, model: "wac" })).grants;
      // Viewer only, whatever the collection role, and never the unshared group.
      expect(grants.filter((grant) => grant.agent.type === "group")).toEqual([
        expect.objectContaining({ agent: { type: "group", id: group.id }, role: "viewer" }),
      ]);
      expect(acls.get(`${url}.acl`)?.body).not.toContain(other.id);
    }
    // A group on the collection that is not a shareable group in this pod is not extended.
    const foreign = `${root}groups/foreign.ttl#this`;
    await putAcl(
      album.url,
      policy(ownerRule("resource"), rule({ kind: "group", group: foreign }, ["read"], "resource")),
    );
    const before = puts.length;
    expect(await directory.extend(album.url, [photo.url], { within: space.url })).toEqual([]);
    expect(puts.slice(before)).toEqual([]);
  });
  it.each([
    [`${root}photos/album.ttl`, `${root}photo.ttl`, `${root}photos/`],
    [`${root}album.ttl`, `${root}photos/photo.ttl`, `${root}photos/`],
    [`${root}photos/album.ttl`, `${root}photos/`, `${root}photos/`],
    [`${root}photos/album.ttl`, `${root}photos/a/../../settings/x`, `${root}photos/`],
    [`${root}photos/album.ttl`, `${root}photosx/photo.ttl`, `${root}photos/`],
    [`${root}photos/album.ttl`, `${root}photos/photo.ttl`, root],
    [`${root}settings/album.ttl`, `${root}settings/x`, `${root}settings/`],
    [`${root}groups/a.ttl`, `${root}groups/b.ttl`, `${root}groups/`],
  ])("refuses a collection or contents outside its space (%s, %s within %s)", async (source, target, within) => {
    const { directory, puts } = await pod();
    const start = puts.length;
    await expect(directory.extend(source, [target], { within })).rejects.toThrow(GROUP_TARGET);
    expect(puts.slice(start)).toEqual([]);
  });
  it("refuses a space that is not a folder", async () => {
    const { directory } = await pod();
    await expect(
      directory.extend(`${root}photos/a.ttl`, [`${root}photos/b.ttl`], {
        within: `${root}photos`,
      }),
    ).rejects.toThrow("application folder");
  });
});

describe("content planted while a folder is being secured (review round 3)", () => {
  it("deletes a state.json planted between the safety check and the ACL rewrite; the retry refuses it", async () => {
    // The adversarial review's proof of concept, which granted the Family group Editor on private/.
    const hooks: { beforePut?: (url: string) => Promise<void> } = {};
    const { directory, storage, fetch, putAcl, puts } = await pod(hooks);
    const group = await directory.create("Family", [bob, mallory]);
    await storage.create(root, null, { name: "settings", kind: "container" });
    await storage.create(`${root}settings/`, null, { name: "group-sharing", kind: "container" });
    await storage.create(root, null, { name: "private", kind: "container" });
    const folder = `${root}settings/group-sharing/`;
    // Mallory can edit the settings folder; no state.json exists yet.
    await putAcl(folder, policy(ownerRule(), rule(agent(mallory), ["read", "write"])));
    let raced = false;
    hooks.beforePut = async (url) => {
      if (url !== `${folder}.acl` || raced) return;
      raced = true;
      await storage.create(
        folder,
        JSON.stringify({
          notices: [JSON.stringify([group.id, bob, group.id])],
          spaces: { [JSON.stringify([group.id, "calendar"])]: [`${root}private/`] },
        }),
        { name: "state.json", contentType: "application/json" },
      );
    };
    await expect(directory.setFamily(group.id)).rejects.toThrow("others could write it");
    await expect(storage.read(settings)).rejects.toMatchObject({ code: "not-found" });
    // The owner reloads and retries, as the error says: the planted spaces are gone.
    const create = vi.fn(async () => [`${root}new/`]);
    await storage.create(root, null, { name: "new", kind: "container" });
    await directory.setupFamily(group.id, [{ key: "calendar", role: "editor", create }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(puts).not.toContain(`${root}private/.acl`);
    const grants = (
      await readGrants(`${root}private/`, { fetch, root, model: "wac", kind: "folder" })
    ).grants;
    expect(grants.some((grant) => grant.agent.type === "group")).toBe(false);
  });
  it("refuses to secure a non-empty settings folder others could write", async () => {
    const { directory, storage, putAcl, puts } = await pod();
    const group = await directory.create("Family", [bob]);
    await storage.create(root, null, { name: "settings", kind: "container" });
    await storage.create(`${root}settings/`, null, { name: "group-sharing", kind: "container" });
    const folder = `${root}settings/group-sharing/`;
    await storage.create(folder, "x", { name: "other.txt", contentType: "text/plain" });
    await putAcl(folder, policy(ownerRule(), rule({ kind: "authenticated" }, ["append"])));
    const start = puts.length;
    await expect(directory.setFamily(group.id)).rejects.toThrow("settings must be owner-only");
    expect(puts.slice(start)).toEqual([]);
  });
  it("deletes a group document planted while the groups folder is published; nested folders are never read", async () => {
    const hooks: { beforePut?: (url: string) => Promise<void> } = {};
    const { directory, storage, putAcl } = await pod(hooks);
    await storage.create(root, null, { name: "groups", kind: "container" });
    // The empty groups folder lets any signed-in agent edit. (A role-less grant such as Append
    // only is refused outright: pod-access never replaces a policy it cannot represent.)
    await putAcl(
      `${root}groups/`,
      policy(ownerRule(), rule({ kind: "authenticated" }, ["read", "write"])),
    );
    let raced = false;
    hooks.beforePut = async (url) => {
      if (url !== `${root}groups/.acl` || raced) return;
      raced = true;
      const { serializeGroup } = await import("../src/index.js");
      await storage.create(
        `${root}groups/`,
        await serializeGroup(`${root}groups/planted.ttl`, { name: "Family", members: [mallory] }),
        { name: "planted.ttl", contentType: "text/turtle" },
      );
      await storage.create(`${root}groups/`, null, { name: "nested", kind: "container" });
    };
    await expect(directory.create("Team", [bob])).rejects.toThrow("others could write it");
    await expect(storage.read(`${root}groups/planted.ttl`)).rejects.toMatchObject({
      code: "not-found",
    });
    // Now owner-managed and public-read; only the owner's own group is listed.
    const team = await directory.create("Team", [bob]);
    expect(await directory.list()).toEqual([team]);
  });
});

describe("fail-safe cleanup with real ACLs (review round 4)", () => {
  const folder = `${root}settings/group-sharing/`;
  /** The PoC: Mallory can manage the settings folder, and plants during the rewrite. */
  async function attacked() {
    const hooks: { beforePut?: (url: string) => Promise<void> } = {};
    const fixture = await pod(hooks);
    const { directory, storage, putAcl } = fixture;
    const group = await directory.create("Family", [bob, mallory]);
    await storage.create(root, null, { name: "settings", kind: "container" });
    await storage.create(`${root}settings/`, null, { name: "group-sharing", kind: "container" });
    await storage.create(root, null, { name: "private", kind: "container" });
    await storage.create(root, null, { name: "new", kind: "container" });
    await putAcl(folder, policy(ownerRule(), rule(agent(mallory), ["read", "write", "control"])));
    let raced = false;
    hooks.beforePut = async (url) => {
      if (url !== `${folder}.acl` || raced) return;
      raced = true;
      // A blocker sorting before state.json, whose own ACL shuts the owner out.
      await storage.create(folder, "x", { name: "0.txt", contentType: "text/plain" });
      await putAcl(`${folder}0.txt`, policy(rule(agent(mallory), ["read", "write", "control"])));
      await storage.create(
        folder,
        JSON.stringify({
          family: group.id,
          notices: [],
          spaces: { [JSON.stringify([group.id, "calendar"])]: [`${root}private/`] },
        }),
        { name: "state.json", contentType: "application/json" },
      );
    };
    return { ...fixture, group };
  }
  const groupOnPrivate = async (fetch: typeof globalThis.fetch) =>
    (
      await readGrants(`${root}private/`, { fetch, root, model: "wac", kind: "folder" })
    ).grants.some((grant) => grant.agent.type === "group");

  it("deletes state.json past a blocker with its own ACL; the retry grants nothing planted", async () => {
    const { directory, storage, fetch, puts, acls } = await attacked();
    const group = (await directory.list())[0];
    if (!group) throw new Error("Expected the Family group");
    await expect(directory.setFamily(group.id)).rejects.toThrow(SECURING_RACE);
    await expect(storage.read(settings)).rejects.toMatchObject({ code: "not-found" });
    // The blocker is still there (the owner can't touch it) but nothing ever reads it.
    await expect(storage.head(`${folder}0.txt`)).rejects.toMatchObject({ code: "forbidden" });
    expect(acls.get(`${folder}.acl`)?.body).toContain("sealedBy");
    const create = vi.fn(async () => [`${root}new/`]);
    await directory.setupFamily(group.id, [{ key: "calendar", role: "editor", create }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(puts).not.toContain(`${root}private/.acl`);
    expect(await groupOnPrivate(fetch)).toBe(false);
  });
  it("refuses, grants nothing and offers only removal after a failed discard; removal cleans up", async () => {
    const { directory, storage, fetch, puts, acls, group } = await attacked();
    const remove = vi.mocked(storage.delete).getMockImplementation() as typeof storage.delete;
    let failures = 1;
    vi.mocked(storage.delete).mockImplementation(async (url, options) => {
      if (url === settings && failures-- > 0)
        throw new StorageError("network", { method: "DELETE", url });
      return remove(url, options);
    });
    await expect(directory.setFamily(group.id)).rejects.toThrow(SECURING_BLOCKED);
    // Owner-only now, but unsealed: the surviving planted settings are refused everywhere.
    expect(acls.get(`${folder}.acl`)?.body).not.toContain("sealedBy");
    expect(await ownerOnlyAccess({ storage, fetch, webId: owner }, settings)).toBe(true);
    await expect(directory.list()).rejects.toThrow(SETTINGS_UNVERIFIED);
    await expect(directory.notifyOnce(group.id, group.id, "Invite")).rejects.toThrow(
      SETTINGS_UNVERIFIED,
    );
    // The folder ACL says it was still being secured: the owner may only remove what it holds.
    expect(acls.get(`${folder}.acl`)?.body).toContain("securingBy");
    expect(await directory.unverified()).toMatchObject([
      { folder: "settings", documents: [settings], planted: true, keepable: false },
    ]);
    await expect(directory.verifyFolder("settings", "keep")).rejects.toThrow(SECURING_INTERRUPTED);
    // The owner removes what the failed cleanup left; the blocker stays, never read.
    await directory.verifyFolder("settings", "discard");
    await expect(storage.read(settings)).rejects.toMatchObject({ code: "not-found" });
    expect(acls.get(`${folder}.acl`)?.body).toContain("sealedBy");
    expect(acls.get(`${folder}.acl`)?.body).not.toContain("securingBy");
    const create = vi.fn(async () => [`${root}new/`]);
    await directory.setupFamily(group.id, [{ key: "calendar", role: "editor", create }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(puts).not.toContain(`${root}private/.acl`);
    expect(await groupOnPrivate(fetch)).toBe(false);
  });
  it("refuses settings whose own ACL looks owner-only and carries a seal its planter wrote", async () => {
    const { directory, storage, putAcl, acls } = await pod();
    const group = await directory.create("Family", [bob]);
    await directory.setFamily(group.id);
    // Mallory's orphan state.json ACL, rewritten to look owner-only (and sealed) after use.
    await putAcl(settings, policy(ownerRule("resource")));
    const own = `${settings}.acl`;
    const forged = await parseRdf(acls.get(own)?.body as string, "text/turtle", { baseIRI: own });
    sealDataset(forged, own, owner);
    acls.set(own, { body: new Writer().quadsToString([...forged]), etag: '"x"' });
    expect(acls.get(own)?.body).toContain("sealedBy");
    expect(await storage.read(settings)).toBeDefined();
    await expect(directory.list()).rejects.toThrow(SETTINGS_UNSAFE);
    // Nor can the owner keep it once the folder needs verifying: a kept document must inherit.
    await putAcl(folder, policy(ownerRule()));
    await expect(directory.verifyFolder("settings", "keep")).rejects.toThrow(SETTINGS_UNSAFE);
    expect(acls.get(`${folder}.acl`)?.body).not.toContain("sealedBy");
  });
});

describe("leftovers of an interrupted securing pass are never kept (review round 6, PoC V7)", () => {
  const folder = `${root}settings/group-sharing/`;
  const groups = `${root}groups/`;
  const SecuringBy = "https://jeswr.org/ns/pod-access#securingBy";
  /** Mallory, who can edit the empty settings folder, plants settings; the cleanup fails once. */
  async function interrupted() {
    const hooks: { beforePut?: (url: string) => Promise<void> } = {};
    const fixture = await pod(hooks);
    const { directory, storage, putAcl } = fixture;
    const group = await directory.create("Family", [bob, mallory]);
    await storage.create(root, null, { name: "settings", kind: "container" });
    await storage.create(`${root}settings/`, null, { name: "group-sharing", kind: "container" });
    await storage.create(root, null, { name: "private", kind: "container" });
    await storage.create(root, null, { name: "new", kind: "container" });
    await putAcl(folder, policy(ownerRule(), rule(agent(mallory), ["read", "write"])));
    let raced = false;
    hooks.beforePut = async (url) => {
      if (url !== `${folder}.acl` || raced) return;
      raced = true;
      await storage.create(
        folder,
        JSON.stringify({
          notices: [],
          spaces: { [JSON.stringify([group.id, "calendar"])]: [`${root}private/`] },
        }),
        { name: "state.json", contentType: "application/json" },
      );
    };
    const remove = vi.mocked(storage.delete).getMockImplementation() as typeof storage.delete;
    let failures = 1;
    vi.mocked(storage.delete).mockImplementation(async (url, options) => {
      if (url === settings && failures-- > 0)
        throw new StorageError("network", { method: "DELETE", url });
      return remove(url, options);
    });
    await expect(directory.setFamily(group.id)).rejects.toThrow(SECURING_BLOCKED);
    return { ...fixture, group };
  }
  const groupOnPrivate = async (fetch: typeof globalThis.fetch) =>
    (
      await readGrants(`${root}private/`, { fetch, root, model: "wac", kind: "folder" })
    ).grants.some((grant) => grant.agent.type === "group");
  /** Add `webId`'s securing mark to a resource's ACL, as only a holder of Control could. */
  async function mark(
    acls: Awaited<ReturnType<typeof pod>>["acls"],
    resource: string,
    webId: string,
  ) {
    const own = `${resource}.acl`;
    const dataset = await parseRdf(acls.get(own)?.body as string, "text/turtle", { baseIRI: own });
    SetFrom.subjectPredicate(
      new TermWrapper(own, dataset, DataFactory),
      SecuringBy,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    ).add(webId);
    acls.set(own, { body: new Writer().quadsToString([...dataset]), etag: '"marked"' });
  }

  it("refuses Keep for the planted settings, and the next pass deletes them (PoC V7)", async () => {
    const { directory, storage, fetch, acls, puts, group } = await interrupted();
    // The rewrite that made the folder owner-only also marked it as being secured.
    expect(acls.get(`${folder}.acl`)?.body).toContain("securingBy");
    expect(acls.get(`${folder}.acl`)?.body).not.toContain("sealedBy");
    expect(await directory.unverified()).toEqual([
      {
        folder: "settings",
        documents: [settings],
        contents: [
          {
            url: settings,
            inherits: true,
            kind: "settings",
            family: null,
            spaces: [`${root}private/`],
          },
        ],
        planted: true,
        keepable: false,
      },
    ]);
    // Before the fix, Keep sealed the planted settings and Family got Editor on private/.
    await expect(directory.verifyFolder("settings", "keep")).rejects.toThrow(SECURING_INTERRUPTED);
    expect(acls.get(`${folder}.acl`)?.body).not.toContain("sealedBy");
    expect(await storage.read(settings)).toBeDefined();
    const create = vi.fn(async () => [`${root}new/`]);
    await expect(
      directory.setupFamily(group.id, [{ key: "calendar", role: "editor", create }]),
    ).rejects.toThrow(SECURING_RACE);
    await expect(storage.read(settings)).rejects.toMatchObject({ code: "not-found" });
    expect(acls.get(`${folder}.acl`)?.body).toContain("sealedBy");
    expect(acls.get(`${folder}.acl`)?.body).not.toContain("securingBy");
    expect(await directory.unverified()).toEqual([]);
    await directory.verifyFolder("settings", "keep");
    await directory.setupFamily(group.id, [{ key: "calendar", role: "editor", create }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(puts).not.toContain(`${root}private/.acl`);
    expect(await groupOnPrivate(fetch)).toBe(false);
  });
  it("never lets a mark the owner didn't write, or a mark on a sealed folder, delete groups", async () => {
    const { directory, storage, acls, putAcl } = await pod();
    const family = await directory.create("Family", [bob]);
    // A mark next to the owner's seal (only a holder of Control could write it) changes nothing.
    await mark(acls, groups, owner);
    expect((await directory.create("Team", [bob])).name).toBe("Team");
    expect((await directory.list()).map((group) => group.name)).toEqual(["Family", "Team"]);
    // Mallory's mark on an unsealed folder is not the owner's: the owner still decides.
    await putAcl(groups, policy(ownerRule(), rule({ kind: "public" }, ["read"])));
    await mark(acls, groups, mallory);
    await expect(directory.create("Garden", [bob])).rejects.toThrow(GROUPS_UNVERIFIED);
    expect(await storage.read(doc(family.id))).toBeDefined();
    expect(await directory.unverified()).toMatchObject([
      { folder: "groups", planted: false, keepable: true },
    ]);
    await directory.verifyFolder("groups", "keep");
    expect((await directory.list()).map((group) => group.name)).toEqual(["Family", "Team"]);
  });
  it("stops discarding when another tab sealed the folder, so the group it created survives", async () => {
    const { directory, storage, fetch, acls } = await pod();
    const other = new GroupDirectory({ storage, fetch, webId: owner }, vi.fn());
    const listAll = storage.listAll.bind(storage);
    let raced = false;
    vi.spyOn(storage, "listAll").mockImplementation(async function* (url, options) {
      // Tab A has rewritten the new groups folder's ACL; before it lists what appeared, tab B
      // finishes securing it (A's mark tells B nothing in it is the owner's), seals it and
      // creates a group.
      if (url === groups && acls.has(`${groups}.acl`) && !raced) {
        raced = true;
        await other.create("Team", [bob]);
      }
      yield* listAll(url, options);
    });
    const family = await directory.create("Family", [mallory]);
    expect(raced).toBe(true);
    expect((await directory.list()).map((group) => group.name)).toEqual(["Family", "Team"]);
    expect(family.name).toBe("Family");
    expect(acls.get(`${groups}.acl`)?.body).toContain("sealedBy");
  });
});

describe("ownerOnlyAccess with real ACLs", () => {
  it("checks raw modes, including the scope a new child inherits", async () => {
    const { storage, fetch, putAcl } = await pod();
    const session = { storage, fetch, webId: owner };
    const target = `${root}tasks/family/index.ttl`;
    expect(await ownerOnlyAccess(session, target)).toBe(true);
    await putAcl(root, policy(ownerRule(), rule({ kind: "authenticated" }, ["append"], "members")));
    expect(await ownerOnlyAccess(session, target)).toBe(false);
    await putAcl(root, policy(ownerRule(), rule(agent(mallory), ["write"])));
    expect(await ownerOnlyAccess(session, target)).toBe(false);
    // Owner Write without Control does not manage the scope a new child inherits.
    await putAcl(
      root,
      policy(ownerRule("resource"), rule(agent(owner), ["read", "write"], "members")),
    );
    expect(await ownerOnlyAccess(session, target)).toBe(false);
    await putAcl(root, policy(ownerRule()));
    const file = await storage.create(root, "x", { name: "own.txt", contentType: "text/plain" });
    await putAcl(file.url, probe("resource"));
    expect(await ownerOnlyAccess(session, file.url)).toBe(false);
    await putAcl(file.url, policy(ownerRule("resource")));
    expect(await ownerOnlyAccess(session, file.url)).toBe(true);
  });
});
