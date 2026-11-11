// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { NoteSharingAdapter } from "../src/apps/notes/lib/sharing";
import { ShareError } from "../src/shell/share/types";
import { VerifiedWacSharingAdapter } from "../src/shell/share/verified-wac-adapter";
import "./drive-ui-dom";
import { harness, POD } from "./sheets-workbook-helpers";

const signal = () => new AbortController().signal;
const BOB = "https://pod.example/bob/#me";
const CAROL = "https://pod.example/carol/#me";
async function setup() {
  const fixture = await harness();
  const image = `${POD}notes/media/race.png`;
  const note = await createNotesStore(fixture.options).create({
    title: "Concurrent sharing",
    body: `<img src="${image}">`,
  });
  await fixture.pod.fetch(image, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: "image",
  });
  const session = { ...fixture.options, storageUrl: POD, mode: "demo" };
  const access = new VerifiedWacSharingAdapter(session);
  for (const url of [note.url, image]) {
    await access.load(url, signal());
    await access.setPerson(url, BOB, "editor");
    await access.setGeneral(url, { mode: "link", role: "editor" });
  }
  const adapter = new NoteSharingAdapter(note, session, access);
  expect(adapter.images).toEqual([image]);
  await adapter.load(note.url, signal());
  fixture.calls.length = 0;
  return { ...fixture, note, image, session, access, adapter };
}

it.each([
  null,
  "viewer",
] as const)("refuses narrowOnly person grants after the current role changes to %s", async (role) => {
  const { note, session, adapter, calls } = await setup();
  const other = new VerifiedWacSharingAdapter(session);
  await other.load(note.url, signal());
  await other.setPerson(note.url, BOB, role);
  calls.length = 0;

  await expect(
    adapter.setPerson(note.url, BOB, "editor", { narrowOnly: true }),
  ).rejects.toMatchObject({ code: "would-grant" });
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
  expect(
    (await other.load(note.url, signal())).people.find((person) => person.webId === BOB)?.role,
  ).toBe(role ?? undefined);
});

it.each([
  { mode: "restricted" },
  { mode: "link", role: "viewer" },
] as const)("refuses narrowOnly general grants after access changes to %j", async (general) => {
  const { note, session, adapter, calls } = await setup();
  const other = new VerifiedWacSharingAdapter(session);
  await other.load(note.url, signal());
  await other.setGeneral(note.url, general);
  calls.length = 0;

  await expect(
    adapter.setGeneral(note.url, { mode: "link", role: "editor" }, { narrowOnly: true }),
  ).rejects.toMatchObject({ code: "would-grant" });
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
  expect((await other.load(note.url, signal())).general).toEqual(general);
});

it.each(["person", "general"] as const)("allows a narrowOnly %s downgrade", async (kind) => {
  const { note, image, access, adapter, calls } = await setup();
  if (kind === "person") await adapter.setPerson(note.url, BOB, "viewer", { narrowOnly: true });
  else await adapter.setGeneral(note.url, { mode: "link", role: "viewer" }, { narrowOnly: true });

  expect(calls.filter((call) => call.method === "PUT").map((call) => call.url)).toEqual([
    `${note.url}.acl`,
    `${image}.acl`,
  ]);
  for (const url of [note.url, image]) {
    const saved = await access.load(url, signal());
    if (kind === "person") expect(saved.people).toContainEqual({ webId: BOB, role: "viewer" });
    else expect(saved.general).toEqual({ mode: "link", role: "viewer" });
  }
  expect((await adapter.load(note.url, signal())).updateWarning).toBeUndefined();
});

