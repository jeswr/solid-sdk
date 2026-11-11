// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
// AUTHORED-BY Claude Opus 5.5
// Drive sharing through the SDK role layer (@jeswr/pod-access/roles) against the demo pod.
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  type AgentRef,
  addGrant,
  type Role,
  type RoleGrant,
  readGrants,
  rolesToModes,
  setGrants,
} from "@jeswr/pod-access/roles";
import { serialize } from "@jeswr/rdf-serialize";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import {
  applySharing,
  loadError,
  loadSharing,
  SharingConflictError,
  SharingIncompleteError,
  SharingRefreshError,
  type SharingSession,
  saveError,
  toSharingState,
} from "../src/apps/drive/lib/sharing/adapter";
import { SharingError } from "../src/apps/drive/lib/sharing/rdf";
import {
  CAPTURE_LIMIT,
  CHANGED_WHILE_SAVING,
  recordAccess,
  UNMAPPED,
  UNSUPPORTED_SYSTEM,
  verifyAccess,
} from "../src/apps/drive/lib/sharing/verify";
import { accessSummary } from "../src/apps/drive/state/access";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import {
  ACL,
  ACP,
  ALICE,
  authorization,
  BOB,
  CAROL,
  document,
  FILE,
  PUBLIC,
  policy,
  properties,
} from "./sharing-fixtures";

const ROOT = "https://example.org/";
const FOLDER = "https://example.org/drive/";

async function setup(model: "wac" | "acp" = "wac", inherited = false) {
  const pod = createDemoPod({ root: ROOT });
  await pod.fetch(FILE, { method: "PUT", body: "report" });
  const doc = document(model, inherited);
  // CSS ACP managers hold resource Control (SDK dialect default), as WAC owners do.
  if (model === "wac") authorization(doc, ALICE, ["Read", "Write", "Control"]);
  else policy(doc, ALICE, ["Read", "Write", "Control"]);
  await pod.fetch(doc.source, {
    method: "PUT",
    body: await serialize([...doc.dataset]),
    headers: { "content-type": "text/turtle" },
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    // The demo's WAC links are replaced by ACP advertisements for these protocol fixtures.
    const response = await pod.fetch(url, init);
    if (model === "wac" || new URL(String(url)).pathname.endsWith(".acr")) return response;
    const headers = new Headers(response.headers);
    headers.set("link", `<${String(url)}.acr>; rel="${ACP}accessControl"`);
    return new Response(response.body, { status: response.status, headers });
  });
  const session: SharingSession = { fetch, webId: ALICE, storageUrl: ROOT };
  const load = () => loadSharing(session, FILE);
  const puts = () => fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
  return { pod, session, doc, load, fetch, puts };
}
type Env = Awaited<ReturnType<typeof setup>>;
async function writeDoc(env: Env, doc = env.doc) {
  await env.pod.fetch(doc.source, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serialize([...doc.dataset]),
  });
}
async function stored(env: Env, url: string) {
  return parseRdf(await (await env.pod.fetch(url)).text(), "text/turtle", { baseIRI: url });
}
const viewLink = { link: "viewer", public: "viewer" } as const;

it("copies inherited defaults and Control into a new own ACL, preserving every effective person", async () => {
  const env = await setup("wac", true);
  authorization(env.doc, BOB, ["Read"]);
  authorization(env.doc, CAROL, ["Read", "Write"], ROOT); // Unrelated defaults never activate.
  await writeDoc(env);
  const inheritedBody = await (await env.pod.fetch(env.doc.source)).text();
  const snapshot = await env.load();
  expect(snapshot.canManage).toBe(true);
  expect(snapshot.state.people).toEqual([
    { webId: ALICE, role: "owner", inherited: true, explicit: false, sources: [env.doc.source] },
    { webId: BOB, role: "viewer", inherited: true, explicit: false, sources: [env.doc.source] },
  ]);
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: CAROL, role: "editor" }],
  });
  expect(result.state.people.map((p) => [p.webId, p.role, p.inherited, p.sources])).toEqual([
    [ALICE, "owner", false, [`${FILE}.acl`]],
    [BOB, "viewer", false, [`${FILE}.acl`]],
    [CAROL, "editor", false, [`${FILE}.acl`]],
  ]);
  expect(result.canManage).toBe(true);
  // Ancestors are never written; the own ACL is created conditionally.
  expect(await (await env.pod.fetch(env.doc.source)).text()).toBe(inheritedBody);
  expect(env.puts()).toHaveLength(1);
  expect(new Headers(env.puts()[0]?.[1]?.headers).get("if-none-match")).toBe("*");
  const acl = new AclResource(await stored(env, `${FILE}.acl`), DataFactory);
  expect([...acl.authorizations].every((a) => a.default === undefined)).toBe(true);
});

it("splits shared WAC nodes while retaining other principals, targets and metadata", async () => {
  const env = await setup();
  const rule = authorization(env.doc, BOB, ["Read", "Write", "Append"]);
  rule.agent.add(CAROL);
  properties(rule).values(`${ACL}accessTo`).add(`${FOLDER}other`);
  properties(rule).values("https://example.org/metadata").add("https://example.org/label");
  await writeDoc(env);
  let snapshot = await env.load();
  const etag = (await env.pod.fetch(env.doc.source)).headers.get("etag");
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.map((p) => (p.webId === BOB ? { ...p, role: "viewer" } : p)),
  });
  expect(snapshot.state.people.map((p) => [p.webId, p.role])).toEqual([
    [ALICE, "owner"],
    [BOB, "viewer"],
    [CAROL, "editor"],
  ]);
  expect(new Headers(env.puts()[0]?.[1]?.headers).get("if-match")).toBe(etag);
  const dataset = await stored(env, env.doc.source);
  expect([...dataset].some((q) => q.predicate.value === "https://example.org/metadata")).toBe(true);
  expect(
    [...new AclResource(dataset, DataFactory).authorizations].some(
      (a) => a.agent.has(BOB) && properties(a).values(`${ACL}accessTo`).has(`${FOLDER}other`),
    ),
  ).toBe(true);
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId !== BOB),
  });
  expect(snapshot.state.people.some((p) => p.webId === BOB)).toBe(false);
});

