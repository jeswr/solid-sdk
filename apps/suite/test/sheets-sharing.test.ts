// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { serializeTurtle } from "../src/apps/docs/lib/model/rdf-io";
import { privateAcl } from "../src/apps/drive/lib/client/access";
import { SheetResource } from "../src/apps/sheets/lib/model";
import { WorkbookSharingAdapter } from "../src/apps/sheets/lib/sharing";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { harness, POD, WEBID } from "./sheets-workbook-helpers";

const READER = "https://pod.example/bob/profile/card#me";
const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP = "http://www.w3.org/ns/solid/acp#";
const signal = () => new AbortController().signal;
async function setup() {
  const pod = await harness();
  const book = await pod.service.create({ title: "Shared workbook" });
  const session = { ...pod.options, storageUrl: POD, mode: "demo" };
  return { ...pod, book, session, adapter: new WorkbookSharingAdapter(session) };
}

describe("workbook container sharing", () => {
  it("creates a conditional owner ACL and shares all editor resources through defaults", async () => {
    const { adapter, book, pod, calls, options } = await setup();
    await adapter.load(book.container, signal());
    expect(
      calls
        .find((call) => call.method === "PUT" && call.url.endsWith("/.acl"))
        ?.headers.get("if-none-match"),
    ).toBe("*");
    await adapter.setPerson(book.container, READER, "viewer");
    await pod.fetch(`${book.container}versions/one.json`, { method: "PUT", body: "{}" });
    // An identity-aware WAC transport over the existing demo pod: own ACL first,
    // then nearest ancestor defaults. The plain demo pod itself does not enforce WAC.
    const readerFetch: typeof fetch = async (input, init) => {
      const target = String(input);
      let resource = target;
      let inherited = false;
      for (;;) {
        const acl = await pod.fetch(`${resource}.acl`);
        if (acl.ok) {
          const dataset = await parseRdf(await acl.text(), "text/turtle");
          const grants = [...new AclResource(dataset, DataFactory).authorizations].filter(
            (rule) =>
              rule.agent.has(READER) &&
              (inherited ? rule.default === resource : rule.accessTo === resource),
          );
          const writing = init?.method === "PUT";
          if (!grants.some((rule) => (writing ? rule.canWrite : rule.canRead)))
            return new Response(null, { status: 403 });
          const response = await pod.fetch(input, init);
          const headers = new Headers(response.headers);
          headers.set("wac-allow", 'user="read",public=""');
          return new Response(response.body, { status: response.status, headers });
        }
        resource = new URL(resource.endsWith("/") ? "../" : "./", resource).href;
        inherited = true;
      }
    };
    const reader = createWorkbookService({
      ...options,
      podRoot: "https://pod.example/bob/",
      fetch: readerFetch,
      webId: READER,
    });
    await expect(reader.open(book.container)).rejects.toThrow();
    const opened = await reader.openShared(book.container);
    expect(opened.readOnly).toBe(true);
    expect(opened.snapshot).toEqual(book.snapshot);
    for (const path of [
      "index.ttl",
      "workbook.json",
      "sheets/1.csv",
      "sheets/1.jsonld",
      "versions/one.json",
    ])
      expect((await readerFetch(`${book.container}${path}`)).ok).toBe(true);
    await expect(reader.save(book.container, opened.snapshot, opened.version)).rejects.toThrow();
    await adapter.setPerson(book.container, READER, "editor");
    await adapter.setPerson(book.container, READER, "viewer");
    expect(
      (await readerFetch(`${book.container}workbook.json`, { method: "PUT", body: "{}" })).status,
    ).toBe(403);
    await adapter.setPerson(book.container, READER, null);
    expect((await readerFetch(`${book.container}workbook.json`)).status).toBe(403);
    await adapter.setGeneral(book.container, { mode: "link", role: "viewer" });
    expect((await adapter.load(book.container, signal())).general).toEqual({
      mode: "link",
      role: "viewer",
    });
    await adapter.setGeneral(book.container, { mode: "restricted" });
  });

  it("opens an existing ACL without creating one and rejects out-of-pod and non-container targets", async () => {
    const { adapter, book, pod, calls } = await setup();
    const policy = privateAcl(book.container, WEBID);
    new SheetResource(`${book.container}.acl#note`, policy, DataFactory).setText(
      "http://www.w3.org/2000/01/rdf-schema#comment",
      "Owner policy",
    );
    await pod.fetch(`${book.container}.acl`, {
      method: "PUT",
      body: await serializeTurtle(policy),
      headers: { "content-type": "text/turtle" },
    });
    calls.length = 0;
    expect((await adapter.load(book.container, signal())).canManage).toBe(true);
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    await expect(adapter.load(`${book.container}index.ttl`, signal())).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(adapter.load("https://foreign.example/sheets/book/", signal())).rejects.toThrow();
  });

  it("bootstraps a real container only after verifying owner-only inherited access", async () => {
    const { session, book, pod } = await setup();
    await pod.fetch(`${POD}.acl`, {
      method: "PUT",
      body: await serializeTurtle(privateAcl(POD, WEBID)),
      headers: { "content-type": "text/turtle" },
    });
    const adapter = new WorkbookSharingAdapter({ ...session, mode: "solid" });
    expect((await adapter.load(book.container, signal())).canManage).toBe(true);
  });

  it("leaves unverified inherited access untouched", async () => {
    const { session, book, calls } = await setup();
    const adapter = new WorkbookSharingAdapter({ ...session, mode: "solid" });
    calls.length = 0;
    await expect(adapter.load(book.container, signal())).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("does not revoke an inherited legacy grant beside an owner default", async () => {
    const { session, book, pod, calls } = await setup();
    const policy = privateAcl(POD, WEBID);
    const bob = new SheetResource(`${POD}.acl#bob`, policy, DataFactory);
    bob.types.add(`${ACL}Authorization`);
    bob.links(`${ACL}agent`).add(READER);
    bob.links(`${ACL}mode`).add(`${ACL}Read`);
    bob.links(`${ACL}defaultForNew`).add(POD);
    await pod.fetch(`${POD}.acl`, {
      method: "PUT",
      body: await serializeTurtle(policy),
      headers: { "content-type": "text/turtle" },
    });
    calls.length = 0;
    const adapter = new WorkbookSharingAdapter({ ...session, mode: "solid" });
    await expect(adapter.load(book.container, signal())).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    expect(pod.has(`${book.container}.acl`)).toBe(false);
    expect(await (await pod.fetch(`${POD}.acl`)).text()).toBe(await serializeTurtle(policy));
  });

  it.each([
    "discovery",
    "predicate",
    "type",
  ])("rejects existing mixed-policy %s and locks stale sharing state", async (kind) => {
    const { adapter, book, pod, calls, setHook } = await setup();
    await adapter.load(book.container, signal());
    if (kind === "discovery") {
      setHook((call) =>
        call.method === "HEAD"
          ? new Response(null, {
              headers: {
                link: `<${book.container}.acl>; rel="acl", <${book.container}.acr>; rel="${ACP}accessControl"`,
              },
            })
          : undefined,
      );
    } else {
      const policy = privateAcl(book.container, WEBID);
      const mixed = new SheetResource(`${book.container}.acl#mixed`, policy, DataFactory);
      if (kind === "type") mixed.types.add(`${ACP}AccessControlResource`);
      else mixed.links(`${ACP}accessControl`).add(`${book.container}.acr#policy`);
      await pod.fetch(`${book.container}.acl`, {
        method: "PUT",
        body: await serializeTurtle(policy),
        headers: { "content-type": "text/turtle" },
      });
    }
    calls.length = 0;
    await expect(adapter.load(book.container, signal())).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(adapter.setPerson(book.container, READER, "viewer")).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(adapter.setGeneral(book.container, { mode: "link" })).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("rejects ACP discovery before bootstrapping a missing ACL", async () => {
    const { adapter, book, calls, setHook } = await setup();
    setHook((call) =>
      call.method === "HEAD"
        ? new Response(null, {
            headers: {
              link: `<${book.container}.acl>; rel="acl", <${book.container}.acr>; rel="${ACP}accessControl"`,
            },
          })
        : undefined,
    );
    calls.length = 0;
    await expect(adapter.load(book.container, signal())).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it.each([
    "missing",
    "duplicate",
    "foreign",
    "head-failure",
  ])("rejects %s ACL discovery", async (kind) => {
    const { adapter, book, setHook } = await setup();
    setHook((call) =>
      call.method === "HEAD"
        ? new Response(null, {
            status: kind === "head-failure" ? 403 : 200,
            headers:
              kind === "missing"
                ? {}
                : {
                    link:
                      kind === "foreign"
                        ? '<https://foreign.example/.acl>; rel="acl"'
                        : `<${book.container}.acl>; rel="acl", <${book.container}.acl>; rel="acl"`,
                  },
          })
        : undefined,
    );
    await expect(adapter.load(book.container, signal())).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  it.each([
    403, 500, 412,
  ])("handles ACL creation status %s without overwriting a concurrent ACL", async (status) => {
    const { adapter, book, pod, setHook } = await setup();
    setHook(async (call) => {
      if (call.method !== "PUT" || !call.url.endsWith(".acl")) return undefined;
      if (status === 412)
        await pod.fetch(call.url, {
          method: "PUT",
          body: await serializeTurtle(privateAcl(book.container, WEBID)),
          headers: { "content-type": "text/turtle" },
        });
      return new Response(null, { status });
    });
    const loading = adapter.load(book.container, signal());
    if (status === 412) expect((await loading).canManage).toBe(true);
    else
      await expect(loading).rejects.toMatchObject({
        code: status === 403 ? "forbidden" : "network",
      });
  });
});

it.each([
  "index.ttl",
  "workbook.json",
])("respects write denial on %s while reading the complete workbook", async (resource) => {
  const { book, pod, service, setHook } = await setup();
  setHook(async (call) => {
    if (call.method !== "GET" || call.url !== `${book.container}${resource}`) return undefined;
    const response = await pod.fetch(call.url, call.init);
    const headers = new Headers(response.headers);
    headers.set("wac-allow", 'user="read control",public=""');
    return new Response(response.body, { status: response.status, headers });
  });
  expect((await service.open(book.container)).readOnly).toBe(true);
});
