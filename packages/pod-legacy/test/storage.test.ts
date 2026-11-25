// AUTHORED-BY Codex GPT-6.1-Sol
import { ownerPolicy, writeAcp, writeWac } from "@jeswr/pod-access";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { createLegacyStore, LegacyPrivacyError, LegacyStorageRootError } from "../src/storage.js";
import { fixture, owner, plan, root, url } from "./fixture.js";

it("does not create a plan on load, creates only an empty resource before the privacy proof, and conditionally persists", async () => {
  const { storage, store } = await fixture();
  expect(await store.load()).toBeNull();
  const write = vi.spyOn(storage, "write");
  const create = vi.spyOn(storage, "create");
  const saved = await store.save(plan(), null);
  expect(saved.etag).toMatch(/^"/);
  expect(write).toHaveBeenCalledWith(
    url,
    expect.any(String),
    expect.objectContaining({ ifMatch: expect.stringMatching(/^"/) }),
  );
  expect(create.mock.calls.every(([, body]) => body === null)).toBe(true);
  expect((await store.load())?.plan).toEqual(plan());
  const edited = { ...saved.plan, enabled: false };
  await store.save(edited, saved.etag);
  expect((await store.load())?.plan?.enabled).toBe(false);
  await expect(store.save(plan(), saved.etag)).rejects.toMatchObject({
    code: "precondition-failed",
  });
  await expect(store.save(plan(), null)).rejects.toMatchObject({ code: "conflict" });
});
it("snapshots caller data before I/O", async () => {
  const { storage, store } = await fixture();
  const p = plan();
  const saving = store.save(p, null);
  p.contacts[0]!.targets = [root];
  p.enabled = false;
  expect((await saving).plan.enabled).toBe(true);
  expect((await store.load())?.plan?.contacts[0]?.targets).toHaveLength(2);
  expect((await storage.read(url)).etag).toBeTruthy();
});
it.each(["*", 'W/"weak"', "", "bad"])("rejects an unsafe validator %s", async (etag) => {
  const { store } = await fixture();
  await expect(store.save(plan(), etag)).rejects.toThrow("strong ETag");
});
it("requires correct owner/storage on writes and valid records", async () => {
  const { store } = await fixture();
  await expect(store.save({ ...plan(), owner: "https://other.example/#me" }, null)).rejects.toThrow(
    "another owner",
  );
  await expect(store.save({ ...plan(), storage: "https://other.example/" }, null)).rejects.toThrow(
    "another owner",
  );
  await expect(store.save({ ...plan(), contacts: [] }, null)).rejects.toThrow("incomplete");
  for (const input of [
    { owner: "bad", storage: { root } },
    { owner, storage: { root: root.slice(0, -1) } },
    { owner, storage: { root: "http://insecure.example/" } },
  ])
    expect(() =>
      createLegacyStore({
        ...input,
        storage: input.storage as StorageClient,
        fetch: globalThis.fetch,
        expectedRoot: root,
      }),
    ).toThrow();
});
it.each([
  ["an assumed origin root above the account's pod", "https://alice.example/", `${root}alice/`],
  ["another pod's root", root, "https://bob.example/"],
  ["an unsafe expected root", root, "http://alice.example/"],
  ["a missing expected root", root, ""],
])("refuses %s before any request, so nothing can be read, written or deleted", async (_, resolved, expectedRoot) => {
  const { storage, fetch } = await fixture();
  const calls = [
    vi.spyOn(storage, "read"),
    vi.spyOn(storage, "readRdf"),
    vi.spyOn(storage, "head"),
    vi.spyOn(storage, "write"),
    vi.spyOn(storage, "create"),
    vi.spyOn(storage, "delete"),
  ];
  const guarded = vi.fn(fetch);
  expect(() =>
    createLegacyStore({
      storage: { ...storage, root: resolved },
      owner,
      fetch: guarded,
      expectedRoot,
    }),
  ).toThrow(LegacyStorageRootError);
  for (const call of calls) expect(call).not.toHaveBeenCalled();
  expect(guarded).not.toHaveBeenCalled();
});
it("accepts an expected root equal to the resolved root after URL normalisation", async () => {
  const { storage, fetch } = await fixture();
  const store = createLegacyStore({
    storage,
    owner,
    fetch,
    expectedRoot: "https://ALICE.example/",
  });
  expect(await store.load()).toBeNull();
});
describe("owner-only verification", () => {
  it.each([
    "read",
    "write",
    "control",
  ] as const)("refuses another agent's %s even when a role projection cannot represent it", async (mode) => {
    const { storage, store } = await fixture();
    const first = await store.save(plan(), null);
    const policy = ownerPolicy(owner, true);
    policy.grants.push({
      ...policy.grants[0]!,
      modes: new Set([mode]),
      who: [[{ kind: "agent", webId: "https://other.example/#me" }]],
    });
    const acl = await storage.read(`${root}.acl`);
    await storage.write(`${root}.acl`, await writeWac(policy, root, `${root}.acl`), {
      contentType: "text/turtle",
      ifMatch: acl.etag!,
    });
    const write = vi.spyOn(storage, "write");
    await expect(store.save(plan(), first.etag)).rejects.toBeInstanceOf(LegacyPrivacyError);
    expect(write).not.toHaveBeenCalled();
    await expect(store.load()).rejects.toBeInstanceOf(LegacyPrivacyError);
  });
  it.each([
    { kind: "public" },
    { kind: "authenticated" },
    { kind: "group", group: "https://groups.example/family" },
  ] as const)("refuses broad selector %s", async (subject) => {
    const { storage, store } = await fixture();
    const policy = ownerPolicy(owner, true);
    policy.grants.push({ ...policy.grants[0]!, who: [[subject]], modes: new Set(["read"]) });
    const acl = await storage.read(`${root}.acl`);
    await storage.write(`${root}.acl`, await writeWac(policy, root, `${root}.acl`), {
      contentType: "text/turtle",
      ifMatch: acl.etag!,
    });
    await expect(store.save(plan(), null)).rejects.toBeInstanceOf(LegacyPrivacyError);
    await expect(storage.read(url)).rejects.toMatchObject({ code: "not-found" });
  });
  it("accepts private own ACLs on settings and the plan under a public ancestor and does not edit ACLs", async () => {
    const { storage, store } = await fixture();
    const saved = await store.save(plan(), null);
    await storage.create(
      `${root}settings/`,
      await writeWac(ownerPolicy(owner), url, `${url}.acl`),
      { name: "legacy-plan.ttl.acl", contentType: "text/turtle" },
    );
    await storage.create(
      `${root}settings/`,
      await writeWac(ownerPolicy(owner, true), `${root}settings/`, `${root}settings/.acl`),
      { name: ".acl", contentType: "text/turtle" },
    );
    const acl = await storage.read(`${root}.acl`);
    const policy = ownerPolicy(owner, true);
    policy.grants.push({
      ...policy.grants[0]!,
      who: [[{ kind: "public" }]],
      modes: new Set(["read"]),
    });
    await storage.write(`${root}.acl`, await writeWac(policy, root, `${root}.acl`), {
      contentType: "text/turtle",
      ifMatch: acl.etag!,
    });
    const write = vi.spyOn(storage, "write");
    await store.save(plan(), saved.etag);
    expect(write.mock.calls.map(([target]) => target)).toEqual([url]);
  });
  it("refuses unknown access, missing ACLs, insufficient owner rights, and transport failure", async () => {
    for (const kind of ["unknown", "missing", "read-only", "no-modes", "network"]) {
      const { storage, store } = await fixture();
      const acl = await storage.read(`${root}.acl`);
      if (kind === "unknown")
        await storage.write(`${root}.acl`, "<urn:unknown> <urn:predicate> <urn:value>.", {
          contentType: "text/turtle",
          ifMatch: acl.etag!,
        });
      else if (kind === "missing") await storage.delete(`${root}.acl`, { ifMatch: acl.etag! });
      else if (kind === "network")
        vi.spyOn(storage, "readRdf").mockRejectedValue(new Error("offline"));
      else {
        const policy = ownerPolicy(owner, true);
        policy.grants[0]!.modes = new Set(kind === "read-only" ? ["read"] : []);
        await storage.write(`${root}.acl`, await writeWac(policy, root, `${root}.acl`), {
          contentType: "text/turtle",
          ifMatch: acl.etag!,
        });
      }
      await expect(store.save(plan(), null)).rejects.toBeInstanceOf(LegacyPrivacyError);
    }
  });
  it("refuses unsupported LWS before creating anything", async () => {
    const { storage, fetch } = await fixture();
    const other = { ...storage, protocol: "lws" as const };
    const create = vi.spyOn(other, "create");
    await expect(
      createLegacyStore({ storage: other, fetch, owner, expectedRoot: root }).save(plan(), null),
    ).rejects.toBeInstanceOf(LegacyPrivacyError);
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects ambiguous/foreign/queried ACL links and missing access metadata", async () => {
    for (const targets of [
      [],
      [`${root}.acl`, `${root}.acl`],
      ["https://foreign.example/.acl"],
      [`${root}.acl?x`],
      [`${root}.acl#x`],
    ]) {
      const { storage, store } = await fixture();
      const saved = await store.save(plan(), null);
      const head = storage.head.bind(storage);
      vi.spyOn(storage, "head").mockImplementation(async (target) => ({
        ...(await head(target)),
        links: new Map([["acl", targets.map((target) => ({ target, params: {} }))]]),
      }));
      await expect(store.save(plan(), saved.etag)).rejects.toBeInstanceOf(LegacyPrivacyError);
    }
  });
});
it("never repairs or evaluates malformed saved data, and reports it as replaceable or deletable", async () => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  const { serializePlan } = await import("../src/model.js");
  for (const body of [
    " ",
    "<<< not turtle",
    await serializePlan(url, { ...plan(), owner: "https://other.example/#me" }),
    await serializePlan(url, {
      ...plan(),
      storage: "https://other.example/",
      enabled: false,
      contacts: [],
    }),
  ]) {
    const before = await storage.head(url);
    await storage.write(url, body, { contentType: "text/turtle", ifMatch: before.etag! });
    const etag = (await storage.head(url)).etag!;
    expect(await store.load()).toEqual({ plan: null, etag, invalid: true });
  }
  // Replace: a conditional write with the invalid version's ETag.
  const invalid = (await store.load())!;
  const replaced = await store.save(plan(), invalid.etag);
  expect((await store.load())?.plan).toEqual(plan());
  // Delete: equally conditional, exactly the plan resource.
  await storage.write(url, " ", { contentType: "text/turtle", ifMatch: replaced.etag });
  const remove = vi.spyOn(storage, "delete");
  await store.delete((await store.load())!.etag);
  expect(remove).toHaveBeenCalledExactlyOnceWith(url, expect.any(Object));
  expect(await store.load()).toBeNull();
  expect(saved.etag).not.toBe(replaced.etag);
});
it("refuses invalid content on a pod that fails the privacy proof, without exposing it", async () => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  await storage.write(url, " ", { contentType: "text/turtle", ifMatch: saved.etag });
  const rdf = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation(async (target, opts) => {
    if (target !== url) throw new Error("unreadable ACL");
    return rdf(target, opts);
  });
  await expect(store.load()).rejects.toBeInstanceOf(LegacyPrivacyError);
});
it("propagates RDF read failures other than not-rdf", async () => {
  const { storage, store } = await fixture();
  await store.save(plan(), null);
  const rdf = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation(async (target, opts) => {
    if (target === url) throw new StorageError("server", { url, method: "GET" });
    return rdf(target, opts);
  });
  await expect(store.load()).rejects.toMatchObject({ code: "server" });
});
it("propagates non-404 load and creation errors", async () => {
  const { storage, store } = await fixture();
  vi.spyOn(storage, "read").mockRejectedValue(new Error("offline"));
  await expect(store.load()).rejects.toThrow("offline");
  vi.spyOn(storage, "head").mockRejectedValue(new Error("offline"));
  await expect(store.save(plan(), null)).rejects.toThrow("offline");
});
it("does not trust redirected creation URLs, nonempty placeholders, or missing validators", async () => {
  for (const kind of [
    "settings-location",
    "resource-location",
    "nonempty",
    "weak",
    "no-response-etag",
  ]) {
    const { storage, store } = await fixture();
    if (kind.endsWith("location")) {
      const create = storage.create.bind(storage);
      vi.spyOn(storage, "create").mockImplementation(async (...args) => {
        const result = await create(...args);
        return args[2]?.name === (kind === "settings-location" ? "settings" : "legacy-plan.ttl")
          ? { ...result, url: `${root}other/` }
          : result;
      });
    } else if (kind === "nonempty" || kind === "weak") {
      const read = storage.read.bind(storage);
      vi.spyOn(storage, "read").mockImplementation(async (...args) => {
        const result = await read(...args);
        return args[0] === url
          ? {
              ...result,
              ...(kind === "nonempty"
                ? { body: new Blob([new Uint8Array([1])]).stream() }
                : { etag: null }),
            }
          : result;
      });
    } else {
      const write = storage.write.bind(storage);
      vi.spyOn(storage, "write").mockImplementation(async (...args) => ({
        ...(await write(...args)),
        etagSource: "follow-up",
      }));
    }
    if (kind === "no-response-etag") expect((await store.save(plan(), null)).etag).toMatch(/^"/);
    else await expect(store.save(plan(), null)).rejects.toThrow();
  }
});
it("refuses unsupported protocol on load and an ancestor escaping storage", async () => {
  const { storage, store, fetch } = await fixture();
  const saved = await store.save(plan(), null);
  await expect(
    createLegacyStore({
      storage: { ...storage, protocol: "lws" },
      owner,
      fetch,
      expectedRoot: root,
    }).load(),
  ).rejects.toBeInstanceOf(LegacyPrivacyError);
  const within = storage.isWithinStorage.bind(storage);
  vi.spyOn(storage, "isWithinStorage").mockImplementation((target) =>
    target === `${root}settings/` ? false : within(target),
  );
  await expect(store.save(plan(), saved.etag)).rejects.toBeInstanceOf(LegacyPrivacyError);
});
it("preflights future member privacy and allows retry after the owner makes settings private", async () => {
  const { storage, store } = await fixture();
  const publicPolicy = ownerPolicy(owner, true);
  publicPolicy.grants.push({
    ...publicPolicy.grants[0]!,
    who: [[{ kind: "public" }]],
    modes: new Set(["read"]),
  });
  const original = await storage.read(`${root}.acl`);
  const publicAcl = await storage.write(
    `${root}.acl`,
    await writeWac(publicPolicy, root, `${root}.acl`),
    { contentType: "text/turtle", ifMatch: original.etag! },
  );
  await expect(store.save(plan(), null)).rejects.toBeInstanceOf(LegacyPrivacyError);
  await expect(storage.head(url)).rejects.toMatchObject({ code: "not-found" });
  await storage.write(
    `${root}.acl`,
    await writeWac(ownerPolicy(owner, true), root, `${root}.acl`),
    { contentType: "text/turtle", ifMatch: publicAcl.etag! },
  );
  await store.save(plan(), null);
  expect((await store.load())?.plan).toEqual(plan());
});
it.each([
  "privacy-race",
  "412",
  "503",
  "offline",
  "weak-etag",
  "fenced-abort",
])("recovers an empty first-save placeholder after %s using its ETag", async (kind) => {
  const { storage, store, fetch } = await fixture();
  const write = vi.spyOn(storage, "write");
  let restore = () => {};
  if (kind === "privacy-race") {
    const head = storage.head.bind(storage);
    const spy = vi.spyOn(storage, "head").mockImplementation(async (target) => {
      if (target === url) throw new Error("privacy changed");
      return head(target);
    });
    restore = () => spy.mockRestore();
  } else if (kind === "weak-etag") {
    const read = storage.read.bind(storage);
    const spy = vi.spyOn(storage, "read").mockImplementation(async (target, opts) => ({
      ...(await read(target, opts)),
      etag: target === url ? 'W/"weak"' : '"acl"',
    }));
    restore = () => spy.mockRestore();
  } else {
    write.mockRejectedValueOnce(
      kind === "fenced-abort"
        ? new DOMException("The account changed", "AbortError")
        : new StorageError(
            kind === "412" ? "precondition-failed" : kind === "503" ? "server" : "network",
            { url, method: "PUT" },
          ),
    );
  }
  await expect(store.save(plan(), null)).rejects.toThrow();
  expect((await storage.read(url)).bytes).toBeTypeOf("function");
  expect(await (await storage.read(url)).bytes()).toHaveLength(0);
  expect(write.mock.calls.filter(([target]) => target === url)).toHaveLength(
    kind === "privacy-race" || kind === "weak-etag" ? 0 : 1,
  );
  restore();
  // A new account-fenced store/session can resume without deleting or creating the resource.
  const resumed = createLegacyStore({ storage, fetch, owner, expectedRoot: root });
  const empty = await resumed.load();
  expect(empty).toEqual({ plan: null, etag: (await storage.head(url)).etag });
  const create = vi.spyOn(storage, "create");
  await resumed.save(plan(), empty!.etag);
  expect(create).not.toHaveBeenCalled();
  expect((await resumed.load())?.plan).toEqual(plan());
});
it("privacy and strong validators are required even for empty resources", async () => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  await storage.write(url, "", { ifMatch: saved.etag, contentType: "text/turtle" });
  const rdf = vi.spyOn(storage, "readRdf").mockRejectedValue(new Error("unknown access"));
  await expect(store.load()).rejects.toBeInstanceOf(LegacyPrivacyError);
  rdf.mockRestore();
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation(async (...args) => ({
    ...(await read(...args)),
    etag: null,
  }));
  await expect(store.load()).rejects.toThrow("strong ETag");
});
it("refuses a changed version between raw and RDF observations", async () => {
  const { storage, store } = await fixture();
  await store.save(plan(), null);
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation(async (...args) => ({
    ...(await read(...args)),
    ...(args[0] === url ? { etag: '"raced"' } : {}),
  }));
  await expect(store.load()).rejects.toThrow("changed");
});
it.each([
  "missing",
  "empty",
  "weak",
  "follow-up",
])("reloads the full snapshot after a %s write validator", async (kind) => {
  const { storage, store } = await fixture();
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementation(async (...args) => ({
    ...(await write(...args)),
    etag: kind === "weak" ? 'W/"weak"' : kind === "empty" ? "" : null,
    etagSource: kind === "follow-up" ? "follow-up" : "response",
  }));
  const saved = await store.save(plan(), null);
  expect(saved.etag).toMatch(/^"/);
  await store.save({ ...saved.plan, enabled: false, contacts: [] }, saved.etag);
  expect((await store.load())?.plan).toMatchObject({ enabled: false, contacts: [] });
});
it.each(["deleted", "emptied"])("refuses when a validator-less write is then %s", async (kind) => {
  const { storage, store } = await fixture();
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementation(async (...args) => {
    const result = await write(...args);
    if (kind === "deleted") await storage.delete(url, { ifMatch: result.etag! });
    else await write(url, "", { ifMatch: result.etag!, contentType: "text/turtle" });
    return { ...result, etag: null };
  });
  await expect(store.save(plan(), null)).rejects.toThrow("changed");
});
it("deletes exactly the plan conditionally, without ACL or profile writes", async () => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  const remove = vi.spyOn(storage, "delete");
  await expect(store.delete("*")).rejects.toThrow("strong ETag");
  await expect(store.delete('W/"weak"')).rejects.toThrow("strong ETag");
  expect(remove).not.toHaveBeenCalled();
  const current = await store.save({ ...saved.plan, enabled: false, contacts: [] }, saved.etag);
  await expect(store.delete(saved.etag)).rejects.toMatchObject({ code: "precondition-failed" });
  const write = vi.spyOn(storage, "write");
  await store.delete(current.etag);
  expect(remove).toHaveBeenLastCalledWith(url, { ifMatch: current.etag });
  expect(remove.mock.calls.every(([target]) => target === url)).toBe(true);
  expect(write).not.toHaveBeenCalled();
  expect(await store.load()).toBeNull();
  expect((await storage.read(`${root}.acl`)).etag).toBeTruthy();
});
it("allows deleting a plan whose privacy proof fails, using the ETag from the refusal", async () => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  const acl = await storage.read(`${root}.acl`);
  const policy = ownerPolicy(owner, true);
  policy.grants.push({
    ...policy.grants[0]!,
    who: [[{ kind: "public" }]],
    modes: new Set(["read"]),
  });
  await storage.write(`${root}.acl`, await writeWac(policy, root, `${root}.acl`), {
    contentType: "text/turtle",
    ifMatch: acl.etag!,
  });
  const refusal = await store.load().catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(LegacyPrivacyError);
  expect((refusal as LegacyPrivacyError).etag).toBe(saved.etag);
  expect((refusal as LegacyPrivacyError).message).not.toContain("Alex");
  await store.delete((refusal as LegacyPrivacyError).etag!);
  await expect(storage.head(url)).rejects.toMatchObject({ code: "not-found" });
  // The ACL itself is untouched; the pod is still public until the owner changes it.
  expect(await (await storage.read(`${root}.acl`)).text()).toContain("xmlns.com/foaf/0.1/Agent");
});
it("does not expose a weak or missing ETag on a privacy refusal", async () => {
  const { storage, store } = await fixture();
  await store.save(plan(), null);
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation(async (target, opts) => ({
    ...(await read(target, opts)),
    ...(target === url ? { etag: 'W/"weak"' } : {}),
  }));
  vi.spyOn(storage, "readRdf").mockRejectedValue(new Error("unreadable ACL"));
  const refusal = await store.load().catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(LegacyPrivacyError);
  expect((refusal as LegacyPrivacyError).etag).toBeUndefined();
});
it("refuses an ACP pod through the WAC model pin before creating a plan", async () => {
  const { storage, store } = await fixture();
  const acl = await storage.read(`${root}.acl`);
  await storage.write(
    `${root}.acl`,
    await writeAcp(ownerPolicy(owner, true), root, `${root}.acl`, "css"),
    { ifMatch: acl.etag!, contentType: "text/turtle" },
  );
  const create = vi.spyOn(storage, "create");
  const proofRead = vi.spyOn(storage, "readRdf");
  await expect(store.save(plan(), null)).rejects.toBeInstanceOf(LegacyPrivacyError);
  expect(create.mock.calls.map(([, , opts]) => opts?.name)).not.toContain("legacy-plan.ttl");
  expect(proofRead).not.toHaveBeenCalled(); // The model pin refuses before the WAC proof.
});
it.each([
  "origin",
  "accessToClass",
  "defaultForNew",
  "unknownPredicate",
])("refuses unknown or unsupported WAC construct acl:%s", async (predicate) => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  const acl = await storage.read(`${root}.acl`);
  // Independent adversarial RDF fixture; the WAC writer intentionally cannot express this.
  const extra = `\n@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n<#unsupported> a acl:Authorization; acl:agent <${owner}>; acl:mode acl:Read; acl:accessTo <${root}>; acl:default <${root}>; acl:${predicate} <${root}>.\n`;
  await storage.write(`${root}.acl`, (await acl.text()) + extra, {
    ifMatch: acl.etag!,
    contentType: "text/turtle",
  });
  const write = vi.spyOn(storage, "write");
  await expect(store.load()).rejects.toBeInstanceOf(LegacyPrivacyError);
  await expect(store.save(plan(), saved.etag)).rejects.toBeInstanceOf(LegacyPrivacyError);
  expect(write).not.toHaveBeenCalled();
});
it("refuses an intermediate settings ACL with public direct access and owner-only defaults", async () => {
  const { storage, store } = await fixture();
  const settings = `${root}settings/`;
  await storage.create(root, null, { kind: "container", name: "settings" });
  const policy = ownerPolicy(owner, true);
  policy.grants.push({
    ...policy.grants[0]!,
    appliesTo: "resource",
    who: [[{ kind: "public" }]],
    modes: new Set(["read"]),
  });
  await storage.create(settings, await writeWac(policy, settings, `${settings}.acl`), {
    name: ".acl",
    contentType: "text/turtle",
  });
  await expect(store.save(plan(), null)).rejects.toBeInstanceOf(LegacyPrivacyError);
  await expect(storage.read(url)).rejects.toMatchObject({ code: "not-found" });
});
it("a stale placeholder ETag cannot overwrite a plan filled by another tab", async () => {
  const { storage, store } = await fixture();
  vi.spyOn(storage, "write").mockRejectedValueOnce(new Error("offline"));
  await expect(store.save(plan(), null)).rejects.toThrow("offline");
  const empty = await store.load();
  const winner = await store.save(plan(), empty!.etag);
  await expect(store.save({ ...plan(), enabled: false }, empty!.etag)).rejects.toMatchObject({
    code: "precondition-failed",
  });
  expect(await store.load()).toEqual(winner);
});
it.each([
  "no-body",
  "zero-chunks",
  "stream-failure",
])("handles %s while probing for a zero-byte placeholder", async (kind) => {
  const { storage, store } = await fixture();
  await store.save(plan(), null);
  const read = storage.read.bind(storage);
  const cancelled = vi.fn();
  vi.spyOn(storage, "read").mockImplementation(async (...args) => ({
    ...(await read(...args)),
    body:
      kind === "no-body"
        ? null
        : new ReadableStream<Uint8Array>({
            start(controller) {
              if (kind === "stream-failure") controller.error(new Error("broken stream"));
              else {
                controller.enqueue(new Uint8Array());
                controller.enqueue(new Uint8Array([1]));
              }
            },
            cancel: cancelled,
          }),
  }));
  if (kind === "stream-failure") await expect(store.load()).rejects.toThrow("broken stream");
  else if (kind === "no-body") await expect(store.load()).rejects.toThrow("could not be read");
  else {
    expect((await store.load())?.plan).toEqual(plan());
    expect(cancelled).toHaveBeenCalledOnce();
  }
});
it.each([
  ["304", 304, true],
  ["206", 206, true],
  ["304 without body", 304, false],
] as const)("never treats a %s response as an empty placeholder", async (_, status, withBody) => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  const read = storage.read.bind(storage);
  const cancelled = vi.fn();
  vi.spyOn(storage, "read").mockImplementation(async (...args) => ({
    ...(await read(...args)),
    status,
    body: withBody ? new ReadableStream<Uint8Array>({ cancel: cancelled }) : null,
  }));
  const write = vi.spyOn(storage, "write");
  await expect(store.load()).rejects.toThrow("could not be read");
  if (withBody) expect(cancelled).toHaveBeenCalledOnce();
  // The first-save path applies the same rule to the placeholder it created.
  await storage.delete(url, { ifMatch: saved.etag });
  await expect(store.save(plan(), null)).rejects.toThrow("could not be read");
  expect(write).not.toHaveBeenCalled();
});
it("refuses public access to the settings folder itself on load and on later saves", async () => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  const settings = `${root}settings/`;
  // Public acl:accessTo settings/ (its listing), owner-only acl:default for its members.
  const policy = ownerPolicy(owner, true);
  policy.grants.push({
    ...policy.grants[0]!,
    appliesTo: "resource",
    who: [[{ kind: "public" }]],
    modes: new Set(["read"]),
  });
  await storage.create(settings, await writeWac(policy, settings, `${settings}.acl`), {
    name: ".acl",
    contentType: "text/turtle",
  });
  const write = vi.spyOn(storage, "write");
  await expect(store.load()).rejects.toBeInstanceOf(LegacyPrivacyError);
  await expect(store.save(plan(), saved.etag)).rejects.toBeInstanceOf(LegacyPrivacyError);
  expect(write).not.toHaveBeenCalled();
  // The same owner-only policy without the public direct grant is accepted.
  const acl = await storage.read(`${settings}.acl`);
  await storage.write(
    `${settings}.acl`,
    await writeWac(ownerPolicy(owner, true), settings, `${settings}.acl`),
    { contentType: "text/turtle", ifMatch: acl.etag! },
  );
  expect((await store.load())?.plan).toEqual(plan());
});
it("clamps stored timestamps later than the resource's Last-Modified plus five minutes", async () => {
  const { storage, store } = await fixture();
  const future = new Date("2099-01-01T00:00:00Z");
  const saved = await store.save(
    { ...plan(), created: plan().created, modified: future, lastActivity: future },
    null,
  );
  // The strong-ETag result is already clamped against the default device clock.
  expect(saved.plan.lastActivity.getTime()).toBeLessThanOrEqual(Date.now() + 300_000);
  const bound = (await storage.read(url)).lastModified!.getTime() + 300_000;
  const loaded = (await store.load())!.plan!;
  expect(loaded.lastActivity.getTime()).toBe(bound);
  expect(loaded.modified.getTime()).toBe(bound);
  expect(loaded.created).toEqual(plan().created);
  // Past timestamps stay exactly as stored.
  await store.save(plan(), (await store.load())!.etag);
  expect((await store.load())?.plan).toEqual(plan());
});
it("reports another writer's content after a validator-less write instead of claiming success", async () => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  const { serializePlan } = await import("../src/model.js");
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementation(async (...args) => {
    const result = await write(...args);
    // Another tab removes the contact between our write and our reload.
    await write(url, await serializePlan(url, { ...plan(), enabled: false, contacts: [] }), {
      contentType: "text/turtle",
      ifMatch: result.etag!,
    });
    return { ...result, etag: null };
  });
  await expect(store.save(plan(), saved.etag)).rejects.toThrow("changed in another tab");
});
it("accepts a validator-less write whose reload differs only in heartbeat timestamps", async () => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  const { serializePlan } = await import("../src/model.js");
  const later = new Date("2026-03-01T12:00:00Z");
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementation(async (...args) => {
    const result = await write(...args);
    await write(
      url,
      await serializePlan(url, { ...plan(), modified: later, lastActivity: later }),
      {
        contentType: "text/turtle",
        ifMatch: result.etag!,
      },
    );
    return { ...result, etag: null };
  });
  expect((await store.save(plan(), saved.etag)).plan.lastActivity).toEqual(later);
});
it("clamps a strong-ETag save result and a Last-Modified-less load against the bounded clock", async () => {
  const { storage, fetch } = await fixture();
  const clock = new Date("2026-06-01T12:00:00Z");
  const bound = clock.getTime() + 300_000;
  const store = createLegacyStore({ storage, owner, fetch, expectedRoot: root, now: () => clock });
  const future = new Date("2099-01-01T00:00:00Z");
  const saved = await store.save({ ...plan(), modified: future, lastActivity: future }, null);
  expect(saved.plan.lastActivity.getTime()).toBe(bound);
  expect(saved.plan.modified.getTime()).toBe(bound);
  expect(saved.plan.created).toEqual(plan().created);
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation(async (...args) => ({
    ...(await read(...args)),
    lastModified: null,
  }));
  const loaded = (await store.load())!.plan!;
  expect(loaded.lastActivity.getTime()).toBe(bound);
  expect(loaded.modified.getTime()).toBe(bound);
});
