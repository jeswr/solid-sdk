// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import type { StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACL, ACP } from "../rdf.js";
import { ensurePrivateContainerAccess, verifyPrivateDemoAccess } from "./private-access.js";

const root = "https://pod.example/alice/";
const owner = "https://alice.example/profile#me";
const bob = "https://bob.example/#me";
const folder = `${root}templates/`;
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";
const PREFIX = `@prefix acl: <${ACL}>. @prefix acp: <${ACP}>. @prefix foaf: <http://xmlns.com/foaf/0.1/>.\n`;
const demo = { mode: "demo", storageUrl: root, webId: owner, fetch: vi.fn<typeof fetch>() };
const privateResponse = () =>
  new Response(null, { headers: { "X-Solid-Demo-Access-Control": "none" } });
beforeEach(() => {
  vi.resetAllMocks();
});

describe("verifyPrivateDemoAccess", () => {
  it("checks owner, demo mode and scoped unambiguous URLs before transport", async () => {
    expect(await verifyPrivateDemoAccess({ ...demo, mode: "solid" }, root, owner)).toBe(false);
    expect(await verifyPrivateDemoAccess(demo, root, "https://other.example/me")).toBe(false);
    for (const target of ["invalid", "https://evil.example/", `${root}x?q=1`, `${root}x#f`])
      expect(await verifyPrivateDemoAccess(demo, target, owner)).toBe(false);
    expect(demo.fetch).not.toHaveBeenCalled();
  });
  it("walks missing ancestors and accepts only the explicit isolated-backend marker", async () => {
    demo.fetch
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(privateResponse());
    expect(await verifyPrivateDemoAccess(demo, `${root}templates/nested/file`, owner)).toBe(true);
    expect(demo.fetch.mock.calls.map(([url]) => url)).toEqual([
      `${root}templates/nested/file`,
      `${root}templates/nested/`,
      `${root}templates/`,
    ]);
    demo.fetch.mockResolvedValueOnce(new Response());
    expect(await verifyPrivateDemoAccess(demo, root, owner)).toBe(false);
    demo.fetch.mockRejectedValueOnce(new Error("offline"));
    expect(await verifyPrivateDemoAccess(demo, root, owner)).toBe(false);
  });
  it.each([405, 501])("falls back to GET when HEAD is unsupported (%s)", async (status) => {
    demo.fetch
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(privateResponse());
    expect(await verifyPrivateDemoAccess(demo, root, owner)).toBe(true);
    expect(demo.fetch).toHaveBeenLastCalledWith(root, { redirect: "manual" });
  });
  it("fails closed at the root, on forbidden or redirect, and at a malformed root boundary", async () => {
    for (const status of [404, 403, 302]) {
      demo.fetch.mockResolvedValueOnce(new Response(null, { status }));
      expect(await verifyPrivateDemoAccess(demo, root, owner)).toBe(false);
    }
    demo.fetch
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(
      await verifyPrivateDemoAccess(
        { ...demo, storageUrl: root.slice(0, -1) },
        `${root}file`,
        owner,
      ),
    ).toBe(false);
  });
});

