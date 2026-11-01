// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { accessControl, bindAccess, requireAccess } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient, type DriveClient } from "../src/apps/drive/lib/client/client";
import { commitHttp, confirmationOptions } from "../src/apps/drive/lib/client/commit";
import {
  copyItem,
  deleteForever,
  listTrash,
  moveItems,
  renameItem,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { moveWithValidator } from "../src/apps/drive/state/undo";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { rdfPod } from "./drive-rdf-pod";
import {
  ACL,
  aclBody,
  DRIVE,
  EVERYONE,
  OWNER,
  PRIVATE,
  PUBLIC,
  ROOT,
  turtle,
  WacFields,
} from "./drive-wac-pod";

it("round 67 discovery: a legacy policy projection retains the protected-resource capture", async () => {
  const f = await rdfPod();
  const headers = new Headers((await f.fetch(PRIVATE, { method: "HEAD" })).headers);
  headers.set("wac-allow", 'user="read write control"');
  f.after(async (url, method, response) => {
    if (url === PRIVATE && ["GET", "HEAD"].includes(method))
      response.headers.set("wac-allow", headers.get("wac-allow") as string);
    return response;
  });
  const access = accessControl(f.fetch, ROOT);
  const binding = await bindAccess(access, PRIVATE, PRIVATE);
  const policy = requireAccess(await access.read(`${PRIVATE}.policy`), PRIVATE);
  binding.installed(access.forResource(policy, PRIVATE));
  expect(() => binding.verifyEndpoint(PRIVATE, headers)).not.toThrow();
  headers.set("wac-allow", 'user="read"');
  expect(() => binding.verifyEndpoint(PRIVATE, headers)).toThrow("access policy changed");
});

it("round 67 discovery: policy comparisons assert the response ETag when HTTP ignores If-Match", async () => {
  const f = await rdfPod();
  const access = accessControl(f.fetch, ROOT);
  const policy = requireAccess(await access.read(`${PRIVATE}.policy`), PRIVATE);
  f.after(async (url, method, response) => {
    if (url === policy.url && method === "GET") response.headers.set("etag", '"replacement"');
    return response;
  });
  await expect(access.checkOwn({ url: policy.url, policy })).rejects.toThrow(
    "access policy changed",
  );
});

it.each([
  "policy PUT verification",
  "captured policy comparison",
  "overwrite PUT discovery replacement",
])("round 67 discovery: %s retains the policy document's own discovery", async (step) => {
  const f = await rdfPod();
  const access = accessControl(f.fetch, ROOT);
  const policy = requireAccess(await access.read(`${PRIVATE}.policy`), PRIVATE);
  let written = false;
  f.after(async (url, method, response) => {
    if (url === policy.url) {
      if (method === "PUT") written = true;
      if (
        (method === "GET" && (written || step === "captured policy comparison")) ||
        (method === "PUT" && step === "overwrite PUT discovery replacement")
      )
        response.headers.set("link", `<${policy.url}.foreign>; rel="acl"`);
    }
    return response;
  });
  await expect(
    step === "captured policy comparison"
      ? access.checkOwn({ url: policy.url, policy })
      : access.install(policy, PRIVATE, PRIVATE),
  ).rejects.toThrow("access policy changed");
  expect(f.calls).not.toContainEqual({ url: `${policy.url}.foreign`, method: "PUT" });
});

it.each([
  "validator",
  "discovery",
])("round 67 confirmation: ACL installation refuses a changed captured %s before hydration", async (changed) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(PRIVATE);
  const access = accessControl(f.fetch, ROOT);
  const policy = requireAccess(await access.read(`${PRIVATE}.policy`), PRIVATE);
  f.after(async (url, method, response) => {
    if (url === PRIVATE && method === "HEAD")
      response.headers.set(
        changed === "validator" ? "etag" : "link",
        changed === "validator" ? '"replacement"' : `<${PRIVATE}foreign.policy>; rel="acl"`,
      );
    return response;
  });
  f.calls.length = 0;
  await expect(
    access.install(policy, PRIVATE, PRIVATE, {
      identity: { ...selected, etag: selected.etag as string },
      expectedAcl: policy,
    }),
  ).rejects.toThrow("Private access could not be established or verified");
  expect(f.calls).not.toContainEqual({ url: `${PRIVATE}.policy`, method: "PUT" });
});

