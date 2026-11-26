// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6.2-Astra
import { parseRdf } from "@jeswr/fetch-rdf";
import { addGrant } from "@jeswr/pod-access/roles";
// AUTHORED-BY Claude Opus 5.5
import { serialize } from "@jeswr/rdf-serialize";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { buildDocument } from "../src/apps/docs/lib/model/document";
import { docContainerUrls } from "../src/apps/docs/lib/model/layout";
import {
  applyDocumentSharing,
  checkDocumentSharing,
  DOCUMENT_GROUPS_DIFFER,
  DOCUMENT_PARTS_DIFFER,
  documentGroupTargets,
  loadDocumentSharing,
  MAX_DOCUMENT_PARTS,
  NOT_A_COMPANION,
  REPAIR_FIRST,
  TOO_MANY_PARTS,
} from "../src/apps/docs/lib/sharing/document-sharing";
import {
  loadSharing,
  SharingRefreshError,
  type SharingSession,
} from "../src/apps/drive/lib/sharing/adapter";
import type { SharingRole, SharingSelection } from "../src/apps/drive/lib/sharing/types";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import {
  ACP,
  ALICE,
  authorization,
  BOB,
  CAROL,
  document,
  FixtureAcrs,
  PUBLIC,
  policy,
} from "./sharing-fixtures";

const ROOT = "https://example.org/";
const DOC = `${ROOT}docs/plan.ttl`;
const layout = docContainerUrls(DOC);
const parts = [layout.container, layout.updateLog, layout.assets, layout.comments, layout.versions];
/** A Docs document whose own links name its companion folder, as Docs writes it. */
async function writeDocument(
  pod: { fetch: typeof globalThis.fetch },
  links: Partial<Record<"updateLog" | "assets" | "comments", string>> = layout,
) {
  const { updateLog, assets, comments } = links;
  const dataset = buildDocument(DOC, { title: "Plan", updateLog, assets, comments });
  await pod.fetch(DOC, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serialize([...dataset]),
  });
}
async function setup(model: "wac" | "acp" = "wac", ownChildren = false) {
  const pod = createDemoPod({ root: ROOT });
  const suffix = model === "wac" ? ".acl" : ".acr";
  async function access(url: string, people: [string, string[]][] = []) {
    const doc = document(model, false, url);
    for (const [who, modes] of [[ALICE, ["Read", "Write", "Control"]], ...people] as [
      string,
      string[],
    ][]) {
      if (model === "wac") {
        const auth = authorization(doc, who, modes);
        if (url.endsWith("/")) auth.default = url;
      } else policy(doc, who, modes);
    }
    if (model === "acp" && url.endsWith("/")) {
      for (const acr of new FixtureAcrs(doc.dataset, DataFactory).resources)
        for (const control of acr.accessControl) acr.memberAccessControl.add(control);
    }
    await pod.fetch(doc.source, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await serialize([...doc.dataset]),
    });
    return doc;
  }
  for (const url of parts) await pod.fetch(url, { method: "PUT", body: "" });
  await writeDocument(pod);
  await access(DOC);
  await access(layout.container);
  if (ownChildren) for (const url of parts.slice(1)) await access(url);
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const response = await pod.fetch(url, init);
    if (model === "wac" || String(url).endsWith(suffix)) return response;
    const headers = new Headers(response.headers);
    headers.set("link", `<${String(url)}.acr>; rel="${ACP}accessControl"`);
    return new Response(response.body, { status: response.status, headers });
  });
  const session: SharingSession = { fetch, storageUrl: ROOT, webId: ALICE };
  const load = () => loadDocumentSharing(session, DOC);
  const writes = () =>
    fetch.mock.calls.filter(([, init]) => init?.method === "PUT").map(([url]) => String(url));
  const roles = async (url: string) => {
    const state = (await loadSharing(session, url)).state;
    return [state.people.map(({ webId, role }) => [webId, role]), state.link];
  };
  return {
    pod,
    session,
    fetch,
    load,
    access,
    writes,
    roles,
    suffix,
    writeDocument: (links?: Parameters<typeof writeDocument>[1]) => writeDocument(pod, links),
  };
}
const select = (state: SharingSelection, role: SharingRole = "viewer"): SharingSelection => ({
  ...state,
  people: [...state.people, { webId: BOB, role }],
});

