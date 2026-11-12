// AUTHORED-BY Claude Opus 5.5
// Real WAC documents through the real pod-access roles layer: no mocked grants. ACL bodies are
// serialised with pod-access writeWac (n3.Writer) and parsed back with fetch-rdf.

import { parseRdf } from "@jeswr/fetch-rdf";
import { type EffectivePolicy, type Grant, writeWac } from "@jeswr/pod-access";
import { readGrants } from "@jeswr/pod-access/roles";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { GROUP_TARGET, GROUP_UNSAFE, GroupDirectory, ownerOnlyAccess } from "../src/index.js";

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

/** A memory pod whose resources advertise `<url>.acl`, served and conditionally written over HTTP. */
async function pod() {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  Object.assign(storage.features.accessControl, { state: "available", detail: { model: "wac" } });
  const exists = storage.head.bind(storage);
  vi.spyOn(storage, "head").mockImplementation(async (url, options) => ({
    ...(await exists(url, options)),
    links: new Map([["acl", [{ target: `${url}.acl`, params: {} }]]]),
  }));
  const acls = new Map<string, { body: string; etag: string }>();
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
  it("trusts pre-existing settings whose folder and document were owner-only all along", async () => {
    const { directory, group } = await preexisting(policy(ownerRule()));
    expect((await directory.list())[0]).toMatchObject({ id: group.id, family: true });
  });
});

describe("collection contents follow the collection's groups (review round 2)", () => {
  it("grants every listed group holding the source Viewer access to added contents", async () => {
    const { directory, storage, fetch, putAcl, puts, acls } = await pod();
    const group = await directory.create("Family", [bob]);
    const other = await directory.create("Unshared", [mallory]);
    const album = await storage.create(root, "a", {
      name: "album.ttl",
      contentType: "text/turtle",
    });
    const photo = await storage.create(root, "p", {
      name: "photo.ttl",
      contentType: "text/turtle",
    });
    const original = await storage.create(root, "o", {
      name: "photo.jpg",
      contentType: "image/jpeg",
    });
    // Nothing shared yet: no reads of the contents' access, no writes.
    const start = puts.length;
    expect(await directory.extend(album.url, [photo.url])).toEqual([]);
    expect(puts.slice(start)).toEqual([]);
    await directory.share(group.id, album.url, "editor");
    expect(await directory.extend(album.url, [])).toEqual([]);
    expect(await directory.extend(album.url, [photo.url, original.url, photo.url])).toEqual([
      group.id,
    ]);
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
    expect(await directory.extend(album.url, [photo.url])).toEqual([]);
    expect(puts.slice(before)).toEqual([]);
  });
  it.each([
    [root, `${root}photo.ttl`],
    [`${root}album.ttl`, `${root}settings/x`],
    [`${root}album.ttl`, `${root}groups/a.ttl`],
  ])("refuses reserved collections or contents (%s, %s)", async (source, target) => {
    const { directory } = await pod();
    await expect(directory.extend(source, [target])).rejects.toThrow(GROUP_TARGET);
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
