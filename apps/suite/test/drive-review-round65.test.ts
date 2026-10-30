// AUTHORED-BY Codex
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import {
  createSolidDriveClient,
  DrivePartialFailureError,
} from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, turtle, WacFields } from "./drive-wac-pod";

type Step = "Replace" | "Move" | "Copy";
type Kind = "file" | "folder";
type Phase = "write completion" | "before source DELETE" | "operation completion";

async function completionScenario(step: Step, kind: Kind, hiddenLink: boolean, switchAt?: number) {
  const f = await rdfPod();
  const source = `${PRIVATE}${kind === "folder" ? "secret-folder/" : "secret"}`;
  const target = step === "Replace" ? source : `${PUBLIC}copy${kind === "folder" ? "/" : ""}`;
  const alternate = `${target}foreign.policy`;
  const foreign = await aclBody(target, true);
  const data = new Store();
  new WacFields(source, data, DataFactory).iris("https://example.test/secret").add("urn:secret");
  const original = kind === "folder" ? await turtle(data) : "secret contents";
  await f.pod.fetch(source, { method: "PUT", body: original });
  const replacement =
    kind === "folder" || step !== "Replace" ? original : "replacement secret contents";
  let written = false;
  let checks = 0;
  let changed = false;
  const events: { url: string; method: string; check?: number }[] = [];
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const response = await f.fetch(input, init);
    if (hiddenLink && response.status === 404) response.headers.delete("link");
    if (
      url === target &&
      method === "PUT" &&
      response.ok &&
      new Headers(init?.headers).has("if-match")
    )
      written = true;
    const isCheck =
      written && url === target && method === "HEAD" && new Headers(init?.headers).has("if-match");
    if (isCheck && ++checks === switchAt) {
      changed = true;
      f.policies.set(alternate, foreign);
      f.endpoints.set(target, alternate);
      response.headers.set("link", `<${alternate}>; rel="acl"`);
    }
    events.push({ url, method, ...(isCheck ? { check: checks } : {}) });
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const approved = await client.stat(source);
  const run = () =>
    step === "Replace"
      ? client.write(
          target,
          replacement,
          {
            contentType: kind === "folder" ? "text/turtle" : "text/plain",
            ifMatch: approved.etag as string,
          },
          { kind: "protect-ancestors" },
        )
      : step === "Move"
        ? client.move(
            source,
            target,
            { kind: "preserve-source" },
            { ifMatch: approved.etag as string },
          )
        : client.copy(
            source,
            target,
            { kind: "preserve-source" },
            { ifMatch: approved.etag as string },
          );
  const result = await run().catch((error: unknown) => error);
  return { f, source, target, alternate, foreign, changed, result, events, replacement };
}

const cases = (["Replace", "Move", "Copy"] as const).flatMap((step) =>
  (["file", "folder"] as const).flatMap((kind) =>
    [false, true].flatMap((hiddenLink) =>
      (step === "Move"
        ? (["write completion", "before source DELETE", "operation completion"] as const)
        : step === "Copy"
          ? (["write completion", "operation completion"] as const)
          : (["write completion"] as const)
      ).map((phase) => ({ step, kind, hiddenLink, phase })),
    ),
  ),
);

it.each(
  cases,
)("round 65: $step $kind rejects changed ACL discovery at $phase (404 hides Link: $hiddenLink)", async ({
  step,
  kind,
  hiddenLink,
  phase,
}: {
  step: Step;
  kind: Kind;
  hiddenLink: boolean;
  phase: Phase;
}) => {
  // Determine the boundary from a successful trace, without coupling to incidental read counts.
  const baseline = await completionScenario(step, kind, hiddenLink);
  expect(baseline.result).not.toBeInstanceOf(Error);
  const beforeDelete = baseline.events.findIndex(
    ({ url, method }) => url === baseline.source && method === "DELETE",
  );
  const checks = (
    phase === "before source DELETE" ? baseline.events.slice(0, beforeDelete) : baseline.events
  ).flatMap(({ check }) => (check === undefined ? [] : [check]));
  const boundary = phase === "write completion" ? checks[0] : checks.at(-1);
  expect(boundary).toBeGreaterThan(0);
  const s = await completionScenario(step, kind, hiddenLink, boundary);
  expect(s.changed).toBe(true);
  expect(s.result).toBeInstanceOf(Error);
  expect(s.f.policies.get(s.alternate)).toBe(s.foreign);
  expect(s.f.calls).not.toContainEqual({ url: s.alternate, method: "PUT" });
  expect(s.f.calls).not.toContainEqual({ url: s.target, method: "DELETE" });
  if (step === "Move" && phase !== "operation completion") {
    expect(s.f.pod.has(s.source)).toBe(true);
    expect(s.f.calls).not.toContainEqual({ url: s.source, method: "DELETE" });
  }
  // The changed endpoint really grants anonymous access; recovery must evacuate confidential data.
  expect(await (await s.f.anonymous(s.target)).text()).not.toContain(
    kind === "folder" ? "urn:secret" : s.replacement,
  );
  expect(s.result).toBeInstanceOf(DrivePartialFailureError);
  const retained = (s.result as DrivePartialFailureError).retainedDestinations;
  expect(retained.length).toBeGreaterThan(0);
  let recovered = false;
  for (const url of retained) {
    expect((await s.f.anonymous(url)).status).toBe(403);
    const contents = await (await s.f.pod.fetch(url)).text();
    if (contents.includes(kind === "folder" ? "urn:secret" : s.replacement)) recovered = true;
  }
  expect(recovered).toBe(true);
});