it.each([
  "wac",
  "acp",
] as const)("shares all inherited parts as Viewer/Editor and revokes people/public access with %s", async (model) => {
  const env = await setup(model);
  let snapshot = await env.load();
  expect(snapshot.needsSave).toBeUndefined();
  for (const role of ["viewer", "editor"] as const) {
    const selection = {
      ...select(
        { ...snapshot.state, people: snapshot.state.people.filter((p) => p.webId !== BOB) },
        role,
      ),
      link: role,
      public: "viewer",
    } as const;
    env.fetch.mockClear();
    snapshot = await applyDocumentSharing(env.session, snapshot, selection);
    expect(snapshot.notice).toBeUndefined();
    expect(env.writes()).toEqual([`${layout.container}${env.suffix}`, `${DOC}${env.suffix}`]);
    for (const url of [DOC, ...parts])
      expect(await env.roles(url)).toEqual([
        [
          [ALICE, "owner"],
          [BOB, role],
        ],
        role,
      ]);
    // Inheriting children keep inheriting; only the two root targets get policies.
    for (const url of parts.slice(1))
      expect((await env.pod.fetch(`${url}${env.suffix}`)).status).toBe(404);
  }
  env.fetch.mockClear();
  snapshot = await applyDocumentSharing(env.session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId !== BOB),
    link: "none",
    public: "none",
  });
  expect(env.writes()).toEqual([`${DOC}${env.suffix}`, `${layout.container}${env.suffix}`]);
  for (const url of [DOC, ...parts])
    expect(await env.roles(url)).toEqual([[[ALICE, "owner"]], "none"]);
  env.fetch.mockClear();
  await applyDocumentSharing(env.session, snapshot, snapshot.state);
  expect(env.writes()).toEqual([]);
});

it.each([
  "wac",
  "acp",
] as const)("repairs legacy own sub-container policies with %s", async (model) => {
  const env = await setup(model, true);
  await env.access(DOC, [
    [BOB, ["Read", "Write"]],
    [PUBLIC, ["Read"]],
  ]);
  const snapshot = await env.load();
  expect(snapshot).toMatchObject({
    notice: expect.stringContaining(DOCUMENT_PARTS_DIFFER),
    needsSave: true,
  });
  expect(snapshot.state.people.find((p) => p.webId === BOB)?.role).toBe("editor");
  env.fetch.mockClear();
  const result = await applyDocumentSharing(env.session, snapshot, snapshot.state);
  expect(result.notice).toBeUndefined();
  expect(env.writes()).toEqual(
    (model === "wac" ? [layout.container, ...parts.slice(1)] : [layout.container]).map(
      (url) => `${url}${env.suffix}`,
    ),
  );
  for (const url of parts)
    expect(await env.roles(url)).toEqual([
      [
        [ALICE, "owner"],
        [BOB, "editor"],
      ],
      "viewer",
    ]);
  const raised = await applyDocumentSharing(env.session, result, {
    ...result.state,
    link: "editor",
  });
  const lowered = await applyDocumentSharing(env.session, raised, {
    ...raised.state,
    people: raised.state.people.map((p) => (p.webId === BOB ? { ...p, role: "viewer" } : p)),
    link: "viewer",
  });
  const removed = await applyDocumentSharing(env.session, lowered, {
    ...lowered.state,
    people: lowered.state.people.filter((p) => p.webId !== BOB),
    link: "none",
    public: "none",
  });
  expect(removed.needsSave).toBeUndefined();
  for (const url of [DOC, ...parts])
    expect(await env.roles(url)).toEqual([[[ALICE, "owner"]], "none"]);
});

it("handles mixed additions and revocations without granting the entry point early", async () => {
  const env = await setup();
  let snapshot = await env.load();
  snapshot = await applyDocumentSharing(env.session, snapshot, select(snapshot.state, "editor"));
  env.fetch.mockClear();
  await applyDocumentSharing(env.session, snapshot, {
    ...snapshot.state,
    people: [
      ...snapshot.state.people.filter((p) => p.webId !== BOB),
      { webId: CAROL, role: "viewer" },
    ],
  });
  expect(env.writes()).toEqual([`${DOC}.acl`, `${layout.container}.acl`, `${DOC}.acl`]);
});

