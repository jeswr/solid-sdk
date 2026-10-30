// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import { accessControl, bindAccess } from "../src/apps/drive/lib/client/access";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
  parentOf,
} from "../src/apps/drive/lib/client/client";
import { deletionControl } from "../src/apps/drive/lib/client/deletion";
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
  wacPod,
} from "./drive-wac-pod";

it.each([
  "inherited default",
  "new own ACL",
])("round 50: source %s narrowing after placeholder creation requires confirmation", async (change) => {
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}secret`;
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  let changed = false;
  f.after(async (url, method, response) => {
    if (!changed && url === to && method === "PUT" && response.ok) {
      changed = true;
      const target = change === "new own ACL" ? from : PRIVATE;
      f.policies.set(`${target}.policy`, await aclBody(target));
    }
    return response;
  });
  await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toThrow();
  expect(changed).toBe(true);
  expect(confirmAccess).toHaveBeenCalledWith(
    expect.objectContaining({ gains: ["Everyone (public)"] }),
  );
  expect(f.pod.has(from)).toBe(true);
  expect((await f.anonymous(from)).status).toBe(403);
  expect(f.pod.has(to)).toBe(false);
  expect(f.calls).not.toContainEqual({ url: from, method: "DELETE" });
});

it("round 50: partial-folder restore rolls back metadata when destination access changes after PUT", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}archived/`;
  const to = `${PRIVATE}surviving/`;
  const data = new Store();
  new WacFields(from, data, DataFactory)
    .iris("https://example.test/note")
    .add(`${ROOT}confidential`);
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let changed = false;
  f.after(async (url, method, response) => {
    if (!changed && url === to && method === "PUT" && response.ok) {
      changed = true;
      f.policies.set(`${to}.policy`, await aclBody(to, true));
    }
    return response;
  });
  await expect(
    client.exclusive?.([from, to], async (scoped) => {
      await scoped.mergeContainer(from, to, { kind: "preserve-source" });
      await scoped.remove(from, { ifMatch: (await scoped.stat(from)).etag as string });
    }),
  ).rejects.toThrow();
  expect(changed).toBe(true);
  expect(f.pod.has(from)).toBe(true);
  const survivor = await f.pod.fetch(to);
  const restored = await parseRdf(await survivor.text(), "text/turtle");
  expect(new WacFields(to, restored, DataFactory).iris("https://example.test/note").size).toBe(0);
  expect(f.calls).not.toContainEqual({ url: from, method: "DELETE" });
});

const operations = [
  "move",
  "copy",
  "restore",
  "partial-folder restore",
  "upload replacement",
  "Trash",
  "empty Trash",
] as const;
const races = operations.flatMap((operation) => {
  const points =
    operation === "empty Trash"
      ? ["before deletion"]
      : operation === "partial-folder restore"
        ? ["before payload", "after payload", "before deletion"]
        : operation === "upload replacement"
          ? ["before payload", "after payload"]
          : [
              "before placeholder",
              "after placeholder",
              "before payload",
              "after payload",
              ...(operation === "copy" ? [] : ["before deletion"]),
            ];
  return points.flatMap((point) =>
    ["source", "destination"].flatMap((side) =>
      ["own ACL added", "inherited default changed", "ACR added"].map((signal) => ({
        operation,
        point,
        side,
        signal,
      })),
    ),
  );
});

