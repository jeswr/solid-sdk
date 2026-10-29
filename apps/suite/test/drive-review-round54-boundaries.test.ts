// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl, privateAcl } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import {
  deleteForever,
  listTrash,
  moveItems,
  renameItem,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import {
  addTrashRecord,
  emptyTrashIndex,
  serializeTrashIndex,
} from "../src/apps/drive/lib/operations/trash-index";
import { rdfPod } from "./drive-rdf-pod";
import {
  ACL,
  aclBody,
  DRIVE,
  EVERYONE,
  OWNER,
  PRIVATE,
  ROOT,
  turtle,
  WacFields,
} from "./drive-wac-pod";

const { IDBFactory, IDBObjectStore } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as {
  IDBFactory: new () => IDBFactory;
  IDBObjectStore: { prototype: IDBObjectStore };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const steps = [
  "Trash index overwrite",
  "move",
  "rename",
  "Trash",
  "remove",
  "recursive remove",
  "Delete forever",
  "Empty Trash",
  "overwrite",
  "folder metadata",
  "Restore",
  "partial file Restore",
  "partial folder Restore",
  "copy payload",
  "ACL overwrite",
  "replacement rollback",
  "copy rollback",
  "container rollback",
  "metadata undo",
  "policy archive cleanup",
  "receipt cleanup",
  "slot cleanup",
  "ancestor cleanup",
  "owner-only ACL",
  "owner-only overwrite",
  "owner-only folder overwrite",
  "private folder ACL",
  "protection receipt repair",
  "retained recovery clearing",
  "replay recovery clearing",
  "container merge",
  "partial folder Restore metadata",
  "copy rollback without Link",
  "container rollback without Link",
  "folder overwrite rollback with child defaults",
  "partial Restore rollback with child defaults",
] as const;
type Step = (typeof steps)[number];

async function scenario(step: Step, events: string[]) {
  const f = await rdfPod();
  const mutations: { url: string; prior: string | undefined }[] = [];
  let afterIdentity: ((url: string, response: Response) => Promise<void>) | undefined;
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (
      method === "DELETE" ||
      (method === "PUT" && (headers.has("if-match") || url.endsWith(".policy")))
    )
      mutations.push({ url, prior: events.at(-1) });
    const response = await f.fetch(input, init);
    if (method === "HEAD" && headers.has("if-match")) await afterIdentity?.(url, response);
    events.push(method === "HEAD" && headers.has("if-match") ? "identity HEAD" : method);
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const folder = [
    "recursive remove",
    "folder metadata",
    "owner-only folder overwrite",
    "partial folder Restore",
    "container rollback",
    "metadata undo",
    "container merge",
    "partial folder Restore metadata",
    "container rollback without Link",
    "folder overwrite rollback with child defaults",
    "partial Restore rollback with child defaults",
  ].includes(step);
  const source = folder ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (folder) await f.pod.fetch(source, { method: "PUT", body: "" });
  if (step === "container merge" || step === "partial folder Restore metadata") {
    const data = new Store();
    new WacFields(source, data, DataFactory)
      .iris("https://example.test/note")
      .add(`${ROOT}statement`);
    await f.pod.fetch(source, { method: "PUT", body: await turtle(data) });
  }
  if (step.endsWith("with child defaults")) {
    const data = new Store();
    const subject = new WacFields(source, data, DataFactory);
    const node = new WacFields(DataFactory.blankNode(), data, DataFactory);
    node.iris("https://example.test/value").add("urn:original");
    SetFrom.subjectPredicate(
      subject,
      "https://example.test/note",
      TermAs.is,
      TermFrom.instance,
    ).add(node);
    await f.pod.fetch(source, { method: "PUT", body: await turtle(data) });
    await f.pod.fetch(`${source}child`, { method: "PUT", body: "shared child" });
    const policy = privateAcl(source, OWNER);
    const rule = new WacFields(DataFactory.blankNode(), policy, DataFactory);
    rule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
    rule.iris(`${ACL}default`).add(source);
    rule.iris(`${ACL}agentClass`).add(EVERYONE);
    rule.iris(`${ACL}mode`).add(`${ACL}Read`);
    f.policies.set(`${source}.policy`, await turtle(policy));
  }
  const selected = await client.stat(source);
  if (!selected.etag) throw new Error("Missing source validator");
  let target = source;
  let targetCheck = 1;
  let identityTarget: string | undefined;
  let run: () => Promise<unknown>;
  if (step.endsWith("with child defaults")) {
    if (step === "partial Restore rollback with child defaults") {
      f.intercept(async (url, init) =>
        url === `${source}child` && init?.method === "DELETE"
          ? new Response(null, { status: 403 })
          : undefined,
      );
      expect((await trashItems(client, DRIVE, [selected], { webId: OWNER })).failed).toHaveLength(
        1,
      );
      f.intercept(undefined);
      const [entry] = await listTrash(client, DRIVE);
      if (!entry) throw new Error("Missing recovery");
      run = () => restoreItems(client, DRIVE, [entry]);
    } else
      run = () =>
        client.write(
          source,
          "",
          { contentType: "text/turtle", ifMatch: selected.etag as string },
          { kind: "protect-ancestors" },
        );
    let written = false;
    let failed = false;
    f.after(async (url, method, response) => {
      if (url === source && method === "PUT" && response.ok) written = true;
      return response;
    });
    f.intercept(async (url, init) => {
      if (written && !failed && url === `${source}.policy` && !init?.method) {
        failed = true;
        return new Response(null, { status: 503 });
      }
      return undefined;
    });
    targetCheck = 2;
  } else if (step === "Trash index overwrite") {
    target = `${DRIVE}.trash/index.ttl`;
    await client.prepareTrash(`${DRIVE}.trash/`, { kind: "owner-only", webId: OWNER });
    await client.write(
      target,
      "",
      { contentType: "text/turtle", ifNoneMatch: "*" },
      { kind: "owner-only" },
    );
    run = () => trashItems(client, DRIVE, [selected], { webId: OWNER });
  } else if (
    [
      "Delete forever",
      "Empty Trash",
      "Restore",
      "partial file Restore",
      "partial folder Restore",
      "policy archive cleanup",
      "receipt cleanup",
      "slot cleanup",
      "partial folder Restore metadata",
    ].includes(step)
  ) {
    if (step.startsWith("partial"))
      f.intercept(async (url, init) =>
        url === source && init?.method === "DELETE"
          ? new Response(null, { status: 412 })
          : undefined,
      );
    await trashItems(client, DRIVE, [selected], { webId: OWNER });
    f.intercept(undefined);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    const slot = new URL(".", entry.url).href;
    target =
      step === "slot cleanup"
        ? slot
        : step === "policy archive cleanup"
          ? `${slot}.access.json`
          : step === "receipt cleanup"
            ? `${slot}partial.ttl`
            : entry.url;
    if (step === "receipt cleanup") {
      const index = emptyTrashIndex();
      addTrashRecord(index, entry);
      index.record(entry.url).status = "complete";
      await f.pod.fetch(target, {
        method: "PUT",
        body: await serializeTrashIndex(index),
        headers: { "content-type": "text/turtle" },
      });
    }
    run = () =>
      step === "Restore" || step.startsWith("partial")
        ? restoreItems(client, DRIVE, [entry])
        : deleteForever(client, DRIVE, [entry]);
  } else if (step === "container merge") {
    target = `${PRIVATE}merged/`;
    run = () => client.mergeContainer(source, target, { kind: "preserve-source" });
  } else if (step.endsWith("rollback without Link")) {
    target = `${PRIVATE}copy${folder ? "/" : ""}`;
    const foreign = await aclBody(target, true);
    let created = false;
    f.after(async (url, method, response) => {
      if (!created && url === target && method === "PUT" && response.ok) {
        created = true;
        response.headers.delete("link");
        f.policies.set(`${target}.policy`, foreign);
      }
      return response;
    });
    run = () => client.copy(source, target, { kind: "preserve-source" });
  } else if (step === "copy payload" || step === "copy rollback" || step === "container rollback") {
    target = `${PRIVATE}copy${folder ? "/" : ""}`;
    if (step === "container rollback") {
      const data = new Store();
      new WacFields(source, data, DataFactory)
        .iris("https://example.test/note")
        .add(`${ROOT}statement`);
      await f.pod.fetch(source, { method: "PUT", body: await turtle(data) });
    }
    if (step !== "copy payload")
      f.intercept(async (url, init) =>
        url === target && init?.method === "PUT" && new Headers(init.headers).has("if-match")
          ? new Response(null, { status: 503 })
          : undefined,
      );
    run = () => client.copy(source, target, { kind: "preserve-source" });
    // The failed payload PUT checks the same target before rollback DELETE.
    if (step !== "copy payload") targetCheck = 2;
  } else if (step === "ACL overwrite") {
    target = `${PRIVATE}.policy`;
    run = () => accessControl(http, ROOT).store(target, privateAcl(PRIVATE, OWNER));
  } else if (step === "metadata undo") {
    const data = new Store();
    new WacFields(source, data, DataFactory)
      .iris("https://example.test/note")
      .add(`${ROOT}statement`);
    await f.pod.fetch(source, { method: "PUT", body: await turtle(data) });
    target = `${PRIVATE}survivor/`;
    await f.pod.fetch(target, { method: "PUT", body: "" });
    const merged = await client.mergeContainer(source, target, { kind: "preserve-source" });
    f.policies.set(`${target}.policy`, await aclBody(target, true));
    run = () => merged.recheck();
  } else if (step === "ancestor cleanup") {
    target = `${PRIVATE}ancestor/`;
    await protectionLedger(http).set(target, {
      acl: `${PRIVATE}.policy`,
      from: PRIVATE,
      turtle: f.policies.get(`${PRIVATE}.policy`) as string,
    });
    f.intercept(async (url, init) =>
      url === `${target}.policy` && init?.method === "PUT"
        ? new Response(null, { status: 403 })
        : undefined,
    );
    run = () =>
      client.write(
        `${target}upload`,
        "upload",
        { contentType: "text/plain", ifNoneMatch: "*" },
        { kind: "protect-ancestors" },
      );
  } else if (step === "protection receipt repair") {
    target = `${source}.policy`;
    identityTarget = source;
    await protectionLedger(http).set(source, {
      acl: `${PRIVATE}.policy`,
      from: PRIVATE,
      turtle: f.policies.get(`${PRIVATE}.policy`) as string,
      etag: selected.etag,
    });
    run = () => client.read(source);
  } else if (step === "private folder ACL") {
    target = `${PRIVATE}.policy`;
    run = () => accessControl(http, ROOT).privateFolder(PRIVATE, OWNER);
  } else if (step === "owner-only overwrite" || step === "owner-only folder overwrite") {
    targetCheck = 2;
    run = () =>
      client.write(
        source,
        step === "owner-only folder overwrite" ? "" : "private upload",
        {
          contentType: step === "owner-only folder overwrite" ? "text/turtle" : "text/plain",
        },
        { kind: "owner-only" },
      );
  } else if (step === "owner-only ACL") {
    target = `${source}.policy`;
    f.policies.set(`${source}.policy`, await aclBody(source, true));
    run = () =>
      client.write(
        source,
        "private upload",
        {
          contentType: "text/plain",
          ifMatch: selected.etag as string,
        },
        { kind: "owner-only" },
      );
  } else if (step === "retained recovery clearing") {
    const destination = `${PRIVATE}copy`;
    target = destination;
    // ACL installation and payload each check the destination first. The third
    // identity check pins clearing our exposed bytes after private retention.
    targetCheck = 3;
    let copied = false;
    f.after(async (url, method, response) => {
      if (
        !copied &&
        url === destination &&
        method === "PUT" &&
        response.ok &&
        (await (await f.pod.fetch(url)).text()) === "secret contents"
      ) {
        copied = true;
        f.policies.set(`${destination}.policy`, await aclBody(destination, true));
        await f.pod.fetch(source, { method: "PUT", body: "edited source" });
      }
      return response;
    });
    run = () => client.copy(source, destination, { kind: "preserve-source" });
  } else if (step === "replay recovery clearing") {
    target = source;
    targetCheck = 2;
    let puts = 0;
    f.after(async (url, method, response) => {
      if (url === source && method === "PUT" && response.ok && ++puts <= 2)
        f.policies.set(`${source}.policy`, await aclBody(source, true));
      return response;
    });
    run = () => uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected);
  } else if (step === "replacement rollback") {
    let uploaded = false;
    f.after(async (url, method, response) => {
      if (!uploaded && url === source && method === "PUT" && response.ok) {
        uploaded = true;
        f.policies.set(`${source}.policy`, await aclBody(source, true));
      }
      return response;
    });
    targetCheck = 2;
    run = () => uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected);
  } else if (step === "move") run = () => moveItems(client, [selected], `${PRIVATE}target/`);
  else if (step === "rename") run = () => renameItem(client, selected, "renamed");
  else if (step === "Trash") run = () => trashItems(client, DRIVE, [selected], { webId: OWNER });
  else if (step === "overwrite")
    run = () => uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected);
  else if (step === "folder metadata")
    run = () =>
      client.write(
        source,
        "",
        { contentType: "text/turtle", ifMatch: selected.etag as string },
        { kind: "protect-ancestors" },
      );
  else run = () => client.remove(source, { recursive: folder, ifMatch: selected.etag as string });
  mutations.length = 0;
  return {
    f,
    run,
    target,
    targetCheck,
    identityTarget: identityTarget ?? target,
    mutations,
    race: (check: typeof afterIdentity) => {
      afterIdentity = check;
    },
  };
}