it.each([
  "wac",
  "acp",
] as const)("adds/removes people and anonymous viewer/editor grants with %s", async (model) => {
  const env = await setup(model);
  let snapshot = await env.load();
  expect(snapshot.canManage).toBe(true);
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: BOB, role: "editor" }],
    link: "editor",
    public: "viewer",
  });
  expect(snapshot.state).toMatchObject({ link: "editor", public: "viewer" });
  expect(snapshot.state.general).toEqual({
    inherited: false,
    explicit: true,
    sources: [env.doc.source],
  });
  expect(snapshot.state.people.find((p) => p.webId === BOB)?.role).toBe("editor");
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId !== BOB),
    ...viewLink,
  });
  expect(snapshot.state.link).toBe("viewer");
  expect(snapshot.state.people.map((p) => p.webId)).toEqual([ALICE]);
  // Public Viewer without link access is the same anonymous Read grant.
  snapshot = await applySharing(env.session, snapshot, { ...snapshot.state, link: "none" });
  expect(snapshot.state).toMatchObject({ link: "viewer", public: "viewer" });
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    link: "none",
    public: "none",
  });
  expect(snapshot.state).toMatchObject({ link: "none", public: "none" });
  expect(snapshot.state.general).toEqual({ inherited: false, explicit: false, sources: [] });
});

it("adds an owner as an SDK manager", async () => {
  const env = await setup();
  const snapshot = await env.load();
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: BOB, role: "owner" }],
  });
  expect(result.state.people.find((p) => p.webId === BOB)?.role).toBe("owner");
});

it("retains ACP ancestors and composes inherited and own management for the owner", async () => {
  const env = await setup("acp");
  const inherited = document("acp", true);
  policy(inherited, CAROL, ["Read"]);
  policy(inherited, ALICE, ["Read", "Write", "Control"]);
  await writeDoc(env, inherited);
  const ancestorBody = await (await env.pod.fetch(inherited.source)).text();
  const snapshot = await env.load();
  expect(snapshot.state.people).toEqual([
    {
      webId: ALICE,
      role: "owner",
      inherited: true,
      explicit: true,
      sources: [inherited.source, env.doc.source].sort(),
    },
    { webId: CAROL, role: "viewer", inherited: true, explicit: false, sources: [inherited.source] },
  ]);
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: BOB, role: "viewer" }],
  });
  expect(result.state.people.map((p) => [p.webId, p.role])).toEqual([
    [ALICE, "owner"],
    [BOB, "viewer"],
    [CAROL, "viewer"],
  ]);
  expect(await (await env.pod.fetch(inherited.source)).text()).toBe(ancestorBody);
});

it("creates a missing own ACR when inherited ACP management permits it", async () => {
  const env = await setup("acp", true);
  policy(env.doc, BOB, ["Read"]);
  await writeDoc(env);
  const snapshot = await env.load();
  expect(snapshot.state.people).toEqual([
    { webId: ALICE, role: "owner", inherited: true, explicit: false, sources: [env.doc.source] },
    { webId: BOB, role: "viewer", inherited: true, explicit: false, sources: [env.doc.source] },
  ]);
  expect(snapshot.canManage).toBe(true);
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: CAROL, role: "editor" }],
  });
  expect(result.state.people.find((p) => p.webId === CAROL)?.role).toBe("editor");
  expect(new Headers(env.puts()[0]?.[1]?.headers).get("if-none-match")).toBe("*");
  await expect(
    applySharing(env.session, result, {
      ...result.state,
      people: result.state.people.filter((p) => p.webId !== BOB),
    }),
  ).rejects.toThrow("Inherited access must be changed at its source");
});

it("refuses read-only, unsafe, duplicate, inherited and other-owner edits without any request", async () => {
  const env = await setup("wac", true);
  authorization(env.doc, BOB, ["Read"]);
  authorization(env.doc, CAROL, ["Read", "Write", "Control"]);
  authorization(env.doc, PUBLIC, ["Read"]);
  await writeDoc(env);
  const snapshot = await env.load();
  env.fetch.mockClear();
  const cases: [Parameters<typeof applySharing>[2], string][] = [
    [
      {
        ...snapshot.state,
        people: [...snapshot.state.people, { webId: "javascript:alert(1)", role: "viewer" }],
      },
      "Enter a valid WebID",
    ],
    [
      { ...snapshot.state, people: [...snapshot.state.people, { webId: BOB, role: "editor" }] },
      "Duplicate person identifier",
    ],
    [
      { ...snapshot.state, people: snapshot.state.people.filter((p) => p.webId !== CAROL) },
      "Owner rows are read-only",
    ],
    [
      { ...snapshot.state, people: snapshot.state.people.filter((p) => p.webId !== BOB) },
      "Inherited access must be changed at its source",
    ],
    [{ ...snapshot.state, link: "none", public: "none" }, "Inherited access"],
  ];
  for (const [selection, message] of cases)
    await expect(applySharing(env.session, snapshot, selection)).rejects.toThrow(message);
  await expect(
    applySharing({ ...env.session, webId: BOB }, { ...snapshot, canManage: false }, snapshot.state),
  ).rejects.toThrow("Only an owner");
  expect(env.fetch).not.toHaveBeenCalled();
});

