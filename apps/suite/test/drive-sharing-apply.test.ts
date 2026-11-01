// AUTHORED-BY Codex
import { serialize } from "@jeswr/rdf-serialize";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { readSharing } from "../src/apps/drive/lib/sharing";
import {
  applySharing,
  loadSharing,
  type SharingSession,
} from "../src/apps/drive/lib/sharing/apply";
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
  Properties,
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
  if (model === "wac") authorization(doc, ALICE, ["Read", "Write", "Control"]);
  else {
    policy(doc, ALICE, ["Read", "Write"]);
    policy(doc, ALICE, ["Read", "Write"], doc.source);
  }
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
  return { pod, session, doc, load, fetch };
}
async function writeDoc(env: Awaited<ReturnType<typeof setup>>, doc = env.doc) {
  await env.pod.fetch(doc.source, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serialize([...doc.dataset]),
  });
}

it("copies inherited defaults and Control into a new own ACL, preserving every effective person", async () => {
  const env = await setup("wac", true);
  authorization(env.doc, BOB, ["Read"]);
  authorization(env.doc, CAROL, ["Read", "Write"], ROOT); // Unrelated defaults never activate.
  await writeDoc(env);
  const inheritedBody = await (await env.pod.fetch(env.doc.source)).text();
  const snapshot = await env.load();
  expect(snapshot.canManage).toBe(true);
  expect(snapshot.state.people.every((p) => p.inherited)).toBe(true);
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: CAROL, role: "editor" }],
  });
  expect(result.state.people.map((p) => [p.webId, p.role, p.inherited])).toEqual([
    [ALICE, "owner", false],
    [BOB, "viewer", false],
    [CAROL, "editor", false],
  ]);
  expect(await (await env.pod.fetch(env.doc.source)).text()).toBe(inheritedBody);
  const put = env.fetch.mock.calls.find(
    ([url, init]) => url === `${FILE}.acl` && init?.method === "PUT",
  );
  expect(new Headers(put?.[1]?.headers).get("if-none-match")).toBe("*");
  const acl = new AclResource(result.own.dataset, DataFactory);
  expect([...acl.authorizations].every((a) => a.default === undefined)).toBe(true);
});

it("splits shared WAC nodes while retaining other principals, scopes, defaults and metadata", async () => {
  const env = await setup();
  const rule = authorization(env.doc, BOB, ["Read", "Write", "Append"]);
  rule.agent.add(CAROL);
  properties(rule).values(`${ACL}accessTo`).add(`${FOLDER}other`);
  rule.default = FOLDER;
  properties(rule).values("https://example.org/metadata").add("https://example.org/label");
  await writeDoc(env);
  let snapshot = await env.load();
  const etag = snapshot.etags.get(env.doc.source);
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.map((p) => (p.webId === BOB ? { ...p, role: "viewer" } : p)),
  });
  expect(snapshot.state.people.find((p) => p.webId === CAROL)?.role).toBe("editor");
  expect(snapshot.state.people.find((p) => p.webId === BOB)?.role).toBe("viewer");
  expect(
    readSharing({
      access: {
        resource: `${FOLDER}other`,
        documents: [{ ...snapshot.own, governingResource: `${FOLDER}other` }],
      },
    }).people.map((p) => p.role),
  ).toEqual(["editor", "editor"]);
  expect(
    [...snapshot.own.dataset].some((q) => q.predicate.value === "https://example.org/metadata"),
  ).toBe(true);
  expect(
    env.fetch.mock.calls.some(
      ([, init]) => init?.method === "PUT" && new Headers(init.headers).get("if-match") === etag,
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
  expect(snapshot.own.model).toBe(model);
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: BOB, role: "editor" }],
    link: "editor",
    public: "viewer",
  });
  expect(snapshot.state.link).toBe("editor");
  expect(snapshot.state.people.find((p) => p.webId === BOB)?.role).toBe("editor");
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.filter((p) => p.webId !== BOB),
    link: "viewer",
    public: "viewer",
  });
  expect(snapshot.state.link).toBe("viewer");
  snapshot = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    link: "none",
    public: "none",
  });
  expect(snapshot.state.link).toBe("none");
  expect(snapshot.state.public).toBe("none");
});