it.each(
  steps,
)("round 59 shape a: %s retains a replacement at its final identity check", async (step) => {
  const events: string[] = [];
  const s = await scenario(step, events);
  let checks = 0;
  let replacementEtag: string | null = null;
  s.race(async (url, response) => {
    if (url !== s.identityTarget || !response.ok || ++checks !== s.targetCheck) return;
    const target = s.target;
    if (target.endsWith(".policy")) {
      const body = await aclBody(PRIVATE, true);
      s.f.policies.set(target, body);
      replacementEtag = JSON.stringify(body);
    } else {
      const current = await s.f.pod.fetch(target);
      await s.f.pod.fetch(target, { method: "PUT", body: await current.text() });
      replacementEtag = (await s.f.pod.fetch(target, { method: "HEAD" })).headers.get("etag");
    }
  });
  await s.run().catch(() => undefined);
  expect(replacementEtag).not.toBeNull();
  const current = s.target.endsWith(".policy")
    ? JSON.stringify(s.f.policies.get(s.target))
    : (await s.f.pod.fetch(s.target, { method: "HEAD" })).headers.get("etag");
  expect(current).toBe(replacementEtag);
});

it.each(
  steps,
)("round 59 shape b: %s performs no local async work after the final HTTP identity check", async (step) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const events: string[] = [];
  const s = await scenario(step, events);
  for (const method of ["get", "getAllKeys", "put", "delete"] as const) {
    const original = IDBObjectStore.prototype[method];
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (
      this: IDBObjectStore,
      ...args: unknown[]
    ) {
      events.push("IndexedDB");
      return Reflect.apply(original, this, args);
    });
  }
  const locks = navigator.locks;
  const request = locks.request.bind(locks);
  vi.spyOn(locks, "request").mockImplementation((...args: Parameters<typeof locks.request>) => {
    events.push("Web Lock");
    return Reflect.apply(request, locks, args);
  });
  await s.run().catch(() => undefined);
  expect(s.mutations.filter(({ url }) => url === s.target).length).toBeGreaterThan(0);
  for (const mutation of s.mutations) expect(mutation.prior).toBe("identity HEAD");
});