it.each([
  "remove",
  "downgrade",
] as const)("leaves self-%s to the SDK owner-lockout guard and never writes", async (change) => {
  const env = await setup();
  const snapshot = await env.load();
  const people =
    change === "remove"
      ? []
      : snapshot.state.people.map((p) => ({ webId: p.webId, role: "editor" as const }));
  const error = await applySharing(env.session, snapshot, { ...snapshot.state, people }).catch(
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SharingError);
  expect((error as Error).message).toBe("You cannot remove your own owner access or Control");
  expect((error as Error).cause).toMatchObject({ code: "owner-lockout" });
  expect(env.puts()).toHaveLength(0);
});

it("does not write unchanged selections, including inherited public access", async () => {
  const env = await setup("wac", true);
  authorization(env.doc, PUBLIC, ["Read"]);
  await writeDoc(env);
  const snapshot = await env.load();
  expect(snapshot.state.general).toEqual({
    inherited: true,
    explicit: false,
    sources: [env.doc.source],
  });
  env.fetch.mockClear();
  expect(await applySharing(env.session, snapshot, snapshot.state)).toBe(snapshot);
  expect(env.fetch).not.toHaveBeenCalled();
});

it("shows a reloaded conflict when the policy changed since the dialog opened, without writing", async () => {
  const env = await setup();
  const snapshot = await env.load();
  authorization(env.doc, CAROL, ["Read"]);
  await writeDoc(env);
  const error = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: BOB, role: "viewer" }],
  }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(SharingConflictError);
  expect((error as SharingConflictError).message).toBe(
    "Sharing changed since you opened it. The current access is shown; review it and try again.",
  );
  expect((error as SharingConflictError).snapshot?.state.people.map((p) => p.webId)).toEqual([
    ALICE,
    CAROL,
  ]);
  expect(env.puts()).toHaveLength(0);
  // Bob was not silently added on top of Carol's change.
  expect((await env.load()).state.people.some((p) => p.webId === BOB)).toBe(false);
});

it("treats a nearer ACL created after load as a conflict instead of copying stale defaults", async () => {
  const env = await setup("wac", true);
  const snapshot = await env.load();
  const own = document("wac");
  authorization(own, ALICE, ["Read", "Write", "Control"]);
  await writeDoc(env, own);
  await expect(
    applySharing(env.session, snapshot, { ...snapshot.state, ...viewLink }),
  ).rejects.toBeInstanceOf(SharingConflictError);
  expect(env.puts()).toHaveLength(0);
});

it("maps a 412 to a conflict and never retries the PUT", async () => {
  const env = await setup();
  const snapshot = await env.load();
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) =>
    init?.method === "PUT" ? new Response(null, { status: 412 }) : env.session.fetch(url, init),
  );
  await expect(
    applySharing({ ...env.session, fetch }, snapshot, { ...snapshot.state, ...viewLink }),
  ).rejects.toMatchObject({
    snapshot: expect.objectContaining({ state: snapshot.state }),
  });
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
});

it("asks for a reload when a conflict's fresh state cannot be read", async () => {
  const env = await setup();
  const snapshot = await env.load();
  let put = false;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (init?.method === "PUT") put = true;
    if (put) return new Response(null, { status: init?.method === "PUT" ? 412 : 503 });
    return env.session.fetch(url, init);
  };
  const error = await applySharing({ ...env.session, fetch }, snapshot, {
    ...snapshot.state,
    ...viewLink,
  }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(SharingConflictError);
  expect((error as SharingConflictError).snapshot).toBeUndefined();
  expect((error as Error).message).toBe(
    "Sharing changed since you opened it. Reload to see the current access before making changes.",
  );
});

it.each([null, 'W/"weak"'])("refuses to write without a usable ETag (%s)", async (etag) => {
  const env = await setup();
  const strip: typeof globalThis.fetch = async (url, init) => {
    const response = await env.session.fetch(url, init);
    if (url !== env.doc.source) return response;
    const headers = new Headers(response.headers);
    if (etag) headers.set("etag", etag);
    else headers.delete("etag");
    return new Response(response.body, { status: response.status, headers });
  };
  const session = { ...env.session, fetch: strip };
  const snapshot = await loadSharing(session, FILE);
  const attempt = applySharing(session, snapshot, { ...snapshot.state, ...viewLink });
  // The SDK refuses a missing validator; a weak one can never match If-Match and 412s.
  if (etag) await expect(attempt).rejects.toBeInstanceOf(SharingConflictError);
  else await expect(attempt).rejects.toThrow("didn't provide a version (ETag)");
  expect((await env.load()).state.link).toBe("none");
});

it.each([
  "HEAD",
  "PUT",
])("uses sharing-specific instructions after an HTTP %s failure", async (method) => {
  const env = await setup();
  authorization(env.doc, PUBLIC, ["Read"]);
  await writeDoc(env);
  const snapshot = await env.load();
  const fetch: typeof globalThis.fetch = (url, init) =>
    init?.method === method
      ? Promise.resolve(new Response(null, { status: 500 }))
      : env.session.fetch(url, init);
  await expect(
    applySharing({ ...env.session, fetch }, snapshot, {
      ...snapshot.state,
      link: "none",
      public: "none",
    }),
  ).rejects.toThrow("Couldn't save sharing. Permissions were not saved. Try again.");
  expect((await env.load()).state.link).toBe("viewer");
});

