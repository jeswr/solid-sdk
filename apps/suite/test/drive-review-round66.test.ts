// AUTHORED-BY Codex
import { expect, it } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT } from "./drive-wac-pod";

type Event = { url: string; method: string; conditional: boolean; check?: number };

async function parentScenario(
  step: "Move" | "Copy" | "remove",
  switchAt?: number | "parent preflight",
) {
  const f = await rdfPod();
  const source = `${PRIVATE}tree/`;
  const target = `${PUBLIC}tree/`;
  await f.pod.fetch(`${source}child`, { method: "PUT", body: "secret contents" });
  const parent = step === "remove" ? source : target;
  const alternate = `${parent}foreign.policy`;
  const foreign = await aclBody(parent, true);
  const events: Event[] = [];
  let checks = 0;
  let changed = false;
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const conditional = new Headers(init?.headers).has("if-match");
    const response = await f.fetch(input, init);
    const check = url === parent && method === "HEAD" && conditional ? ++checks : undefined;
    if (
      !changed &&
      ((check === switchAt && switchAt !== undefined) ||
        (switchAt === "parent preflight" &&
          checks > 0 &&
          url === parent &&
          method === "HEAD" &&
          !conditional))
    ) {
      changed = true;
      f.endpoints.set(parent, alternate);
      f.policies.set(alternate, foreign);
      response.headers.set("link", `<${alternate}>; rel="acl"`);
    }
    events.push({ url, method, conditional, ...(check ? { check } : {}) });
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const selected = await client.stat(source);
  const result = await (step === "remove"
    ? client.remove(source, { recursive: true, ifMatch: selected.etag as string })
    : step === "Move"
      ? client.move(
          source,
          target,
          { kind: "preserve-source" },
          { ifMatch: selected.etag as string },
        )
      : client.copy(
          source,
          target,
          { kind: "preserve-source" },
          { ifMatch: selected.etag as string },
        )
  ).catch((error: unknown) => error);
  return { f, source, target, parent, alternate, foreign, events, changed, result };
}

it.each([
  "Move",
  "Copy",
  "remove",
] as const)("round 66: %s asserts parent discovery on the final parent HEAD before a child mutation", async (step) => {
  const baseline = await parentScenario(step);
  expect(baseline.result).not.toBeInstanceOf(Error);
  const child = `${step === "remove" ? baseline.source : baseline.target}child`;
  const mutation = baseline.events.findIndex(
    (event) =>
      event.url === child &&
      event.conditional &&
      event.method === (step === "remove" ? "DELETE" : "PUT"),
  );
  expect(mutation).toBeGreaterThan(0);
  const boundary = baseline.events
    .slice(0, mutation)
    .filter((event) => event.check)
    .at(-1)?.check;
  expect(boundary).toBeGreaterThan(0);
  const s = await parentScenario(step, boundary);
  expect(s.changed).toBe(true);
  expect(s.result).toBeInstanceOf(Error);
  const changedAt = s.events.findIndex((event) => event.check === boundary);
  expect(
    s.events
      .slice(changedAt + 1)
      .filter(
        (event) => event.url === child && event.method === (step === "remove" ? "DELETE" : "PUT"),
      ),
  ).toEqual([]);
  expect(s.f.policies.get(s.alternate)).toBe(s.foreign);
  expect(s.f.calls).not.toContainEqual({ url: s.alternate, method: "PUT" });
  expect(await (await s.f.pod.fetch(`${s.source}child`)).text()).toBe("secret contents");
  if (step !== "remove")
    expect(await (await s.f.anonymous(child)).text()).not.toBe("secret contents");
});

it("round 66: recursive removal never replaces its captured ancestor endpoint with a fresher parent preflight", async () => {
  const s = await parentScenario("remove", "parent preflight");
  expect(s.changed).toBe(true);
  expect(s.result).toBeInstanceOf(Error);
  expect(s.f.calls).not.toContainEqual({ url: `${s.source}child`, method: "DELETE" });
  expect(await (await s.f.pod.fetch(`${s.source}child`)).text()).toBe("secret contents");
});

async function backupScenario(switchAt?: number, replayFailure = false) {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  let written = false;
  let cleared = false;
  let changed = false;
  let checks = 0;
  let backup: string | undefined;
  const events: Event[] = [];
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const conditional = new Headers(init?.headers).has("if-match");
    const response = await f.fetch(input, init);
    if (url === source && method === "PUT" && response.ok) {
      if (!written) {
        written = true;
        if (!replayFailure) {
          // Widen the captured endpoint's policy to enter quarantine without
          // changing its discovery; quarantine now pins the original endpoint too.
          f.policies.set(`${source}.policy`, await aclBody(source, true));
        }
      } else cleared = true;
    }
    if (
      written &&
      method === "PUT" &&
      url.includes("/.drive-recovery-") &&
      !url.endsWith("/") &&
      !url.endsWith(".policy")
    )
      backup ??= url;
    const check = url === backup && method === "HEAD" && conditional ? ++checks : undefined;
    if (check === switchAt && switchAt !== undefined) {
      changed = true;
      const alternate = `${url}foreign.policy`;
      f.endpoints.set(url, alternate);
      f.policies.set(alternate, await aclBody(url, true));
      response.headers.set("link", `<${alternate}>; rel="acl"`);
    }
    events.push({ url, method, conditional, ...(check ? { check } : {}) });
    return response;
  };
  // Force both post-write verification and replay to fail, without touching the
  // captured policy, to reach the second reported overwrite recovery route.
  if (replayFailure)
    f.intercept(async (url, init) =>
      written && url === `${source}.policy` && !init?.method
        ? new Response(null, { status: 503 })
        : undefined,
    );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const selected = await client.stat(source);
  const result = await client
    .write(
      source,
      "replacement secret",
      { contentType: "text/plain", ifMatch: selected.etag as string },
      { kind: "protect-ancestors" },
    )
    .catch((error: unknown) => error);
  return { f, source, events, backup, changed, cleared, result };
}

