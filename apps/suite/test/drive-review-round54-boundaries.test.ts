// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import {
  ensureTypeRegistrations,
  ProfileTypeIndexAnchor,
} from "../src/apps/docs/lib/model/type-index";
import { accessControl, privateAcl } from "../src/apps/drive/lib/client/access";
import { driveBootstrapFetch } from "../src/apps/drive/lib/client/bootstrap";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { confirmationOptions } from "../src/apps/drive/lib/client/commit";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import { ensureDriveRoot } from "../src/apps/drive/lib/model/root";
import { PODDRIVE, RDF } from "../src/apps/drive/lib/model/vocab";
import {
  deleteForever,
  listTrash,
  moveItems,
  purgeExpired,
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
  PUBLIC,
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
  "startup purge",
  "overwrite",
  "folder metadata",
  "Restore",
  "partial file Restore",
  "partial folder Restore",
  "copy payload",
  "ACL overwrite",
  "replacement rollback",
  "upload rollback",
  "new folder rollback",
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
  "inherited replacement rollback",
  "container provisioning ACL",
  "metadata undo recovery clearing",
  "post-retirement private backup ACL",
  "move tree",
  "rename tree",
  "Trash tree",
  "Restore tree",
  "Delete forever tree",
  "Empty Trash tree",
  "startup purge tree",
  "Replace completion recovery clearing",
  "Move completion recovery clearing",
  "Copy completion recovery clearing",
  "shared partial file Restore",
  "shared partial folder Restore",
  "verification and replay failure clearing",
  "Upload payload",
  "Keep both payload",
  "unconditional creation payload",
  "deny-all copy payload",
  "deny-all move",
  "deny-all rename",
  "deny-all Trash",
  "deny-all Restore",
  "root marker PATCH",
  "description marker PATCH",
  "Type Index overwrite",
  "safe-name Upload payload",
  "safe-name copy payload",
  "safe-name rename",
  "custom-name Upload payload",
  "custom-name copy payload",
  "custom-name rename",
  "renewed-consent move",
  "renewed-consent move tree",
  "startup index overwrite",
  "startup preferences overwrite",
  "startup profile overwrite",
  "revoked source recovery ACL",
] as const;
type Step = (typeof steps)[number];

