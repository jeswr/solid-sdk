// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { readSharing } from "../src/apps/drive/lib/sharing";
import { WacSharingAdapter } from "../src/shell/share/wac-adapter";
import {
  ACL,
  ALICE,
  authorization,
  BOB,
  CAROL,
  COMMENTS,
  context,
  document,
  FILE,
  PUBLIC,
  properties,
} from "./sharing-fixtures";

const signal = () => new AbortController().signal;
async function turtle(doc: ReturnType<typeof document>) {
  return new Promise<string>((resolve, reject) => {
    const writer = new Writer();
    writer.addQuads([...doc.dataset]);
    writer.end((error, body) => (error ? reject(error) : resolve(body)));
  });
}
function commentsGrants(doc: ReturnType<typeof document>, webId: string) {
  return [...new AclResource(doc.dataset, DataFactory).authorizations].filter(
    (row) =>
      row.agent.has(webId) &&
      ["accessTo", "default", "defaultForNew"].some((predicate) =>
        properties(row)
          .values(ACL + predicate)
          .has(doc.governingResource),
      ),
  );
}
async function server() {
  const doc = document();
  authorization(doc, ALICE, ["Read", "Write", "Control"]);
  const documents = new Map([[doc.source, doc]]);
  const versions = new Map<string, string>();
  let status = 0;
  let etag: string | null = '"v1"';
  let link = `<${FILE}.acl>; rel="type acl"`;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: { link: url === FILE ? link : `<${url}.acl>; rel=acl` },
      });
    const target = documents.get(url);
    if (!target) return new Response(null, { status: 404 });
    if (init?.method === "PUT") {
      if (status) {
        const failed = status;
        status = 0;
        return new Response(null, { status: failed });
      }
      expect(new Headers(init.headers).get("if-match")).toBe(versions.get(url) ?? etag);
      target.dataset = await parseRdf(String(init.body), "text/turtle", { baseIRI: url });
      versions.set(url, '"v2"');
      return new Response(null, { status: 204, headers: { etag: '"v2"' } });
    }
    return new Response(await turtle(target), {
      headers: {
        "content-type": "text/turtle",
        ...(etag ? { etag: versions.get(url) ?? etag } : {}),
      },
    });
  });
  const adapter = new WacSharingAdapter({ fetch, webId: ALICE });
  return {
    adapter,
    fetch,
    doc,
    documents,
    fail: (code: number) => {
      status = code;
    },
    etag: (value: string | null) => {
      etag = value;
    },
    link: (value: string) => {
      link = value;
    },
  };
}
describe("WAC sharing adapter", () => {
  it("refuses added modes in narrow-only plans before any PUT and keeps no-ops available", async () => {
    const { adapter, fetch } = await server();
    await adapter.load(FILE, signal());
    await expect(
      adapter.setPerson(FILE, BOB, "viewer", { narrowOnly: true }),
    ).rejects.toMatchObject({ code: "would-grant" });
    await expect(
      adapter.setGeneral(FILE, { mode: "link" }, { narrowOnly: true }),
    ).rejects.toMatchObject({ code: "would-grant" });
    await adapter.setPerson(FILE, BOB, null, { narrowOnly: true });
    await adapter.setGeneral(FILE, { mode: "restricted" }, { narrowOnly: true });
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    await adapter.setPerson(FILE, BOB, "viewer");
    await adapter.setPerson(FILE, BOB, null, { narrowOnly: true });
    expect((await adapter.load(FILE, signal())).people.some((person) => person.webId === BOB)).toBe(
      false,
    );
  });
  it("checks every resource in a narrow-only plan, including a lower role that adds comments access", async () => {
    const { fetch, documents, doc } = await server();
    authorization(doc, BOB, ["Read", "Write"]);
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await expect(
      adapter.setPerson(FILE, BOB, "commenter", { narrowOnly: true }),
    ).rejects.toMatchObject({ code: "would-grant" });
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "editor",
    });
  });
  it("discovers ACLs, adds a viewer conditionally, and emits no empty writes", async () => {
    const { adapter, fetch } = await server();
    expect(await adapter.load(FILE, signal())).toMatchObject({
      canManage: true,
      people: [{ webId: ALICE, role: "owner" }],
    });
    expect(fetch.mock.calls[0]).toMatchObject([FILE, { method: "HEAD", redirect: "manual" }]);
    await adapter.setPerson(FILE, BOB, "viewer");
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "viewer",
    });
    const puts = () => fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts()).toHaveLength(1);
    await adapter.setPerson(FILE, BOB, "viewer");
    await adapter.setGeneral(FILE, { mode: "restricted" });
    expect(puts()).toHaveLength(1);
    await adapter.setPerson(FILE, BOB, null);
    expect((await adapter.load(FILE, signal())).people.some((person) => person.webId === BOB)).toBe(
      false,
    );
  });
  it("splits shared principals/scopes and preserves defaults and metadata", async () => {
    const { adapter, doc } = await server();
    const auth = authorization(doc, BOB, ["Read", "Write", "Append"]);
    auth.agent.add(CAROL);
    properties(auth).values(`${ACL}accessTo`).add(`${FILE}-other`);
    auth.default = FILE;
    properties(auth).values("https://example.org/metadata").add("https://example.org/retained");
    await adapter.load(FILE, signal());
    await adapter.setPerson(FILE, BOB, "viewer");
    const state = readSharing({ access: context(doc) });
    expect(state.people.find((person) => person.webId === CAROL)?.role).toBe("editor");
    expect(state.people.find((person) => person.webId === BOB)?.role).toBe("viewer");
    const grants = [...new AclResource(doc.dataset, DataFactory).authorizations];
    expect(
      grants.some(
        (row) =>
          row.agent.has(BOB) &&
          properties(row).values(`${ACL}accessTo`).has(`${FILE}-other`) &&
          row.mode.has(`${ACL}Write`),
      ),
    ).toBe(true);
    expect(
      grants.some(
        (row) => row.agent.has(BOB) && row.default === FILE && row.mode.has(`${ACL}Write`),
      ),
    ).toBe(true);
    expect(
      grants.some((row) =>
        properties(row).values("https://example.org/metadata").has("https://example.org/retained"),
      ),
    ).toBe(true);
  });
  it("sets and restricts anonymous link access without changing owner rows", async () => {
    const { adapter } = await server();
    await adapter.load(FILE, signal());
    await adapter.setGeneral(FILE, { mode: "link", role: "viewer" });
    expect((await adapter.load(FILE, signal())).general).toEqual({ mode: "link", role: "viewer" });
    await adapter.setGeneral(FILE, { mode: "link", role: "editor" });
    expect((await adapter.load(FILE, signal())).general.role).toBe("editor");
    await adapter.setGeneral(FILE, { mode: "restricted" });
    expect((await adapter.load(FILE, signal())).general.mode).toBe("restricted");
  });
  it("reloads on 412 and reports a conflict without retrying the write", async () => {
    const { adapter, fail, fetch } = await server();
    await adapter.load(FILE, signal());
    fail(412);
    await expect(adapter.setPerson(FILE, BOB, "editor")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect((await adapter.load(FILE, signal())).people).toHaveLength(1);
  });
  it("retains the visible list and becomes read-only after 403", async () => {
    const { adapter, fail, fetch } = await server();
    await adapter.load(FILE, signal());
    fail(403);
    await expect(adapter.setPerson(FILE, BOB, "editor")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(adapter.setGeneral(FILE, { mode: "link" })).rejects.toMatchObject({
      code: "forbidden",
    });
    fetch.mockImplementation(async () => new Response(null, { status: 403 }));
    expect(await adapter.load(FILE, signal())).toMatchObject({
      readOnly: "forbidden",
      people: [{ role: "owner" }],
    });
  });
  it("refuses owners, unsupported roles, unsafe IDs, missing validators and unsupported core data", async () => {
    const { adapter, fetch, etag, doc } = await server();
    await adapter.load(FILE, signal());
    for (const role of [null, "viewer", "editor"] as const)
      await expect(adapter.setPerson(FILE, ALICE, role)).rejects.toThrow("Owner");
    await expect(adapter.setPerson(FILE, BOB, "manager")).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(
      adapter.setPerson(FILE, BOB, "viewer", { expires: new Date() }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(adapter.setPerson(FILE, BOB, "viewer", { purpose: "Use" })).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(adapter.setPerson(FILE, BOB, "commenter")).rejects.toThrow("comments");
    await expect(adapter.setGeneral(FILE, { mode: "signed-in" })).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(
      adapter.setGeneral(FILE, { mode: "link", role: "commenter" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    for (const id of [
      "javascript:bad",
      "https://example.org/a>bad",
      "https://user:pass@example.org/me",
    ])
      await expect(adapter.setPerson(FILE, id, "viewer")).rejects.toThrow();
    for (const value of [null, 'W/"v1"']) {
      etag(value);
      await adapter.load(FILE, signal());
      await expect(adapter.setPerson(FILE, BOB, "viewer")).rejects.toMatchObject({
        code: "unsupported",
      });
    }
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    authorization(doc, PUBLIC, ["Control"]);
    await expect(adapter.load(FILE, signal())).rejects.toThrow();
    await expect(adapter.setPerson(FILE, BOB, "viewer")).rejects.toThrow();
  });
  it("fails closed on missing, ambiguous or foreign ACL links and redirected discovery", async () => {
    const { adapter, fetch, link } = await server();
    for (const value of [
      "",
      '<https://evil.example/acl>; rel="acl"',
      `<${FILE}.acl>; rel="acl", <${FILE}.other>; rel="acl"`,
      `<${FILE}>; rel="acl"`,
    ]) {
      link(value);
      await expect(adapter.load(FILE, signal())).rejects.toThrow();
    }
    fetch.mockImplementation(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    await expect(adapter.load(FILE, signal())).rejects.toThrow();
    await expect(adapter.setPerson(FILE, BOB, "viewer")).rejects.toThrow();
  });
  it("maps Commenter through the separate comments resource", async () => {
    const { fetch, documents } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    expect(adapter.supportsCommenter).toBe(true);
    await adapter.load(FILE, signal());
    await adapter.setPerson(FILE, BOB, "commenter");
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "commenter",
    });
    const bob = [...new AclResource(comments.dataset, DataFactory).authorizations].filter((row) =>
      row.agent.has(BOB),
    );
    expect(bob).toHaveLength(2);
    expect(new Set(bob.find((row) => row.accessTo === COMMENTS)?.mode)).toEqual(
      new Set([`${ACL}Read`, `${ACL}Append`]),
    );
    const members = bob.find((row) => row.default === COMMENTS);
    expect(members?.accessTo).toBeUndefined();
    expect(new Set(members?.mode)).toEqual(new Set([`${ACL}Read`]));
    await adapter.setPerson(FILE, BOB, "viewer");
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "viewer",
    });
    expect(commentsGrants(comments, BOB)).toEqual([]);
  });
  it("narrows comments container Append and removes legacy member Append on revocation", async () => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    // Carol starts with the legacy symmetric commenter grant.
    const carol = authorization(comments, CAROL, ["Read", "Append"]);
    carol.default = COMMENTS;
    authorization(doc, CAROL, ["Read"]);
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await adapter.setPerson(FILE, BOB, "commenter");
    const rows = () => [...new AclResource(comments.dataset, DataFactory).authorizations];
    const bob = rows().filter((row) => row.agent.has(BOB));
    expect(bob.some((row) => row.canAppend && row.accessTo === COMMENTS)).toBe(true);
    expect(bob.some((row) => row.canRead && row.default === COMMENTS)).toBe(true);
    expect(bob.some((row) => row.canAppend && row.default === COMMENTS)).toBe(false);
    await adapter.setPerson(FILE, CAROL, null);
    expect(commentsGrants(comments, CAROL)).toEqual([]);
  });
  it("refuses comment changes for a principal whose container grant is one-sided", async () => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(comments, CAROL, ["Read", "Append"]);
    authorization(doc, CAROL, ["Read"]);
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await expect(adapter.load(FILE, signal())).rejects.toThrow(
      "Folder and descendant permissions differ",
    );
    await expect(adapter.setPerson(FILE, CAROL, null)).rejects.toThrow();
    // Refused before any write: no half-applied plan.
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });
  it.each([
    "default",
    "defaultForNew",
  ])("migrates legacy %s commenter access in one conditional PUT even when the role is unchanged", async (predicate) => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(doc, BOB, ["Read"]);
    const legacy = authorization(comments, BOB, ["Read", "Append"]);
    legacy.agent.add(CAROL);
    properties(legacy)
      .values(ACL + predicate)
      .add(COMMENTS);
    properties(legacy).values(`${ACL}accessTo`).add(`${FILE}-unrelated`);
    properties(legacy).values("https://example.org/metadata").add("https://example.org/kept");
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "commenter",
    });
    await adapter.setPerson(FILE, BOB, "commenter");
    const puts = fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[0]).toBe(comments.source);
    expect(new Headers(puts[0]?.[1]?.headers).get("if-match")).toBe('"v1"');
    const rows = [...new AclResource(comments.dataset, DataFactory).authorizations];
    const members = rows.filter(
      (row) =>
        row.agent.has(BOB) &&
        ["default", "defaultForNew"].some((p) =>
          properties(row)
            .values(ACL + p)
            .has(COMMENTS),
        ),
    );
    expect(members).toHaveLength(1);
    expect(new Set(members[0]?.mode)).toEqual(new Set([`${ACL}Read`]));
    expect(
      rows.some(
        (row) =>
          row.agent.has(CAROL) &&
          row.canAppend &&
          properties(row)
            .values(ACL + predicate)
            .has(COMMENTS),
      ),
    ).toBe(false);
    expect(commentsGrants(comments, CAROL).some((row) => row.canRead)).toBe(true);
    expect(
      commentsGrants(comments, CAROL).some((row) => row.canAppend && row.accessTo === COMMENTS),
    ).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.agent.has(BOB) &&
          row.canAppend &&
          properties(row).values(`${ACL}accessTo`).has(`${FILE}-unrelated`),
      ),
    ).toBe(true);
    expect(
      rows.some((row) =>
        properties(row).values("https://example.org/metadata").has("https://example.org/kept"),
      ),
    ).toBe(true);
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "commenter",
    });
    await adapter.setPerson(FILE, BOB, "commenter");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
  it.each([
    null,
    'W/"v1"',
    "conflict",
  ])("refuses a legacy migration with validator %s without an unconditional or retried write", async (validator) => {
    const { fetch, documents, doc, etag, fail } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(comments, BOB, ["Read", "Append"]).default = COMMENTS;
    authorization(doc, BOB, ["Read"]);
    documents.set(comments.source, comments);
    if (validator !== "conflict") etag(validator);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    if (validator === "conflict") fail(412);
    // Bob is already a commenter, so the plan is empty. Without a strong validator the
    // migration is deferred rather than written unconditionally.
    if (validator === "conflict")
      await expect(adapter.setPerson(FILE, BOB, "commenter")).rejects.toMatchObject({
        code: "conflict",
      });
    else await expect(adapter.setPerson(FILE, BOB, "commenter")).resolves.toBeUndefined();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(
      validator === "conflict" ? 1 : 0,
    );
    expect(
      [...new AclResource(comments.dataset, DataFactory).authorizations].some(
        (row) => row.agent.has(BOB) && row.canAppend && row.default === COMMENTS,
      ),
    ).toBe(true);
  });
  it("narrows comments-only principals when saving unrelated general access", async () => {
    const { fetch, documents } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(comments, BOB, ["Append"]).default = COMMENTS;
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await adapter.setGeneral(FILE, { mode: "restricted" });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(
      [...new AclResource(comments.dataset, DataFactory).authorizations].some(
        (row) => row.agent.has(BOB) && row.canAppend && row.default === COMMENTS,
      ),
    ).toBe(false);
    const bob = commentsGrants(comments, BOB);
    expect(bob).toHaveLength(1);
    expect(new Set(bob[0]?.mode)).toEqual(new Set([`${ACL}Append`]));
    expect(bob[0]?.accessTo).toBe(COMMENTS);
    expect(bob[0]?.default).toBeUndefined();
  });
  it("narrows defaults-only legacy rules without adding a container target", async () => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(doc, BOB, ["Read"]);
    authorization(comments, BOB, ["Append"]);
    const members = authorization(comments, BOB, ["Append"]);
    members.accessTo = undefined;
    members.default = COMMENTS;
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await adapter.setGeneral(FILE, { mode: "restricted" });
    const rows = [...new AclResource(comments.dataset, DataFactory).authorizations].filter((row) =>
      row.agent.has(BOB),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accessTo).toBe(COMMENTS);
    expect(new Set(rows[0]?.mode)).toEqual(new Set([`${ACL}Append`]));
    expect(rows[0]?.default).toBeUndefined();
  });
  it("migrates the Append-only shape produced by the old adapter", async () => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(comments, BOB, ["Append"]).default = COMMENTS;
    authorization(doc, BOB, ["Read"]);
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await adapter.setPerson(FILE, BOB, "commenter");
    const rows = [...new AclResource(comments.dataset, DataFactory).authorizations].filter((row) =>
      row.agent.has(BOB),
    );
    expect(rows).toHaveLength(1);
    expect(new Set(rows[0]?.mode)).toEqual(new Set([`${ACL}Append`]));
    expect(rows[0]?.accessTo).toBe(COMMENTS);
    expect(rows[0]?.default).toBeUndefined();
    expect(rows.some((row) => properties(row).values(`${ACL}defaultForNew`).size)).toBe(false);
  });
  it.each([
    "default",
    "defaultForNew",
  ])("downgrades and revokes narrow %s grants without leaving any comments permission", async (predicate) => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(comments, BOB, ["Read", "Append"]);
    const members = authorization(comments, BOB, ["Read"]);
    members.accessTo = undefined;
    properties(members)
      .values(ACL + predicate)
      .add(COMMENTS);
    authorization(doc, BOB, ["Read"]);
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await adapter.setPerson(FILE, BOB, "viewer");
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "viewer",
    });
    expect(commentsGrants(comments, BOB)).toEqual([]);
    await adapter.setPerson(FILE, BOB, "commenter");
    await adapter.setPerson(FILE, BOB, null);
    expect((await adapter.load(FILE, signal())).people.some((row) => row.webId === BOB)).toBe(
      false,
    );
    expect(commentsGrants(comments, BOB)).toEqual([]);
  });
  it("leaves pre-existing Write comment rules unchanged", async () => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(comments, BOB, ["Read", "Append", "Write"]).default = COMMENTS;
    authorization(doc, BOB, ["Read"]);
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await adapter.setGeneral(FILE, { mode: "restricted" });
    const bob = commentsGrants(comments, BOB);
    // Write already reaches members as Append, so the migration leaves the rule as is.
    expect(bob.filter((row) => row.default === COMMENTS).map((row) => new Set(row.mode))).toEqual([
      new Set([`${ACL}Read`, `${ACL}Append`, `${ACL}Write`]),
    ]);
    expect(bob.some((row) => row.canAppend && row.accessTo === COMMENTS)).toBe(true);
    for (const role of ["viewer", null] as const)
      await expect(adapter.setPerson(FILE, BOB, role)).rejects.toThrow("also comes from Write");
  });
  it("writes only the planner's commenter modes when existing comments include Control", async () => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(comments, BOB, ["Read", "Control"]).default = COMMENTS;
    authorization(doc, BOB, ["Read"]);
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await adapter.setPerson(FILE, BOB, "commenter");
    const bob = commentsGrants(comments, BOB);
    expect(new Set(bob.find((row) => row.accessTo === COMMENTS)?.mode)).toEqual(
      new Set([`${ACL}Read`, `${ACL}Append`]),
    );
    expect(new Set(bob.find((row) => row.default === COMMENTS)?.mode)).toEqual(
      new Set([`${ACL}Read`]),
    );
  });
  it.each([
    "commenter",
    "editor",
  ] as const)("removes a narrow-shape %s without retaining any comments grant", async (role) => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await adapter.setPerson(FILE, BOB, "commenter");
    if (role === "editor") await adapter.setPerson(FILE, BOB, "editor");
    await adapter.setPerson(FILE, BOB, null);
    expect(commentsGrants(comments, BOB)).toEqual([]);
    expect((await adapter.load(FILE, signal())).people.some((row) => row.webId === BOB)).toBe(
      false,
    );
    for (const target of [doc, comments])
      for (const row of new AclResource(target.dataset, DataFactory).authorizations)
        expect(
          row.agent.size + row.agentClass.size + properties(row).values(`${ACL}agentGroup`).size,
        ).toBeGreaterThan(0);
  });
  it.each([
    "editor",
    "absent",
  ])("narrows pre-existing legacy comment grants when a %s person becomes Commenter", async (before) => {
    const { fetch, documents, doc } = await server();
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    authorization(comments, BOB, ["Read", "Append"]).default = COMMENTS;
    if (before === "editor") authorization(doc, BOB, ["Read", "Write"]);
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    await adapter.load(FILE, signal());
    await adapter.setPerson(FILE, BOB, "commenter");
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "commenter",
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(2);
    const members = [...new AclResource(comments.dataset, DataFactory).authorizations].filter(
      (row) => row.agent.has(BOB) && row.default === COMMENTS,
    );
    expect(members).toHaveLength(1);
    expect(new Set(members[0]?.mode)).toEqual(new Set([`${ACL}Read`]));
  });
  it("does not confer management just because an ACL is readable", async () => {
    const { fetch } = await server();
    const adapter = new WacSharingAdapter({ fetch, webId: BOB });
    expect((await adapter.load(FILE, signal())).canManage).toBe(false);
    await expect(adapter.setGeneral(FILE, { mode: "link" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("WAC adapter scope limits (fail closed)", () => {
  it.each([
    "",
    "?revision=1",
  ])("updates folder grants and defaults together, including downgrade and removal (%s)", async (suffix) => {
    const { adapter, documents } = await server();
    const folder = new URL("./", FILE).href + suffix;
    const doc = document("wac", false, folder);
    authorization(doc, ALICE, ["Read", "Write", "Control"]).default = folder;
    documents.set(doc.source, doc);
    await adapter.load(folder, signal());
    for (const role of ["editor", "viewer", null] as const) {
      await adapter.setPerson(folder, BOB, role);
      const grants = [...new AclResource(doc.dataset, DataFactory).authorizations].filter((row) =>
        row.agent.has(BOB),
      );
      const active = grants.filter((row) => row.accessTo === folder || row.default === folder);
      expect(active).toHaveLength(role ? 1 : 0);
      if (role) {
        expect(active[0]?.accessTo).toBe(folder);
        expect(active[0]?.default).toBe(folder);
        expect(active[0]?.canWrite).toBe(role === "editor");
      }
    }
    await adapter.setGeneral(folder, { mode: "link", role: "editor" });
    await adapter.setGeneral(folder, { mode: "restricted" });
    expect((await adapter.load(folder, signal())).general.mode).toBe("restricted");
  });
  it("removes legacy container defaults without changing another principal or scope", async () => {
    const { adapter, documents } = await server();
    const folder = new URL("./", FILE).href;
    const doc = document("wac", false, folder);
    authorization(doc, ALICE, ["Read", "Write", "Control"]).default = folder;
    const shared = authorization(doc, BOB, ["Read", "Write"]);
    shared.agent.add(CAROL);
    properties(shared).values(`${ACL}defaultForNew`).add(folder);
    properties(shared).values(`${ACL}accessTo`).add(FILE);
    documents.set(doc.source, doc);
    await adapter.load(folder, signal());
    await adapter.setPerson(folder, BOB, "viewer");
    const rules = [...new AclResource(doc.dataset, DataFactory).authorizations];
    expect(
      rules.some(
        (row) =>
          row.agent.has(CAROL) &&
          row.canWrite &&
          properties(row).values(`${ACL}defaultForNew`).has(folder),
      ),
    ).toBe(true);
    expect(rules.some((row) => row.agent.has(BOB) && row.accessTo === FILE && row.canWrite)).toBe(
      true,
    );
    expect(
      rules.some(
        (row) =>
          row.agent.has(BOB) &&
          row.canWrite &&
          properties(row).values(`${ACL}defaultForNew`).has(folder),
      ),
    ).toBe(false);
    await adapter.setPerson(folder, BOB, null);
    expect(
      (await adapter.load(folder, signal())).people.some((person) => person.webId === BOB),
    ).toBe(false);
  });
  it.each([
    "folder-only",
    "members-only",
    "split",
  ])("refuses unsupported %s folder grants before writing", async (shape) => {
    const { adapter, documents, fetch } = await server();
    const folder = new URL("./", FILE).href;
    const doc = document("wac", false, folder);
    authorization(doc, ALICE, ["Read", "Write", "Control"]).default = folder;
    const grant = authorization(doc, BOB, ["Read", "Write"]);
    if (shape === "members-only") properties(grant).values(`${ACL}accessTo`).clear();
    if (shape !== "folder-only") {
      const members = shape === "split" ? authorization(doc, BOB, ["Read", "Write"], FILE) : grant;
      members.default = folder;
    }
    documents.set(doc.source, doc);
    if (shape === "split") {
      await adapter.load(folder, signal());
      await expect(adapter.setPerson(folder, BOB, "viewer")).rejects.toMatchObject({
        code: "unsupported",
      });
    } else
      await expect(adapter.load(folder, signal())).rejects.toThrow(
        "Folder and descendant permissions differ",
      );
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
  it("locks writes as offline when storage is unreachable, then unlocks on the next load", async () => {
    const { adapter, fetch } = await server();
    await adapter.load(FILE, signal());
    const working = fetch.getMockImplementation();
    fetch.mockImplementation(async () => new Response(null, { status: 503 }));
    await expect(adapter.load(FILE, signal())).rejects.toMatchObject({ code: "network" });
    await expect(adapter.setPerson(FILE, BOB, "viewer")).rejects.toMatchObject({
      code: "network",
    });
    if (working) fetch.mockImplementation(working);
    expect((await adapter.load(FILE, signal())).readOnly).toBeUndefined();
    await adapter.setPerson(FILE, BOB, "viewer");
    expect(
      (await adapter.load(FILE, signal())).people.find((person) => person.webId === BOB)?.role,
    ).toBe("viewer");
  });
  it("an adapter with a comments ACL serves only its own document", async () => {
    const adapter = new WacSharingAdapter({
      fetch: vi.fn(async () => new Response(null, { status: 404 })),
      webId: ALICE,
      commentsUrl: COMMENTS,
    });
    await adapter.load(FILE, signal()).catch(() => undefined);
    await expect(adapter.load(`${FILE}-other`, signal())).rejects.toMatchObject({
      code: "unsupported",
    });
  });
});

describe("comments migration safety", () => {
  function twoDocuments(commentsEtag: string) {
    const file = document();
    authorization(file, ALICE, ["Read", "Write", "Control"]);
    authorization(file, PUBLIC, ["Read"]);
    authorization(file, BOB, ["Read"]);
    const comments = document("wac", false, COMMENTS);
    authorization(comments, ALICE, ["Read", "Write", "Control"]).default = COMMENTS;
    const documents = new Map([
      [file.source, file],
      [comments.source, comments],
    ]);
    const puts: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === "HEAD")
        return new Response(null, { headers: { link: `<${url}.acl>; rel=acl` } });
      const target = documents.get(url);
      if (!target) return new Response(null, { status: 404 });
      if (init?.method === "PUT") {
        puts.push(url);
        target.dataset = await parseRdf(String(init.body), "text/turtle", { baseIRI: url });
        return new Response(null, { status: 204 });
      }
      return new Response(await turtle(target), {
        headers: {
          "content-type": "text/turtle",
          etag: url === comments.source ? commentsEtag : '"f1"',
        },
      });
    });
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    return { adapter, comments, file, puts };
  }
  it("leaves Control and Write holders' comment rules alone so the dialog stays readable", async () => {
    const { adapter, comments, puts } = twoDocuments('"c1"');
    authorization(comments, BOB, ["Read", "Append", "Control"]).default = COMMENTS;
    authorization(comments, CAROL, ["Read", "Write"]).default = COMMENTS;
    await adapter.load(FILE, signal());
    await adapter.setGeneral(FILE, { mode: "restricted" });
    expect(puts).toEqual([`${FILE}.acl`]);
    await expect(adapter.load(FILE, signal())).resolves.toMatchObject({ canManage: true });
  });
  it("skips the migration instead of blocking revocations when the comments ACL has a weak ETag", async () => {
    const { adapter, comments, puts } = twoDocuments('W/"c1"');
    authorization(comments, CAROL, ["Read", "Append"]).default = COMMENTS;
    await adapter.load(FILE, signal());
    await adapter.setGeneral(FILE, { mode: "restricted" }, { narrowOnly: true });
    await adapter.setPerson(FILE, BOB, null, { narrowOnly: true });
    expect(puts).toEqual([`${FILE}.acl`, `${FILE}.acl`]);
    const carol = [...new AclResource(comments.dataset, DataFactory).authorizations].filter(
      (auth) => auth.agent.has(CAROL),
    );
    expect(carol).toHaveLength(1);
  });
});