it.each([
  "Copy",
  "Move",
  "Restore",
])("round 67 discovery: %s advances modes only through its own verified ACL receipt", async (step) => {
  const f = await rdfPod();
  const source = `${PUBLIC}private-original`;
  const target = `${PUBLIC}private-copy`;
  f.policies.set(`${source}.policy`, await aclBody(source));
  await f.pod.fetch(source, { method: "PUT", body: "secret contents" });
  f.after(async (url, method, response) => {
    if (response.ok && !url.endsWith(".policy") && ["GET", "HEAD", "PUT"].includes(method))
      response.headers.set(
        "wac-allow",
        `user="read write append control",public="${(await f.anonymous(url)).ok ? "read" : ""}"`,
      );
    return response;
  });
  f.audit();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(source);
  if (step === "Restore") {
    const trashed = await trashItems(client, DRIVE, [selected], { webId: OWNER });
    expect(trashed.failed).toEqual([]);
    const restored = await restoreItems(client, DRIVE, await listTrash(client, DRIVE));
    expect(restored.failed).toEqual([]);
  } else if (step === "Copy")
    await client.copy(source, target, { kind: "preserve-source" }, confirmationOptions(selected));
  else
    await client.move(source, target, { kind: "preserve-source" }, confirmationOptions(selected));
  const result = step === "Restore" ? source : target;
  expect(await (await f.pod.fetch(result)).text()).toBe("secret contents");
  expect((await f.anonymous(result)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});

it.each([
  "remove survivor",
  "Move source",
  "Copy source",
  "merge source",
])("round 67 discovery: %s requires a hydrated supplemental assertion", async (step) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const source = step === "merge source" ? PRIVATE : `${PRIVATE}secret`;
  const selected = await client.stat(source);
  const parent = await client.stat(PRIVATE);
  const guard = { url: parent.url, etag: parent.etag as string };
  const target = step === "merge source" ? `${DRIVE}merged/` : `${PRIVATE}copy`;
  let run: () => Promise<unknown>;
  if (step === "remove survivor") {
    await client.copy(source, target, { kind: "preserve-source" });
    const copy = await client.stat(target);
    run = () =>
      client.remove(target, {
        ...confirmationOptions(copy),
        commit: { survivors: [{ url: source, etag: selected.etag as string }] },
      });
  } else if (step === "merge source")
    run = () =>
      client.mergeContainer(
        source,
        target,
        { kind: "preserve-source" },
        { ...confirmationOptions(selected), sourceGuards: [guard] },
      );
  else if (step === "Move source")
    run = () =>
      client.move(
        source,
        target,
        { kind: "preserve-source" },
        { ...confirmationOptions(selected), sourceGuards: [guard] },
      );
  else
    run = () =>
      client.copy(
        source,
        target,
        { kind: "preserve-source" },
        { ...confirmationOptions(selected), sourceGuards: [guard] },
      );
  f.calls.length = 0;
  await expect(run()).rejects.toMatchObject({ status: 428 });
  expect(f.calls).not.toContainEqual({
    url: target,
    method: step === "remove survivor" ? "DELETE" : "PUT",
  });
  expect(f.pod.has(source)).toBe(true);
});

it.each([
  "root",
  "tree child",
])("round 67 confirmation: Undo refuses a missing %s discovery capture before reading", async (missing) => {
  const http = vi.fn<typeof fetch>(async () => new Response(null, { status: 412 }));
  const from = missing === "root" ? `${PRIVATE}moved` : `${PRIVATE}moved/`;
  const to = missing === "root" ? `${PRIVATE}original` : `${PRIVATE}original/`;
  const verifyHeaders = accessControl(http, ROOT).captureEndpoint(
    from,
    new Headers({ "x-solid-demo-access-control": "none" }),
  );
  const tree =
    missing === "root"
      ? undefined
      : [
          { url: from, etag: '"approved"', verifyHeaders, children: [`${from}leaf`] },
          { url: `${from}leaf`, etag: '"leaf"' },
        ];
  await expect(
    moveWithValidator(
      { storageUrl: ROOT, fetch: http },
      from,
      to,
      '"approved"',
      tree,
      missing === "root" ? undefined : verifyHeaders,
    ),
  ).rejects.toMatchObject({ status: 428 });
  expect(http).not.toHaveBeenCalled();
});

function withoutDiscovery<T extends object>(value: T): Omit<T, "verifyHeaders"> {
  const { verifyHeaders: _discovery, ...rest } = value as T & { verifyHeaders?: unknown };
  return rest;
}

it.each([
  1, 2,
])("round 67 discovery: %s policy guards without a captured assertion cannot authorize a step", async (count) => {
  const url = `${PRIVATE}secret`;
  const policy = `${url}.policy`;
  const http = vi.fn<typeof fetch>(
    async () => new Response(null, { headers: { etag: '"approved"' } }),
  );
  await expect(
    commitHttp({
      http,
      url,
      init: { method: "DELETE", headers: { "if-match": '"approved"' } },
      verifyHeaders: () => undefined,
      policyGuards: Array.from({ length: count }, () => ({ url: policy, etag: '"approved"' })),
      error: (status) => new Error(String(status)),
      response: async () => {},
    }),
  ).rejects.toThrow("428");
  expect(http.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});

it.each(
  ["all reads", "entry only", "merge receipt"].flatMap((adapter) =>
    (adapter === "merge receipt"
      ? ["nested folder Restore"]
      : ["file Restore", "folder Restore", "nested folder Restore", "Delete forever"]
    ).map((step) => ({
      adapter,
      step,
    })),
  ),
)("round 67 compatibility: $step retains conditional identities with discovery omitted by $adapter", async ({
  adapter,
  step,
}) => {
  const f = await rdfPod();
  const requests: { method: string; headers: Headers }[] = [];
  const real = createSolidDriveClient({
    storageUrl: ROOT,
    webId: OWNER,
    fetch: async (input, init) => {
      requests.push({ method: init?.method ?? "GET", headers: new Headers(init?.headers) });
      return f.fetch(input, init);
    },
  });
  const client: DriveClient =
    adapter !== "all reads"
      ? real
      : {
          ...real,
          async stat(...args) {
            return withoutDiscovery(await real.stat(...args));
          },
          async readVersion(...args) {
            return withoutDiscovery(await real.readVersion(...args));
          },
          async readRdf(...args) {
            const result = await real.readRdf(...args);
            return result && withoutDiscovery(result);
          },
          async move(...args) {
            return withoutDiscovery(await real.move.call(this, ...args));
          },
        };
  if (adapter === "merge receipt") {
    const merge = real.mergeContainer;
    client.mergeContainer = async function (...args) {
      const { source: _source, ...receipt } = await merge.call(this, ...args);
      return receipt;
    };
  }
  const folder = step.includes("folder");
  const source = folder ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  const leaf = folder ? `${source}${step.startsWith("nested") ? "inner/" : ""}leaf` : source;
  if (folder) await f.pod.fetch(leaf, { method: "PUT", body: "secret contents" });
  if (step !== "Delete forever")
    f.intercept(async (url, init) =>
      url === leaf && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
    );
  await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
  f.intercept(undefined);
  const [listed] = await listTrash(client, DRIVE);
  if (!listed) throw new Error("Missing recovery");
  const entry = withoutDiscovery(listed);
  expect((await f.anonymous(entry.url)).status).toBe(403);
  const result =
    step === "Delete forever"
      ? await deleteForever(client, DRIVE, [entry])
      : await restoreItems(client, DRIVE, [entry]);
  if (adapter === "all reads" || adapter === "merge receipt") {
    // A backend that cannot supply the archive's captured discovery cannot
    // authorize disposal or restoration from that policy; keep recovery.
    expect(result.done).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(f.pod.has(entry.url)).toBe(true);
    if (adapter === "merge receipt") {
      // The initial assertion still authorizes restoring children. Without a
      // container receipt, their removal cannot authorize a refreshed root tag.
      expect(f.pod.has(`${entry.url}inner/leaf`)).toBe(false);
    }
  } else {
    expect(result.failed).toEqual([]);
    expect(result.done).toHaveLength(1);
    expect(f.pod.has(entry.url)).toBe(false);
  }
  if (step !== "Delete forever")
    expect(await (await f.pod.fetch(leaf)).text()).toBe("secret contents");
  for (const { method, headers } of requests) {
    if (method === "DELETE") expect(headers.get("if-match")).toBeTruthy();
    if (method === "PUT")
      expect(headers.has("if-match") || headers.get("if-none-match") === "*").toBe(true);
  }
});

it("round 67 compatibility: legacy policy captures still refuse a changed validator", async () => {
  const f = await rdfPod();
  const access = accessControl(f.fetch, ROOT);
  const state = await access.effective(PRIVATE);
  if (state.status !== "known" || !state.own) throw new Error("Missing policy");
  let policy = withoutDiscovery(state.policy);
  const adapter = {
    ...access,
    effective: async () => ({
      ...state,
      policy,
      own: { ...state.own, url: state.own?.url as string, policy },
    }),
  };
  const binding = await bindAccess(adapter, PRIVATE, PRIVATE);
  expect(
    binding.identities.some(
      (identity) => identity.url === policy.url && identity.verifyHeaders === undefined,
    ),
  ).toBe(true);
  await binding.recheck();
  policy = { ...policy, etag: '"changed"' };
  await expect(binding.recheck()).rejects.toThrow("access policy changed");
});

it("round 67 compatibility: Restore refuses a replacement even when an adapter ignores conditional stat", async () => {
  const f = await rdfPod();
  const real = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await trashItems(real, DRIVE, [await real.stat(`${PRIVATE}secret`)], { webId: OWNER });
  const [entry] = await listTrash(real, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  await f.pod.fetch(entry.url, { method: "PUT", body: "replacement" });
  const adapter: DriveClient = { ...real, stat: (url) => real.stat(url) };
  const result = await restoreItems(adapter, DRIVE, [entry]);
  expect(result.done).toEqual([]);
  expect(result.failed[0]?.error).toMatchObject({ kind: "conflict", status: 412, url: entry.url });
  expect(await (await f.pod.fetch(entry.url)).text()).toBe("replacement");
  expect(f.pod.has(entry.original)).toBe(false);
});

it("round 67 discovery: final writes retain explicit no-ACL discovery without an own ACL", async () => {
  const source = `${PRIVATE}secret`;
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "drive/private/secret", body: "original", contentType: "text/plain" }],
  });
  let changed = false;
  const writes: string[] = [];
  const http: typeof fetch = async (input, init) => {
    if (init?.method === "PUT") writes.push(String(input));
    const response = await pod.fetch(input, init);
    if (
      !changed &&
      String(input) === source &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match")
    ) {
      changed = true;
      response.headers.delete("x-solid-demo-access-control");
      response.headers.delete("link");
    }
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http });
  const selected = await client.stat(source);
  // Exercise the binding's own capture, independently of a UI-provided assertion.
  await expect(
    client.write(
      source,
      "replacement",
      {
        contentType: "text/plain",
        ifMatch: selected.etag as string,
      },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow("access policy changed");
  expect(changed).toBe(true);
  expect(writes).not.toContain(source);
  expect(await (await pod.fetch(source)).text()).toBe("original");
});

