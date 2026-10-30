// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient, parentOf } from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import {
  deleteForever,
  listTrash,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { expectPrivateRecovery } from "./drive-private-recovery";
import { rdfPod } from "./drive-rdf-pod";
import {
  aclBody,
  DRIVE,
  OWNER,
  PRIVATE,
  PUBLIC,
  ROOT,
  turtle,
  WacFields,
  type wacPod,
} from "./drive-wac-pod";

afterEach(() => vi.restoreAllMocks());

async function editFolder(f: Awaited<ReturnType<typeof wacPod>>, url: string) {
  const response = await f.pod.fetch(url);
  const data = await parseRdf(await response.text(), "text/turtle");
  new WacFields(url, data, DataFactory).iris("https://example.test/note").add(`${ROOT}concurrent`);
  expect(
    (
      await f.pod.fetch(url, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body: await turtle(data),
      })
    ).ok,
  ).toBe(true);
}
async function hasEdit(f: Awaited<ReturnType<typeof wacPod>>, url: string) {
  const response = await f.pod.fetch(url);
  if (!response.ok) return false;
  return new WacFields(url, await parseRdf(await response.text(), "text/turtle"), DataFactory)
    .iris("https://example.test/note")
    .has(`${ROOT}concurrent`);
}

it("recursive Delete forever retains folder RDF saved after a child DELETE", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  let edited = false;
  f.after(async (url, method, response) => {
    if (!edited && url === `${PRIVATE}secret` && method === "DELETE" && response.ok) {
      edited = true;
      await editFolder(f, PRIVATE);
    }
    return response;
  });
  const outcome = await client
    .remove(PRIVATE, { recursive: true })
    .catch((error: unknown) => error);
  expect(edited).toBe(true);
  expect(outcome).toMatchObject({ kind: "partial-failure", cause: { kind: "conflict" } });
  expect(await hasEdit(f, PRIVATE)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: PRIVATE, method: "DELETE" });
});

const signals = [
  "empty ACR via rel=acl",
  "inherited ACP policies",
  "mixed ACP header and WAC",
] as const;
it.each(signals)("access detection refuses %s", async (signal) => {
  const f = await rdfPod();
  const url = PRIVATE;
  f.policies.set(
    `${url}.policy`,
    signal === signals[0]
      ? ""
      : signal === signals[1]
        ? `<${url}.policy> <http://www.w3.org/ns/solid/acp#apply> <${ROOT}public-policy>.`
        : await aclBody(url),
  );
  f.after(async (target, _method, response) => {
    if (signal === signals[2] && target === url) response.headers.set("ACP-Allow", 'public="read"');
    return response;
  });
  expect(await accessControl(f.fetch, ROOT).effective(url)).toMatchObject({ status: "unknown" });
});

it.each(
  signals.flatMap((signal) =>
    [
      "copy",
      "move preserving access",
      "Trash",
      "Restore",
      "recreated folder",
      "upload replacement",
      "confirmed move",
    ].map((operation) => ({ signal, operation })),
  ),
)("$operation fails closed for $signal", async ({ operation, signal }) => {
  const f = await rdfPod();
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess,
  });
  const source = `${PRIVATE}secret`;
  let affected = source;
  let entry: Awaited<ReturnType<typeof listTrash>>[number] | undefined;
  if (operation === "Restore") {
    entry = (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER }))
      .done[0];
    if (!entry) throw new Error("Missing recovery");
    affected = entry.url;
  }
  if (operation === "Trash") affected = `${DRIVE}.trash/`;
  if (operation === "recreated folder") affected = `${PUBLIC}recreated/`;
  f.calls.length = 0;
  f.policies.set(
    `${affected}.policy`,
    signal === signals[0]
      ? ""
      : signal === signals[1]
        ? `<${affected}.policy> <http://www.w3.org/ns/solid/acp#apply> <${ROOT}public-policy>.`
        : await aclBody(affected),
  );
  f.after(async (target, _method, response) => {
    if (signal === signals[2] && (target === affected || target === `${affected}.policy`))
      response.headers.set("ACP-Allow", 'public="read"');
    return response;
  });
  if (operation === "upload replacement")
    await protectionLedger(f.fetch).set(source, {
      acl: `${source}.policy`,
      from: source,
      turtle: await aclBody(source),
    });
  const result =
    operation === "copy"
      ? client.copy(source, `${PUBLIC}copy`, { kind: "preserve-source" })
      : operation === "move preserving access"
        ? client.move(source, `${PUBLIC}moved`, { kind: "preserve-source" })
        : operation === "confirmed move"
          ? client.move(source, `${PUBLIC}moved`, { kind: "confirm-move" })
          : operation === "Trash"
            ? trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER })
            : operation === "Restore"
              ? restoreItems(client, DRIVE, entry ? [entry] : [])
              : operation === "recreated folder"
                ? client.createFolder(affected, { kind: "owner-only" })
                : uploadFile(
                    client,
                    PRIVATE,
                    new Blob(["replacement"]),
                    "secret",
                    "replace",
                    await client.stat(source),
                  );
  const outcome = await result.then(
    (value) => value,
    (error: unknown) => error,
  );
  if (operation === "Trash" || operation === "Restore")
    expect(outcome).toMatchObject({ done: [], failed: [expect.anything()] });
  else expect(outcome).toBeInstanceOf(Error);
  expect(confirmAccess).not.toHaveBeenCalled();
  expect(f.pod.has(operation === "Restore" ? affected : source)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: `${affected}.policy`, method: "PUT" });
});

