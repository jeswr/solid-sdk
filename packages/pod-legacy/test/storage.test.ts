// AUTHORED-BY Codex GPT-6.1-Sol
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import type { StorageClient } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { createLegacyStore, LegacyPrivacyError } from "../src/storage.js";
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
  expect((await store.load())?.plan.enabled).toBe(false);
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
  expect((await store.load())?.plan.contacts[0]?.targets).toHaveLength(2);
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
      }),
    ).toThrow();
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
  it("accepts a private own ACL even under a public ancestor and does not edit ACLs", async () => {
    const { storage, store } = await fixture();
    const saved = await store.save(plan(), null);
    await storage.create(
      `${root}settings/`,
      await writeWac(ownerPolicy(owner), url, `${url}.acl`),
      { name: "legacy-plan.ttl.acl", contentType: "text/turtle" },
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
    for (const kind of ["missing", "read-only", "no-modes", "network"]) {
      const { storage, store } = await fixture();
      const acl = await storage.read(`${root}.acl`);
      if (kind === "missing") await storage.delete(`${root}.acl`, { ifMatch: acl.etag! });
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
      createLegacyStore({ storage: other, fetch, owner }).save(plan(), null),
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
it("never repairs or evaluates malformed saved data and rejects foreign ownership on load", async () => {
  const { storage, store } = await fixture();
  const saved = await store.save(plan(), null);
  await storage.write(url, "", { contentType: "text/turtle", ifMatch: saved.etag });
  await expect(store.load()).rejects.toThrow("invalid");
  const fresh = await storage.head(url);
  const { serializePlan } = await import("../src/model.js");
  await storage.write(
    url,
    await serializePlan(url, { ...plan(), owner: "https://other.example/#me" }),
    { contentType: "text/turtle", ifMatch: fresh.etag! },
  );
  await expect(store.load()).rejects.toThrow("invalid");
});
it("propagates non-404 load and creation errors", async () => {
  const { storage, store } = await fixture();
  vi.spyOn(storage, "readRdf").mockRejectedValue(new Error("offline"));
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
                ? { bytes: async () => new Uint8Array([1]) }
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
    if (kind === "no-response-etag") expect((await store.save(plan(), null)).etag).toBe("");
    else await expect(store.save(plan(), null)).rejects.toThrow();
  }
});
it("refuses unsupported protocol on load and an ancestor escaping storage", async () => {
  const { storage, store, fetch } = await fixture();
  const saved = await store.save(plan(), null);
  await expect(
    createLegacyStore({ storage: { ...storage, protocol: "lws" }, owner, fetch }).load(),
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