it.each([
  "person",
  "general",
] as const)("refuses a note downgrade that would grant %s access on the reloaded policy", async (kind) => {
  const { note, image, session, access, adapter, calls } = await setup();
  const other = new VerifiedWacSharingAdapter(session);
  await other.load(note.url, signal());
  let afterConcurrentWrite = 0;
  if (kind === "person") {
    const original = access.setPerson.bind(access);
    vi.spyOn(access, "setPerson").mockImplementation(async (url, webId, role, opts) => {
      expect(opts?.narrowOnly).toBe(true);
      await other.setPerson(url, webId, null);
      afterConcurrentWrite = calls.length;
      return original(url, webId, role, opts);
    });
  } else {
    const original = access.setGeneral.bind(access);
    vi.spyOn(access, "setGeneral").mockImplementation(async (url, general, opts) => {
      expect(opts?.narrowOnly).toBe(true);
      await other.setGeneral(url, { mode: "restricted" });
      afterConcurrentWrite = calls.length;
      return original(url, general, opts);
    });
  }
  const change =
    kind === "person"
      ? adapter.setPerson(note.url, BOB, "viewer")
      : adapter.setGeneral(note.url, { mode: "link", role: "viewer" });
  await expect(change).rejects.toMatchObject({ code: "would-grant" });
  expect(afterConcurrentWrite).toBeGreaterThan(0);
  expect(calls.slice(afterConcurrentWrite).some((call) => call.method === "PUT")).toBe(false);
  const saved = await other.load(note.url, signal());
  if (kind === "person") expect(saved.people.some((person) => person.webId === BOB)).toBe(false);
  else expect(saved.general.mode).toBe("restricted");
  expect(calls.some((call) => call.method === "PUT" && call.url === `${image}.acl`)).toBe(false);
  expect((await adapter.load(note.url, signal())).updateWarning).toBeUndefined();
});

it.each([
  "person",
  "general",
] as const)("refuses an image downgrade that would reintroduce %s access after its reload", async (kind) => {
  const { note, image, session, access, adapter, calls } = await setup();
  const other = new VerifiedWacSharingAdapter(session);
  await other.load(image, signal());
  let afterConcurrentWrite = 0;
  if (kind === "person") {
    const original = access.setPerson.bind(access);
    vi.spyOn(access, "setPerson").mockImplementation(async (url, webId, role, opts) => {
      expect(opts?.narrowOnly).toBe(true);
      if (url === image) {
        await other.setPerson(image, webId, null);
        afterConcurrentWrite = calls.length;
      }
      return original(url, webId, role, opts);
    });
  } else {
    const original = access.setGeneral.bind(access);
    vi.spyOn(access, "setGeneral").mockImplementation(async (url, general, opts) => {
      expect(opts?.narrowOnly).toBe(true);
      if (url === image) {
        await other.setGeneral(image, { mode: "restricted" });
        afterConcurrentWrite = calls.length;
      }
      return original(url, general, opts);
    });
  }
  if (kind === "person") await adapter.setPerson(note.url, BOB, "viewer");
  else await adapter.setGeneral(note.url, { mode: "link", role: "viewer" });
  expect(afterConcurrentWrite).toBeGreaterThan(0);
  expect(calls.slice(afterConcurrentWrite).some((call) => call.method === "PUT")).toBe(false);
  const saved = await other.load(image, signal());
  if (kind === "person") expect(saved.people.some((person) => person.webId === BOB)).toBe(false);
  else expect(saved.general.mode).toBe("restricted");
  expect((await adapter.load(note.url, signal())).updateWarning).toContain(image);
});

it.each([
  "person",
  "general",
] as const)("uses the reloaded ETag and preserves concurrent unrelated grants during a normal %s revocation", async (kind) => {
  const { note, image, session, access, adapter, calls, pod } = await setup();
  const other = new VerifiedWacSharingAdapter(session);
  const etags = new Map<string, string>();
  async function concurrent(url: string) {
    await other.load(url, signal());
    await other.setPerson(url, CAROL, "viewer");
    etags.set(`${url}.acl`, (await pod.fetch(`${url}.acl`)).headers.get("etag") as string);
  }
  if (kind === "person") {
    const original = access.setPerson.bind(access);
    vi.spyOn(access, "setPerson").mockImplementation(async (url, ...args) => {
      await concurrent(url);
      return original(url, ...args);
    });
    await adapter.setPerson(note.url, BOB, null);
  } else {
    const original = access.setGeneral.bind(access);
    vi.spyOn(access, "setGeneral").mockImplementation(async (url, ...args) => {
      await concurrent(url);
      return original(url, ...args);
    });
    await adapter.setGeneral(note.url, { mode: "restricted" });
  }
  for (const url of [note.url, image]) {
    const writes = calls.filter((call) => call.method === "PUT" && call.url === `${url}.acl`);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.headers.get("if-match")).toBe(etags.get(`${url}.acl`));
    const saved = await other.load(url, signal());
    expect(saved.people).toContainEqual({ webId: CAROL, role: "viewer" });
    if (kind === "person") expect(saved.people.some((person) => person.webId === BOB)).toBe(false);
    else expect(saved.general.mode).toBe("restricted");
  }
  expect((await adapter.load(note.url, signal())).updateWarning).toBeUndefined();
});