// A Solid pod served over fetch: containers advertise one access document (`.acl` for WAC,
// `.acr` for CSS ACP) and the root carries pim:Storage. Both the role writer (fetch) and
// checkOwnerOnly (a real Solid StorageClient over the same fetch) see the same documents.
function pod(model: "wac" | "acp", docs: Record<string, string> = {}) {
  const suffix = model === "wac" ? ".acl" : ".acr";
  const containers = new Set([root, folder, `${root}shared/`]);
  const store = new Map<string, { body: string; etag: string }>();
  for (const [url, body] of Object.entries(docs))
    store.set(url, { body: PREFIX + body, etag: '"1"' });
  let refusePut = false;
  const writes: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const doc = store.get(url);
    if (containers.has(url)) {
      const link = [
        `<${url}${suffix}>; rel="acl"`,
        '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      ];
      if (url === root) link.push(`<${PIM_STORAGE}>; rel="type"`);
      return new Response(method === "HEAD" ? null : "", {
        headers: { link: link.join(", "), etag: '"c"', "content-type": "text/turtle" },
      });
    }
    if (method === "PUT") {
      const headers = new Headers(init.headers);
      if (refusePut) return new Response(null, { status: 403 });
      if (doc ? headers.get("if-match") !== doc.etag : headers.get("if-none-match") !== "*")
        return new Response(null, { status: 412 });
      writes.push(url);
      store.set(url, { body: String(init.body), etag: `"${writes.length + 1}"` });
      return new Response(null, { status: 205 });
    }
    if (!doc) return new Response(null, { status: 404 });
    return new Response(method === "HEAD" ? null : doc.body, {
      headers: { "content-type": "text/turtle", etag: doc.etag },
    });
  }) as unknown as typeof globalThis.fetch;
  const storage: StorageClient = createSolidBackend({
    fetch,
    root,
    features: {
      ...createMemoryStorage({ root }).features,
      accessControl: { state: "available", detail: { model }, evidence: "fixture" },
    },
  });
  const session = { mode: "solid", storageUrl: root, webId: owner, fetch };
  return {
    session,
    storage,
    writes,
    store,
    refuse: () => {
      refusePut = true;
    },
  };
}
const wac = (target: string, agent: string, modes: string, defaults = true) =>
  `[] a acl:Authorization; acl:accessTo <${target}>; ${defaults ? `acl:default <${target}>;` : ""}
    ${agent}; acl:mode ${modes}.\n`;