it("retains ACP ancestors, shared policies, alternate targets and member controls", async () => {
  const env = await setup("acp");
  const inherited = document("acp", true);
  policy(inherited, CAROL, ["Read"]);
  const shared = policy(env.doc, BOB, ["Read", "Write"]);
  for (const q of env.doc.dataset) {
    if (q.predicate.value === `${ACP}resource` && q.object.value === FILE) {
      const root = new Properties(q.subject, env.doc.dataset, DataFactory);
      root.values(`${ACP}resource`).add(`${FOLDER}other`);
      root.values("https://example.org/metadata").add("https://example.org/label");
    }
  }
  shared.allOf.values().next().value?.agent.add(CAROL);
  await writeDoc(env);
  await writeDoc(env, inherited);
  const snapshot = await env.load();
  expect(snapshot.state.people.find((p) => p.webId === CAROL)?.inherited).toBe(true);
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: snapshot.state.people.map((p) => (p.webId === BOB ? { ...p, role: "viewer" } : p)),
  });
  expect(result.state.people.find((p) => p.webId === BOB)?.role).toBe("viewer");
  expect(result.state.people.find((p) => p.webId === CAROL)?.role).toBe("editor");
  expect(
    readSharing({
      access: {
        resource: `${FOLDER}other`,
        documents: [{ ...result.own, governingResource: `${FOLDER}other` }],
      },
    }).people.find((p) => p.webId === BOB)?.role,
  ).toBe("editor");
});

it("refuses owner lockout, read-only edits, unsafe WebIDs and inherited changes without writes", async () => {
  const env = await setup("wac", true);
  authorization(env.doc, BOB, ["Read"]);
  authorization(env.doc, PUBLIC, ["Read"]);
  await writeDoc(env);
  const snapshot = await env.load();
  const selections = [
    { ...snapshot.state, people: snapshot.state.people.filter((p) => p.webId !== ALICE) },
    {
      ...snapshot.state,
      people: snapshot.state.people.map((p) =>
        p.webId === ALICE ? { ...p, role: "editor" as const } : p,
      ),
    },
    {
      ...snapshot.state,
      people: [...snapshot.state.people, { webId: "javascript:alert(1)", role: "viewer" as const }],
    },
    { ...snapshot.state, people: snapshot.state.people.filter((p) => p.webId !== BOB) },
    { ...snapshot.state, link: "none" as const, public: "none" as const },
  ];
  env.fetch.mockClear();
  for (const selection of selections)
    await expect(applySharing(env.session, snapshot, selection)).rejects.toThrow();
  await expect(
    applySharing({ ...env.session, webId: BOB }, { ...snapshot, canManage: false }, snapshot.state),
  ).rejects.toThrow("Only an owner");
  expect(env.fetch).not.toHaveBeenCalled();
});

it("does not write unchanged selections", async () => {
  const env = await setup();
  const snapshot = await env.load();
  env.fetch.mockClear();
  expect(await applySharing(env.session, snapshot, snapshot.state)).toBe(snapshot);
  expect(env.fetch).not.toHaveBeenCalled();
});

it.each([
  "put",
  "ancestor",
  "missing",
  "changed-etag",
])("reloads a conflict after %s changes and never retries the write", async (failure) => {
  const env = await setup("wac", failure === "ancestor");
  const snapshot = await env.load();
  const transport = env.session.fetch;
  let failed = false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (
      !failed &&
      ((failure === "put" && init?.method === "PUT") ||
        (failure !== "put" && init?.method === "HEAD" && String(url).endsWith(".acl")))
    ) {
      failed = true;
      return failure === "changed-etag"
        ? new Response(null, { headers: { etag: '"different"' } })
        : new Response(null, { status: failure === "missing" ? 404 : 412 });
    }
    return transport(url, init);
  });
  await expect(
    applySharing({ ...env.session, fetch }, snapshot, {
      ...snapshot.state,
      link: "viewer",
      public: "viewer",
    }),
  ).rejects.toMatchObject({
    message: "Sharing changed elsewhere, review and try again",
    snapshot: expect.objectContaining({ state: snapshot.state }),
  });
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(
    failure === "put" ? 1 : 0,
  );
});

it.each([null, 'W/"weak"'])("blocks writes without a strong ETag (%s)", async (etag) => {
  const env = await setup();
  const snapshot = await env.load();
  await expect(
    applySharing(
      env.session,
      { ...snapshot, etags: new Map([[snapshot.own.source, etag]]) },
      { ...snapshot.state, link: "viewer", public: "viewer" },
    ),
  ).rejects.toThrow("strong");
});