it.each([
  "person",
  "general",
] as const)("reconciles a real %s setter rejection after commit and revokes the images", async (kind) => {
  const { note, image, adapter, access, calls, setHook } = await setup();
  let remainingFailures = 0;
  setHook((call) => {
    if (call.url !== `${note.url}.acl`) return;
    if (call.method === "PUT") remainingFailures = 2;
    if (call.method === "GET" && remainingFailures-- > 0)
      return new Response(null, { status: 503 });
  });
  const setter = vi.spyOn(access, kind === "person" ? "setPerson" : "setGeneral");
  if (kind === "person") await adapter.setPerson(note.url, BOB, null);
  else await adapter.setGeneral(note.url, { mode: "restricted" });
  await expect(setter.mock.results[0]?.value).rejects.toMatchObject({ code: "network" });
  const saved = await access.load(image, signal());
  if (kind === "person") expect(saved.people.some((person) => person.webId === BOB)).toBe(false);
  else expect(saved.general.mode).toBe("restricted");
  expect(calls.some((call) => call.method === "PUT" && call.url === `${image}.acl`)).toBe(true);
  expect((await adapter.load(note.url, signal())).updateWarning).toBeUndefined();
});

it.each([
  "person",
  "general",
] as const)("retains pending images when an ambiguous %s PUT commits after an unchanged reconciliation read", async (kind) => {
  const { note, image, adapter, access, calls, setHook, pod } = await setup();
  let pending: { url: string; init: RequestInit } | undefined;
  setHook((call) => {
    if (call.method === "PUT" && call.url === `${note.url}.acl`) {
      pending = call;
      return new Response(null, { status: 503 });
    }
  });
  const change =
    kind === "person"
      ? adapter.setPerson(note.url, BOB, null)
      : adapter.setGeneral(note.url, { mode: "restricted" });
  await expect(change).rejects.toMatchObject({ code: "network" });
  expect(calls.some((call) => call.method === "PUT" && call.url === `${image}.acl`)).toBe(false);
  expect((await access.load(image, signal())).people).toContainEqual({
    webId: BOB,
    role: "editor",
  });
  expect((await access.load(image, signal())).general.role).toBe("editor");
  const unchanged = await adapter.load(note.url, signal());
  expect(unchanged.people).toContainEqual({ webId: BOB, role: "editor" });
  expect(unchanged.general.role).toBe("editor");
  expect(unchanged.updateWarning).toContain(image);

  // The failed request reaches storage only after recovery read the old policy.
  if (!pending) throw new Error("Expected a pending note ACL write");
  expect((await pod.fetch(pending.url, pending.init)).ok).toBe(true);
  const committed = await adapter.load(note.url, signal());
  if (kind === "person")
    expect(committed.people.some((person) => person.webId === BOB)).toBe(false);
  else expect(committed.general.mode).toBe("restricted");
  expect(committed.updateWarning).toContain(image);
  expect((await access.load(image, signal())).people).toContainEqual({
    webId: BOB,
    role: "editor",
  });
  expect((await access.load(image, signal())).general.role).toBe("editor");

  // A successful retry for the same audience reconciles the pending images.
  setHook(() => undefined);
  if (kind === "person") await adapter.setPerson(note.url, BOB, null);
  else await adapter.setGeneral(note.url, { mode: "restricted" });
  const reconciled = await access.load(image, signal());
  if (kind === "person")
    expect(reconciled.people.some((person) => person.webId === BOB)).toBe(false);
  else expect(reconciled.general.mode).toBe("restricted");
  expect((await adapter.load(note.url, signal())).updateWarning).toBeUndefined();
});