it("reports a transport failure before any PUT as not saved", async () => {
  const env = await setup();
  const snapshot = await env.load();
  const cause = new TypeError("Failed to fetch");
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (init?.method === "HEAD") throw cause;
    return env.session.fetch(url, init);
  };
  await expect(
    applySharing({ ...env.session, fetch }, snapshot, { ...snapshot.state, ...viewLink }),
  ).rejects.toMatchObject({
    message: "Couldn't save sharing. Permissions were not saved. Try again.",
    cause,
  });
});

it.each(["HEAD", "GET"])("reports a committed change when the refresh %s fails", async (method) => {
  const env = await setup();
  const snapshot = await env.load();
  let committed = false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (committed && (init?.method ?? "GET") === method) return new Response(null, { status: 503 });
    const response = await env.session.fetch(url, init);
    if (init?.method === "PUT" && response.ok) committed = true;
    return response;
  });
  await expect(
    applySharing({ ...env.session, fetch }, snapshot, { ...snapshot.state, ...viewLink }),
  ).rejects.toMatchObject({
    committed: true,
    message:
      "Your sharing change was sent, but current access couldn't be reloaded to confirm it. Retry to verify access.",
    cause: expect.any(SharingError),
  });
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  expect((await env.load()).state.link).toBe("viewer");
  expect(snapshot.state.link).toBe("none");
});

it.each(
  (["wac", "acp"] as const).flatMap((model) =>
    [false, true].map((committed) => ({ model, committed })),
  ),
)("invalidates an unknown $model PUT outcome (committed: $committed) without retrying", async ({
  model,
  committed,
}) => {
  const env = await setup(model);
  const snapshot = await env.load();
  const cause = new TypeError("Failed to fetch");
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (init?.method === "PUT") {
      if (committed) await env.session.fetch(url, init);
      throw cause;
    }
    return env.session.fetch(url, init);
  });
  const error = await applySharing({ ...env.session, fetch }, snapshot, {
    ...snapshot.state,
    ...viewLink,
  }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(SharingRefreshError);
  expect(error).toMatchObject({
    committed: false,
    message:
      "The sharing write outcome is unknown. Retry to verify current access before making more changes.",
    cause,
  });
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  expect((await env.load()).state.link).toBe(committed ? "viewer" : "none");
});

it("fails closed with readable messages on unavailable, unsupported and off-pod discovery", async () => {
  const env = await setup();
  for (const status of [403, 500])
    await expect(
      loadSharing({ ...env.session, fetch: async () => new Response(null, { status }) }, FILE),
    ).rejects.toThrow("Couldn't load sharing. Try again.");
  await expect(
    loadSharing({ ...env.session, fetch: async () => new Response(null) }, FILE),
  ).rejects.toThrow("access rules that this dialog can't show");
  await expect(
    loadSharing(
      {
        ...env.session,
        fetch: async () => {
          throw new TypeError("Failed to fetch");
        },
      },
      FILE,
    ),
  ).rejects.toMatchObject({
    message: "Couldn't load sharing. Try again.",
    cause: expect.any(TypeError),
  });
  await expect(loadSharing(env.session, "https://foreign.example/file")).rejects.toThrow(
    "outside your pod",
  );
  const mixed: typeof globalThis.fetch = async (url, init) => {
    const response = await env.session.fetch(url, init);
    if (url !== FILE) return response;
    const headers = new Headers(response.headers);
    headers.append("link", `<${FILE}.acr>; rel="${ACP}accessControl"`);
    return new Response(response.body, { status: response.status, headers });
  };
  await expect(loadSharing({ ...env.session, fetch: mixed }, FILE)).rejects.toBeInstanceOf(
    SharingError,
  );
});

it("fails closed on ESS-shaped ACRs, which the SDK cannot read even when told it is ESS", async () => {
  // ESS links a query-string ACR (`?ext=acr`) and grants acp:* modes.
  async function ess(acr: string) {
    const pod = createDemoPod({ root: ROOT });
    await pod.fetch(FILE, { method: "PUT", body: "report" });
    const doc = { ...document("acp"), source: acr };
    const owner = policy(doc, ALICE, []);
    for (const mode of ["Read", "Write"]) owner.allow.add(`${ACP}${mode}`);
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (String(url) === acr)
        return new Response(await serialize([...doc.dataset]), {
          headers: { "content-type": "text/turtle", etag: '"ess-1"' },
        });
      const response = await pod.fetch(url, init);
      const headers = new Headers(response.headers);
      headers.set("link", `<${acr}>; rel="${ACP}accessControl"`);
      return new Response(response.body, { status: response.status, headers });
    });
    return { fetch, session: { fetch, webId: ALICE, storageUrl: ROOT } };
  }
  // The real ESS shape: the SDK refuses non-canonical (query) access URLs for any implementation.
  const real = await ess(`${FILE}?ext=acr`);
  await expect(loadSharing(real.session, FILE)).rejects.toMatchObject({
    message: "This pod's access system isn't supported for sharing yet.",
    cause: { code: "scope" },
  });
  await expect(
    readGrants(FILE, { fetch: real.fetch, root: ROOT, kind: "resource", implementation: "ess" }),
  ).rejects.toMatchObject({ code: "scope" });
  // ESS modes behind a canonical ACR URL: the SDK's default CSS dialect rejects acp:* modes
  // (an unclassified TypeError); the recorded ACR shows it is ESS, not a transient failure.
  const modes = await ess(`${FILE}.acr`);
  await expect(loadSharing(modes.session, FILE)).rejects.toMatchObject({
    message: "This pod's access system isn't supported for sharing yet.",
    cause: { message: "Unknown access mode" },
  });
  for (const { fetch } of [real, modes])
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it("returns read-only access for a non-owner", async () => {
  const env = await setup();
  const snapshot = await loadSharing({ ...env.session, webId: BOB }, FILE);
  expect(snapshot.canManage).toBe(false);
  expect(snapshot.readOnly).toBeUndefined();
});