it.each([
  "file",
  "folder",
] as const)("round 65: partial Restore compares archived shared %s access after refused Trash DELETE", async (kind) => {
  const f = await rdfPod();
  const source = `${PUBLIC}shared${kind === "folder" ? "/" : ""}`;
  await f.pod.fetch(source, { method: "PUT", body: kind === "folder" ? "" : "shared contents" });
  if (kind === "folder")
    await f.pod.fetch(`${source}child`, { method: "PUT", body: "shared contents" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
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
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect((await f.anonymous(source)).status).toBe(200);
  expect(f.pod.has(entry.url)).toBe(false);
});

it.each([
  "file",
  "folder",
] as const)("round 65: source snapshot refuses changed discovery on its conditional %s HEAD before copying", async (kind) => {
  const f = await rdfPod();
  const source = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}snapshot/`;
  if (kind === "folder") await f.pod.fetch(source, { method: "PUT", body: "" });
  let changed = false;
  const http: typeof fetch = async (input, init) => {
    const response = await f.fetch(input, init);
    if (
      !changed &&
      String(input) === source &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match")
    ) {
      changed = true;
      response.headers.set("link", `<${source}foreign.policy>; rel="acl"`);
    }
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  await expect(
    client.copy(source, `${PUBLIC}snapshot${kind === "folder" ? "/" : ""}`, {
      kind: "preserve-source",
    }),
  ).rejects.toThrow("access policy changed");
  expect(changed).toBe(true);
  expect(f.calls.filter(({ method }) => method === "PUT" || method === "DELETE")).toEqual([]);
  expect(f.pod.has(source)).toBe(true);
});

it("round 65: partial Restore checks the survivor's captured endpoint after recovery deletion", async () => {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  let recovery: string | undefined;
  let deleted = false;
  let changed = false;
  const http: typeof fetch = async (input, init) => {
    const response = await f.fetch(input, init);
    const url = String(input);
    if (url === recovery && init?.method === "DELETE" && response.ok) deleted = true;
    if (
      deleted &&
      !changed &&
      url === source &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match")
    ) {
      changed = true;
      response.headers.set("link", `<${source}foreign.policy>; rel="acl"`);
    }
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  f.intercept(async (url, init) =>
    url === source && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  recovery = entry.url;
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(changed).toBe(true);
  expect(result.done).toEqual([]);
  const failure = result.failed[0]?.error as { remaining: { error: DrivePartialFailureError }[] };
  const error = failure.remaining[0]?.error;
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  expect(error?.retainedDestinations.length).toBeGreaterThan(0);
  for (const url of error?.retainedDestinations ?? []) {
    expect((await f.anonymous(url)).status).toBe(403);
    expect(await (await f.pod.fetch(url)).text()).toBe("secret contents");
  }
  expect(await (await f.pod.fetch(source)).text()).toBe("secret contents");
});

it("round 65: private evacuation checks backup discovery on its completion HEAD", async () => {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  let written = false;
  let cleared = false;
  let changed = false;
  let backup: string | undefined;
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const response = await f.fetch(input, init);
    if (url === source && init?.method === "PUT" && response.ok) {
      if (!written) {
        written = true;
        f.endpoints.set(source, `${source}foreign.policy`);
        f.policies.set(`${source}foreign.policy`, await aclBody(source, true));
      } else cleared = true;
    }
    if (
      cleared &&
      !changed &&
      url.includes("/.drive-recovery-") &&
      !url.endsWith("/") &&
      !url.endsWith(".policy") &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match")
    ) {
      changed = true;
      backup = url;
      response.headers.set("link", `<${url}foreign.policy>; rel="acl"`);
    }
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const selected = await client.stat(source);
  const result = await client
    .write(
      source,
      "new secret",
      { contentType: "text/plain", ifMatch: selected.etag as string },
      { kind: "protect-ancestors" },
    )
    .catch((error: unknown) => error);
  expect(changed).toBe(true);
  expect(result).toBeInstanceOf(DrivePartialFailureError);
  let cause: unknown = result;
  while (cause instanceof DrivePartialFailureError) cause = cause.cause;
  expect(cause).toMatchObject({
    cause: "Bound access changed",
    gains: ["The item's own ACL endpoint changed"],
  });
  expect((result as DrivePartialFailureError).retainedDestinations).toContain(backup);
  expect((await f.anonymous(backup as string)).status).toBe(403);
  expect(await (await f.pod.fetch(backup as string)).text()).toBe("secret contents");
});