const ownerAll = "acl:Read, acl:Write, acl:Control";
// Only applied policies are written: the role reader refuses detached ACP nodes.
const acr = (target: string, members: string, own = "") => {
  const used = members + own;
  return `<> a acp:AccessControlResource;
    acp:resource <${target}>; acp:accessControl <#own>${members ? "; acp:memberAccessControl <#members>" : ""}.
  <#own> acp:apply <#ownerPolicy>${own}.
  ${members ? `<#members> acp:apply <#ownerPolicy>${members}.` : ""}
  <#ownerPolicy> acp:allow acl:Read, acl:Write, acl:Control; acp:allOf <#owner>.
  <#owner> acp:agent <${owner}>.
  ${used.includes("#bobPolicy") ? `<#bobPolicy> acp:allow acl:Read; acp:allOf <#bob>. <#bob> acp:agent <${bob}>.` : ""}
  ${used.includes("#publicPolicy") ? "<#publicPolicy> acp:allow acl:Read; acp:allOf <#public>. <#public> acp:agent acp:PublicAgent." : ""}\n`;
};

describe("ensurePrivateContainerAccess", () => {
  it("refuses the storage root, non-containers and ambiguous or foreign targets before transport", async () => {
    const { session, storage } = pod("wac");
    for (const target of [
      root,
      root.slice(0, -1),
      `${root}templates`,
      `${folder}?q=1`,
      `${folder}#f`,
      "https://evil.example/templates/",
    ])
      await expect(
        ensurePrivateContainerAccess(session, target, { created: true, storage }),
      ).rejects.toThrow();
    await expect(
      ensurePrivateContainerAccess(demo, root, { created: true, storage }),
    ).rejects.toThrow("below the storage root");
    expect(session.fetch).not.toHaveBeenCalled();
    expect(demo.fetch).not.toHaveBeenCalled();
  });
  it("delegates the isolated demo backend to its explicit marker", async () => {
    const { storage } = pod("wac");
    demo.fetch.mockResolvedValueOnce(privateResponse());
    expect(await ensurePrivateContainerAccess(demo, folder, { created: true, storage })).toEqual({
      private: true,
    });
    demo.fetch.mockResolvedValueOnce(new Response());
    expect(
      await ensurePrivateContainerAccess(demo, folder, { created: false, storage }),
    ).toMatchObject({ private: false });
  });
  it("provisions a WAC container it just created, without copying a public default", async () => {
    const { session, storage, writes, store } = pod("wac", {
      [`${root}.acl`]:
        wac(root, `acl:agent <${owner}>`, ownerAll) +
        wac(root, "acl:agentClass foaf:Agent", "acl:Read"),
    });
    expect(await ensurePrivateContainerAccess(session, folder, { created: true, storage })).toEqual(
      { private: true },
    );
    expect(writes).toEqual([`${folder}.acl`]);
    expect(store.get(`${folder}.acl`)?.body).not.toContain("Agent>");
  });
  it("verifies an adopted owner-only WAC container without writing", async () => {
    const { session, storage, writes } = pod("wac", {
      [`${root}.acl`]: wac(root, `acl:agent <${owner}>`, ownerAll),
    });
    expect(
      await ensurePrivateContainerAccess(session, folder, { created: false, storage }),
    ).toEqual({ private: true });
    expect(writes).toEqual([]);
  });
  it("refuses an adopted shared WAC folder and never revokes its collaborators", async () => {
    const shared = `${root}shared/`;
    const acl =
      wac(shared, `acl:agent <${owner}>`, ownerAll) +
      wac(shared, `acl:agent <${bob}>`, "acl:Read, acl:Write");
    const { session, storage, writes, store } = pod("wac", { [`${shared}.acl`]: acl });
    expect(
      await ensurePrivateContainerAccess(session, shared, { created: false, storage }),
    ).toEqual({
      private: false,
      reasons: [
        { subject: "agent", modes: expect.arrayContaining(["read", "write"]), reason: "non-owner" },
      ],
    });
    expect(writes).toEqual([]);
    expect(store.get(`${shared}.acl`)?.body).toContain(bob);
  });
  it("refuses an untyped WAC rule that the role reader cannot see", async () => {
    const { session, storage, writes } = pod("wac", {
      [`${folder}.acl`]:
        wac(folder, `acl:agent <${owner}>`, ownerAll) +
        `[] acl:accessTo <${folder}>; acl:default <${folder}>; acl:agent <${bob}>; acl:mode acl:Read.`,
    });
    expect(
      await ensurePrivateContainerAccess(session, folder, { created: false, storage }),
    ).toMatchObject({ private: false, reasons: [{ reason: "unrepresentable" }] });
    expect(writes).toEqual([]);
  });
  it("accepts an owner grant inherited from a CSS ACP root member policy", async () => {
    // The root's own public read applies to the root alone, as on a default CSS pod.
    const { session, storage, writes } = pod("acp", {
      [`${root}.acr`]: acr(root, " ", ", <#publicPolicy>"),
    });
    expect(await ensurePrivateContainerAccess(session, folder, { created: true, storage })).toEqual(
      { private: true },
    );
    expect(writes).toEqual([`${folder}.acr`]);
    expect(
      await ensurePrivateContainerAccess(session, folder, { created: false, storage }),
    ).toEqual({ private: true });
    expect(writes).toHaveLength(1);
  });
  it("refuses a non-owner grant inherited from an ACP ancestor even after provisioning", async () => {
    const { session, storage } = pod("acp", {
      [`${root}.acr`]: acr(root, ", <#bobPolicy>"),
    });
    expect(await ensurePrivateContainerAccess(session, folder, { created: true, storage })).toEqual(
      {
        private: false,
        reasons: [{ subject: "agent", modes: ["read"], reason: "non-owner" }],
      },
    );
  });
  it("never treats a missing ACP ACR on an adopted container as private", async () => {
    const { session, storage, writes } = pod("acp", { [`${root}.acr`]: acr(root, " ") });
    expect(
      await ensurePrivateContainerAccess(session, folder, { created: false, storage }),
    ).toMatchObject({ private: false });
    expect(writes).toEqual([]);
  });
  it("refuses when provisioning a created container fails", async () => {
    const { session, storage, refuse } = pod("wac", {
      [`${root}.acl`]: wac(root, `acl:agent <${owner}>`, ownerAll),
    });
    refuse();
    expect(await ensurePrivateContainerAccess(session, folder, { created: true, storage })).toEqual(
      { private: false, reasons: [{ subject: "unknown", modes: [], reason: "unknown" }] },
    );
  });
  it("passes a trusted ESS dialect to both the writer and the verifier", async () => {
    const ess = (target: string) => `<> a acp:AccessControlResource; acp:resource <${target}>;
        acp:accessControl <#c>; acp:memberAccessControl <#c>.
      <#c> acp:apply <#p>. <#p> acp:allow acp:Read, acp:Write; acp:allOf <#m>.
      <#m> acp:agent <${owner}>.`;
    const { session, storage, writes } = pod("acp", { [`${root}.acr`]: ess(root) });
    const result = await ensurePrivateContainerAccess(session, folder, {
      created: true,
      storage,
      acpDialect: "ess",
    });
    expect(writes).toEqual([`${folder}.acr`]);
    expect(result).toEqual({ private: true });
  });
});