it.each([
  "wac",
  "acp",
] as const)("edits %s folders for people and general access without writing descendants", async (model) => {
  const env = await setup(model);
  const folder = `${FOLDER}nested/`;
  const child = `${folder}independent.txt`;
  await env.pod.fetch(folder, { method: "PUT" });
  await env.pod.fetch(child, { method: "PUT", body: "independent" });
  const doc = document(model, false, folder);
  const ownChild = document(model, false, child);
  if (model === "wac") {
    authorization(doc, ALICE, ["Read", "Write", "Control"]).default = folder;
    authorization(ownChild, ALICE, ["Read", "Write", "Control"]);
  } else {
    policy(doc, ALICE, ["Read", "Write", "Control"]);
    const members = document(model, true, folder);
    policy(members, ALICE, ["Read", "Write", "Control"], folder);
    for (const quad of members.dataset) doc.dataset.add(quad);
    policy(ownChild, ALICE, ["Read", "Write", "Control"]);
  }
  await writeDoc(env, doc);
  await writeDoc(env, ownChild);
  const childBytes = await (await env.pod.fetch(ownChild.source)).text();
  let snapshot = await loadSharing(env.session, folder);
  expect(snapshot.canManage).toBe(true);
  for (const role of ["editor", "viewer"] as const) {
    snapshot = await applySharing(env.session, snapshot, {
      ...snapshot.state,
      people: [...snapshot.state.people.filter((p) => p.webId !== BOB), { webId: BOB, role }],
      link: role,
      public: "viewer",
    });
    const reopened = await loadSharing(env.session, folder);
    expect(reopened.state.people.find((p) => p.webId === BOB)?.role).toBe(role);
    expect(reopened.state.link).toBe(role);
  }
  snapshot = await applySharing(env.session, snapshot, {
    people: snapshot.state.people.filter((p) => p.webId !== BOB),
    link: "none",
    public: "none",
  });
  expect(snapshot.state.people.map((p) => p.webId)).toEqual([ALICE]);
  expect(snapshot.state.link).toBe("none");
  expect(env.puts().every(([url]) => String(url) === doc.source)).toBe(true);
  expect(await (await env.pod.fetch(ownChild.source)).text()).toBe(childBytes);
  expect((await loadSharing({ ...env.session, webId: BOB }, folder)).canManage).toBe(false);
});

it("projects SDK grants and fails closed for principals the dialog cannot show", () => {
  const grant = (agent: AgentRef, role: Role = "viewer"): RoleGrant => ({
    agent,
    role,
    inherited: false,
    source: `${FILE}.acl`,
  });
  expect(
    toSharingState([
      grant({ type: "webid", id: CAROL }, "commenter"),
      grant({ type: "webid", id: BOB }, "editor"),
      grant({ type: "public" }, "editor"),
    ]),
  ).toMatchObject({
    people: [
      { webId: BOB, role: "editor" },
      { webId: CAROL, role: "commenter" },
    ],
    link: "editor",
    public: "viewer",
  });
  for (const agent of [
    { type: "authenticated" },
    { type: "group", id: `${ROOT}group#it` },
    { type: "app", id: `${ROOT}app#id` },
  ] as const)
    expect(() => toSharingState([grant(agent)])).toThrow("can't be shown");
  for (const role of ["commenter", "manager"] as const)
    expect(() => toSharingState([grant({ type: "public" }, role)])).toThrow(
      "Anonymous permissions exceed",
    );
});

it("maps every SDK role error to the dialog's error copy", async () => {
  const env = await setup();
  const snapshot = await readGrants(FILE, { fetch: env.session.fetch, root: ROOT });
  const options = { fetch: env.session.fetch, root: ROOT, webId: ALICE };
  const errors = {
    comments: (() => {
      try {
        rolesToModes("commenter", "document", {});
      } catch (error) {
        return error;
      }
    })(),
    unsupported: await addGrant(
      [FILE],
      {
        agent: { type: "webid", id: BOB },
        role: "viewer",
        inherited: false,
        source: "",
        purpose: "x",
      },
      options,
    ).catch((error: unknown) => error),
    inherited: (
      await setGrants(
        [FILE],
        [
          ...snapshot.grants,
          { agent: { type: "webid", id: BOB }, role: "viewer", inherited: true, source: ROOT },
        ],
        options,
      )
    ).failed[0]?.error,
    scope: await readGrants("https://foreign.example/x", {
      fetch: env.session.fetch,
      root: ROOT,
    }).catch((error: unknown) => error),
    invalid: await readGrants(FILE, {
      fetch: async () => new Response(null, { status: 500 }),
      root: ROOT,
    }).catch((error: unknown) => error),
  };
  expect(saveError(errors.comments, false).message).toBe(
    "Commenter is not available for this item yet. Permissions were not saved.",
  );
  expect(saveError(errors.unsupported, true).message).toBe(
    "These permissions use access rules that this dialog can't change. Permissions were not saved.",
  );
  expect(saveError(errors.inherited, false).message).toBe(
    "Inherited access must be changed at its source",
  );
  expect(saveError(errors.scope, false).message).toBe(
    "This item's access document is outside your pod. Permissions were not saved.",
  );
  // A classified SDK refusal is never mistaken for an unknown write outcome.
  expect(saveError(errors.invalid, true)).toBeInstanceOf(SharingError);
  expect(saveError(errors.invalid, true).message).toBe(
    "Couldn't save sharing. Permissions were not saved. Try again.",
  );
  expect(saveError(new Error("boom"), true)).toBeInstanceOf(SharingRefreshError);
  // A redirected PUT response is refused after the write may have landed: outcome unknown.
  expect(saveError(errors.scope, true)).toMatchObject({ committed: false, cause: errors.scope });
  expect(saveError(errors.scope, true)).toBeInstanceOf(SharingRefreshError);
  expect(saveError(new Error("boom"), false).message).toBe(
    "Couldn't save sharing. Permissions were not saved. Try again.",
  );
  expect(loadError(errors.unsupported).message).toBe(
    "This item's sharing uses access rules that this dialog can't show.",
  );
  expect(loadError(errors.invalid).message).toBe("Couldn't load sharing. Try again.");
  const own = new SharingError("own");
  expect(loadError(own)).toBe(own);
  expect(saveError(errors.scope, false).cause).toBe(errors.scope);
});