it.each([
  "grant",
  "revoke",
] as const)("reports a second-target failure during %s and repairs after Retry reloads", async (direction) => {
  const env = await setup();
  let snapshot = await env.load();
  if (direction === "revoke")
    snapshot = await applyDocumentSharing(env.session, snapshot, select(snapshot.state));
  const selection =
    direction === "grant"
      ? select(snapshot.state)
      : { ...snapshot.state, people: snapshot.state.people.filter((p) => p.webId !== BOB) };
  const failed = direction === "grant" ? DOC : layout.container;
  const fetch: typeof globalThis.fetch = (url, init) =>
    init?.method === "PUT" && url === `${failed}.acl`
      ? Promise.resolve(new Response(null, { status: 503 }))
      : env.session.fetch(url, init);
  const error = await applyDocumentSharing({ ...env.session, fetch }, snapshot, selection).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SharingRefreshError);
  expect(error).toMatchObject({ message: expect.stringContaining(`Not confirmed: ${failed}`) });
  expect((error as Error).message).toContain(
    direction === "grant" ? "companion access matches" : "document access reduced",
  );
  expect((error as Error).message).toContain("Retry");
  // A grant whose document write failed reverts the companion it already widened.
  if (direction === "grant") {
    expect((error as Error).message).toContain(
      "Access added to the document's other parts was reverted.",
    );
    expect(await env.roles(layout.container)).toEqual([[[ALICE, "owner"]], "none"]);
  }
  const fresh = await env.load();
  expect(fresh.needsSave).toBe(direction === "grant" ? undefined : true);
  // Revoke already reduced the doc; grant needs the original selection again.
  const repaired = await applyDocumentSharing(env.session, fresh, selection);
  expect(repaired.needsSave).toBeUndefined();
});

it("stops on the first failed target, with no doc grant", async () => {
  const env = await setup();
  const snapshot = await env.load();
  const fetch: typeof globalThis.fetch = (url, init) =>
    init?.method === "PUT"
      ? Promise.resolve(new Response(null, { status: 503 }))
      : env.session.fetch(url, init);
  await expect(
    applyDocumentSharing({ ...env.session, fetch }, snapshot, select(snapshot.state)),
  ).rejects.toThrow("Confirmed: no targets");
  expect(await env.roles(DOC)).toEqual([[[ALICE, "owner"]], "none"]);
});

it("refuses partial folder scopes rather than hiding or weakening them", async () => {
  const env = await setup();
  const doc = await env.access(layout.assets);
  authorization(doc, BOB, ["Read"]); // Resource only: no matching member grant.
  await env.pod.fetch(doc.source, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serialize([...doc.dataset]),
  });
  await expect(env.load()).rejects.toMatchObject({ cause: { code: "partial-scope" } });
  expect(env.writes()).toEqual([]);
});

it("skips absent lazy containers but fails closed on unreadable parts", async () => {
  const env = await setup();
  await env.pod.fetch(layout.versions, { method: "DELETE" });
  expect((await env.load()).companions).toHaveLength(4);
  const fetch: typeof globalThis.fetch = (url, init) =>
    url === layout.assets && init?.method === "HEAD"
      ? Promise.resolve(new Response(null, { status: 403 }))
      : env.session.fetch(url, init);
  await expect(loadDocumentSharing({ ...env.session, fetch }, DOC)).rejects.toThrow(
    `Couldn't check document part ${layout.assets}`,
  );
});

it("requires ownership of the entry point and every companion and preflights immutable rows", async () => {
  const env = await setup();
  const snapshot = await env.load();
  await expect(
    applyDocumentSharing(env.session, { ...snapshot, canManage: false }, snapshot.state),
  ).rejects.toThrow("Only an owner");
  await expect(
    applyDocumentSharing(
      env.session,
      { ...snapshot, canManage: false, readOnly: "Read only" },
      snapshot.state,
    ),
  ).rejects.toThrow("Read only");
  await env.access(layout.comments, [[CAROL, ["Read", "Write", "Control"]]]);
  await expect(applyDocumentSharing(env.session, await env.load(), snapshot.state)).rejects.toThrow(
    "Owner rows are read-only",
  );
  expect(env.writes()).toEqual([]);
  const other = await loadDocumentSharing({ ...env.session, webId: BOB }, DOC);
  expect(other).toMatchObject({
    canManage: false,
    readOnly: "Only an owner of every document part can change sharing.",
  });
});