it.each([
  "person",
  "general",
] as const)("retains every image in the warning if a committed %s write cannot be reconciled", async (kind) => {
  const { note, image, adapter, access } = await setup();
  const load = access.load.bind(access);
  let committed = false;
  vi.spyOn(access, "load").mockImplementation(async (url, signal) => {
    if (url === note.url && committed) throw new ShareError("network");
    return load(url, signal);
  });
  if (kind === "person") {
    const original = access.setPerson.bind(access);
    vi.spyOn(access, "setPerson").mockImplementation(async (...args) => {
      await original(...args);
      committed = true;
      throw new ShareError("network");
    });
  } else {
    const original = access.setGeneral.bind(access);
    vi.spyOn(access, "setGeneral").mockImplementation(async (...args) => {
      await original(...args);
      committed = true;
      throw new ShareError("network");
    });
  }
  const change =
    kind === "person"
      ? adapter.setPerson(note.url, BOB, null)
      : adapter.setGeneral(note.url, { mode: "restricted" });
  await expect(change).rejects.toMatchObject({ code: "network" });
  committed = false;
  expect((await adapter.load(note.url, signal())).updateWarning).toContain(image);
  expect((await access.load(image, signal())).people).toContainEqual({
    webId: BOB,
    role: "editor",
  });
});

it.each([
  "person",
  "general",
] as const)("reports images when a committed %s write rejects and image access cannot be changed", async (kind) => {
  const { note, image, adapter, access, setHook } = await setup();
  if (kind === "person") {
    const original = access.setPerson.bind(access);
    vi.spyOn(access, "setPerson").mockImplementation(async (...args) => {
      await original(...args);
      if (args[0] === note.url) throw new ShareError("network");
    });
  } else {
    const original = access.setGeneral.bind(access);
    vi.spyOn(access, "setGeneral").mockImplementation(async (...args) => {
      await original(...args);
      if (args[0] === note.url) throw new ShareError("network");
    });
  }
  setHook((call) =>
    call.url === `${image}.acl` && call.method === "PUT"
      ? new Response(null, { status: 503 })
      : undefined,
  );
  if (kind === "person") await adapter.setPerson(note.url, BOB, null);
  else await adapter.setGeneral(note.url, { mode: "restricted" });
  expect((await adapter.load(note.url, signal())).updateWarning).toContain(image);
  expect((await access.load(image, signal())).people).toContainEqual({
    webId: BOB,
    role: "editor",
  });
  expect((await access.load(image, signal())).general.role).toBe("editor");
});

it("requires read-back confirmation even when a note or image setter resolves", async () => {
  const { note, image, adapter, access, calls } = await setup();
  const original = access.setPerson.bind(access);
  const setter = vi.spyOn(access, "setPerson").mockResolvedValue(undefined);
  await expect(adapter.setPerson(note.url, BOB, null)).rejects.toMatchObject({ code: "conflict" });
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
  setter.mockImplementation(async (...args) => {
    if (args[0] !== image) await original(...args);
  });
  await adapter.setPerson(note.url, BOB, null);
  expect((await adapter.load(note.url, signal())).updateWarning).toContain(image);
  // A refused retry must not erase an earlier unconfirmed image revocation.
  setter.mockRejectedValue(new ShareError("would-grant"));
  await expect(adapter.setPerson(note.url, BOB, null)).rejects.toMatchObject({
    code: "would-grant",
  });
  expect((await adapter.load(note.url, signal())).updateWarning).toContain(image);
});

it("retains pending images after a successful note setter followed by a failed reconciliation read", async () => {
  const { note, image, adapter, access } = await setup();
  const originalSet = access.setPerson.bind(access);
  const originalLoad = access.load.bind(access);
  let committed = false;
  vi.spyOn(access, "setPerson").mockImplementation(async (...args) => {
    await originalSet(...args);
    committed = true;
  });
  vi.spyOn(access, "load").mockImplementation(async (url, signal) => {
    if (committed && url === note.url) throw new ShareError("network");
    return originalLoad(url, signal);
  });
  await expect(adapter.setPerson(note.url, BOB, null)).rejects.toMatchObject({ code: "network" });
  committed = false;
  expect((await adapter.load(note.url, signal())).updateWarning).toContain(image);
});
