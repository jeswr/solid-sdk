// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/noNonNullAssertion: Explicit fixtures and cardinality assertions establish these entries.
import { parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessSummary } from "../src/apps/home/components/item/data";
import {
  applyRevoke,
  dpvPurposeLabel,
  loadPermissions,
  planRevoke,
  readGrantRecords,
  resolveClientName,
} from "../src/apps/home/lib/permissions";
import {
  CLIENT_RETRY_MS,
  CLIENT_TIMEOUT_MS,
  isClientIdDocument,
} from "../src/apps/home/lib/permissions/client";
import { mergeRecord, recordForGrant, recordsFrom } from "../src/apps/home/lib/permissions/records";
import { UnsupportedAccessError } from "../src/apps/home/lib/permissions/vocab";
import { accessSystem, aclLink, acpHeaders } from "../src/apps/home/lib/permissions/walk";

const ROOT = "https://pod.test/alice/";
const OWNER = `${ROOT}profile#me`;
const BOB = "https://bob.test/profile#me";
const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP = "http://www.w3.org/ns/solid/acp#";
const DPV = "https://w3id.org/dpv#";
const ACCM = NS.ACCESS_MANAGER;
const PREFIX = `@prefix acl: <${ACL}>. @prefix acp: <${ACP}>. @prefix ldp: <http://www.w3.org/ns/ldp#>. @prefix accm: <${ACCM}>. @prefix dpv: <${DPV}>. @prefix dct: <http://purl.org/dc/terms/>. @prefix odrl: <http://www.w3.org/ns/odrl/2/>. @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.`;
function acl(resource = ROOT, extra = "") {
  return `${PREFIX} <#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${resource}>; acl:default <${resource}>; acl:mode acl:Control, acl:Read, acl:Write. ${extra}`;
}
function listing(url: string, members: string[] = []) {
  return `${PREFIX} <${url}> a ldp:BasicContainer. ${members.map((member) => `<${url}> ldp:contains <${member}>. <${member}> a ${member.endsWith("/") ? "ldp:BasicContainer" : "ldp:Resource"}.`).join(" ")}`;
}
interface Doc {
  body?: string;
  status?: number;
  type?: string;
  headers?: Record<string, string>;
}
function fixture(entries: Record<string, Doc> = {}) {
  const docs = new Map<string, Doc>(
    Object.entries({
      [ROOT]: { body: listing(ROOT) },
      [`${ROOT}.acl`]: { body: acl() },
      ...entries,
    }),
  );
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    expect(init?.redirect).toBe("error");
    const url = String(input);
    expect(url.startsWith(ROOT)).toBe(true);
    const doc = docs.get(url);
    if (init?.method === "PUT") {
      expect(doc).toBeDefined();
      expect(new Headers(init.headers).get("if-match")).toBe('"1"');
      docs.set(url, { ...doc, body: String(init.body) });
      return new Response(null, { status: 205 });
    }
    return new Response(init?.method === "HEAD" ? null : (doc?.body ?? ""), {
      status: doc?.status ?? (doc ? 200 : 404),
      headers: {
        "content-type": doc?.type ?? "text/turtle",
        etag: '"1"',
        link: `<${url}.acl>; rel="acl"`,
        ...doc?.headers,
      },
    });
  });
  return {
    docs,
    fetch,
    load: (options: Partial<Parameters<typeof loadPermissions>[0]> = {}) =>
      loadPermissions({ fetch, storage: ROOT, webId: OWNER, ...options }),
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("bounded Home permission discovery", () => {
  it("resolves a detail resource at its nearest ACL without ancestor public bleed", async () => {
    const folder = `${ROOT}contacts/`;
    const secret = `${folder}secret.ttl`;
    const pod = fixture({
      [secret]: { body: '<#it> <https://schema.org/name> "Secret".' },
      [folder]: { body: listing(folder, [secret]) },
      [`${folder}.acl`]: {
        body: acl(
          folder,
          `<#public> a acl:Authorization; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:default <${folder}>; acl:mode acl:Read.`,
        ),
      },
      [`${secret}.acl`]: {
        body: `${PREFIX} <#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${secret}>; acl:mode acl:Read, acl:Write, acl:Control.`,
      },
    });
    let snapshot = await pod.load({ resource: secret });
    expect(snapshot.failures).toEqual([]);
    expect(accessSummary(snapshot.rows, secret, OWNER).text).toBe("Only you");
    expect(pod.fetch.mock.calls.some(([url]) => String(url) === `${folder}.acl`)).toBe(false);
    pod.docs.delete(`${secret}.acl`);
    snapshot = await pod.load({ resource: secret });
    expect(accessSummary(snapshot.rows, secret, OWNER).text).toBe("Anyone with the link");
    const container = await pod.load({ resource: folder });
    expect(container.truncated).toBe(false);
    expect(container.rows).toHaveLength(1);
  });
  it("walks default grants, classifies registered folders, compacts children and caches ACL documents", async () => {
    const folder = `${ROOT}docs/`;
    const file = `${folder}a`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT, [folder, `${ROOT}.acl`, `${ROOT}ignored.acr`]) },
      [folder]: { body: listing(folder, [file]) },
      [file]: { body: "binary", type: "application/octet-stream" },
      [`${ROOT}.acl`]: {
        body: acl(
          ROOT,
          `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:default <${ROOT}>; acl:mode acl:Read.`,
        ),
      },
    });
    const snapshot = await pod.load({
      typeIndex: [{ forClass: `${NS.POD_DOCS}Document`, container: folder }],
    });
    expect(snapshot.failures).toEqual([]);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.summary).toEqual({ apps: 0, people: 1, publicItems: 0 });
    const resources = snapshot.rows[0]!.lines.flatMap((l) => l.resources);
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      url: ROOT,
      inherited: true,
      inheritedFrom: ROOT,
      scope: "members",
    });
    expect(pod.fetch.mock.calls.filter(([url]) => String(url) === `${ROOT}.acl`)).toHaveLength(1);
    expect(pod.fetch.mock.calls.some(([url]) => String(url).includes("ignored.acr"))).toBe(false);
  });
  it("loads, plans and revokes one blank-node default authorization inherited by a folder and file", async () => {
    const folder = `${ROOT}docs/`;
    const file = `${folder}book`;
    const endpoint = `${ROOT}.acl`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT, [folder]) },
      [folder]: { body: listing(folder, [file]) },
      [file]: { type: "application/octet-stream" },
      [endpoint]: {
        body: acl(
          ROOT,
          `[] a acl:Authorization; acl:agent <${BOB}>; acl:default <${ROOT}>; acl:mode acl:Read.`,
        ),
      },
    });
    // Distinct classifications keep all three holdings visible before planning.
    const typeIndex = [
      { forClass: `${NS.SCHEMA}Photograph`, container: ROOT },
      { forClass: `${NS.SCHEMA}TextDigitalDocument`, container: folder },
      { forClass: `${NS.SCHEMA}Book`, instance: file },
    ];
    const state = await pod.load({ typeIndex });
    expect(state.failures).toEqual([]);
    const resources = state.rows[0]!.lines.flatMap((line) => line.resources);
    expect(resources.map((resource) => resource.url)).toEqual([ROOT, folder, file]);
    expect(new Set(resources.map((resource) => resource.node)).size).toBe(1);
    const plan = planRevoke(state, "all");
    expect(plan.changes).toEqual([
      expect.objectContaining({ source: endpoint, resource: ROOT, scope: "members" }),
    ]);
    expect(pod.fetch.mock.calls.filter(([url]) => String(url) === endpoint)).toHaveLength(1);
    const { undo } = await applyRevoke(plan, { fetch: pod.fetch, storage: ROOT, webId: OWNER });
    expect(pod.fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect((await pod.load({ typeIndex })).rows).toEqual([]);
    await applyRevoke(undo, { fetch: pod.fetch, storage: ROOT, webId: OWNER });
    expect(planRevoke(await pod.load({ typeIndex }), "all").changes).toHaveLength(1);
  });
  it("loads and revokes NSS defaultForNew grants using the dialect retained in the plan", async () => {
    const folder = `${ROOT}docs/`;
    const endpoint = `${ROOT}.acl`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT, [folder]) },
      [folder]: { body: listing(folder) },
      [endpoint]: {
        body: acl(
          ROOT,
          `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:defaultForNew <${ROOT}>; acl:mode acl:Read.`,
        ).replace("acl:default ", "acl:defaultForNew "),
      },
    });
    for (const implementation of [undefined, "css", "ess"] as const) {
      const unsupported = await pod.load(implementation ? { implementation } : {});
      expect(unsupported.rows).toEqual([]);
      expect(unsupported.failures).toContainEqual({ url: endpoint, reason: "unsupported" });
    }
    const state = await pod.load({ implementation: "nss" });
    expect(state.failures).toEqual([]);
    expect(state.summary.people).toBe(1);
    expect(state.rows[0]!.lines[0]!.resources).toEqual([
      expect.objectContaining({
        url: ROOT,
        inherited: true,
        inheritedFrom: ROOT,
        implementation: "nss",
      }),
    ]);
    const plan = planRevoke(state, "all");
    expect(plan.changes).toEqual([
      expect.objectContaining({ source: endpoint, scope: "members", implementation: "nss" }),
    ]);
    const { undo } = await applyRevoke(plan, { fetch: pod.fetch, storage: ROOT, webId: OWNER });
    expect((await pod.load({ implementation: "nss" })).rows).toEqual([]);
    await applyRevoke(undo, { fetch: pod.fetch, storage: ROOT, webId: OWNER });
    expect((await pod.load({ implementation: "nss" })).summary.people).toBe(1);
  });
  it("uses each node's registered type, primary RDF type, or first known child class", async () => {
    const folder = `${ROOT}notes/`;
    const file = `${folder}one`;
    const extra = `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${folder}>; acl:mode acl:Read.`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT, [folder]) },
      [folder]: { body: listing(folder, [file]) },
      [`${folder}.acl`]: { body: acl(folder, extra) },
      [file]: { body: `<${file}#it> a <${NS.SCHEMA}TextDigitalDocument>.` },
    });
    const snapshot = await pod.load();
    expect(snapshot.rows[0]!.lines[0]).toMatchObject({
      dataType: { id: "notes", label: "Notes" },
      domainId: "documents",
      inherited: false,
    });
    pod.docs.set(folder, { body: `${listing(folder, [file])} <${file}> a <${NS.SCHEMA}Book>.` });
    expect((await pod.load()).rows[0]!.lines[0]!.dataType?.id).toBe("books");
    expect(
      (await pod.load({ typeIndex: [{ forClass: `${NS.SCHEMA}Photograph`, instance: folder }] }))
        .rows[0]!.lines[0]!.dataType?.id,
    ).toBe("photos");
    expect((await pod.load({ typeIndex: [{ forClass: "urn:unknown" }] })).failures).toEqual([]);
  });
  it("keeps Notes and Photos under one root default grant with root revocation targets", async () => {
    const notes = `${ROOT}notes/`;
    const photos = `${ROOT}photos/`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT, [notes, photos]) },
      [notes]: { body: listing(notes) },
      [photos]: { body: listing(photos) },
      [`${ROOT}.acl`]: {
        body: acl(
          ROOT,
          `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:default <${ROOT}>; acl:mode acl:Read.`,
        ),
      },
    });
    const snapshot = await pod.load({
      typeIndex: [
        { forClass: `${NS.SCHEMA}TextDigitalDocument`, container: notes },
        { forClass: `${NS.SCHEMA}Photograph`, container: photos },
      ],
    });
    expect(snapshot.failures).toEqual([]);
    expect(snapshot.rows[0]!.lines.map((line) => line.dataType?.label).sort()).toEqual([
      "Notes",
      "Photos",
    ]);
    for (const line of snapshot.rows[0]!.lines)
      expect(planRevoke(line, "line").changes).toEqual([
        expect.objectContaining({ source: `${ROOT}.acl`, resource: ROOT, scope: "members" }),
      ]);
  });
  it("discovers and revokes readable ACLs even when the resource Turtle is corrupt", async () => {
    const file = `${ROOT}broken.ttl`;
    const endpoint = `${ROOT}broken-access`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT, [file]) },
      [file]: { body: "invalid turtle !!!", headers: { link: `<${endpoint}>; rel="acl"` } },
      [endpoint]: {
        body: acl(
          file,
          `<#public> a acl:Authorization; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:accessTo <${file}>; acl:mode acl:Read.`,
        ),
      },
    });
    const snapshot = await pod.load();
    expect(snapshot.failures).toEqual([{ url: file, reason: "unreadable" }]);
    expect(snapshot.summary.publicItems).toBe(1);
    expect(snapshot.rows[0]!.kind).toBe("public");
    const line = snapshot.rows[0]!.lines[0]!;
    expect(line.dataType).toBeUndefined();
    expect(line.domainId).toBe("other");
    const plan = planRevoke(line, "line");
    expect(plan.changes[0]).toMatchObject({ source: endpoint, resource: file });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT") {
        expect(String(input)).toBe(endpoint);
        expect(new Headers(init.headers).get("if-match")).toBe('"1"');
        pod.docs.set(endpoint, { body: String(init.body) });
        return new Response(null, { status: 205 });
      }
      return pod.fetch(input, init);
    };
    await applyRevoke(plan, { fetch, storage: ROOT, webId: OWNER });
    expect((await pod.load()).rows).toEqual([]);
    // Known registrations survive content failures too.
    pod.docs.set(endpoint, {
      body: acl(
        file,
        `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${file}>; acl:mode acl:Read.`,
      ),
    });
    expect(
      (await pod.load({ typeIndex: [{ forClass: `${NS.SCHEMA}Photograph`, instance: file }] }))
        .rows[0]!.lines[0]!.dataType?.id,
    ).toBe("photos");
  });
  it("pins pseudo agents and recognizes an origin-only app rule", async () => {
    const pod = fixture({
      [`${ROOT}.acl`]: {
        body: acl(
          ROOT,
          `
      <#public> a acl:Authorization; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:accessTo <${ROOT}>; acl:mode acl:Read.
      <#signed> a acl:Authorization; acl:agentClass acl:AuthenticatedAgent; acl:accessTo <${ROOT}>; acl:mode acl:Append.
      <#app> a acl:Authorization; acl:origin <https://app.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
        ),
      },
    });
    const snapshot = await pod.load();
    expect(snapshot.rows.map((r) => r.kind)).toEqual(["public", "authenticated", "app"]);
    expect(snapshot.summary).toEqual({ apps: 1, people: 0, publicItems: 1 });
  });
  it("counts CSS public Read with acl:origin as public exposure and warns for unknown enforcement", async () => {
    const pod = fixture({
      [`${ROOT}.acl`]: {
        body: acl(
          ROOT,
          `<#public> a acl:Authorization; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:origin <https://app.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
        ),
      },
    });
    const css = await pod.load({ implementation: "css" });
    expect(css.summary.publicItems).toBe(1);
    expect(css.failures).toEqual([]);
    expect(css.warnings).toEqual([]);
    expect(css.rows.find((row) => row.kind === "public")!.lines[0]).toMatchObject({
      conditions: [{ kind: "origin", origin: "https://app.test" }],
      conditionEnforcement: "ignored",
    });
    const unknown = await pod.load();
    expect(unknown.summary.publicItems).toBe(1);
    expect(unknown.rows[0]!.lines[0]!.conditionEnforcement).toBe("unknown");
    expect(unknown.warnings).toEqual([
      {
        url: ROOT,
        reason: "condition-enforcement-unknown",
        conditions: [{ kind: "origin", origin: "https://app.test" }],
      },
    ]);
  });
  it("retains public exposure and metadata for ACP client and issuer conditions", async () => {
    const endpoint = `${ROOT}policy.acr`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT), headers: { link: `<${endpoint}>; rel="acl"` } },
      [endpoint]: {
        body: `${PREFIX} <> a acp:AccessControlResource; acp:resource <${ROOT}>; acp:accessControl <#access>. <#access> acp:apply <#policy>. <#policy> acp:allow acl:Read; acp:anyOf <#match>. <#match> acp:agent acp:PublicAgent; acp:client <https://app.test/client.json>; acp:issuer <https://issuer.test/>.`,
      },
    });
    const state = await pod.load();
    expect(state.failures).toEqual([]);
    expect(state.summary.publicItems).toBe(1);
    const conditions = [
      { kind: "client", clientId: "https://app.test/client.json" },
      { kind: "issuer", issuer: "https://issuer.test/" },
    ];
    expect(state.rows[0]).toMatchObject({
      kind: "public",
      lines: [{ conditions, conditionEnforcement: "unknown" }],
    });
    expect(state.warnings).toEqual([
      { url: ROOT, reason: "condition-enforcement-unknown", conditions },
    ]);
  });
  it.each([
    "linked",
    "fallback",
    "network",
  ])("discovers and revokes Control-only ACLs after a failed resource HEAD (%s)", async (discovery) => {
    const file = `${ROOT}private`;
    const endpoint = discovery === "linked" ? `${ROOT}private-policy` : `${file}.acl`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT, [file]) },
      [file]: {
        status: 403,
        headers: { link: discovery === "linked" ? `<${endpoint}>; rel="acl"` : "" },
      },
      [endpoint]: {
        body: `${PREFIX} <#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${file}>; acl:mode acl:Control. <#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${file}>; acl:mode acl:Read.`,
      },
    });
    const transport = pod.fetch.getMockImplementation()!;
    pod.fetch.mockImplementation(async (input, init) => {
      if (String(input) === file && discovery === "network") throw new Error("offline");
      if (init?.method === "PUT") {
        expect(String(input)).toBe(endpoint);
        pod.docs.set(endpoint, { body: String(init.body) });
        return new Response(null, { status: 205 });
      }
      return transport(input, init);
    });
    const state = await pod.load();
    expect(state.failures).toEqual([
      { url: file, reason: discovery === "network" ? "unreadable" : "forbidden" },
    ]);
    expect(state.summary.people).toBe(1);
    expect(pod.fetch.mock.calls.filter(([url]) => String(url) === file)).toHaveLength(1);
    const plan = planRevoke(state.rows[0]!.lines[0]!, "line");
    expect(plan.changes[0]).toMatchObject({ source: endpoint, resource: file });
    await applyRevoke(plan, { fetch: pod.fetch, storage: ROOT, webId: OWNER });
    expect((await pod.load()).rows).toEqual([]);
  });
  it("skips malformed listing members independently before discovering valid children", async () => {
    const file = `${ROOT}shared`;
    const pod = fixture({
      [ROOT]: {
        body: `${listing(ROOT)} <${ROOT}> ldp:contains "bad", _:bad, <urn:bad>, <https://evil.test/item>, <${ROOT}%2Fescape>, <${file}>.`,
      },
      [file]: { type: "application/octet-stream" },
      [`${file}.acl`]: {
        body: acl(
          file,
          `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${file}>; acl:mode acl:Read.`,
        ),
      },
    });
    const state = await pod.load();
    expect(state.summary.people).toBe(1);
    expect(state.rows[0]!.lines[0]!.resources[0]!.url).toBe(file);
    expect(state.failures).toContainEqual({ url: "bad", reason: "unreadable" });
    expect(pod.fetch.mock.calls.every(([url]) => String(url).startsWith(ROOT))).toBe(true);
  });
  it.each([
    401, 403, 404, 500,
  ])("reports an ACL %i without treating forbidden ACLs as missing", async (status) => {
    const pod = fixture({ [`${ROOT}.acl`]: { status } });
    const snapshot = await pod.load();
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.failures).toEqual([
      {
        url: `${ROOT}.acl`,
        reason:
          status === 401 || status === 403
            ? "forbidden"
            : status === 404
              ? "not-found"
              : "unreadable",
      },
    ]);
  });
  it("reports each failing item once even when several children reach the same document", async () => {
    const children = ["a", "b", "c"].map((name) => `${ROOT}${name}`);
    const pod = fixture({
      [ROOT]: { body: listing(ROOT, children) },
      [`${ROOT}.acl`]: { status: 500 },
      ...Object.fromEntries(
        children.map((child) => [child, { body: "binary", type: "application/octet-stream" }]),
      ),
    });
    const { failures } = await pod.load();
    expect(failures.length).toBeGreaterThan(0);
    expect(new Set(failures.map((failure) => failure.url)).size).toBe(failures.length);
  });
  it("reports resource failures, network/parse errors and unsupported WAC selectors", async () => {
    expect((await fixture({ [ROOT]: { status: 404 } }).load()).failures).toContainEqual({
      url: ROOT,
      reason: "not-found",
    });
    expect(
      (await fixture({ [ROOT]: { body: "invalid turtle !!!" } }).load()).failures,
    ).toContainEqual({ url: ROOT, reason: "unreadable" });
    const group = fixture({
      [`${ROOT}.acl`]: {
        body: acl(
          ROOT,
          `<#group> a acl:Authorization; acl:agentGroup <urn:group>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
        ),
      },
    });
    expect((await group.load()).failures).toEqual([{ url: ROOT, reason: "unsupported" }]);
    expect((await group.load()).rows).toEqual([]);
    group.docs.set(`${ROOT}.acl`, {
      body: acl(
        ROOT,
        `<#weird> a acl:Authorization; acl:agentClass <urn:class>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
      ),
    });
    expect((await group.load()).failures[0]!.reason).toBe("unsupported");
    group.docs.set(`${ROOT}.acl`, {
      body: acl(
        ROOT,
        `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; acl:unknownCondition <urn:condition>.`,
      ),
    });
    expect((await group.load()).failures[0]!.reason).toBe("unsupported");
    const broken = fixture();
    broken.fetch.mockRejectedValueOnce(new Error("offline"));
    expect((await broken.load()).failures).toContainEqual({ url: ROOT, reason: "unreadable" });
  });
  it("honors depth 4 by default, request budgets, empty listings and cancellation", async () => {
    const pod = fixture();
    let url = ROOT;
    for (let i = 0; i < 6; i++) {
      const child = `${url}child/`;
      pod.docs.set(url, { body: listing(url, [child]) });
      url = child;
    }
    const snapshot = await pod.load();
    expect(snapshot.truncated).toBe(true);
    expect(
      pod.fetch.mock.calls.some(([url]) => String(url) === `${ROOT}child/child/child/child/child/`),
    ).toBe(false);
    for (const maxRequests of [0, 1, 2, 3, 4, 5]) {
      pod.fetch.mockClear();
      const result = await pod.load({ maxRequests });
      expect(result.truncated).toBe(true);
      expect(pod.fetch).toHaveBeenCalledTimes(maxRequests);
      expect(result.failures).toEqual([]);
    }
    expect((await pod.load({ maxDepth: 0 })).truncated).toBe(true);
    expect((await fixture().load({ maxDepth: 0 })).truncated).toBe(false);
    for (const options of [
      { maxDepth: -1 },
      { maxDepth: 1.5 },
      { maxRequests: -1 },
      { maxRequests: NaN },
    ])
      await expect(pod.load(options)).rejects.toThrow(TypeError);
    await expect(pod.load({ storage: ROOT.slice(0, -1) })).rejects.toThrow();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(pod.load({ signal: controller.signal })).rejects.toThrow("cancelled");
    const active = new AbortController();
    pod.fetch.mockImplementationOnce(async () => {
      active.abort(new Error("during fetch"));
      throw active.signal.reason;
    });
    await expect(pod.load({ signal: active.signal })).rejects.toThrow("during fetch");
  });
  it("never forwards authenticated fetch to a foreign listing, ACL endpoint or redirect", async () => {
    const pod = fixture({ [ROOT]: { body: listing(ROOT, ["https://evil.test/item"]) } });
    expect((await pod.load()).failures).toContainEqual({
      url: "https://evil.test/item",
      reason: "unreadable",
    });
    pod.docs.set(ROOT, {
      body: listing(ROOT),
      headers: { link: '<https://evil.test/rules>; rel="acl"' },
    });
    expect((await pod.load()).failures).toContainEqual({
      url: "https://evil.test/rules",
      reason: "unreadable",
    });
    pod.docs.set(ROOT, { status: 302, headers: { location: "https://evil.test/" } });
    expect((await pod.load()).failures[0]!.reason).toBe("unreadable");
    expect(pod.fetch.mock.calls.every(([url]) => String(url).startsWith(ROOT))).toBe(true);
  });
  it("detects ACP, reads conservative neutral grants, and refuses ambiguous access models", async () => {
    const body = `${PREFIX} <> a acp:AccessControlResource; acp:resource <${ROOT}>; acp:accessControl <#access>. <#access> acp:apply <#policy>. <#policy> acp:allow acl:Read; acp:anyOf <#match>. <#match> acp:agent <${BOB}>.`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT), headers: { link: '<policy.acr>; rel="acl"' } },
      [`${ROOT}policy.acr`]: { body },
    });
    const snapshot = await pod.load();
    expect(snapshot.failures).toEqual([]);
    expect(snapshot.rows[0]!.lines[0]!.resources[0]!.system).toBe("acp");
    const dataset = await parseRdf(acl(), "text/turtle", { baseIRI: ROOT });
    expect(() => accessSystem(dataset, `${ROOT}.acr`, new Headers())).toThrow(
      UnsupportedAccessError,
    );
    expect(() => accessSystem(dataset, ROOT, new Headers({ "acp-policy": "yes" }))).toThrow(
      UnsupportedAccessError,
    );
    expect(() => accessSystem(awaitedEmpty, ROOT, new Headers())).toThrow(UnsupportedAccessError);
    expect(acpHeaders(new Headers({ link: `<${ACP}AccessControlResource>; rel="type"` }))).toBe(
      true,
    );
    pod.docs.set(ROOT, {
      body: listing(ROOT, [`${ROOT}sub/`]),
      headers: { link: '<policy.acr>; rel="acl"' },
    });
    pod.docs.set(`${ROOT}sub/`, { body: listing(`${ROOT}sub/`) });
    expect((await pod.load()).failures).toContainEqual({
      url: `${ROOT}policy.acr`,
      reason: "unsupported",
    });
  });
  it("reads ESS ACP modes and a typed ACR without acp:resource only with an established ESS dialect", async () => {
    const endpoint = `${ROOT}policy.acr`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT), headers: { link: `<${endpoint}>; rel="acl"` } },
      [endpoint]: {
        body: `${PREFIX} <> a acp:AccessControlResource; acp:accessControl <#access>. <#access> acp:apply <#policy>. <#policy> acp:allow acp:Read; acp:anyOf <#match>. <#match> acp:agent <${BOB}>.`,
      },
    });
    for (const implementation of [undefined, "css", "nss"] as const) {
      const unsupported = await pod.load(implementation ? { implementation } : {});
      expect(unsupported.rows).toEqual([]);
      expect(unsupported.failures).toEqual([{ url: endpoint, reason: "unsupported" }]);
    }
    const state = await pod.load({ implementation: "ess" });
    expect(state.failures).toEqual([]);
    expect(state.warnings).toEqual([]);
    expect(state.summary.people).toBe(1);
    expect(state.rows[0]).toMatchObject({
      kind: "person",
      id: BOB,
      lines: [{ modes: ["read"], resources: [{ source: endpoint, system: "acp" }] }],
    });
    // Reading ESS permissions does not make ACP mutation supported.
    await expect(
      applyRevoke(planRevoke(state, "all"), { fetch: pod.fetch, storage: ROOT, webId: OWNER }),
    ).rejects.toThrow(UnsupportedAccessError);
    expect(pod.fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
  it("parses multiple rel tokens and ignores unrelated Link relations", () => {
    expect(
      aclLink(
        new Headers({
          link: '<other>; rel="type", <.rules>; type="text/turtle"; rel="acl alternate"',
        }),
        ROOT,
      ),
    ).toBe(`${ROOT}.rules`);
    expect(aclLink(new Headers({ link: "<acl>; rel=acl" }), ROOT)).toBe(`${ROOT}acl`);
    expect(aclLink(new Headers({ link: '<other>; rel="type"' }), ROOT)).toBeUndefined();
    expect(aclLink(new Headers(), ROOT)).toBeUndefined();
    expect(aclLink(new Headers({ link: '<other>; type="text/turtle"' }), ROOT)).toBeUndefined();
  });
  it("reports inactive ACP credential matchers and ACP hints without a discoverable endpoint", async () => {
    const body = `${PREFIX} <> a acp:AccessControlResource; acp:resource <${ROOT}>; acp:accessControl <#access>. <#access> acp:apply <#policy>. <#policy> acp:allow acl:Read; acp:anyOf <#match>. <#match> acp:vc <urn:credential>.`;
    const pod = fixture({
      [ROOT]: { body: listing(ROOT), headers: { link: '<policy.acr>; rel="acl"' } },
      [`${ROOT}policy.acr`]: { body },
    });
    expect((await pod.load()).failures).toEqual([{ url: ROOT, reason: "unsupported" }]);
    expect((await pod.load()).rows).toEqual([]);
    pod.docs.set(ROOT, { body: listing(ROOT), headers: { link: "", "acp-policy": "enabled" } });
    expect((await pod.load()).failures[0]!.reason).toBe("unsupported");
    expect(dpvPurposeLabel(`${DPV}toString`)).toBeUndefined();
  });
  it("handles repeated members, suffix ACL discovery and an unreadable unlisted parent", async () => {
    const pod = fixture({ [ROOT]: { body: listing(ROOT, [ROOT]), headers: { link: "" } } });
    expect((await pod.load()).failures).toEqual([]);
    const file = `${ROOT}unlisted/leaf`;
    pod.docs.set(ROOT, { body: listing(ROOT, [file]) });
    pod.docs.set(file, { type: "application/octet-stream" });
    expect((await pod.load()).failures).toContainEqual({
      url: `${ROOT}unlisted/`,
      reason: "not-found",
    });
  });
});
// An empty graph is deliberately not presumed to use WAC.
const awaitedEmpty = await parseRdf("", "text/turtle");