it("checks the final access of skipped inheriting children and the main resource", async () => {
  const env = await setup();
  const snapshot = await env.load();
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await env.session.fetch(url, init);
    if (init?.method === "PUT" && url === `${DOC}.acl`) await env.access(layout.assets); // Concurrent explicit override.
    return response;
  };
  await expect(
    applyDocumentSharing({ ...env.session, fetch }, snapshot, select(snapshot.state)),
  ).rejects.toThrow("Document sharing is incomplete");
});

it("reports a main-resource read-back mismatch rather than claiming success", async () => {
  const env = await setup();
  const snapshot = await env.load();
  let checks = 0;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    // Change the doc only when the whole-plan read starts, after its adapter verified it.
    if (url === DOC && init?.method === "HEAD" && ++checks === 3) await env.access(DOC);
    return env.session.fetch(url, init);
  };
  await expect(
    applyDocumentSharing({ ...env.session, fetch }, snapshot, select(snapshot.state)),
  ).rejects.toBeInstanceOf(SharingRefreshError);
});

it("uses folder accessTo+default modes for the companion", async () => {
  const env = await setup();
  const snapshot = await env.load();
  await applyDocumentSharing(env.session, snapshot, select(snapshot.state, "editor"));
  const url = `${layout.container}.acl`;
  const dataset = await parseRdf(await (await env.pod.fetch(url)).text(), "text/turtle", {
    baseIRI: url,
  });
  const bob = [...new AclResource(dataset, DataFactory).authorizations].find((a) =>
    a.agent.has(BOB),
  );
  expect(bob).toMatchObject({ accessTo: layout.container, default: layout.container });
  expect([...(bob as NonNullable<typeof bob>).mode].sort()).toEqual(
    ["Append", "Read", "Write"].map((mode) => `http://www.w3.org/ns/auth/acl#${mode}`),
  );
});

it("normalises the public-only presentation of anonymous Viewer", async () => {
  const env = await setup();
  const snapshot = await env.load();
  const result = await applyDocumentSharing(env.session, snapshot, {
    ...snapshot.state,
    link: "none",
    public: "viewer",
  });
  expect(result.state.link).toBe("viewer");
  expect(result.needsSave).toBeUndefined();
});

it("refuses an access document that changes while loading the companion tree", async () => {
  const env = await setup();
  let gets = 0;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (url === `${layout.container}.acl` && (init?.method ?? "GET") === "GET" && ++gets === 2)
      await env.access(layout.container, [[BOB, ["Read"]]]);
    return env.session.fetch(url, init);
  };
  await expect(loadDocumentSharing({ ...env.session, fetch }, DOC)).rejects.toThrow(
    "Sharing changed while it was being saved",
  );
});

it("does not refresh a child's snapshot over a concurrent own-policy edit", async () => {
  const env = await setup("acp", true);
  const snapshot = await env.load();
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await env.session.fetch(url, init);
    if (url === `${layout.container}.acr` && init?.method === "PUT")
      await env.access(layout.assets, [[CAROL, ["Read"]]]);
    return response;
  };
  await expect(
    applyDocumentSharing({ ...env.session, fetch }, snapshot, select(snapshot.state)),
  ).rejects.toThrow(`Not confirmed: ${layout.assets}`);
  expect((await env.roles(layout.assets))[0]).toContainEqual([CAROL, "viewer"]);
  expect((await env.roles(DOC))[0]).not.toContainEqual([BOB, "viewer"]);
});

