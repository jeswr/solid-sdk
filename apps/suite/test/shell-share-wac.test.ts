// AUTHORED-BY Codex GPT-6.1-Sol
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
    authorization(comments, ALICE, ["Read", "Write", "Control"]);
    documents.set(comments.source, comments);
    const adapter = new WacSharingAdapter({ fetch, webId: ALICE, commentsUrl: COMMENTS });
    expect(adapter.supportsCommenter).toBe(true);
    await adapter.load(FILE, signal());
    await adapter.setPerson(FILE, BOB, "commenter");
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "commenter",
    });
    await adapter.setPerson(FILE, BOB, "viewer");
    expect((await adapter.load(FILE, signal())).people).toContainEqual({
      webId: BOB,
      role: "viewer",
    });
    expect(
      [...new AclResource(comments.dataset, DataFactory).authorizations].some(
        (row) => row.agent.has(BOB) && row.canAppend,
      ),
    ).toBe(false);
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