it("round 67 confirmation: renewed Move consent never adopts a later destination policy validator", async () => {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  const target = `${PUBLIC}moved`;
  const policy = `${PUBLIC}.policy`;
  const data = await parseRdf(await aclBody(PUBLIC, true), "text/turtle");
  const rule = new WacFields(DataFactory.blankNode(), data, DataFactory);
  rule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  rule.iris(`${ACL}default`).add(PUBLIC);
  rule.iris(`${ACL}agentClass`).add(EVERYONE);
  rule.iris(`${ACL}mode`).add(`${ACL}Write`);
  const widened = await turtle(data);
  let confirmations = 0;
  let afterConsent = 0;
  let changed = false;
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess: async () => {
      confirmations++;
      if (confirmations === 2) {
        afterConsent = f.calls.length;
        f.policies.set(policy, `${widened}\n# replaced after consent`);
      }
      return "move";
    },
  });
  f.after(async (url, method, response) => {
    if (!changed && confirmations === 1 && url === target && method === "PUT" && response.ok) {
      changed = true;
      f.policies.set(policy, widened);
    }
    return response;
  });
  const selected = await client.stat(source);
  const result = await client
    .move(source, target, { kind: "confirm-move" }, confirmationOptions(selected))
    .catch((error: unknown) => error);
  expect(confirmations).toBe(2);
  expect(result).toBeInstanceOf(Error);
  expect((result as Error).message).toContain("access policy changed");
  expect(f.calls.slice(afterConsent)).not.toContainEqual({ url: target, method: "PUT" });
  expect(await (await f.pod.fetch(source)).text()).toBe("secret contents");
  expect(f.policies.get(policy)).toBe(`${widened}\n# replaced after consent`);
});