// Review round 1 (#282): access copied from a parent's default (materialized) must be removable,
// and a save is reported only when the reloaded access matches the selection.
async function materialized() {
  const env = await setup("wac", true);
  authorization(env.doc, CAROL, ["Read"]);
  authorization(env.doc, PUBLIC, ["Read"]);
  await writeDoc(env);
  let snapshot = await env.load();
  expect(snapshot.state.people.find((p) => p.webId === CAROL)?.inherited).toBe(true);
  // The first share copies Carol's and the public's inherited access into the file's own ACL.
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: BOB, role: "viewer" }],
  });
  expect(snapshot.state.people.map((p) => [p.webId, p.inherited])).toEqual([
    [ALICE, false],
    [BOB, false],
    [CAROL, false],
  ]);
  expect(snapshot.state).toMatchObject({ link: "viewer", general: { inherited: false } });
  env.fetch.mockClear();
  return { env, snapshot };
}
const agents = async (env: Env) =>
  [...new AclResource(await stored(env, `${FILE}.acl`), DataFactory).authorizations]
    .filter((a) => properties(a).values(`${ACL}accessTo`).has(FILE))
    .flatMap((a) => [...a.agent, ...a.agentClass]);

it("removes a person whose access was copied from the parent folder's default", async () => {
  const { env, snapshot } = await materialized();
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId !== CAROL),
  });
  expect(result.state.people.map((p) => p.webId)).toEqual([ALICE, BOB]);
  expect(await agents(env)).not.toContain(CAROL);
  expect((await env.load()).state.people.some((p) => p.webId === CAROL)).toBe(false);
});

it("restricts general access that was copied from the parent folder's default", async () => {
  const { env, snapshot } = await materialized();
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    link: "none",
    public: "none",
  });
  expect(result.state).toMatchObject({ link: "none", public: "none" });
  expect(await agents(env)).not.toContain(PUBLIC);
  // Raising copied access works through the explicit grant, and Carol keeps her copy.
  const raised = await applySharing(env.session, result, { ...result.state, link: "editor" });
  expect(raised.state.link).toBe("editor");
  expect(raised.state.people.map((p) => p.webId)).toEqual([ALICE, BOB, CAROL]);
});

it("reports access that did not change instead of saving when a removal fails", async () => {
  const { env, snapshot } = await materialized();
  const fetch: typeof globalThis.fetch = async (url, init) =>
    init?.method === "PUT" ? new Response(null, { status: 500 }) : env.session.fetch(url, init);
  const error = await applySharing({ ...env.session, fetch }, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId !== CAROL),
    link: "none",
    public: "none",
  }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(SharingIncompleteError);
  expect(error).toMatchObject({
    message: `Sharing wasn't saved as chosen for ${CAROL}, general access. The current access is shown; review it and try again.`,
    unchanged: [CAROL, "general access"],
  });
  expect((error as Error).cause).toMatchObject({ code: "invalid-response" });
  const fresh = (error as SharingIncompleteError).snapshot;
  expect(fresh.state.people.map((p) => p.webId)).toEqual([ALICE, BOB, CAROL]);
  expect(fresh.state.link).toBe("viewer");
});

it("stops a removal when access changed after the conditional setGrants", async () => {
  const { env, snapshot } = await materialized();
  let gets = 0;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (url === `${FILE}.acl` && (init?.method ?? "GET") === "GET" && ++gets === 2) {
      // Between the conditional setGrants and removeGrant, Alice's Control disappears.
      const own = document("wac");
      authorization(own, ALICE, ["Read", "Write"]);
      authorization(own, CAROL, ["Read"]);
      await writeDoc(env, own);
    }
    return env.session.fetch(url, init);
  };
  const error = await applySharing({ ...env.session, fetch }, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId !== CAROL),
  }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(SharingIncompleteError);
  expect(error).toMatchObject({ unchanged: [ALICE, BOB, CAROL, "general access"] });
  // The bound re-read sees the change before removeGrant plans anything.
  expect((error as Error).cause).toMatchObject({ message: CHANGED_WHILE_SAVING });
  expect(env.puts()).toHaveLength(0);
});

// Codex gate (#282): a follow-up removal is bound to the state it verified, so a change made
// between that read and the removal is never overwritten and never reported as saved.
it("refuses a removal when access changes between its verified read and the write", async () => {
  const { env, snapshot } = await materialized();
  let gets = 0;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    // GETs: setGrants' load, the bound re-read, then removeGrant's own load.
    if (url === `${FILE}.acl` && (init?.method ?? "GET") === "GET" && ++gets === 3) {
      const own = document("wac");
      authorization(own, ALICE, ["Read", "Write", "Control"]);
      authorization(own, BOB, ["Read"]);
      authorization(own, CAROL, ["Read", "Write"]); // Someone else promotes Carol.
      authorization(own, PUBLIC, ["Read"]);
      await writeDoc(env, own);
    }
    return env.session.fetch(url, init);
  };
  const error = await applySharing({ ...env.session, fetch }, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId !== CAROL),
  }).catch((reason: unknown) => reason);
  expect(gets).toBeGreaterThanOrEqual(3);
  expect(error).toBeInstanceOf(SharingIncompleteError);
  expect(error).toMatchObject({ unchanged: [CAROL] });
  expect((error as Error).cause).toMatchObject({ message: CHANGED_WHILE_SAVING });
  expect(env.puts()).toHaveLength(0);
  const fresh = await env.load();
  expect(fresh.state.people.find((p) => p.webId === CAROL)?.role).toBe("editor");
});