async function scenario(variant: Step, events: string[], captureModes = false) {
  let sequence = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  );
  const tree = variant.endsWith(" tree");
  const renewed = variant.startsWith("renewed-consent ");
  const base = renewed ? variant.slice("renewed-consent ".length) : variant;
  const shared = variant.startsWith("shared ");
  const denyAll = variant.startsWith("deny-all ");
  const safeName = variant.startsWith("safe-name ");
  const customName = variant.startsWith("custom-name ");
  const step = (
    tree
      ? base.slice(0, -5)
      : shared
        ? variant.slice(7)
        : denyAll
          ? variant.slice(9)
          : safeName
            ? variant.slice(10)
            : customName
              ? variant.slice(12)
              : base
  ) as Step;
  const f = await rdfPod();
  if (shared) f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  if (denyAll) f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, false, false));
  const mutations: { url: string; method: string; empty: boolean; prior: string | undefined }[] =
    [];
  type IdentityCheck = { url: string; check: number };
  const boundaries: {
    target: string;
    method: string;
    empty: boolean;
    identity: string | undefined;
    check: number;
    identities: IdentityCheck[];
  }[] = [];
  let finalChecks: IdentityCheck[] = [];
  let lastIdentity: string | undefined;
  const identityCounts = new Map<string, number>();
  let afterIdentity: ((url: string, response: Response) => Promise<void>) | undefined;
  let completionTarget: string | undefined;
  let completionWritten = false;
  let completionChanged = false;
  const consentDestination = `${DRIVE}consent/`;
  let consentWidened = false;
  let sourceRevoked = false;
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (
      method === "DELETE" ||
      method === "PATCH" ||
      (method === "PUT" && (headers.has("if-match") || url.endsWith(".policy")))
    ) {
      mutations.push({ url, method, empty: init?.body === "", prior: events.at(-1) });
      boundaries.push({
        target: url,
        method,
        empty: init?.body === "",
        identity: lastIdentity,
        check: lastIdentity ? (identityCounts.get(lastIdentity) ?? 0) : 0,
        identities: finalChecks,
      });
    }
    const response = await f.fetch(input, init);
    if (
      renewed &&
      !consentWidened &&
      url.startsWith(consentDestination) &&
      !url.endsWith(".policy") &&
      method === "PUT" &&
      headers.has("if-match") &&
      response.ok
    ) {
      consentWidened = true;
      f.policies.set(`${consentDestination}.policy`, await aclBody(consentDestination, true));
    }
    if (captureModes) response.headers.set("wac-allow", 'user="read write control",public=""');
    if (variant === "revoked source recovery ACL" && url.startsWith(PRIVATE))
      response.headers.set(
        "wac-allow",
        `user="read write control",public="${sourceRevoked ? "" : "read"}"`,
      );
    if (url === completionTarget && method === "PUT" && headers.has("if-match") && response.ok)
      completionWritten = true;
    if (method === "HEAD" && headers.has("if-match")) {
      lastIdentity = url;
      if (url === completionTarget && completionWritten && !completionChanged) {
        completionChanged = true;
        const endpoint = `${url}foreign.policy`;
        f.policies.set(endpoint, await aclBody(url, true));
        f.endpoints.set(url, endpoint);
        response.headers.set("link", `<${endpoint}>; rel="acl"`);
      } else if (!completionTarget || completionChanged) {
        identityCounts.set(url, (identityCounts.get(url) ?? 0) + 1);
        finalChecks.push({ url, check: identityCounts.get(url) as number });
        await afterIdentity?.(url, response);
      }
    } else if (method !== "HEAD" || !headers.has("if-none-match")) finalChecks = [];
    events.push(method === "HEAD" && headers.has("if-match") ? "identity HEAD" : method);
    return response;
  };
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: http,
    webId: OWNER,
    ...(denyAll || renewed ? { confirmAccess: async () => "keep" as const } : {}),
  });
  if (renewed) {
    await f.pod.fetch(consentDestination, { method: "PUT", body: "" });
    f.policies.set(`${consentDestination}.policy`, await aclBody(consentDestination));
  }
  const folder =
    tree ||
    [
      "recursive remove",
      "folder metadata",
      "owner-only folder overwrite",
      "partial folder Restore",
      "container rollback",
      "metadata undo",
      "metadata undo recovery clearing",
      "container merge",
      "partial folder Restore metadata",
      "container rollback without Link",
      "folder overwrite rollback with child defaults",
      "partial Restore rollback with child defaults",
    ].includes(step);
  const source = folder ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (folder) await f.pod.fetch(source, { method: "PUT", body: "" });
  if (tree) await f.pod.fetch(`${source}child`, { method: "PUT", body: "child contents" });
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
  if (step.startsWith("startup ") && step.endsWith(" overwrite")) {
    const profile = new URL("profile", ROOT).href;
    const preferences = `${ROOT}settings/prefs.ttl`;
    const index = `${ROOT}settings/privateTypeIndex.ttl`;
    f.policies.set(`${ROOT}.policy`, await aclBody(ROOT));
    const data = new Store();
    if (step === "startup index overwrite") {
      new ProfileTypeIndexAnchor(OWNER, data, DataFactory).privateIndex = index;
      await f.pod.fetch(index, {
        method: "PUT",
        body: "",
        headers: { "content-type": "text/turtle" },
      });
    }
    if (step === "startup preferences overwrite")
      await f.pod.fetch(preferences, {
        method: "PUT",
        body: "",
        headers: { "content-type": "text/turtle" },
      });
    await f.pod.fetch(profile, {
      method: "PUT",
      body: await turtle(data),
      headers: { "content-type": "text/turtle" },
    });
    target =
      step === "startup index overwrite"
        ? index
        : step === "startup preferences overwrite"
          ? preferences
          : profile;
    run = () =>
      ensureTypeRegistrations({
        webId: OWNER,
        podRoot: ROOT,
        registrations: [{ forClass: "https://example.test/Class", container: DRIVE }],
        fetchImpl: driveBootstrapFetch(http, ROOT),
      });
  } else if (step === "revoked source recovery ACL") {
    const destination = `${PUBLIC}retained`;
    f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
    f.after(async (url, method, response) => {
      if (
        !sourceRevoked &&
        url === destination &&
        method === "PUT" &&
        response.ok &&
        (await (await f.pod.fetch(destination)).text()) === "secret contents"
      ) {
        sourceRevoked = true;
        f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE));
      }
      return response;
    });
    target = `${destination}.policy`;
    identityTarget = destination;
    // The destination's first conditional HEAD writes its payload; the second
    // binds owner-only recovery after rollback refuses the revoked source.
    targetCheck = 2;
    run = () => client.move(source, destination, { kind: "confirm-move" });
  } else if (
    ["root marker PATCH", "description marker PATCH", "Type Index overwrite"].includes(step)
  ) {
    // Exercise the bootstrap's real shared commit boundary too. The mock pod
    // applies only this known marker PATCH using typed RDF fields.
    for (const url of [`${PRIVATE}secret`, PRIVATE, `${PUBLIC}placeholder`, PUBLIC])
      await f.pod.fetch(url, { method: "DELETE" });
    const index = `${ROOT}index.ttl`;
    const description = `${ROOT}drive-description`;
    await f.pod.fetch(index, {
      method: "PUT",
      body: "",
      headers: { "content-type": "text/turtle" },
    });
    if (step === "description marker PATCH")
      await f.pod.fetch(description, {
        method: "PUT",
        body: "",
        headers: { "content-type": "text/turtle" },
      });
    target =
      step === "Type Index overwrite" ? index : step === "root marker PATCH" ? DRIVE : description;
    f.after(async (url, method, response) => {
      if (url === DRIVE && method === "GET" && response.ok) {
        response.headers.append("link", `<${description}>; rel="describedby"`);
        if (step !== "description marker PATCH") response.headers.set("accept-patch", "text/n3");
      }
      return response;
    });
    f.intercept(async (url, init) => {
      if (init?.method !== "PATCH") return undefined;
      const headers = new Headers(init.headers);
      const current = await f.pod.fetch(url, { method: "HEAD" });
      if (headers.get("if-match") !== current.headers.get("etag"))
        return new Response(null, { status: 412 });
      const data = new Store();
      new WacFields(DRIVE, data, DataFactory).iris(RDF.type).add(PODDRIVE.DriveRoot);
      const body = await turtle(data);
      if (url !== DRIVE)
        await f.pod.fetch(url, {
          method: "PUT",
          body,
          headers: { "if-match": headers.get("if-match") as string },
        });
      await f.pod.fetch(DRIVE, { method: "PUT", body });
      return new Response(null, { status: 205 });
    });
    run = () => ensureDriveRoot(http, { storageUrl: ROOT, typeIndexUrl: index });
  } else if (
    ["Upload payload", "Keep both payload", "unconditional creation payload"].includes(step)
  ) {
    target = `${PRIVATE}new-upload${safeName ? ".acl.txt" : customName ? "-policy.ttl" : ""}`;
    run = () =>
      step === "unconditional creation payload"
        ? client.write(
            target,
            "upload",
            { contentType: "text/plain" },
            { kind: "protect-ancestors" },
          )
        : uploadFile(
            client,
            PRIVATE,
            new Blob(["upload"]),
            safeName ? "new-upload.acl.txt" : customName ? "new-upload-policy.ttl" : "new-upload",
            step === "Keep both payload" ? "keep-both" : "fail",
          );
  } else if (step.endsWith("completion recovery clearing")) {
    target = step.startsWith("Replace") ? source : `${PRIVATE}copy`;
    completionTarget = target;
    // Transfers first refuse rollback DELETE on the changed endpoint; the next
    // captured target check belongs to conditional evacuation after private backup.
    targetCheck = step.startsWith("Replace") ? 1 : 2;
    run = () =>
      step.startsWith("Replace")
        ? uploadFile(client, PRIVATE, new Blob(["replacement"]), "secret", "replace", selected)
        : step.startsWith("Move")
          ? client.move(
              source,
              target,
              { kind: "preserve-source" },
              { ...confirmationOptions(selected) },
            )
          : client.copy(
              source,
              target,
              { kind: "preserve-source" },
              { ...confirmationOptions(selected) },
            );
  } else if (step === "post-retirement private backup ACL") {
    f.intercept(async (url, init) =>
      url === source && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
    );
    expect((await trashItems(client, DRIVE, [selected], { webId: OWNER })).failed).toHaveLength(1);
    f.intercept(undefined);
    const [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    const id = "9ea04ab3-cd3f-4f52-af04-a415c8318bd7";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
    const folder = `${ROOT}.drive-recovery-${id}/`;
    target = `${folder}.policy`;
    identityTarget = folder;
    f.after(async (url, method, response) => {
      if (url === entry.url && method === "DELETE" && response.ok)
        await f.pod.fetch(source, { method: "PUT", body: "foreign replacement" });
      return response;
    });
    run = () => restoreItems(client, DRIVE, [entry]);
  } else if (step.endsWith("with child defaults")) {
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
          { contentType: "text/turtle", ...confirmationOptions(selected) },
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
      "startup purge",
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
    await trashItems(client, DRIVE, [selected], {
      webId: OWNER,
      ...(step === "startup purge" ? { now: new Date(Date.now() - 31 * 86_400_000) } : {}),
    });
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
      step === "startup purge"
        ? purgeExpired(client, DRIVE)
        : step === "Restore" || step.startsWith("partial")
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
    target = `${PRIVATE}copy${safeName ? ".acr.txt" : customName ? "-policy.ttl" : ""}${folder ? "/" : ""}`;
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
  } else if (step === "container provisioning ACL") {
    const folder = `${PRIVATE}new/`;
    target = `${folder}.policy`;
    identityTarget = folder;
    run = () => client.createFolder(folder, { kind: "owner-only", webId: OWNER });
  } else if (step === "ACL overwrite") {
    target = `${PRIVATE}.policy`;
    run = () => accessControl(http, ROOT).store(target, privateAcl(PRIVATE, OWNER));
  } else if (step === "metadata undo" || step === "metadata undo recovery clearing") {
    const data = new Store();
    new WacFields(source, data, DataFactory)
      .iris("https://example.test/note")
      .add(`${ROOT}statement`);
    await f.pod.fetch(source, { method: "PUT", body: await turtle(data) });
    target = `${PRIVATE}survivor/`;
    // Distinguish replaying the captured metadata from quarantine's empty PUT;
    // these are separate conditional steps with independent final assertions.
    const previous = new Store();
    new WacFields(target, previous, DataFactory)
      .iris("https://example.test/previous")
      .add(`${ROOT}surviving-statement`);
    await f.pod.fetch(target, { method: "PUT", body: await turtle(previous) });
    const merged = await client.mergeContainer(source, target, { kind: "preserve-source" });
    if (step === "metadata undo recovery clearing")
      f.policies.set(`${target}.policy`, await aclBody(target, true));
    else {
      let failed = false;
      f.intercept(async (url, init) => {
        if (!failed && url === `${target}.policy` && !init?.method) {
          failed = true;
          return new Response(null, { status: 503 });
        }
        return undefined;
      });
    }
    run = () => merged.recheck();
  } else if (step === "upload rollback" || step === "new folder rollback") {
    target = `${PRIVATE}new${step === "new folder rollback" ? "/" : ""}`;
    let written = false;
    let refused = false;
    f.after(async (url, method, response) => {
      if (url === target && method === "PUT" && response.ok) written = true;
      return response;
    });
    f.intercept(async (url, init) => {
      if (written && !refused && url === `${PRIVATE}.policy` && !init?.method) {
        refused = true;
        return new Response(null, { status: 503 });
      }
      return undefined;
    });
    run = () =>
      step === "new folder rollback"
        ? client.createFolder(target, { kind: "inherit-verified" })
        : uploadFile(client, PRIVATE, new Blob(["upload"]), "new");
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
      ownAcl: { url: `${source}.policy`, etag: null },
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
          ...confirmationOptions(selected),
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
  } else if (step === "inherited replacement rollback") {
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
    run = () => uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected);
  } else if (step === "verification and replay failure clearing") {
    let written = false;
    f.after(async (url, method, response) => {
      if (url === source && method === "PUT" && response.ok) written = true;
      return response;
    });
    f.intercept(async (url, init) =>
      written && url === `${source}.policy` && !init?.method
        ? new Response(null, { status: 503 })
        : undefined,
    );
    targetCheck = 2;
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
  } else if (step === "move")
    run = () => moveItems(client, [selected], renewed ? consentDestination : `${PRIVATE}target/`);
  else if (step === "rename")
    run = () =>
      renameItem(
        client,
        selected,
        safeName ? "renamed.acl.txt" : customName ? "renamed-policy.ttl" : "renamed",
      );
  else if (step === "Trash") run = () => trashItems(client, DRIVE, [selected], { webId: OWNER });
  else if (step === "overwrite")
    run = () => uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected);
  else if (step === "folder metadata")
    run = () =>
      client.write(
        source,
        "",
        { contentType: "text/turtle", ...confirmationOptions(selected) },
        { kind: "protect-ancestors" },
      );
  else run = () => client.remove(source, { recursive: folder, ...confirmationOptions(selected) });
  mutations.length = 0;
  boundaries.length = 0;
  identityCounts.clear();
  finalChecks = [];
  lastIdentity = undefined;
  return {
    f,
    run,
    target,
    targetCheck,
    identityTarget: identityTarget ?? target,
    mutations,
    boundaries,
    race: (check: typeof afterIdentity) => {
      afterIdentity = check;
    },
  };
}