it.each(
  signals.flatMap((signal) =>
    ["copy", "move", "Restore"].map((operation) => ({ signal, operation })),
  ),
)("$operation never places payloads behind a destination with $signal", async ({
  operation,
  signal,
}) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const original = `${PRIVATE}secret`;
  let source = original;
  let entry: Awaited<ReturnType<typeof listTrash>>[number] | undefined;
  if (operation === "Restore") {
    entry = (await trashItems(client, DRIVE, [await client.stat(original)], { webId: OWNER }))
      .done[0];
    if (!entry) throw new Error("Missing recovery");
    source = entry.url;
  }
  const destination = operation === "Restore" ? original : `${PUBLIC}destination`;
  f.policies.set(
    `${destination}.policy`,
    signal === signals[0]
      ? ""
      : signal === signals[1]
        ? `<${destination}.policy> <http://www.w3.org/ns/solid/acp#apply> <${ROOT}public-policy>.`
        : await aclBody(destination),
  );
  f.after(async (url, _method, response) => {
    if (signal === signals[2] && (url === destination || url === `${destination}.policy`))
      response.headers.set("ACP-Allow", 'public="read"');
    return response;
  });
  f.calls.length = 0;
  if (operation === "Restore")
    expect((await restoreItems(client, DRIVE, entry ? [entry] : [])).failed).toHaveLength(1);
  else
    await expect(
      operation === "copy"
        ? client.copy(source, destination, { kind: "preserve-source" })
        : client.move(source, destination, { kind: "preserve-source" }),
    ).rejects.toThrow();
  expect(f.pod.has(source)).toBe(true);
  expect(await (await f.pod.fetch(destination)).text()).not.toBe("secret contents");
  expect(f.calls).not.toContainEqual({ url: `${destination}.policy`, method: "PUT" });
});

it.each([
  "during child transfers",
  "at DELETE",
])("partial Restore retains recovery RDF edited %s", async (timing) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === PRIVATE && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial recovery");
  f.intercept(undefined);
  let edited = false;
  f.intercept(async (url, init) => {
    if (timing === "at DELETE" && !edited && url === entry.url && init?.method === "DELETE") {
      edited = true;
      await editFolder(f, entry.url);
    }
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (
      timing === "during child transfers" &&
      !edited &&
      url === `${PRIVATE}secret` &&
      method === "PUT" &&
      response.ok
    ) {
      edited = true;
      await editFolder(f, entry.url);
    }
    return response;
  });
  const restored = await restoreItems(client, DRIVE, [entry]);
  expect(edited).toBe(true);
  expect((await hasEdit(f, entry.url)) || (await hasEdit(f, PRIVATE))).toBe(true);
  if (f.pod.has(entry.url)) {
    expect(restored.failed).toHaveLength(1);
    f.after(undefined);
    f.intercept(undefined);
    expect((await restoreItems(client, DRIVE, await listTrash(client, DRIVE))).failed).toEqual([]);
    expect(await hasEdit(f, PRIVATE)).toBe(true);
  }
});