it("stops a revoke on the entry point before touching companions", async () => {
  const env = await setup();
  let snapshot = await env.load();
  snapshot = await applyDocumentSharing(env.session, snapshot, select(snapshot.state));
  const fetch: typeof globalThis.fetch = (url, init) =>
    init?.method === "PUT"
      ? Promise.resolve(new Response(null, { status: 403 }))
      : env.session.fetch(url, init);
  await expect(
    applyDocumentSharing({ ...env.session, fetch }, snapshot, {
      ...snapshot.state,
      people: snapshot.state.people.filter((p) => p.webId !== BOB),
    }),
  ).rejects.toThrow(`Confirmed: no targets. Not confirmed: ${DOC}`);
  expect((await env.roles(layout.container))[0]).toContainEqual([BOB, "viewer"]);
});

it("keeps external ACP inheritance immutable on explicit children", async () => {
  const env = await setup("acp", true);
  await env.access(`${ROOT}docs/`, [[CAROL, ["Read"]]]);
  const snapshot = await env.load();
  await expect(
    applyDocumentSharing(env.session, snapshot, {
      ...snapshot.state,
      people: snapshot.state.people.filter((p) => p.webId !== CAROL),
    }),
  ).rejects.toThrow("Inherited access must be changed at its source");
  expect(env.writes()).toEqual([]);
});

it("preserves external people/public inheritance while editing child contributions", async () => {
  const env = await setup("acp", true);
  await env.access(`${ROOT}docs/`, [
    [CAROL, ["Read"]],
    [PUBLIC, ["Read"]],
  ]);
  const snapshot = await env.load();
  const result = await applyDocumentSharing(env.session, snapshot, select(snapshot.state));
  expect(result.state.people.find((p) => p.webId === CAROL)).toMatchObject({
    inherited: true,
    role: "viewer",
  });
  expect(result.state.general.inherited).toBe(true);
});

it.each([
  "main",
  "companion",
] as const)("checks final semantic access even when the %s validator is incorrectly reused", async (target) => {
  const env = await setup();
  const snapshot = await env.load();
  const url = target === "main" ? `${DOC}.acl` : `${layout.container}.acl`;
  const original = await (await env.pod.fetch(url)).text();
  let wroteDoc = false;
  let readsAfterWrite = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await env.session.fetch(input, init);
    if (input === `${DOC}.acl` && init?.method === "PUT") wroteDoc = true;
    if (
      input === url &&
      (init?.method ?? "GET") === "GET" &&
      wroteDoc &&
      ++readsAfterWrite >= (target === "main" ? 2 : 1)
    )
      return new Response(original, { headers: response.headers });
    return response;
  };
  const error = await applyDocumentSharing(
    { ...env.session, fetch },
    snapshot,
    select(snapshot.state),
  ).catch((reason: unknown) => reason);
  expect(error).toMatchObject({
    message: expect.stringContaining("Not confirmed: final verification"),
    cause: { message: "Current document parts do not all match the selected access." },
  });
});

it("materialises a companion policy that previously inherited from outside the tree", async () => {
  const env = await setup("wac", true);
  await env.access(`${ROOT}docs/`);
  await env.pod.fetch(`${layout.container}.acl`, { method: "DELETE" });
  const snapshot = await env.load();
  const fresh = await applyDocumentSharing(env.session, snapshot, select(snapshot.state));
  expect(fresh.needsSave).toBeUndefined();
});

it.each([
  ["no ETag", null],
  ["a weak ETag", 'W/"weak"'],
] as const)("completes a save when the server answers PUT with %s (CSS)", async (_name, etag) => {
  const env = await setup();
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await env.session.fetch(url, init);
    if (init?.method !== "PUT") return response;
    const headers = new Headers(response.headers);
    if (etag) headers.set("etag", etag);
    else headers.delete("etag");
    return new Response(response.body, { status: response.status, headers });
  };
  const session = { ...env.session, fetch };
  let snapshot = await loadDocumentSharing(session, DOC);
  snapshot = await applyDocumentSharing(session, snapshot, select(snapshot.state));
  expect(snapshot.notice).toBeUndefined();
  for (const url of [DOC, ...parts])
    expect(await env.roles(url)).toEqual([
      [
        [ALICE, "owner"],
        [BOB, "viewer"],
      ],
      "none",
    ]);
  // A second save, and a revocation, still pin each reload.
  snapshot = await applyDocumentSharing(session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId !== BOB),
  });
  for (const url of [DOC, ...parts])
    expect(await env.roles(url)).toEqual([[[ALICE, "owner"]], "none"]);
});