it.each([
  "endpoint",
  "modes",
])("round 69: bootstrap registration retains its first index discovery (%s)", async (change) => {
  const s = await scenario("Type Index overwrite", []);
  const index = `${ROOT}index.ttl`;
  let captured = false;
  s.f.after(async (url, method, response) => {
    if (url === index && method === "GET" && !captured) {
      captured = true;
      if (change === "endpoint")
        response.headers.set("link", `<${ROOT}original-index.policy>; rel="acl"`);
      else response.headers.set("wac-allow", 'user="read write control",public=""');
    }
    if (url === DRIVE && method === "GET" && response.ok) {
      response.headers.append("link", `<${ROOT}drive-description>; rel="describedby"`);
      response.headers.set("accept-patch", "text/n3");
    }
    return response;
  });
  const result = await s.run().catch((error: unknown) => error);
  expect(captured).toBe(true);
  expect(result).toBeInstanceOf(Error);
  expect(s.f.calls).not.toContainEqual({ url: index, method: "PUT" });
});

it.each(
  steps,
)("round 74 shape a: %s retains a replacement at its final identity check", async (step) => {
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
  if (["Upload payload", "Keep both payload", "unconditional creation payload"].includes(step))
    expect(s.mutations.some(({ url, method }) => url === s.target && method === "PUT")).toBe(true);
  const current = s.target.endsWith(".policy")
    ? JSON.stringify(s.f.policies.get(s.target))
    : (await s.f.pod.fetch(s.target, { method: "HEAD" })).headers.get("etag");
  expect(current).toBe(replacementEtag);
});