it.each([
  "copy",
  "move",
])("%s rollback retains destination folder RDF edited before a child-copy 503", async (operation) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const to = `${PUBLIC}rollback/`;
  f.intercept(async (url, init) => {
    if (url === `${to}secret` && init?.method === "PUT") {
      await editFolder(f, to);
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  await expect(
    operation === "copy"
      ? client.copy(PRIVATE, to, { kind: "preserve-source" })
      : client.move(PRIVATE, to, { kind: "preserve-source" }),
  ).rejects.toThrow();
  expect(await hasEdit(f, to)).toBe(true);
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
});

it.each([
  "lost merged graph",
  "missing survivor",
  "missing recovery read",
])("partial Restore retains recovery when verification sees %s", async (mode) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await editFolder(f, PRIVATE);
  f.intercept(async (url, init) =>
    url === PRIVATE && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial recovery");
  f.intercept(undefined);
  let transferred = false;
  f.after(async (url, method, response) => {
    if (url === `${PRIVATE}secret` && method === "PUT" && response.ok) {
      transferred = true;
      if (mode === "lost merged graph") await f.pod.fetch(PRIVATE, { method: "PUT", body: "" });
    }
    return response;
  });
  const readRdf = client.readRdf;
  vi.spyOn(client, "readRdf").mockImplementation(async (url) => {
    if (
      (mode === "missing recovery read" && url === entry.url) ||
      (mode === "missing survivor" && transferred && url === PRIVATE)
    )
      return undefined;
    return readRdf(url);
  });
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(true);
  expect(await hasEdit(f, entry.url)).toBe(true);
});

it("container merge rollback retains destination RDF edited after the merged graph write", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await f.pod.fetch(PRIVATE, {
    method: "PUT",
    body: await turtle(
      await parseRdf(
        `<${PRIVATE}> <https://example.test/original> <${ROOT}original>.`,
        "text/turtle",
      ),
    ),
  });
  const to = `${PUBLIC}merge/`;
  let writes = 0;
  f.after(async (url, method, response) => {
    if (url === to && method === "PUT" && ++writes === 2 && response.ok) await editFolder(f, to);
    return response;
  });
  await expect(client.mergeContainer(PRIVATE, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(writes).toBe(2);
  expect(await hasEdit(f, to)).toBe(true);
});

it.each([
  "Restore",
  "Delete forever",
])("%s slot cleanup retains concurrent folder RDF at DELETE", async (operation) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const [entry] = (
    await trashItems(client, DRIVE, [await client.stat(`${PRIVATE}secret`)], { webId: OWNER })
  ).done;
  if (!entry) throw new Error("Missing recovery");
  const slot = parentOf(entry.url);
  if (!slot) throw new Error("Missing slot");
  let edited = false;
  f.after(async (url, method, response) => {
    if (!edited && url === slot && method === "GET") {
      edited = true;
      await editFolder(f, slot);
    }
    return response;
  });
  await (operation === "Restore"
    ? restoreItems(client, DRIVE, [entry])
    : deleteForever(client, DRIVE, [entry]));
  expect(edited).toBe(true);
  expect(await hasEdit(f, slot)).toBe(true);
});

it("upload replacement ancestor cleanup retains a concurrent RDF edit at DELETE", async () => {
  const f = await rdfPod();
  const folder = `${PUBLIC}recreated/`;
  const source = `${folder}file`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await protectionLedger(f.fetch).set(folder, {
    acl: `${folder}.policy`,
    from: folder,
    turtle: await aclBody(folder),
  });
  let edited = false;
  f.intercept(async (url, init) => {
    if (url === `${folder}.policy` && init?.method === "PUT")
      return new Response(null, { status: 503 });
    if (!edited && url === folder && init?.method === "DELETE") {
      edited = true;
      await editFolder(f, folder);
    }
    return undefined;
  });
  await expect(
    uploadFile(client, folder, new Blob(["bytes"]), "file", "replace", {
      url: source,
      etag: '"old"',
    }),
  ).rejects.toThrow();
  expect(edited).toBe(true);
  expect(await hasEdit(f, folder)).toBe(true);
});

it.each([
  "copy",
  "move",
  "merge",
])("%s cleanup retains RDF edited between its captured read and DELETE", async (operation) => {
  const f = await rdfPod();
  const to = `${PUBLIC}racing/`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  if (operation === "merge") await editFolder(f, PRIVATE);
  let puts = 0;
  let edited = false;
  f.intercept(async (url, init) => {
    if (init?.method === "PUT" && (url === `${to}secret` || (url === to && ++puts > 1)))
      return new Response(null, { status: 503 });
    if (!edited && url === to && init?.method === "DELETE") {
      edited = true;
      await editFolder(f, to);
    }
    return undefined;
  });
  await expect(
    operation === "merge"
      ? client.mergeContainer(PRIVATE, to, { kind: "preserve-source" })
      : operation === "copy"
        ? client.copy(PRIVATE, to, { kind: "preserve-source" })
        : client.move(PRIVATE, to, { kind: "preserve-source" }),
  ).rejects.toThrow();
  expect(edited).toBe(true);
  expect(await hasEdit(f, to)).toBe(true);
});

it.each([
  "archive",
  "receipt",
])("Trash %s cleanup keeps RDF or metadata edited after its captured GET", async (kind) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const [entry] = (
    await trashItems(client, DRIVE, [await client.stat(`${PRIVATE}secret`)], { webId: OWNER })
  ).done;
  if (!entry) throw new Error("Missing recovery");
  const { emptyTrashIndex, addTrashRecord, serializeTrashIndex } = await import(
    "../src/apps/drive/lib/operations/trash-index"
  );
  const slot = parentOf(entry.url);
  const target = `${slot}${kind === "archive" ? ".access.json" : "partial.ttl"}`;
  if (kind === "receipt") {
    const receipt = emptyTrashIndex();
    addTrashRecord(receipt, entry);
    receipt.record(entry.url).status = "complete";
    await client.write(
      target,
      await serializeTrashIndex(receipt),
      { contentType: "text/turtle", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    );
  }
  let edited = false;
  f.after(async (url, method, response) => {
    if (
      !edited &&
      response.ok &&
      (kind === "archive"
        ? url === entry.url && method === "DELETE"
        : url === target && method === "GET")
    ) {
      edited = true;
      const body =
        kind === "archive"
          ? '{"external":"retain me"}'
          : `${await response.clone().text()}\n<${target}> <https://example.test/note> <${ROOT}concurrent>.`;
      await f.pod.fetch(target, {
        method: "PUT",
        headers: { "content-type": kind === "archive" ? "application/json" : "text/turtle" },
        body,
      });
    }
    return response;
  });
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(edited).toBe(true);
  expect(result.failed).toHaveLength(1);
  expect(f.pod.has(target)).toBe(true);
  expect(await (await f.pod.fetch(target)).text()).toContain(
    kind === "archive" ? "retain me" : "concurrent",
  );
});

it.each([
  "empty",
  "malformed",
  "mixed RDF",
  "access document header",
  "ACP link",
  "ACR path",
  "two ACL links",
])("policy installation refuses ambiguous %s discovery", async (mode) => {
  const f = await rdfPod();
  const resource = `${PUBLIC}placeholder`;
  const wac = await aclBody(resource);
  f.policies.set(
    `${resource}.policy`,
    mode === "empty"
      ? ""
      : mode === "malformed"
        ? "not RDF"
        : mode === "mixed RDF"
          ? `${wac}\n<${resource}.policy> <https://example.test/policy> <http://www.w3.org/ns/solid/acp#PublicAgent>.`
          : wac,
  );
  f.after(async (url, _method, response) => {
    if (url === `${resource}.policy` && mode === "access document header")
      response.headers.set("ACR-Allow", "read");
    if (url === resource) {
      if (mode === "ACP link")
        response.headers.append(
          "link",
          '<policy>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
        );
      if (mode === "ACR path") response.headers.set("link", `<${resource}.acr>; rel=acl`);
      if (mode === "two ACL links") response.headers.append("link", "<other>; rel=acl");
    }
    return response;
  });
  await expect(accessControl(f.fetch, ROOT).privateFolder(resource, OWNER)).rejects.toThrow();
  expect(f.calls.some(({ method }) => method === "PUT")).toBe(false);
});

it.each([
  "foreign bytes",
  "empty bytes",
  "missing validator",
  "read refused",
  "folder without validator",
])("failed protection cleanup rechecks %s after a DELETE precondition conflict", async (mode) => {
  const f = await rdfPod();
  const folder = mode === "folder without validator";
  const to = `${PUBLIC}unprotected${folder ? "/" : ""}`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  let raced = false;
  f.intercept(async (url, init) => {
    if (url === `${to}.policy` && init?.method === "PUT")
      return new Response(null, { status: 503 });
    if (!raced && url === to && init?.method === "DELETE") {
      raced = true;
      await f.pod.fetch(to, {
        method: "PUT",
        body: mode === "foreign bytes" ? "another writer's bytes" : "",
      });
    }
    if (raced && url === to && !init?.method && mode === "read refused")
      return new Response(null, { status: 403 });
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (raced && url === to && method === "GET" && mode.includes("validator"))
      response.headers.delete("etag");
    return response;
  });
  await expect(
    client.copy(folder ? PRIVATE : `${PRIVATE}secret`, to, { kind: "preserve-source" }),
  ).rejects.toThrow();
  expect(raced).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  if (mode === "foreign bytes")
    expect(await (await f.pod.fetch(to)).text()).toBe("another writer's bytes");
});

it.each([
  "after creation",
  "missing creation validator",
])("container merge refuses foreign RDF %s", async (mode) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const to = `${PUBLIC}foreign-merge/`;
  let created = false;
  f.after(async (url, method, response) => {
    if (!created && url === to && method === "PUT" && response.ok) {
      created = true;
      await editFolder(f, to);
      if (mode === "missing creation validator") response.headers.delete("etag");
    }
    return response;
  });
  await expect(client.mergeContainer(PRIVATE, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(await hasEdit(f, to)).toBe(true);
});

it("a direct recovery move refuses an unreadable policy archive before payload writes", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const original = `${PRIVATE}secret`;
  const [entry] = (await trashItems(client, DRIVE, [await client.stat(original)], { webId: OWNER }))
    .done;
  if (!entry) throw new Error("Missing recovery");
  f.calls.length = 0;
  f.intercept(async (url, init) =>
    url.endsWith("/.access.json") && init?.method !== "HEAD"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  await expect(client.move(entry.url, original, { kind: "preserve-source" })).rejects.toMatchObject(
    { cause: 403 },
  );
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
  expect(f.pod.has(entry.url)).toBe(true);
  expect(f.pod.has(original)).toBe(false);
});

it("a destination ACL widened after payload PUT retains private recovery and preserves the foreign ACL", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const source = `${PRIVATE}secret`;
  const to = `${PUBLIC}policy-race`;
  let writes = 0;
  f.after(async (url, method, response) => {
    if (url === to && method === "PUT" && response.ok && ++writes === 2)
      f.policies.set(`${to}.policy`, await aclBody(to, true));
    return response;
  });
  await expect(client.move(source, to, { kind: "preserve-source" })).rejects.toMatchObject({
    kind: "partial-failure",
    cause: { kind: "private-access-unavailable" },
  });
  expect(writes).toBe(3);
  expect(f.pod.has(source)).toBe(true);
  expect(await (await f.pod.fetch(to)).text()).toBe("");
  expect(f.policies.get(`${to}.policy`)).toBe(await aclBody(to, true));
  await expectPrivateRecovery(f, "secret contents");
});

it("Restore retains recovery when the original's existence cannot be determined", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const original = `${PRIVATE}secret`;
  const [entry] = (await trashItems(client, DRIVE, [await client.stat(original)], { webId: OWNER }))
    .done;
  if (!entry) throw new Error("Missing recovery");
  f.intercept(async (url, init) =>
    url === original && init?.method === "HEAD" ? new Response(null, { status: 503 }) : undefined,
  );
  expect((await restoreItems(client, DRIVE, [entry])).failed).toMatchObject([
    { error: { status: 503, url: original } },
  ]);
  expect(f.pod.has(entry.url)).toBe(true);
  expect(f.pod.has(original)).toBe(false);
});

it.each([
  "ACL PUT",
  "destination HEAD",
])("move stops if ACP signals appear on the %s response", async (phase) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const source = `${PRIVATE}secret`;
  const to = `${PUBLIC}late-acp`;
  let writes = 0;
  f.after(async (url, method, response) => {
    if (url === to && method === "PUT" && response.ok) writes++;
    if (
      (phase === "ACL PUT" && url === `${to}.policy` && method === "PUT") ||
      (phase === "destination HEAD" && writes === 2 && url === to && method === "HEAD")
    )
      response.headers.set("ACP-Allow", 'public="read"');
    return response;
  });
  await expect(client.move(source, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(f.pod.has(source)).toBe(true);
  if (phase === "ACL PUT") expect(await (await f.pod.fetch(to)).text()).not.toBe("secret contents");
});