it("still refuses a concurrent change after an ETag-less PUT once the reload is pinned", async () => {
  const env = await setup();
  const acl = `${layout.container}.acl`;
  let written = false;
  let edited = false;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await env.session.fetch(url, init);
    const method = init?.method ?? "GET";
    if (String(url) === acl && method === "GET" && written && !edited) {
      // Someone else edits the companion policy right after our reload pinned it.
      edited = true;
      await env.access(layout.container, [[CAROL, ["Read"]]]);
    }
    if (method !== "PUT") return response;
    if (String(url) === acl) written = true;
    const headers = new Headers(response.headers);
    headers.delete("etag");
    return new Response(response.body, { status: response.status, headers });
  };
  const session = { ...env.session, fetch };
  const snapshot = await loadDocumentSharing(session, DOC);
  await expect(applyDocumentSharing(session, snapshot, select(snapshot.state))).rejects.toThrow(
    "Document sharing is incomplete",
  );
  expect(edited).toBe(true);
});

it("treats a member with its own policy as a document part", async () => {
  const env = await setup();
  const image = `${layout.assets}image.png`;
  await env.pod.fetch(image, {
    method: "PUT",
    body: "png",
    headers: { "content-type": "image/png" },
  });
  await env.access(image, [[BOB, ["Read", "Write"]]]);
  // A member that only inherits is not a separate part.
  await env.pod.fetch(`${layout.comments}inherits.ttl`, { method: "PUT", body: "" });
  const snapshot = await env.load();
  expect(snapshot).toMatchObject({
    notice: expect.stringContaining(DOCUMENT_PARTS_DIFFER),
    needsSave: true,
  });
  expect(snapshot.companions.map((part) => part.resource)).toEqual([...parts, image]);
  const result = await applyDocumentSharing(env.session, snapshot, snapshot.state);
  expect(result.notice).toBeUndefined();
  expect(await env.roles(image)).toEqual([[[ALICE, "owner"]], "none"]);
});

it("fails closed when a listed member cannot be checked", async () => {
  const env = await setup();
  const image = `${layout.assets}image.png`;
  await env.pod.fetch(image, {
    method: "PUT",
    body: "png",
    headers: { "content-type": "image/png" },
  });
  const failing = (match: (url: string, init?: RequestInit) => Response | undefined) =>
    loadDocumentSharing(
      {
        ...env.session,
        fetch: async (url, init) => match(String(url), init) ?? env.session.fetch(url, init),
      },
      DOC,
    );
  const message = `Couldn't check document part ${image}`;
  const head = (url: string, init?: RequestInit) => url === image && init?.method === "HEAD";
  await expect(
    failing((url, init) => (head(url, init) ? new Response(null, { status: 500 }) : undefined)),
  ).rejects.toThrow(message);
  await expect(
    failing((url, init) => (head(url, init) ? new Response(null) : undefined)),
  ).rejects.toThrow(message);
  await expect(
    failing((url, init) =>
      url === `${image}.acl` && init?.method === "HEAD"
        ? new Response(null, { status: 403 })
        : undefined,
    ),
  ).rejects.toThrow(message);
  const foreign = `${ROOT}docs/other.ttl`;
  await expect(
    failing((url, init) =>
      url === layout.assets && (init?.method ?? "GET") === "GET"
        ? new Response(`<> <http://www.w3.org/ns/ldp#contains> <${foreign}>.`, {
            headers: { "content-type": "text/turtle" },
          })
        : undefined,
    ),
  ).rejects.toThrow(`Couldn't check document part ${foreign}`);
});

it("refuses to check a companion tree with too many members", async () => {
  const env = await setup();
  for (let index = 0; index <= MAX_DOCUMENT_PARTS; index++)
    await env.pod.fetch(`${layout.assets}${index}.bin`, { method: "PUT", body: "" });
  await expect(env.load()).rejects.toThrow(TOO_MANY_PARTS);
});