it.each(["HEAD", "PUT"])("reports %s failures without replacing the policy", async (method) => {
  const env = await setup();
  const snapshot = await env.load();
  const fetch: typeof globalThis.fetch = (url, init) =>
    init?.method === method
      ? Promise.resolve(new Response(null, { status: 403 }))
      : env.session.fetch(url, init);
  await expect(
    applySharing({ ...env.session, fetch }, snapshot, {
      ...snapshot.state,
      link: "viewer",
      public: "viewer",
    }),
  ).rejects.toThrow("Couldn't");
});

it("fails closed on unsupported, missing, inaccessible, off-pod and mixed-model discovery", async () => {
  const env = await setup();
  for (const status of [403, 500])
    await expect(
      loadSharing({ ...env.session, fetch: async () => new Response(null, { status }) }, FILE),
    ).rejects.toThrow("Couldn't load");
  await expect(
    loadSharing({ ...env.session, fetch: async () => new Response(null) }, FILE),
  ).rejects.toThrow("advertise");
  const transport = env.session.fetch;
  await expect(
    loadSharing(
      {
        ...env.session,
        fetch: (url, init) =>
          String(url).endsWith(".acl")
            ? Promise.resolve(new Response(null, { status: 500 }))
            : transport(url, init),
      },
      FILE,
    ),
  ).rejects.toThrow();
  await expect(loadSharing(env.session, "https://foreign.example/file")).rejects.toThrow();
  await env.pod.fetch(env.doc.source, { method: "DELETE" });
  await expect(env.load()).rejects.toThrow("No governing");
  const inherited = document("wac", true);
  authorization(inherited, ALICE, ["Read", "Write", "Control"]);
  await writeDoc(env, inherited);
  const mixedFetch: typeof globalThis.fetch = async (url, init) => {
    const response = await transport(url, init);
    if (url !== FILE) return response;
    const headers = new Headers(response.headers);
    headers.set("link", `<${FILE}.acr>; rel="${ACP}accessControl"`);
    return new Response(response.body, { status: response.status, headers });
  };
  await expect(loadSharing({ ...env.session, fetch: mixedFetch }, FILE)).rejects.toThrow(
    "Mixed access models",
  );
});