it.each([
  "Replace",
  "Move",
  "Copy",
  "Rename",
  "Trash",
  "remove",
  "owner-only overwrite",
  "folder metadata",
  "Restore",
  "partial Restore",
  "Delete forever",
  "Empty Trash",
  "ACL overwrite",
])("round 67 confirmation: %s carries captured discovery into preflight and the final step", async (step) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let target = step === "folder metadata" ? PRIVATE : `${PRIVATE}secret`;
  let run: () => Promise<unknown>;
  if (["Restore", "partial Restore", "Delete forever", "Empty Trash"].includes(step)) {
    if (step === "partial Restore")
      f.intercept(async (url, init) =>
        url === target && init?.method === "DELETE"
          ? new Response(null, { status: 403 })
          : undefined,
      );
    await trashItems(client, DRIVE, [await client.stat(target)], { webId: OWNER });
    f.intercept(undefined);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    target = entry.url;
    expect(entry.verifyHeaders).toBeTypeOf("function");
    run = () =>
      step === "Delete forever" || step === "Empty Trash"
        ? deleteForever(client, DRIVE, [entry])
        : restoreItems(client, DRIVE, [entry]);
  } else if (step === "ACL overwrite") {
    const access = accessControl(f.fetch, ROOT);
    const selected = await client.stat(PRIVATE);
    const state = await access.read(`${PRIVATE}.policy`);
    if (state.status !== "known" || !selected.etag) throw new Error("Missing policy");
    target = state.policy.url;
    run = () =>
      access.install(state.policy, PRIVATE, PRIVATE, {
        identity: {
          url: PRIVATE,
          etag: selected.etag as string,
          verifyHeaders: selected.verifyHeaders as NonNullable<typeof selected.verifyHeaders>,
        },
        expectedAcl: state.policy,
      });
  } else {
    const selected = await client.stat(target);
    run = () => {
      switch (step) {
        case "Replace":
          return uploadFile(
            client,
            PRIVATE,
            new Blob(["replacement"]),
            "secret",
            "replace",
            selected,
          );
        case "Move":
          return moveItems(client, [selected], `${PRIVATE}target/`);
        case "Copy":
          return copyItem(client, selected);
        case "Rename":
          return renameItem(client, selected, "renamed");
        case "Trash":
          return trashItems(client, DRIVE, [selected], { webId: OWNER });
        case "remove":
          return client.remove(target, confirmationOptions(selected));
        default:
          return client.write(
            target,
            "",
            { contentType: "text/turtle", ...confirmationOptions(selected) },
            step === "owner-only overwrite"
              ? { kind: "owner-only" }
              : { kind: "protect-ancestors" },
          );
      }
    };
  }
  const endpoint = `${target}foreign-confirmed.policy`;
  f.endpoints.set(target, endpoint);
  f.policies.set(endpoint, await aclBody(target, true));
  if (step === "ACL overwrite")
    f.after(async (url, method, response) => {
      if (url === target && (method === "GET" || method === "HEAD"))
        response.headers.set("link", `<${endpoint}>; rel="acl"`);
      return response;
    });
  f.calls.length = 0;
  const result = await run().catch((error: unknown) => error);
  expect(result instanceof Error || (result as { failed: unknown[] }).failed.length > 0).toBe(true);
  expect(f.calls).not.toContainEqual({ url: target, method: "PUT" });
  expect(f.calls).not.toContainEqual({ url: target, method: "DELETE" });
  expect(f.calls).not.toContainEqual({ url: endpoint, method: "PUT" });
});