it("removes several people, each bound to the state left by the previous removal", async () => {
  const { env, snapshot } = await materialized();
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId === ALICE),
    link: "none",
    public: "none",
  });
  expect(result.state.people.map((p) => p.webId)).toEqual([ALICE]);
  expect(result.state.link).toBe("none");
  expect(await agents(env)).toEqual([ALICE]);
});

// Codex gate (#282): the recorder's copy must not stall the SDK's bounded reader when it
// refuses an oversized access document.
it("fails a load on an oversized access document instead of hanging", async () => {
  const env = await setup();
  const chunk = new TextEncoder().encode(`# ${"x".repeat(65_533)}\n`);
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await env.session.fetch(url, init);
    if (url !== `${FILE}.acl` || (init?.method ?? "GET") !== "GET") return response;
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.enqueue(chunk),
    });
    return new Response(body, { status: 200, headers: response.headers });
  };
  await expect(loadSharing({ ...env.session, fetch }, FILE)).rejects.toBeInstanceOf(SharingError);
});

it("abandons a recorded copy whose body fails", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => controller.error(new Error("reset")),
  });
  const recorder = recordAccess(async () => new Response(body, { status: 200 }));
  await (await recorder.fetch(`${FILE}.acl`)).text().catch(() => undefined);
  await expect(recorder.documents(FILE)).rejects.toThrow(UNMAPPED);
});

it("abandons a recorded copy over the capture limit", async () => {
  const big = new Uint8Array(CAPTURE_LIMIT + 1);
  const recorder = recordAccess(
    async () => new Response(big, { status: 200, headers: { "content-type": "text/turtle" } }),
  );
  await (await recorder.fetch(`${FILE}.acl`)).arrayBuffer();
  await expect(recorder.documents(FILE)).rejects.toThrow(UNMAPPED);
});

it("never reports a save when someone else changes access before the reload", async () => {
  const env = await setup();
  const snapshot = await env.load();
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await env.session.fetch(url, init);
    if (init?.method === "PUT") {
      authorization(env.doc, BOB, ["Read"]);
      authorization(env.doc, CAROL, ["Read"]);
      await writeDoc(env);
    }
    return response;
  };
  const error = await applySharing({ ...env.session, fetch }, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: BOB, role: "editor" }],
  }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(SharingIncompleteError);
  expect(error).toMatchObject({ unchanged: [BOB, CAROL] });
  expect((error as Error).cause).toBeUndefined();
});

it("treats a failed removal whose result cannot be reloaded as an unknown outcome", async () => {
  const { env, snapshot } = await materialized();
  let gets = 0;
  const fetch: typeof globalThis.fetch = async (url, init) =>
    (init?.method ?? "GET") === "GET" && ++gets > 1
      ? new Response(null, { status: 503 })
      : env.session.fetch(url, init);
  // setGrants writes nothing (the copied row is retained); removeGrant and the reload fail.
  await expect(
    applySharing({ ...env.session, fetch }, snapshot, {
      ...snapshot.state,
      people: snapshot.state.people.filter((p) => p.webId !== CAROL),
    }),
  ).rejects.toMatchObject({ committed: false });
  expect((await env.load()).state.people.some((p) => p.webId === CAROL)).toBe(true);
});

// Review round 1 (#282): grants the role projection cannot map are never silently dropped.
it.each([
  ["anonymous Read+Append", PUBLIC, ["Read", "Append"]],
  ["Write without Read", BOB, ["Write"]],
  ["Control without Write", CAROL, ["Read", "Control"]],
] as const)("fails closed on %s that the SDK role projection drops", async (_, who, modes) => {
  const env = await setup();
  authorization(env.doc, who, [...modes]);
  await writeDoc(env);
  // The SDK omits the principal entirely, which would read as "Restricted" / "Only you".
  const sdk = await readGrants(FILE, { fetch: env.session.fetch, root: ROOT, kind: "resource" });
  expect(sdk.grants.map((g) => (g.agent.type === "webid" ? g.agent.id : g.agent.type))).toEqual([
    ALICE,
  ]);
  await expect(env.load()).rejects.toThrow(UNMAPPED);
});

it("fails closed on unmappable access inherited from the parent folder", async () => {
  const env = await setup("wac", true);
  authorization(env.doc, PUBLIC, ["Read", "Append"]);
  await writeDoc(env);
  await expect(env.load()).rejects.toThrow(UNMAPPED);
});