it.each(
  steps,
)("round 74 shape b: %s performs no local async work after the final HTTP identity check", async (step) => {
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
  const timeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
    events.push("timer");
    return timeout(callback, delay, ...args);
  });
  await s.run().catch(() => undefined);
  const targetMutations = s.mutations.filter(({ url }) => url === s.target);
  if (["copy rollback without Link", "container rollback without Link"].includes(step))
    expect(targetMutations).toEqual([]);
  else expect(targetMutations.length).toBeGreaterThan(0);
  for (const mutation of s.mutations) expect(mutation.prior).toBe("identity HEAD");
});

it.each(
  steps.flatMap((step) => ["endpoint", "modes"].map((change) => ({ step, change }))),
)("round 74 final discovery: $step refuses changed captured $change on its conditional HEAD", async ({
  step,
  change,
}) => {
  const baseline = await scenario(step, [], change === "modes");
  const baselineOutcome = await baseline.run().catch((error: unknown) => error);
  const boundary = baseline.boundaries.findLast(
    (boundary) => boundary.target === baseline.target && boundary.check > 0,
  );
  if (!boundary) {
    // Missing creation discovery now refuses before any cleanup or clear can be authorized.
    expect(
      [
        "copy rollback without Link",
        "container rollback without Link",
        "Replace completion recovery clearing",
        "Move completion recovery clearing",
        "Copy completion recovery clearing",
      ],
      JSON.stringify(baselineOutcome, [
        "name",
        "message",
        "stack",
        "cause",
        "retainedDestinations",
      ]),
    ).toContain(step);
    expect(baselineOutcome).toBeInstanceOf(Error);
    expect(
      baseline.boundaries
        .filter((boundary) => boundary.target === baseline.target)
        .every((boundary) => boundary.check === 0),
    ).toBe(true);
    return;
  }
  // Exercise every policy, parent, source, survivor and target check in this
  // boundary, including checks that precede the very last target HEAD.
  expect(boundary.identities.length).toBeGreaterThan(0);
  for (const identity of boundary.identities) {
    const s = await scenario(step, [], change === "modes");
    let checks = 0;
    let changed = false;
    let mutationsBefore = 0;
    s.race(async (url, response) => {
      if (url !== identity.url || ++checks !== identity.check || !response.ok) return;
      changed = true;
      mutationsBefore = s.mutations.filter(
        (mutation) =>
          mutation.url === s.target &&
          mutation.method === boundary.method &&
          mutation.empty === boundary.empty,
      ).length;
      if (change === "modes") response.headers.set("wac-allow", 'user="read",public=""');
      else {
        const endpoint = `${url}foreign-final.policy`;
        s.f.endpoints.set(url, endpoint);
        s.f.policies.set(endpoint, await aclBody(url, true));
        response.headers.set("link", `<${endpoint}>; rel="acl"`);
      }
    });
    const outcome = await s.run().catch((error: unknown) => error);
    expect(changed, JSON.stringify({ step, identity })).toBe(true);
    expect(
      s.mutations.filter(
        (mutation) =>
          mutation.url === s.target &&
          mutation.method === boundary.method &&
          mutation.empty === boundary.empty,
      ),
      JSON.stringify({ step, identity, outcome, calls: s.f.calls.slice(-12) }),
    ).toHaveLength(mutationsBefore);
    expect(s.f.calls).not.toContainEqual({
      url: `${identity.url}foreign-final.policy`,
      method: "PUT",
    });
  }
});