it.each(races)("access binding: $operation / $side / $signal / $point", async ({
  operation,
  point,
  side,
  signal,
}) => {
  const f = await rdfPod();
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess,
  });
  let from = `${PRIVATE}secret`;
  let to = `${PUBLIC}secret`;
  let entry: Awaited<ReturnType<typeof listTrash>>[number] | undefined;
  if (operation === "partial-folder restore") {
    from = `${PRIVATE}tree/`;
    to = from;
    const data = new Store();
    new WacFields(from, data, DataFactory)
      .iris("https://example.test/note")
      .add(`${ROOT}confidential`);
    await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
    await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
    f.intercept(async (url, init) =>
      url === from && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
    );
    await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
    f.intercept(undefined);
    [entry] = await listTrash(client, DRIVE);
    expect(entry?.status).toBe("partial");
    from = (entry as NonNullable<typeof entry>).url;
    await f.pod.fetch(to, { method: "PUT", body: "" });
  } else if (operation === "restore" || operation === "empty Trash") {
    [entry] = (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).done;
    expect(entry).toBeDefined();
    to = operation === "restore" ? from : `${DRIVE}.trash/index.ttl`;
    from = (entry as NonNullable<typeof entry>).url;
    // Exercise inheritance as well as newly installed own policies on recovery.
    f.policies.delete(`${from}.policy`);
  } else if (operation === "upload replacement") to = from;
  f.calls.length = 0;
  let changed = false;
  let targetKnown = operation !== "Trash";
  const flip = async () => {
    changed = true;
    const endpoint = side === "source" ? from : to;
    const resource =
      signal === "inherited default changed" ? (parentOf(endpoint) as string) : endpoint;
    if (signal === "ACR added") {
      const data = new Store();
      new WacFields(`${resource}.policy`, data, DataFactory)
        .iris("http://www.w3.org/ns/solid/acp#apply")
        .add(`${ROOT}public-policy`);
      f.policies.set(`${resource}.policy`, await turtle(data));
    } else f.policies.set(`${resource}.policy`, await aclBody(resource, true));
  };
  const writing = (url: string, init?: RequestInit) => {
    if (operation === "Trash" && /\/\.trash\/[^/]+\/secret$/.test(url)) {
      to = url;
      targetKnown = true;
    }
    if (url !== to || init?.method !== "PUT") return undefined;
    return String(init.body ?? "") === "" ? "placeholder" : "payload";
  };
  if (point === "before deletion" && ["move", "restore", "Trash"].includes(operation)) {
    const move = client.move;
    vi.spyOn(client, "move").mockImplementation(async function (
      this: DriveClient,
      source,
      destination,
      policy,
      options,
    ) {
      return move.call(this, source, destination, policy, {
        ...options,
        beforeDelete: async () => {
          await options?.beforeDelete?.();
          if (!changed) await flip();
        },
      });
    });
  }
  if (point === "before deletion" && operation === "partial-folder restore") {
    const remove = client.remove;
    vi.spyOn(client, "remove").mockImplementation(async function (this: DriveClient, url, options) {
      if (url === from && !changed) await flip();
      return remove.call(this, url, options);
    });
  }
  f.intercept(async (url, init) => {
    if (!changed && operation === "empty Trash" && url === from && init?.method === "HEAD")
      await flip();
    const phase = writing(url, init);
    if (!changed && phase && point === `before ${phase}`) await flip();
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (!response.ok) return response;
    if (url === to && method === "PUT") {
      const phase = (await (await f.pod.fetch(to)).text()) === "" ? "placeholder" : "payload";
      if (!changed && point === `after ${phase}`) await flip();
    }
    if (!changed && point === "before deletion") {
      if (operation === "empty Trash") {
        const endpoint = side === "source" ? from : to;
        const policy = f.policies.has(`${endpoint}.policy`)
          ? `${endpoint}.policy`
          : `${parentOf(endpoint)}.policy`;
        if (url === policy && method === "GET") await flip();
      }
    }
    return response;
  });
  let failed = false;
  try {
    if (operation === "move") await client.move(from, to, { kind: "confirm-move" });
    else if (operation === "copy") await client.copy(from, to, { kind: "preserve-source" });
    else if (operation === "restore" || operation === "partial-folder restore") {
      const outcome = await restoreItems(client, DRIVE, [entry as NonNullable<typeof entry>]);
      failed = outcome.failed.length > 0;
    } else if (operation === "Trash") {
      const outcome = await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER });
      failed = outcome.failed.length > 0;
    } else if (operation === "empty Trash") {
      const outcome = await deleteForever(client, DRIVE, [entry as NonNullable<typeof entry>]);
      failed = outcome.failed.length > 0;
    } else
      await uploadFile(
        client,
        PRIVATE,
        new Blob(["new confidential upload"]),
        "secret",
        "replace",
        await client.stat(from),
      );
  } catch {
    failed = true;
  }
  expect(changed).toBe(true);
  expect(targetKnown).toBe(true);
  if (failed) {
    expect(f.pod.has(from)).toBe(true);
    expect(f.calls.filter(({ url, method }) => url === from && method === "DELETE").length).toBe(0);
  }
  if (operation === "empty Trash") {
    expect(failed).toBe(false);
    expect(f.pod.has(from)).toBe(false);
  } else if (operation === "upload replacement") {
    // Changed inheritance is a concurrent policy too. Preserve it and retain
    // both byte versions privately rather than freezing the former grants.
    expect(await (await f.pod.fetch(from)).text()).toBe("");
    await expectPrivateRecovery(f, "secret contents");
    await expectPrivateRecovery(f, "new confidential upload");
    expect(failed).toBe(true);
  } else if (f.pod.has(to)) {
    // An irrelevant ancestor edit may be shielded by a verified own ACL.
    // An unchecked destination may never retain the copied confidential data.
    const anonymous = await f.anonymous(to).catch(() => new Response(null, { status: 403 }));
    if (anonymous.ok) {
      const body = await anonymous.text();
      expect(body).not.toContain("secret contents");
      expect(body).not.toContain("confidential");
    }
  }
});