it.each([
  {
    captured: { link: `<${PRIVATE}.policy>; rel="acl"` },
    changed: { link: `<${PRIVATE}.policy>; rel="acl"`, "acp-model": "WAC to ACP" },
  },
  {
    captured: { link: `<${PRIVATE}.policy>; rel="acl"` },
    changed: { link: `<${PRIVATE}.policy>; rel="http://www.w3.org/ns/solid/acp#accessControl"` },
  },
  { captured: { "x-solid-demo-access-control": "none" }, changed: {} },
  {
    captured: { link: `<${PRIVATE}.policy>; rel="acl"`, "acr-mode": "original" },
    changed: { link: `<${PRIVATE}.policy>; rel="acl"`, "acr-mode": "changed" },
  },
  {
    captured: { link: `<${PRIVATE}.policy>; rel="acl"`, "wac-allow": 'user="read write control"' },
    changed: { link: `<${PRIVATE}.policy>; rel="acl"`, "wac-allow": 'user="read"' },
  },
])("round 67 discovery: content identity cannot excuse changed access model ($captured)", ({
  captured,
  changed,
}) => {
  const access = accessControl(fetch, ROOT);
  const verify = access.captureEndpoint(PRIVATE, new Headers(captured));
  expect(() => verify(new Headers(captured))).not.toThrow();
  expect(() => verify(new Headers(changed))).toThrow("access policy changed");
});