// AUTHORED-BY Claude Opus 5.5
it("keeps sharing for a long-lived document whose update logs exceed the part cap", async () => {
  const env = await setup();
  const recovery = `${layout.container}updates-1700000000000/`;
  await env.pod.fetch(recovery, { method: "PUT", body: "" });
  for (let index = 0; index <= MAX_DOCUMENT_PARTS; index++)
    await env.pod.fetch(`${index % 2 ? layout.updateLog : recovery}${index}.bin`, {
      method: "PUT",
      body: "",
    });
  // Log entries are still checked one by one: a shared entry is still a part.
  const entry = `${layout.updateLog}7.bin`;
  await env.access(entry, [[BOB, ["Read"]]]);
  const snapshot = await env.load();
  expect(snapshot.companions.map((part) => part.resource)).toContain(entry);
  expect(snapshot.needsSave).toBe(true);
});

it("checks the companion tree's members concurrently, at most eight at a time", async () => {
  const env = await setup();
  for (let index = 0; index < 40; index++)
    await env.pod.fetch(`${layout.comments}${index}.ttl`, { method: "PUT", body: "" });
  let active = 0;
  let peak = 0;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (init?.method !== "HEAD") return env.session.fetch(url, init);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    try {
      return await env.session.fetch(url, init);
    } finally {
      active--;
    }
  };
  await loadDocumentSharing({ ...env.session, fetch }, DOC);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
});

it("decides the Share button from the entry point and companion root without walking the tree", async () => {
  const env = await setup();
  for (let index = 0; index < 20; index++)
    await env.pod.fetch(`${layout.updateLog}${index}.bin`, { method: "PUT", body: "" });
  env.fetch.mockClear();
  expect(await checkDocumentSharing(env.session, DOC)).toEqual({ canManage: true });
  const urls = env.fetch.mock.calls.map(([url]) => String(url));
  expect(urls.some((url) => url.startsWith(layout.updateLog))).toBe(false);
  expect(await checkDocumentSharing({ ...env.session, webId: BOB }, DOC)).toMatchObject({
    canManage: false,
  });
  await env.access(layout.container, [[CAROL, ["Read", "Write", "Control"]]]);
  const other = await checkDocumentSharing({ ...env.session, webId: CAROL }, DOC);
  expect(other).toEqual({ canManage: false });
});

const GROUP = "https://example.org/groups/team.ttl#group";
async function shareWithGroup(env: Awaited<ReturnType<typeof setup>>, url: string) {
  const result = await addGrant(
    [url],
    { agent: { type: "group", id: GROUP }, role: "viewer", inherited: false, source: "" },
    {
      fetch: env.session.fetch,
      root: ROOT,
      webId: ALICE,
      model: "wac",
      kind: url.endsWith("/") ? "folder" : "resource",
    },
  );
  expect(result.failed).toEqual([]);
}

it("reports group grants that differ between the document and its companion", async () => {
  const env = await setup();
  expect((await env.load()).notice).toBeUndefined();
  await shareWithGroup(env, layout.container);
  const snapshot = await env.load();
  expect(snapshot.notice).toContain(DOCUMENT_GROUPS_DIFFER);
  expect(snapshot.notice).toContain("Shared differently: the document folder");
  // Group differences are repaired from the Groups panel, not by the people Save.
  expect(snapshot.needsSave).toBeUndefined();
  await shareWithGroup(env, DOC);
  expect((await env.load()).notice).toBeUndefined();
  // People changes keep group rows on every part.
  const result = await applyDocumentSharing(env.session, await env.load(), select(snapshot.state));
  expect(result.notice).toBeUndefined();
});

it("includes every independently shared part as a group target, the entry point first", async () => {
  const env = await setup("wac", true);
  const snapshot = await env.load();
  expect(documentGroupTargets(snapshot)).toEqual([DOC, ...parts]);
  expect(documentGroupTargets({ ...snapshot, companions: undefined } as never)).toEqual([DOC]);
});

it.each([
  ["moved without its folder", { updateLog: `${ROOT}elsewhere/updates/` }],
  ["linking a part outside its folder", { ...layout, comments: `${ROOT}docs/comments/` }],
] as const)("refuses companion sharing for a document %s", async (_case, links) => {
  const env = await setup();
  await env.writeDocument(links);
  env.fetch.mockClear();
  await expect(env.load()).rejects.toThrow(NOT_A_COMPANION);
  expect(env.writes()).toEqual([]);
});