it.each([
  false,
  true,
])("round 66: quarantine asserts backup discovery before clearing the original (replay failure: %s)", async (replayFailure) => {
  const baseline = await backupScenario(undefined, replayFailure);
  expect(baseline.cleared).toBe(true);
  const clearing = baseline.events.findLastIndex(
    (event) => event.url === baseline.source && event.method === "PUT",
  );
  const boundary = baseline.events
    .slice(0, clearing)
    .filter((event) => event.check)
    .at(-1)?.check;
  expect(boundary).toBeGreaterThan(0);
  const s = await backupScenario(boundary, replayFailure);
  expect(s.changed).toBe(true);
  expect(s.cleared).toBe(false);
  expect(s.result).toMatchObject({
    kind: "partial-failure",
    retainedDestinations: expect.arrayContaining([s.backup]),
  });
  expect(await (await s.f.pod.fetch(s.source)).text()).toBe("replacement secret");
  expect(await (await s.f.pod.fetch(s.backup as string)).text()).toBe("secret contents");
  expect(await (await s.f.anonymous(s.backup as string)).text()).toBe("secret contents");
  expect(s.f.calls).not.toContainEqual({ url: `${s.backup}foreign.policy`, method: "PUT" });
});

async function survivorScenario(kind: "file" | "folder", shared: boolean, switchAt?: number) {
  const f = await rdfPod();
  const source = `${shared ? PUBLIC : PRIVATE}original${kind === "folder" ? "/" : ""}`;
  await f.pod.fetch(kind === "folder" ? `${source}child` : source, {
    method: "PUT",
    body: "secret contents",
  });
  const events: Event[] = [];
  let checks = 0;
  let changed = false;
  let restoring = false;
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const conditional = new Headers(init?.headers).has("if-match");
    const response = await f.fetch(input, init);
    const check =
      restoring && url === source && method === "HEAD" && conditional ? ++checks : undefined;
    if (check === switchAt && switchAt !== undefined) {
      changed = true;
      const alternate = `${url}foreign.policy`;
      f.endpoints.set(url, alternate);
      f.policies.set(alternate, await aclBody(url, true));
      response.headers.set("link", `<${alternate}>; rel="acl"`);
    }
    events.push({ url, method, conditional, ...(check ? { check } : {}) });
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  f.intercept(async (url, init) =>
    url === (kind === "folder" ? `${source}child` : source) && init?.method === "DELETE"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  events.length = 0;
  restoring = true;
  const result = await restoreItems(client, DRIVE, [entry]);
  return { f, source, entry, events, changed, result };
}

it.each([
  "file",
  "folder",
] as const)("round 66: partial %s Restore asserts final survivor discovery before deleting its private recovery", async (kind) => {
  const baseline = await survivorScenario(kind, false);
  expect(baseline.result.failed).toEqual([]);
  const recovery = baseline.entry.url;
  const deletion = baseline.events.findIndex(
    (event) => event.url === recovery && event.method === "DELETE",
  );
  expect(deletion).toBeGreaterThan(0);
  const boundary = baseline.events
    .slice(0, deletion)
    .filter((event) => event.check)
    .at(-1)?.check;
  expect(boundary).toBeGreaterThan(0);
  const s = await survivorScenario(kind, false, boundary);
  expect(s.changed).toBe(true);
  expect(s.result.done).toEqual([]);
  const copy = s.entry.url;
  expect(s.f.calls).not.toContainEqual({ url: copy, method: "DELETE" });
  if (kind === "file") expect(await (await s.f.pod.fetch(copy)).text()).toBe("secret contents");
  expect(s.f.pod.has(copy)).toBe(true);
  expect((await s.f.anonymous(copy)).status).toBe(403);
  expect(s.f.calls).not.toContainEqual({ url: `${s.source}foreign.policy`, method: "PUT" });
});

it.each([
  "file",
  "folder",
] as const)("round 66: unchanged shared %s Restore compares the archived original after refused Trash DELETE", async (kind) => {
  const s = await survivorScenario(kind, true);
  expect(s.result.failed).toEqual([]);
  expect(s.result.done).toHaveLength(1);
  expect(s.f.pod.has(s.entry.url)).toBe(false);
  expect((await s.f.anonymous(kind === "folder" ? `${s.source}child` : s.source)).status).toBe(200);
});

it("round 66 shape a: a later Drive child write cannot replace the approved folder overwrite validator", async () => {
  const f = await rdfPod();
  const folder = `${PRIVATE}approved/`;
  await f.pod.fetch(`${folder}child`, { method: "PUT", body: "secret contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  // Track this container, then confirm metadata overwrite before another logical
  // operation changes its membership using Drive's own atomic parent receipts.
  await client.copy(folder, `${PRIVATE}copy/`, { kind: "preserve-source" });
  const approved = await client.stat(folder);
  await client.write(
    `${folder}later`,
    "later contents",
    { contentType: "text/plain", ifNoneMatch: "*" },
    { kind: "protect-ancestors" },
  );
  expect((await client.stat(folder)).etag).not.toBe(approved.etag);
  const puts = f.calls.filter(({ url, method }) => url === folder && method === "PUT").length;
  await expect(
    client.write(
      folder,
      "",
      { contentType: "text/turtle", ifMatch: approved.etag as string },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toMatchObject({ kind: "conflict", status: 412, url: folder });
  expect(f.calls.filter(({ url, method }) => url === folder && method === "PUT")).toHaveLength(
    puts,
  );
  expect(await (await f.pod.fetch(`${folder}later`)).text()).toBe("later contents");
});