it("round 67 discovery: a captured assertion does not retain mutable response headers", () => {
  const access = accessControl(fetch, ROOT);
  const headers = new Headers({
    link: `<${PRIVATE}.policy>; rel="acl"`,
    "wac-allow": 'user="read write control"',
  });
  const original = new Headers(headers);
  const verify = access.captureEndpoint(PRIVATE, headers);
  headers.delete("wac-allow");
  expect(() => verify(original)).not.toThrow();
  expect(() => verify(headers)).toThrow("access policy changed");
});

it.each(
  ["first", "last", "both"].flatMap((order) =>
    [true, false].map((changed) => ({ order, changed })),
  ),
)("round 67 discovery: duplicate policy guards preserve the $order captured assertion (changed: $changed)", async ({
  order,
  changed,
}) => {
  const access = accessControl(fetch, ROOT);
  const url = `${PRIVATE}secret`;
  const policy = `${url}.policy`;
  const captured = access.captureEndpoint(policy, new Headers());
  const http = vi.fn<typeof fetch>(async (input, init) => {
    if (init?.method !== "HEAD") return new Response(null, { status: 204 });
    return new Response(null, {
      headers: {
        etag: '"approved"',
        ...(changed && String(input) === policy ? { link: `<${policy}.foreign>; rel="acl"` } : {}),
      },
    });
  });
  const committing = commitHttp({
    http,
    url,
    init: { method: "DELETE", headers: { "if-match": '"approved"' } },
    verifyHeaders: () => undefined,
    policyGuards: [
      {
        url: policy,
        etag: '"approved"',
        ...(order !== "last" ? { verifyHeaders: captured } : {}),
      },
      {
        url: policy,
        etag: '"approved"',
        ...(order !== "first" ? { verifyHeaders: captured } : {}),
      },
    ],
    error: (status) => new Error(String(status)),
    response: async () => {},
  });
  if (changed) await expect(committing).rejects.toThrow("access policy changed");
  else await committing;
  expect(http.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(
    changed ? 0 : 1,
  );
  expect(http.mock.calls.filter(([input]) => String(input) === policy)).toHaveLength(1);
});