// Review round 1 (#282): a folder label must not say private while its contents are shared.
it.each([
  ["a person", BOB],
  ["the public", PUBLIC],
] as const)("refuses a folder whose default-only rules share its contents with %s", async (_, who) => {
  const env = await setup();
  const folder = `${FOLDER}drop/`;
  await env.pod.fetch(folder, { method: "PUT" });
  const doc = document("wac", false, folder);
  authorization(doc, ALICE, ["Read", "Write", "Control"]).default = folder;
  const rule = authorization(doc, who, ["Read"]);
  properties(rule).values(`${ACL}accessTo`).clear();
  rule.default = folder;
  await writeDoc(env, doc);
  await expect(loadSharing(env.session, folder)).rejects.toMatchObject({
    message: expect.stringContaining("different sharing for the folder and its contents"),
    cause: { code: "partial-scope" },
  });
  // The independent verifier still flags unequal scopes, even without a projected member row.
  const capture = { resource: folder, url: doc.source, dataset: doc.dataset };
  expect(
    await verifyAccess(folder, "folder", async () => [capture], [
      {
        agent: { type: "webid", id: ALICE },
        role: "manager",
        inherited: false,
        source: doc.source,
      },
    ]),
  ).toEqual({ contentsDiffer: true });
  // A file inside inherits that access, and its own dialog shows it.
  await env.pod.fetch(`${folder}upload.txt`, { method: "PUT", body: "x" });
  const child = await loadSharing(env.session, `${folder}upload.txt`);
  expect(accessSummary(child, ALICE)).not.toBe("Only you");
});

it("flags an ACP folder whose member access differs from its own", async () => {
  const env = await setup("acp");
  const folder = `${FOLDER}drop/`;
  await env.pod.fetch(folder, { method: "PUT" });
  const doc = document("acp", false, folder);
  policy(doc, ALICE, ["Read", "Write", "Control"]);
  await writeDoc(env, doc);
  await expect(loadSharing(env.session, folder)).rejects.toMatchObject({
    cause: { code: "partial-scope" },
  });
  const both = document("acp", false, folder);
  policy(both, ALICE, ["Read", "Write", "Control"]);
  const members = document("acp", true, folder);
  policy(members, ALICE, ["Read", "Write", "Control"], folder);
  for (const quad of [...members.dataset]) both.dataset.add(quad);
  await writeDoc(env, both);
  expect((await loadSharing(env.session, folder)).contentsDiffer).toBe(false);
});

it("does not flag a folder that inherits all of its access", async () => {
  const env = await setup("wac", true);
  const folder = `${FOLDER}nested/`;
  await env.pod.fetch(folder, { method: "PUT" });
  expect((await loadSharing(env.session, folder)).contentsDiffer).toBe(false);
});

it("verifies the recorded access documents and fails closed on anything it cannot account for", async () => {
  const grant = (id: string, role: Role): RoleGrant => ({
    agent: { type: "webid", id },
    role,
    inherited: false,
    source: `${FILE}.acl`,
  });
  const own = document("wac");
  authorization(own, ALICE, ["Read", "Write", "Control"]);
  authorization(own, BOB, ["Read"]);
  const capture = { resource: FILE, url: `${FILE}.acl`, dataset: own.dataset };
  const ok = [grant(ALICE, "manager"), grant(BOB, "viewer")];
  await expect(verifyAccess(FILE, "resource", async () => [capture], ok)).resolves.toEqual({
    contentsDiffer: false,
  });
  const refuse = (documents: () => Promise<never[] | (typeof capture)[]>, grants = ok) =>
    expect(verifyAccess(FILE, "resource", documents, grants)).rejects.toThrow(UNMAPPED);
  // A role the raw modes do not support, or a principal the documents do not grant.
  await refuse(async () => [capture], [grant(ALICE, "manager"), grant(BOB, "editor")]);
  await refuse(async () => [capture], [grant(ALICE, "manager"), grant(CAROL, "viewer")]);
  // Raw modes that map to no role never match a projected role, even when the counts agree.
  const writeOnly = document("wac");
  authorization(writeOnly, ALICE, ["Read", "Write", "Control"]);
  authorization(writeOnly, BOB, ["Write"]);
  await refuse(async () => [{ ...capture, dataset: writeOnly.dataset }]);
  // A document attributed to a resource that cannot govern the target.
  await refuse(async () => [{ ...capture, resource: `${ROOT}elsewhere/` }]);
  // Conditional WAC grants and ACP denials.
  const conditional = document("wac");
  authorization(conditional, ALICE, ["Read"]).origin.add("https://app.example.org");
  await refuse(async () => [{ ...capture, dataset: conditional.dataset }]);
  const denied = document("acp");
  policy(denied, BOB, []).deny.add(`${ACL}Read`);
  await refuse(async () => [{ ...capture, url: `${FILE}.acr`, dataset: denied.dataset }], []);
  // Reader and parse failures fail closed with the same message.
  const cause = new TypeError("unreadable");
  await expect(
    verifyAccess(FILE, "resource", () => Promise.reject(cause), ok),
  ).rejects.toMatchObject({ message: UNMAPPED, cause });
});

it("records responses for any fetch call shape without consuming them", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response("<a> <b> <c> .", { headers: { "content-type": "text/turtle" } }),
  );
  const recorder = recordAccess(fetch);
  expect(await (await recorder.fetch(`${FILE}.acl`)).text()).toBe("<a> <b> <c> .");
  expect((await recorder.documents(FILE)).map((d) => [d.resource, d.dataset.size])).toEqual([
    [FILE, 1],
  ]);
});

it("names an unsupported access system only for ESS shapes, and falls back when unreadable", async () => {
  const env = await setup();
  // The access document fails with a non-RDF body: the generic retry message, not ESS.
  const broken: typeof globalThis.fetch = async (url, init) =>
    url === `${FILE}.acl`
      ? new Response("<html>", { status: 500, headers: { "content-type": "text/html" } })
      : env.session.fetch(url, init);
  await expect(loadSharing({ ...env.session, fetch: broken }, FILE)).rejects.toThrow(
    "Couldn't load sharing. Try again.",
  );
  expect(UNSUPPORTED_SYSTEM).toBe("This pod's access system isn't supported for sharing yet.");
});