it.each([
  "source",
  "destination",
  "unknown",
])("partial restore keeps its binding until recovery deletion: %s", async (side) => {
  const f = await rdfPod();
  const from = `${PRIVATE}recovery/`;
  const to = `${PRIVATE}survivor/`;
  const data = new Store();
  new WacFields(from, data, DataFactory)
    .iris("https://example.test/note")
    .add(`${ROOT}confidential`);
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(
    client.exclusive?.([from, to], async (scoped) => {
      await scoped.mergeContainer(from, to, { kind: "preserve-source" });
      const endpoint = side === "source" ? from : to;
      f.policies.set(
        `${endpoint}.policy`,
        side === "unknown" ? "invalid RDF" : await aclBody(endpoint, true),
      );
      await scoped.remove(from, { ifMatch: (await scoped.stat(from)).etag as string });
    }),
  ).rejects.toThrow();
  expect(f.pod.has(from)).toBe(true);
  expect(await (await f.pod.fetch(to)).text()).not.toContain("confidential");
  expect(f.calls).not.toContainEqual({ url: from, method: "DELETE" });
});

it.each([
  "new upload",
  "folder metadata",
  "scoped source change",
  "foreign replacement",
])("standalone writes roll back only their captured version: %s", async (operation) => {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  const to = operation === "folder metadata" ? `${PRIVATE}metadata/` : `${PRIVATE}new-upload`;
  if (operation === "folder metadata") await f.pod.fetch(to, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  let changed = false;
  f.after(async (url, method, response) => {
    if (!changed && url === to && method === "PUT" && response.ok) {
      changed = true;
      if (operation === "foreign replacement")
        await f.pod.fetch(to, { method: "PUT", body: "foreign bytes" });
      const endpoint = operation === "scoped source change" ? source : to;
      f.policies.set(`${endpoint}.policy`, await aclBody(endpoint, true));
    }
    return response;
  });
  const data = new Store();
  new WacFields(to, data, DataFactory).iris("https://example.test/note").add(`${ROOT}confidential`);
  await expect(
    client.exclusive?.([source, to], async (scoped) => {
      if (operation === "scoped source change") await scoped.bindAccess?.(source, to);
      await scoped.write(
        to,
        operation === "folder metadata" ? await turtle(data) : "secret contents",
        {
          contentType: operation === "folder metadata" ? "text/turtle" : "text/plain",
          ...(operation === "folder metadata"
            ? { ifMatch: (await scoped.stat(to)).etag as string }
            : { ifNoneMatch: "*" as const }),
        },
        { kind: "protect-ancestors" },
      );
    }),
  ).rejects.toThrow();
  expect(changed).toBe(true);
  expect(f.pod.has(source)).toBe(true);
  if (operation === "foreign replacement")
    expect(await (await f.pod.fetch(to)).text()).toBe("foreign bytes");
  else if (operation === "folder metadata")
    expect(await (await f.pod.fetch(to)).text()).not.toContain("confidential");
  else if (operation === "new upload") {
    expect(await (await f.pod.fetch(to)).text()).toBe("");
    await expectPrivateRecovery(f, "secret contents");
    expect(f.policies.get(`${to}.policy`)).toBe(await aclBody(to, true));
  } else expect(f.pod.has(to)).toBe(false);
});

it("rechecks bound access after persisting a deletion intent and retires a refused intent", async () => {
  const f = await wacPod();
  const url = `${PRIVATE}secret`;
  const binding = await bindAccess(accessControl(f.fetch, ROOT), url, url);
  const deletion = deletionControl(f.fetch, (status, target) => new Error(`${status}: ${target}`));
  const etag = (await f.pod.fetch(url, { method: "HEAD" })).headers.get("etag") as string;
  await expect(
    deletion.remove(url, etag, undefined, {
      rechecks: [
        async () => {
          f.policies.set(`${url}.policy`, await aclBody(url, true));
          await binding.recheck();
        },
      ],
    }),
  ).rejects.toThrow();
  expect(f.calls).not.toContainEqual({ url, method: "DELETE" });
  expect(await deletion.recheck(ROOT)).toEqual([]);
  expect(f.pod.has(url)).toBe(true);
});

it("retired destinations do not hide changes to a still-live source", async () => {
  const f = await wacPod();
  const from = `${PUBLIC}placeholder`;
  const to = `${PRIVATE}secret`;
  const binding = await bindAccess(accessControl(f.fetch, ROOT), from, to);
  binding.retire(to);
  f.policies.set(`${from}.policy`, await aclBody(from));
  await expect(binding.recheck()).rejects.toThrow();
  binding.retire(from);
  await binding.recheck();
  await expect(binding.rollback(async () => "captured version removed")).resolves.toBe(
    "captured version removed",
  );
});

it("recovery access binding refuses a wider survivor before removing the private copy", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(client.bindAccess?.(`${PRIVATE}secret`, `${PUBLIC}placeholder`)).rejects.toThrow();
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
  expect(f.calls.some(({ method }) => method === "DELETE")).toBe(false);
});