it("refuses companion sharing for a .ttl that is not a Docs document", async () => {
  const env = await setup();
  await env.pod.fetch(DOC, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: '<#it> <http://purl.org/dc/terms/title> "Not a document".',
  });
  await expect(env.load()).rejects.toThrow(NOT_A_COMPANION);
});

it("accepts a legacy Docs document that records no companion links", async () => {
  const env = await setup();
  await env.writeDocument({});
  expect((await env.load()).needsSave).toBeUndefined();
  // Versions are lazy and older recovery logs may still be present.
  await env.pod.fetch(layout.versions, { method: "DELETE" });
  await env.pod.fetch(`${layout.container}updates-1700000000000/`, { method: "PUT", body: "" });
  expect((await env.load()).needsSave).toBeUndefined();
});

it.each([
  "missing update log",
  "unrelated root member",
])("refuses a linkless Docs document with an unconfirmed sibling folder (%s)", async (reason) => {
  const env = await setup();
  await env.writeDocument({});
  if (reason === "missing update log") await env.pod.fetch(layout.updateLog, { method: "DELETE" });
  else await env.pod.fetch(`${layout.container}budget.ttl`, { method: "PUT", body: "" });
  await expect(env.load()).rejects.toThrow(NOT_A_COMPANION);
  expect(env.writes()).toEqual([]);
});

it.each([
  "assets/",
  "assets/image.png",
])("requires the repair Save before rewriting %s with its own access", async (path) => {
  const env = await setup();
  const part = `${layout.container}${path}`;
  if (!part.endsWith("/"))
    await env.pod.fetch(part, {
      method: "PUT",
      body: "png",
      headers: { "content-type": "image/png" },
    });
  await env.access(part, [[CAROL, ["Read"]]]);
  const snapshot = await env.load();
  expect(snapshot.notice).toContain(`Shared differently: ${path}.`);
  env.fetch.mockClear();
  await expect(applyDocumentSharing(env.session, snapshot, select(snapshot.state))).rejects.toThrow(
    REPAIR_FIRST,
  );
  expect(env.writes()).toEqual([]);
  expect((await env.roles(part))[0]).toContainEqual([CAROL, "viewer"]);
  // The explicit repair, then the change.
  const repaired = await applyDocumentSharing(env.session, snapshot, snapshot.state);
  expect((await env.roles(part))[0]).not.toContainEqual([CAROL, "viewer"]);
  const shared = await applyDocumentSharing(env.session, repaired, select(repaired.state));
  expect(shared.needsSave).toBeUndefined();
});

it("reverts a widened companion grant when the document write fails", async () => {
  const env = await setup("wac", true);
  const snapshot = await env.load();
  const fetch: typeof globalThis.fetch = (url, init) =>
    init?.method === "PUT" && url === `${DOC}.acl`
      ? Promise.resolve(new Response(null, { status: 412 }))
      : env.session.fetch(url, init);
  const error = await applyDocumentSharing(
    { ...env.session, fetch },
    snapshot,
    select(snapshot.state, "editor"),
  ).catch((e: unknown) => e);
  expect((error as Error).message).toContain("was reverted");
  for (const url of [DOC, ...parts])
    expect(await env.roles(url)).toEqual([[[ALICE, "owner"]], "none"]);
});

it("reports a companion grant it could not revert", async () => {
  const env = await setup();
  const snapshot = await env.load();
  let companionWrites = 0;
  const fetch: typeof globalThis.fetch = (url, init) => {
    if (init?.method === "PUT" && url === `${DOC}.acl`)
      return Promise.resolve(new Response(null, { status: 503 }));
    if (init?.method === "PUT" && url === `${layout.container}.acl` && ++companionWrites > 1)
      return Promise.resolve(new Response(null, { status: 503 }));
    return env.session.fetch(url, init);
  };
  const error = await applyDocumentSharing(
    { ...env.session, fetch },
    snapshot,
    select(snapshot.state),
  ).catch((e: unknown) => e);
  expect((error as Error).message).toContain(
    `Access added to ${layout.container} could not be reverted; review it in Drive.`,
  );
});