it("discovers ACP from a legacy ACL relation and returns read-only for a non-owner", async () => {
  const env = await setup("acp");
  const legacy = await env.pod.fetch(env.doc.source);
  await env.pod.fetch(`${FILE}.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await legacy.text(),
  });
  const snapshot = await loadSharing({ ...env.session, fetch: env.pod.fetch, webId: BOB }, FILE);
  expect(snapshot.own.model).toBe("acp");
  expect(snapshot.canManage).toBe(false);
});

it("preserves inherited child defaults when creating a folder ACL", async () => {
  const env = await setup("wac", true);
  const folder = `${FOLDER}nested/`;
  await env.pod.fetch(folder, { method: "PUT" });
  const snapshot = await loadSharing(env.session, folder);
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    people: [...snapshot.state.people, { webId: BOB, role: "viewer" }],
  });
  expect(
    [...new AclResource(result.own.dataset, DataFactory).authorizations].some(
      (a) => a.default === folder && a.agent.has(ALICE),
    ),
  ).toBe(true);
  expect(
    readSharing({
      access: { resource: `${folder}child`, documents: [{ ...result.own, inherited: true }] },
    }).people.find((p) => p.webId === ALICE)?.role,
  ).toBe("owner");
});

it("walks past ancestors without discovery and stops at the nearest real ACL", async () => {
  const env = await setup();
  await env.pod.fetch(env.doc.source, { method: "DELETE" });
  const root = document("wac", false, ROOT);
  const rule = authorization(root, ALICE, ["Read", "Write", "Control"]);
  rule.default = ROOT;
  await writeDoc(env, root);
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const response = await env.pod.fetch(url, init);
    if (url !== FOLDER) return response;
    const headers = new Headers(response.headers);
    headers.delete("link");
    return new Response(response.body, { status: response.status, headers });
  };
  const snapshot = await loadSharing({ ...env.session, fetch }, FILE);
  expect(snapshot.state.people[0]?.sources).toEqual([`${ROOT}.acl`]);
});

it("loads a missing own ACR together with ancestor member policies", async () => {
  const env = await setup("acp");
  await env.pod.fetch(env.doc.source, { method: "DELETE" });
  const ancestor = document("acp", true);
  policy(ancestor, BOB, ["Read"]);
  await writeDoc(env, ancestor);
  const snapshot = await env.load();
  expect(snapshot.own.dataset.size).toBe(0);
  expect(snapshot.input.access.documents).toHaveLength(2);
  expect(snapshot.state.people[0]).toMatchObject({ webId: BOB, inherited: true, role: "viewer" });
  expect(snapshot.canManage).toBe(false);
});

it("treats unchanged inherited anonymous grants as a no-op and blocks a changed public field", async () => {
  const env = await setup("wac", true);
  authorization(env.doc, PUBLIC, ["Read"]);
  await writeDoc(env);
  const snapshot = await env.load();
  expect(await applySharing(env.session, snapshot, snapshot.state)).toBe(snapshot);
  await expect(
    applySharing(env.session, snapshot, { ...snapshot.state, public: "none" }),
  ).rejects.toThrow("Inherited access");
});

it("reloads rather than creating an ACL from defaults changed at a nearer ancestor", async () => {
  const env = await setup("wac", true);
  const folder = `${FOLDER}nested/`;
  await env.pod.fetch(`${folder}file`, { method: "PUT", body: "data" });
  const snapshot = await loadSharing(env.session, `${folder}file`);
  const nearer = document("wac", false, folder);
  const rule = authorization(nearer, ALICE, ["Read", "Write", "Control"]);
  rule.default = folder;
  await writeDoc(env, nearer);
  await expect(
    applySharing(env.session, snapshot, { ...snapshot.state, link: "viewer", public: "viewer" }),
  ).rejects.toThrow("Sharing changed elsewhere");
  expect(env.pod.has(snapshot.own.source)).toBe(false);
});

it("rejects RDF IRIs that n3.Writer cannot safely serialize", async () => {
  const env = await setup();
  const snapshot = await env.load();
  for (const owner of new AclResource(snapshot.own.dataset, DataFactory).authorizations)
    properties(owner)
      .values("https://example.org/metadata")
      .add("https://example.org/unsafe>value");
  await expect(
    applySharing(env.session, snapshot, { ...snapshot.state, link: "viewer", public: "viewer" }),
  ).rejects.toThrow("Unsafe IRI");
});

it("preserves Control and other people when inheriting legacy defaultForNew authorizations", async () => {
  const env = await setup("wac", true);
  authorization(env.doc, BOB, ["Read"]);
  for (const auth of new AclResource(env.doc.dataset, DataFactory).authorizations) {
    auth.default = undefined;
    properties(auth).values(`${ACL}defaultForNew`).add(FOLDER);
  }
  await writeDoc(env);
  const snapshot = await env.load();
  expect(snapshot.state.people.find((p) => p.webId === BOB)?.role).toBe("viewer");
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    link: "viewer",
    public: "viewer",
  });
  expect(result.canManage).toBe(true);
  expect(result.state.people.find((p) => p.webId === BOB)?.role).toBe("viewer");
});

it("keeps ACP child member policies when changing a folder's own sharing", async () => {
  const env = await setup("acp");
  const folder = `${FOLDER}nested/`;
  await env.pod.fetch(folder, { method: "PUT" });
  const doc = document("acp", false, folder);
  policy(doc, ALICE, ["Read", "Write"]);
  policy(doc, ALICE, ["Read", "Write"], doc.source);
  policy({ ...doc, inherited: true }, BOB, ["Read", "Write"]);
  await writeDoc(env, doc);
  const snapshot = await loadSharing(env.session, folder);
  const result = await applySharing(env.session, snapshot, {
    ...snapshot.state,
    link: "viewer",
    public: "viewer",
  });
  expect(
    readSharing({
      access: { resource: `${folder}child`, documents: [{ ...result.own, inherited: true }] },
    }).people.find((p) => p.webId === BOB)?.role,
  ).toBe("editor");
});

it("blocks ACP self-removal and owner downgrades before any network mutation", async () => {
  const env = await setup("acp");
  const snapshot = await env.load();
  env.fetch.mockClear();
  await expect(
    applySharing(env.session, snapshot, { ...snapshot.state, people: [] }),
  ).rejects.toThrow("own owner access");
  await expect(
    applySharing(env.session, snapshot, {
      ...snapshot.state,
      people: [{ webId: ALICE, role: "editor" }],
    }),
  ).rejects.toThrow("own owner access");
  expect(env.fetch).not.toHaveBeenCalled();
});