describe("grant records and purpose labels", () => {
  it("reads approval snapshots with nested ODRL permissions and joins an unlinked ACL by its exact grant", async () => {
    const records = `${ROOT}settings/access-records/`;
    const grant = `${records}grant.ttl`;
    const receipt = `${records}receipt.ttl`;
    const body = `${PREFIX} <> a odrl:Agreement; accm:agent <${BOB}>; accm:resolvesTo <${ROOT}>; accm:mode acl:Read; dct:created "2025-01-01";
      odrl:permission [ odrl:assignee <${BOB}>; odrl:target <${ROOT}>; odrl:constraint
        [ odrl:leftOperand odrl:purpose; odrl:operator odrl:eq; odrl:rightOperand "Build your training plan" ],
        [ odrl:leftOperand odrl:dateTime; odrl:operator odrl:lteq; odrl:rightOperand "2030-01-01" ] ].`;
    const pod = fixture({
      [records]: { body: listing(records, [grant]) },
      [grant]: { body },
      [`${ROOT}.acl`]: {
        body: acl(
          ROOT,
          `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
        ),
      },
    });
    const snapshot = await pod.load();
    expect(snapshot.rows[0]!.since).toBe("2025-01-01T00:00:00.000Z");
    expect(snapshot.rows[0]!.lines[0]).toMatchObject({
      expiresAt: "2030-01-01T00:00:00.000Z",
      purpose: { label: "Build your training plan" },
    });
    pod.docs.set(records, { body: listing(records, [grant, receipt]) });
    pod.docs.set(receipt, {
      body: `${PREFIX} <> a dpv:ConsentRecord; accm:grantRef <${grant}>; dpv:hasRecipient <${BOB}>; dpv:hasPurpose dpv:ServicePersonalisation.`,
    });
    expect((await pod.load()).rows[0]!.lines[0]!.purpose).toEqual({
      iri: `${DPV}ServicePersonalisation`,
      label: "Personalise the service",
    });
    const second = `${records}another.ttl`;
    pod.docs.set(records, { body: listing(records, [grant, receipt, second]) });
    pod.docs.set(second, { body });
    expect((await pod.load()).rows[0]!.since).toBeUndefined();
    expect((await pod.load()).rows[0]!.lines[0]!.purpose).toBeUndefined();
  });
  it("does not guess attribution across agents, targets, modes or ambiguous grant refs", () => {
    const valid = {
      agents: [BOB],
      targets: [ROOT],
      modes: ["read"] as const,
      grantRefs: ["urn:grant"],
    };
    const record = { ...valid, modes: [...valid.modes] };
    expect(
      recordForGrant(
        new Map([
          ["urn:g", record],
          ["urn:receipt", record],
        ]),
        "auth",
        BOB,
        ROOT,
        new Set(["read"]),
      ),
    ).toBe(record);
    for (const bad of [
      {},
      { agents: [] },
      { ...record, agents: ["urn:other"] },
      { ...record, agents: [BOB, OWNER] },
      { ...record, grantRefs: [] },
      { ...record, grantRefs: ["urn:g1", "urn:g2"] },
      { ...record, grantRefs: undefined },
      { ...record, targets: [] },
      { ...record, targets: undefined },
      { ...record, modes: [] },
      { ...record, modes: undefined },
      { ...record, modes: ["control" as const] },
    ]) {
      // Simulate loosely parsed foreign records, including explicitly missing fields.
      const index = new Map([["urn:g", bad]]) as Parameters<typeof recordForGrant>[0];
      expect(recordForGrant(index, "auth", BOB, ROOT, new Set(["read"]))).toEqual({});
    }
    expect(
      mergeRecord(
        { purpose: { label: "Receipt" }, purposeSource: "receipt" },
        { purpose: { label: "Grant" } },
      ).purpose?.label,
    ).toBe("Receipt");
    expect(mergeRecord({ modes: ["write"] }, {}).modes).toEqual(["write", "append"]);
  });
  it("joins DPV receipts and records by grant ref, including ACL-local references", async () => {
    const records = `${ROOT}settings/access-records/`;
    const grant = `${records}grant.ttl`;
    const receipt = `${records}receipt.ttl`;
    const pod = fixture({
      [records]: {
        body: listing(records, [grant, receipt, `${records}.acl`, `${records}nested/`]),
      },
      [grant]: {
        body: `${PREFIX} <> dct:created "2025-01-01"; dct:modified "2025-02-01"; accm:expiresAt "2030-01-01".`,
      },
      [receipt]: {
        body: `${PREFIX} <> accm:grantRef <${grant}>; dpv:hasPurpose dpv:ServicePersonalisation; dct:created "2025-01-02".`,
      },
      [`${ROOT}.acl`]: {
        body: acl(
          ROOT,
          `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; accm:grantRef <${grant}>.`,
        ),
      },
    });
    const index = await readGrantRecords(pod.fetch, ROOT);
    expect(index.get(grant)).toMatchObject({
      created: "2025-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
      purpose: { iri: `${DPV}ServicePersonalisation`, label: "Personalise the service" },
    });
    const snapshot = await pod.load();
    expect(snapshot.rows[0]!.since).toBe("2025-01-01T00:00:00.000Z");
    expect(snapshot.rows[0]!.lines[0]!.purpose?.label).toBe("Personalise the service");
    expect(snapshot.rows[0]!.lines[0]!.expiresAt).toBe("2030-01-01T00:00:00.000Z");
  });
  it("reads literal/labelled purposes and ODRL constraints, skipping malformed dates and unknown purpose IRIs", async () => {
    const dataset = await parseRdf(
      `${PREFIX}
      <urn:a> odrl:purpose "Build your training plan"; dct:created "bad"; dct:modified "bad"; accm:expiry "2032-01-01"; odrl:endTime "2031-01-01"; odrl:dateTime "bad"; odrl:constraint <urn:c>, <urn:ignored>.
      <urn:c> odrl:leftOperand odrl:dateTime; odrl:operator odrl:lt; odrl:rightOperand "2030-01-01".
      <urn:ignored> odrl:leftOperand odrl:count; odrl:operator odrl:lt; odrl:rightOperand "2020-01-01".
      <urn:invalid> odrl:constraint <urn:equal>. <urn:equal> odrl:leftOperand odrl:dateTime; odrl:operator odrl:eq; odrl:rightOperand "2020-01-01".
      <urn:b> dpv:hasPurpose <urn:purpose>. <urn:purpose> rdfs:label "Read a diary".
      <urn:d> dpv:hasPurpose <urn:preferred>. <urn:preferred> <http://www.w3.org/2004/02/skos/core#prefLabel> "Plan a trip".
      <urn:e> dpv:hasPurpose <urn:unknown>.
    `,
      "text/turtle",
    );
    const index = recordsFrom(dataset);
    expect(index.get("urn:a")).toEqual({
      expiresAt: "2030-01-01T00:00:00.000Z",
      purpose: { label: "Build your training plan" },
    });
    expect(index.get("urn:b")?.purpose).toEqual({ iri: "urn:purpose", label: "Read a diary" });
    expect(index.get("urn:d")?.purpose?.label).toBe("Plan a trip");
    expect(index.get("urn:e")?.purpose).toBeUndefined();
    expect(index.get("urn:invalid")?.expiresAt).toBeUndefined();
    expect(dpvPurposeLabel(`${DPV}Personalisation`)).toBe("Personalise your experience");
    expect(dpvPurposeLabel(`${DPV}Unknown`)).toBeUndefined();
    expect(dpvPurposeLabel("urn:Personalisation")).toBeUndefined();
  });
  it("treats a missing records folder as empty, but reports unreadable records", async () => {
    const pod = fixture();
    expect((await readGrantRecords(pod.fetch, ROOT)).size).toBe(0);
    const url = `${ROOT}settings/access-records/`;
    pod.docs.set(url, { status: 403 });
    await expect(readGrantRecords(pod.fetch, ROOT)).rejects.toBeInstanceOf(RdfFetchError);
    expect((await pod.load()).failures).toContainEqual({ url, reason: "forbidden" });
    pod.docs.set(url, { body: listing(url, ["https://evil.test/record"]) });
    await expect(readGrantRecords(pod.fetch, ROOT)).rejects.toThrow();
    expect(pod.fetch.mock.calls.every(([url]) => String(url).startsWith(ROOT))).toBe(true);
  });
});
describe("public Client ID Document resolver", () => {
  it("uses global public fetch once per 24h, coalesces concurrent calls and never retrieves the logo", async () => {
    const publicFetch = vi.fn<typeof fetch>(async () =>
      Response.json({
        client_name: "Journal",
        client_uri: "https://journal.test/",
        logo_uri: "https://cdn.test/logo.png",
        policy_uri: "https://journal.test/privacy",
        tos_uri: "https://journal.test/terms",
      }),
    );
    const sessionFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", publicFetch);
    const clientId = "https://journal.test/client.json";
    const [first, concurrent] = await Promise.all([
      resolveClientName(clientId, undefined, 0),
      resolveClientName(clientId, undefined, 1),
    ]);
    expect(first).toEqual({
      name: "Journal",
      uri: "https://journal.test/",
      logoUri: "https://cdn.test/logo.png",
      policyUri: "https://journal.test/privacy",
      tosUri: "https://journal.test/terms",
    });
    expect(concurrent).toEqual(first);
    first.name = "Caller mutation";
    expect((await resolveClientName(clientId, undefined, 86_399_999)).name).toBe("Journal");
    expect(publicFetch).toHaveBeenCalledTimes(1);
    expect(publicFetch).toHaveBeenCalledWith(clientId, {
      headers: { accept: "application/ld+json, application/json" },
      credentials: "omit",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    await resolveClientName(clientId, undefined, 86_400_000);
    expect(publicFetch).toHaveBeenCalledTimes(2);
    expect(sessionFetch).not.toHaveBeenCalled();
    expect(publicFetch.mock.calls.every(([url]) => String(url) === clientId)).toBe(true);
  });
  it("accepts a JSON-LD Client ID Document", async () => {
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ client_name: "MaraCoach" }), {
          headers: { "content-type": "application/ld+json; charset=utf-8" },
        }),
    );
    expect(await resolveClientName("https://ld.test/id.jsonld", transport)).toEqual({
      name: "MaraCoach",
    });
  });
  it("validates strings/HTTPS and caches failures, including invalid JSON and non-JSON responses", async () => {
    const publicFetch = vi.fn<typeof fetch>(async () =>
      Response.json({
        client_name: 123,
        client_uri: "http://insecure.test",
        logo_uri: "javascript:alert(1)",
        policy_uri: "https://user:pass@test/",
        tos_uri: 3,
      }),
    );
    expect(await resolveClientName("https://bad-fields.test/id.json", publicFetch)).toEqual({});
    for (const id of ["http://bad.test/id", "data:application/json,{}", "not a url"])
      expect(await resolveClientName(id, publicFetch)).toEqual({});
    expect(publicFetch).toHaveBeenCalledTimes(1);
    const responses = [
      new Response("broken", { headers: { "content-type": "application/json" } }),
      Response.json(null),
      Response.json([]),
      Response.json(12),
      new Response("{}", { headers: { "content-type": "text/html" } }),
      new Response("", { status: 403 }),
      new Response(null),
      new Error("offline"),
    ];
    for (const [i, response] of responses.entries()) {
      const transport = vi.fn<typeof fetch>(async () => {
        if (response instanceof Error) throw response;
        return response;
      });
      const id = `https://invalid-${i}.test/client.json`;
      expect(await resolveClientName(id, transport)).toEqual({});
      expect(await resolveClientName(id, transport)).toEqual({});
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it("never fetches a bare origin, only Client ID Documents with a path", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ client_name: "Origin" }));
    for (const id of ["https://app.test", "https://app.test/", "https://app.test/?q=1"])
      expect(await resolveClientName(id, transport)).toEqual({});
    expect(transport).not.toHaveBeenCalled();
    expect(isClientIdDocument("https://app.test/id")).toBe(true);
    expect(isClientIdDocument("https://app.test/")).toBe(false);
  });
  it("refuses private, loopback and internal hosts before invoking any transport", async () => {
    const transport = vi.fn<typeof fetch>();
    for (const host of [
      "localhost",
      "sub.localhost.",
      "printer.local",
      "internal",
      "service.internal",
      "127.0.0.1",
      "2130706433",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "[::1]",
      "[fc00::1]",
      "[::ffff:127.0.0.1]",
    ]) {
      expect(await resolveClientName(`https://${host}/client-id.jsonld`, transport)).toEqual({});
    }
    expect(transport).not.toHaveBeenCalled();
    expect(isClientIdDocument("https://8.8.8.8/client.json")).toBe(true);
  });
  it("times out a hanging document and retries failures soon instead of caching them for a day", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const hanging = vi.fn<typeof fetch>((_input, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      });
      const id = "https://hanging.test/client.json";
      const pending = resolveClientName(id, hanging, 0);
      await vi.advanceTimersByTimeAsync(CLIENT_TIMEOUT_MS);
      expect(await pending).toEqual({});
      expect(signal?.aborted).toBe(true);
      expect(await resolveClientName(id, hanging, CLIENT_RETRY_MS - 1)).toEqual({});
      expect(hanging).toHaveBeenCalledTimes(1);
      const recovered = vi.fn<typeof fetch>(async () => Response.json({ client_name: "Back" }));
      expect((await resolveClientName(id, recovered, CLIENT_RETRY_MS)).name).toBe("Back");
      // A body that stalls after the headers is bounded by the same timeout.
      const stalled = vi.fn<typeof fetch>(
        async () =>
          ({
            ok: true,
            headers: new Headers({ "content-type": "application/json" }),
            json: () => new Promise(() => {}),
          }) as unknown as Response,
      );
      const slow = resolveClientName("https://stalled.test/id.json", stalled, 0);
      await vi.advanceTimersByTimeAsync(CLIENT_TIMEOUT_MS);
      expect(await slow).toEqual({});
      expect(
        (await resolveClientName("https://stalled.test/id.json", recovered, CLIENT_RETRY_MS)).name,
      ).toBe("Back");
    } finally {
      vi.useRealTimers();
    }
  });
});