it("a conditional new upload preserves the target HEAD error before any payload write", async () => {
  const f = await wacPod();
  const to = `${PRIVATE}denied`;
  f.intercept(async (url, init) =>
    url === to && init?.method === "HEAD" ? new Response(null, { status: 403 }) : undefined,
  );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(
    client.write(
      to,
      "secret contents",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toMatchObject({ kind: "forbidden", status: 403 });
  expect(f.calls).not.toContainEqual({ url: to, method: "PUT" });
});

it("permanent deletion accepts an older client's confirmed missing recovery without polling DELETE", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const [entry] = (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER }))
    .done;
  if (!entry) throw new Error("Missing recovery");
  delete client.bindAccess;
  vi.spyOn(client, "remove").mockImplementationOnce(async () => {
    await f.pod.fetch(`${entry.url}secret`, { method: "DELETE" });
    await f.pod.fetch(entry.url, { method: "DELETE" });
    throw new DriveError("not-found", 404, entry.url);
  });
  expect((await deleteForever(client, DRIVE, [entry])).failed).toEqual([]);
  expect(f.pod.has(entry.url)).toBe(false);
});

it("a missing write validator never authorizes unconditional rollback after access changes", async () => {
  const f = await wacPod();
  const to = `${PRIVATE}no-validator`;
  let changed = false;
  f.after(async (url, method, response) => {
    if (!changed && url === to && method === "PUT" && response.ok) {
      changed = true;
      f.policies.set(`${to}.policy`, await aclBody(to, true));
      response.headers.delete("etag");
    }
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(
    client.write(
      to,
      "secret contents",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toMatchObject({ kind: "partial-failure", cause: { kind: "missing-validator" } });
  expect(changed).toBe(true);
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
  expect(f.calls.some(({ method }) => method === "DELETE")).toBe(false);
});

it.each([
  "PUT",
  "listing",
])("partial merge retains the survivor when its %s fails before a write identity is captured", async (failure) => {
  const f = await rdfPod();
  const from = `${PRIVATE}recovery/`;
  const to = `${PRIVATE}survivor/`;
  const data = new Store();
  new WacFields(from, data, DataFactory)
    .iris("https://example.test/note")
    .add(`${ROOT}confidential`);
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  f.intercept(async (url, init) =>
    url === to && (init?.method ?? "GET") === (failure === "PUT" ? "PUT" : "GET")
      ? new Response(null, { status: 503 })
      : undefined,
  );
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(client.mergeContainer(from, to, { kind: "preserve-source" })).rejects.toMatchObject({
    status: 503,
  });
  expect(f.pod.has(from)).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  expect(await (await f.pod.fetch(to)).text()).not.toContain("confidential");
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});

it("access bindings bypass cached policy bodies and discovery headers on every recheck", async () => {
  const f = await wacPod();
  const url = `${PRIVATE}secret`;
  const cached = await aclBody(PRIVATE);
  const discovery = vi.fn((cache: RequestCache | undefined) => expect(cache).toBe("no-store"));
  f.intercept(async (target, init) => {
    if (init?.method === "HEAD") discovery(init.cache);
    if (
      target === `${PRIVATE}.policy` &&
      (init?.method ?? "GET") === "GET" &&
      init?.cache !== "no-store"
    )
      return new Response(cached, { headers: { "content-type": "text/turtle", etag: '"cached"' } });
    return undefined;
  });
  const binding = await bindAccess(accessControl(f.fetch, ROOT), url, url);
  f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  await expect(binding.recheck()).rejects.toThrow();
  expect(discovery).toHaveBeenCalled();
});

it("partial-folder rollback never adopts a newer validator for foreign application RDF", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}recovery/`;
  const to = `${PRIVATE}survivor/`;
  const data = new Store();
  new WacFields(from, data, DataFactory)
    .iris("https://example.test/note")
    .add(`${ROOT}confidential`);
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(
    client.exclusive?.([from, to], async (scoped) => {
      await scoped.mergeContainer(from, to, { kind: "preserve-source" });
      const current = await scoped.readRdf(to);
      if (!current) throw new Error("Missing survivor");
      new WacFields(to, current.dataset, DataFactory)
        .iris("https://example.test/foreign")
        .add(`${ROOT}foreign`);
      await f.pod.fetch(to, { method: "PUT", body: await turtle(current.dataset) });
      f.policies.set(`${to}.policy`, await aclBody(to, true));
      await scoped.remove(from, { ifMatch: (await scoped.stat(from)).etag as string });
    }),
  ).rejects.toThrow();
  expect(f.pod.has(from)).toBe(true);
  expect(await (await f.pod.fetch(to)).text()).toContain(`${ROOT}foreign`);
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
});
