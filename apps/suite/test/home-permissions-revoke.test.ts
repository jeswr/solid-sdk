// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/noNonNullAssertion: Explicit fixtures and cardinality assertions establish these entries.
import { parseRdf } from "@jeswr/fetch-rdf";
import { readWac, type Subject } from "@jeswr/pod-access";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { describe, expect, it, vi } from "vitest";
import { serializeTurtle } from "../src/apps/home/lib/model/rdf";
import {
  AclConflictError,
  aggregateHoldings,
  applyRevoke,
  LockoutError,
  PartialRevokeError,
  planRevoke,
  type RevokeChange,
  type RevokePlan,
  UnsupportedAccessError,
} from "../src/apps/home/lib/permissions";
import { recordsFrom } from "../src/apps/home/lib/permissions/records";
import { readWacPolicy } from "../src/apps/home/lib/permissions/walk";

const ROOT = "https://pod.test/alice/";
const OWNER = `${ROOT}profile#me`;
const BOB = "https://bob.test/profile#me";
const CAROL = "https://carol.test/profile#me";
const DOC = `${ROOT}.acl`;
const ACL = "http://www.w3.org/ns/auth/acl#";
const PREFIX = `@prefix acl: <${ACL}>. @prefix foaf: <http://xmlns.com/foaf/0.1/>.`;
const ownerRule = `<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Control, acl:Read, acl:Write.`;
const bobRule = `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
const body = (extra = bobRule) => `${PREFIX} ${ownerRule} ${extra}`;
function change(options: Partial<RevokeChange> = {}): RevokeChange {
  return {
    source: DOC,
    system: "wac",
    node: `${DOC}#bob`,
    subject: { kind: "agent", webId: BOB },
    resource: ROOT,
    scope: "resource",
    modes: ["read"],
    ...options,
  };
}
function fixture(initial = body()) {
  const docs = new Map([[DOC, { body: initial, etag: '"1"' }]]);
  let conflicts = 0;
  let failure = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    expect(url.startsWith(ROOT)).toBe(true);
    expect(init?.redirect).toBe("error");
    const doc = docs.get(url);
    if (!doc) return new Response("", { status: 404 });
    if (init?.method === "PUT") {
      expect(new Headers(init.headers).get("if-match")).toBe(doc.etag);
      expect(new Headers(init.headers).get("content-type")).toBe("text/turtle");
      if (conflicts-- > 0) {
        doc.etag = `"${Number(doc.etag.slice(1, -1)) + 1}"`;
        return new Response(null, { status: 412 });
      }
      if (failure) return new Response(null, { status: failure });
      doc.body = String(init.body);
      doc.etag = `"${Number(doc.etag.slice(1, -1)) + 1}"`;
      return new Response(null, { status: 205, headers: { etag: doc.etag } });
    }
    return new Response(doc.body, { headers: { "content-type": "text/turtle", etag: doc.etag } });
  });
  return {
    docs,
    fetch,
    conflicts: (count: number) => {
      conflicts = count;
    },
    failure: (status: number) => {
      failure = status;
    },
    apply: (plan: RevokePlan) => applyRevoke(plan, { fetch, storage: ROOT, webId: OWNER }),
    graph: async (url = DOC) => parseRdf(docs.get(url)!.body, "text/turtle", { baseIRI: url }),
    puts: () => fetch.mock.calls.filter(([, init]) => init?.method === "PUT"),
  };
}
async function same(actual: Iterable<import("@rdfjs/types").Quad>, expected: string, url = DOC) {
  expect(
    isomorphic([...actual], [...(await parseRdf(expected, "text/turtle", { baseIRI: url }))]),
  ).toBe(true);
}
async function snapshot(initial: string) {
  const dataset = await parseRdf(initial, "text/turtle", { baseIRI: DOC });
  return {
    ...aggregateHoldings(
      [
        {
          url: ROOT,
          isContainer: true,
          system: "wac",
          inherited: false,
          policy: readWacPolicy(dataset, ROOT, DOC),
          dataset,
          records: recordsFrom(dataset),
        },
      ],
      { webId: OWNER, classify: () => undefined },
    ),
    failures: [],
    truncated: false,
  };
}
describe("pure revoke planning", () => {
  it("plans one line, all agent lines and both make-private pseudo agents, deduplicating scopes", async () => {
    const data =
      body(`${bobRule} <#public> a acl:Authorization; acl:accessTo <${ROOT}>; acl:agentClass foaf:Agent; acl:mode acl:Read.
      <#signed> a acl:Authorization; acl:accessTo <${ROOT}>; acl:agentClass acl:AuthenticatedAgent; acl:mode acl:Read.`);
    const state = await snapshot(data);
    const row = state.rows.find((r) => r.key === BOB)!;
    const line = row.lines[0]!;
    const plan = planRevoke(line, "line");
    expect(plan.changes).toEqual([expect.objectContaining(change())]);
    expect(planRevoke(row, "all")).toEqual(plan);
    expect(planRevoke({ ...row, lines: [line, line] }, "all")).toEqual(plan);
    expect(planRevoke(state, "make-private").changes.map((c) => c.subject.kind)).toEqual([
      "public",
      "authenticated",
    ]);
    expect(planRevoke(row, "make-private").changes).toEqual([]);
    const pod = fixture(data);
    const { undo } = await pod.apply(planRevoke(state, "make-private"));
    await same(await pod.graph(), body());
    await pod.apply(undo);
    await same(await pod.graph(), data);
  });
  it("targets inherited defaults on the parent instead of materializing child ACLs", async () => {
    const data = body(
      `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:default <${ROOT}>; acl:mode acl:Read.`,
    );
    const state = await snapshot(data);
    const line = state.rows[0]!.lines[0]!;
    expect(line.inherited).toBe(true);
    const plan = planRevoke(line, "line");
    expect(plan.changes[0]).toMatchObject({ source: DOC, resource: ROOT, scope: "members" });
    const pod = fixture(data);
    const { undo } = await pod.apply(plan);
    await same(await pod.graph(), body(""));
    await pod.apply(undo);
    await same(await pod.graph(), data);
  });
});
describe("WAC revocation and inverse plans", () => {
  it("removes a line with If-Match, retains owner control, and undo restores an isomorphic graph", async () => {
    const pod = fixture();
    const before = await pod.graph();
    const { undo } = await pod.apply({ changes: [change()] });
    await same(await pod.graph(), body(""));
    expect(pod.puts()).toHaveLength(1);
    expect(new Headers(pod.puts()[0]![1]!.headers).get("if-match")).toBe('"1"');
    const { undo: redo } = await pod.apply(undo);
    expect(isomorphic([...before], [...(await pod.graph())])).toBe(true);
    await pod.apply(redo);
    await same(await pod.graph(), body(""));
  });
  it("keeps unrelated principals and all foreign annotations on a shared authorization", async () => {
    const shared = `<#bob> a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; <urn:purpose> "shared".`;
    const pod = fixture(body(shared));
    const { undo } = await pod.apply({ changes: [change()] });
    await same(await pod.graph(), body(shared.replace(`<${BOB}>, `, "")));
    await pod.apply(undo);
    await same(await pod.graph(), body(shared));
  });
  it("splits resource/default and multiple-resource scopes without changing other principals", async () => {
    const other = `${ROOT}elsewhere`;
    const shared = `<#bob> a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>, <${other}>; acl:default <${ROOT}>; acl:mode acl:Read; <urn:purpose> "retain".`;
    const pod = fixture(body(shared));
    const { undo } = await pod.apply({ changes: [change()] });
    await same(
      await pod.graph(),
      body(`<#bob> a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${other}>; acl:default <${ROOT}>; acl:mode acl:Read; <urn:purpose> "retain".
      [] a acl:Authorization; acl:agent <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; <urn:purpose> "retain".`),
    );
    await pod.apply(undo);
    await same(await pod.graph(), body(shared));
    const state = await snapshot(body(shared));
    await pod.apply(planRevoke(state.rows.find((r) => r.id === BOB)!, "all"));
    // The other resource remains shared with Bob; both selected folder scopes lose him.
    const policy = readWac(await pod.graph(), ROOT, DOC);
    expect(
      policy.grants.some((g) =>
        g.who.some((clause) => clause.some((s) => s.kind === "agent" && s.webId === BOB)),
      ),
    ).toBe(false);
    expect(
      readWac(await pod.graph(), other, DOC).grants.some((g) =>
        g.who.some((clause) => clause.some((s) => s.kind === "agent" && s.webId === BOB)),
      ),
    ).toBe(true);
  });
  it("removes both pseudo agents from one split node without losing the retained default scope", async () => {
    const shared = `<#bob> a acl:Authorization; acl:agentClass foaf:Agent, acl:AuthenticatedAgent; acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Read.`;
    const pod = fixture(body(shared));
    await pod.apply({
      changes: [
        change({ subject: { kind: "public" } }),
        change({ subject: { kind: "authenticated" } }),
      ],
    });
    await same(
      await pod.graph(),
      body(
        `<#bob> a acl:Authorization; acl:agentClass foaf:Agent, acl:AuthenticatedAgent; acl:default <${ROOT}>; acl:mode acl:Read.`,
      ),
    );
  });
  it("does not broaden an origin-constrained grant when revoking an app", async () => {
    const shared = `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:origin <https://app.test>, <https://other.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const pod = fixture(body(shared));
    await pod.apply({
      changes: [change({ subject: { kind: "origin", origin: "https://app.test" } })],
    });
    await same(await pod.graph(), body(shared.replace("<https://app.test>, ", "")));
    await pod.apply({
      changes: [change({ subject: { kind: "origin", origin: "https://other.test" } })],
    });
    await same(await pod.graph(), body(""));
  });
  it("resolves an unambiguous blank authorization across parser-local node labels", async () => {
    const shared = `[] a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const pod = fixture(body(shared));
    const state = await snapshot(body(shared));
    const plan = planRevoke(state.rows[0]!, "all");
    const { undo } = await pod.apply(plan);
    await same(await pod.graph(), body(""));
    await pod.apply(undo);
    await same(await pod.graph(), body(shared));
    pod.docs.get(DOC)!.body = body(`${shared} ${shared}`);
    await expect(pod.apply(plan)).rejects.toBeInstanceOf(AclConflictError);
  });
  it("matches separate blank Read and Write rules for Bob and removes both in one conditional write", async () => {
    const rules = ["Read", "Write"]
      .map(
        (mode) =>
          `[] a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:${mode}.`,
      )
      .join(" ");
    const pod = fixture(body(rules));
    const state = await snapshot(body(rules));
    const plan = planRevoke(state.rows[0]!, "all");
    expect(plan.changes).toHaveLength(2);
    expect(plan.changes.map((entry) => entry.modes)).toEqual([["read"], ["append", "write"]]);
    const { undo } = await pod.apply(plan);
    expect(pod.puts()).toHaveLength(1);
    await same(await pod.graph(), body(""));
    await pod.apply(undo);
    await same(await pod.graph(), body(rules));
  });
  it("matches complete principal and origin conditions before mutating shared blank rules", async () => {
    const shared = `[] a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:origin <https://app.test>; acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Read.`;
    const other = `[] a acl:Authorization; acl:agent <${BOB}>; acl:origin <https://other.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const pod = fixture(body(`${shared} ${other}`));
    const state = await snapshot(body(`${shared} ${other}`));
    const app = state.rows.find((row) => row.id === "https://app.test")!;
    const { undo } = await pod.apply(planRevoke(app, "all"));
    await same(await pod.graph(), body(other));
    await pod.apply(undo);
    await same(await pod.graph(), body(`${shared} ${other}`));
    const bob = state.rows.find((row) => row.id === BOB)!;
    await pod.apply(planRevoke(bob, "all"));
    const retained = shared.replace(`<${BOB}>, `, "");
    await same(
      await pod.graph(),
      body(
        [
          retained.replace(`acl:accessTo <${ROOT}>; `, ""),
          retained.replace(`acl:default <${ROOT}>; `, ""),
        ].join(" "),
      ),
    );
  });
  it("handles identical blank rules only when every equivalent rule is selected", async () => {
    const shared = `[] a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const data = body(`${shared} ${shared}`);
    const pod = fixture(data);
    const state = await snapshot(data);
    const { undo } = await pod.apply(planRevoke(state.rows.find((row) => row.id === BOB)!, "all"));
    await same(await pod.graph(), body(`${shared} ${shared}`.replaceAll(`<${BOB}>, `, "")));
    await pod.apply(undo);
    await same(await pod.graph(), data);
  });
  it.each([
    "named",
    "blank",
  ])("revokes only the selected purpose and duration on %s rules", async (kind) => {
    const temporary = `${kind === "named" ? "<#temporary>" : "[]"} a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; <http://www.w3.org/ns/odrl/2/purpose> "Preview"; <${NS.ACCESS_MANAGER}expiresAt> "2030-01-01".`;
    const permanent = `${kind === "named" ? "<#permanent>" : "[]"} a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; <http://www.w3.org/ns/odrl/2/purpose> "Archive".`;
    const data = body(`${temporary} ${permanent}`);
    const state = await snapshot(data);
    const lines = state.rows[0]!.lines;
    expect(lines).toHaveLength(2);
    const expiring = lines.find((line) => line.expiresAt)!;
    expect(expiring.purpose?.label).toBe("Preview");
    const plan = planRevoke(expiring, "line");
    expect(plan.changes).toHaveLength(1);
    const pod = fixture(data);
    const { undo } = await pod.apply(plan);
    await same(await pod.graph(), body(permanent));
    await pod.apply(undo);
    await same(await pod.graph(), data);
  });
  it("compares nested blank annotations without relying on their parser labels", async () => {
    const rule = `[] a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; <urn:annotation> _:detail; <urn:also> _:detail.`;
    const detail = `_:detail <urn:value> "retain"; <urn:self> _:detail.`;
    const data = body(`${rule} ${detail}`);
    const state = await snapshot(data);
    const pod = fixture(data);
    const { undo } = await pod.apply(planRevoke(state.rows[0]!, "all"));
    await same(await pod.graph(), body(detail));
    await pod.apply(undo);
    await same(await pod.graph(), data);
    pod.docs.get(DOC)!.body = data.replace('"retain"', '"changed"');
    await expect(pod.apply(planRevoke(state.rows[0]!, "all"))).rejects.toBeInstanceOf(
      AclConflictError,
    );
    expect(pod.puts()).toHaveLength(2);
  });
  it("accepts neutral snapshots and legacy blank-node plans without stored authorization graphs", async () => {
    const rules = ["Read", "Write"]
      .map(
        (mode) =>
          `[] a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:${mode}.`,
      )
      .join(" ");
    for (const legacy of [false, true]) {
      const state = await snapshot(body(rules));
      for (const resource of state.rows[0]!.lines[0]!.resources) {
        delete resource.authorization;
        if (legacy) delete resource.signature;
      }
      const pod = fixture(body(rules));
      await pod.apply(planRevoke(state.rows[0]!, "all"));
      await same(await pod.graph(), body(""));
    }
  });
  it("rejects overlapping legacy matches instead of selecting the same blank rule twice", async () => {
    const rule = (scopes: string) =>
      `[] a acl:Authorization; acl:agent <${BOB}>; ${scopes} acl:mode acl:Read.`;
    const pod = fixture(
      body(
        [
          rule(`acl:accessTo <${ROOT}>;`),
          rule(`acl:accessTo <${ROOT}>; acl:default <${ROOT}>;`),
          rule(`acl:default <${ROOT}>;`),
        ].join(" "),
      ),
    );
    await expect(
      pod.apply({
        changes: [
          change({ node: "old-resource-a" }),
          change({ node: "old-resource-b" }),
          change({ node: "old-default-a", scope: "members" }),
          change({ node: "old-default-b", scope: "members" }),
        ],
      }),
    ).rejects.toBeInstanceOf(AclConflictError);
    expect(pod.puts()).toHaveLength(0);
  });
  it("resolves every selected atom before a prior change removes their whole shared rule", async () => {
    const data = body(
      `[] a acl:Authorization; acl:agentClass foaf:Agent; acl:origin <https://app.test>; acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Read.`,
    );
    const state = await snapshot(data);
    expect(state.summary.publicItems).toBe(0);
    const pod = fixture(data);
    const { undo } = await pod.apply(planRevoke(state, "all"));
    await same(await pod.graph(), body(""));
    await pod.apply(undo);
    await same(await pod.graph(), data);
  });
  it("retains unselected origins on an origin-only blank authorization", async () => {
    const rule = `[] a acl:Authorization; acl:origin <https://app.test>, <https://other.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const state = await snapshot(body(rule));
    const pod = fixture(body(rule));
    await pod.apply(planRevoke(state.rows.find((row) => row.id === "https://app.test")!, "all"));
    await same(await pod.graph(), body(rule.replace("<https://app.test>, ", "")));
  });
  it("re-reads and reapplies after two 412s, then throws after the third conflict", async () => {
    const pod = fixture();
    pod.conflicts(2);
    const { undo } = await pod.apply({ changes: [change()] });
    expect(pod.puts()).toHaveLength(3);
    expect(pod.puts().map(([, init]) => new Headers(init!.headers).get("if-match"))).toEqual([
      '"1"',
      '"2"',
      '"3"',
    ]);
    await pod.apply(undo);
    await same(await pod.graph(), body());
    pod.conflicts(3);
    await expect(pod.apply({ changes: [change()] })).rejects.toBeInstanceOf(AclConflictError);
    expect(pod.puts()).toHaveLength(7);
  });
  it("retries against the new server graph, retaining concurrent unrelated grants", async () => {
    const pod = fixture();
    const underlying = pod.fetch.getMockImplementation()!;
    pod.fetch.mockImplementationOnce(async (input, init) => underlying(input, init));
    const read = await pod.graph();
    pod.fetch.mockImplementationOnce(async () => {
      pod.docs.get(DOC)!.body = body(
        `${bobRule} <#carol> a acl:Authorization; acl:agent <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
      );
      return new Response(null, { status: 412 });
    });
    // Consume the first queued GET and simulate a conflicting PUT with a new authorization.
    pod.fetch.mockClear();
    await pod.apply({ changes: [change()] });
    const policy = readWac(await pod.graph(), ROOT, DOC);
    expect(
      policy.grants.some((g) =>
        g.who.some((c) => c.some((s) => s.kind === "agent" && s.webId === CAROL)),
      ),
    ).toBe(true);
    expect(read.size).toBeGreaterThan(0);
  });
  it.each([
    "agent",
    "public",
    "authenticated",
  ] as const)("refuses loss of owner's final Control via %s", async (kind) => {
    const subject: Subject = kind === "agent" ? { kind, webId: OWNER } : { kind };
    const principal =
      kind === "agent"
        ? `acl:agent <${OWNER}>`
        : `acl:agentClass ${kind === "public" ? "foaf:Agent" : "acl:AuthenticatedAgent"}`;
    const pod = fixture(
      `${PREFIX} <#bob> a acl:Authorization; ${principal}; acl:accessTo <${ROOT}>; acl:mode acl:Control.`,
    );
    await expect(
      pod.apply({ changes: [change({ subject, modes: ["control"] })] }),
    ).rejects.toBeInstanceOf(LockoutError);
    expect(pod.puts()).toHaveLength(0);
  });
  it("does not count Control over another resource or an origin-constrained owner as protection", async () => {
    const unrelated = body().replace(
      `<${ROOT}>; acl:default <${ROOT}>`,
      `<${ROOT}other>; acl:default <${ROOT}other>`,
    );
    await expect(fixture(unrelated).apply({ changes: [change()] })).rejects.toBeInstanceOf(
      LockoutError,
    );
    const constrained = body().replace(
      "<#owner> a acl:Authorization;",
      "<#owner> a acl:Authorization; acl:origin <https://app.test>;",
    );
    await expect(fixture(constrained).apply({ changes: [change()] })).rejects.toBeInstanceOf(
      LockoutError,
    );
    const sharedOwner = body().replace(`<${OWNER}>;`, `<${OWNER}>, <${BOB}>;`);
    const pod = fixture(sharedOwner);
    await expect(
      pod.apply({
        changes: [change({ node: `${DOC}#owner`, subject: { kind: "agent", webId: OWNER } })],
      }),
    ).rejects.toBeInstanceOf(LockoutError);
    pod.docs.get(DOC)!.body +=
      ` <#fallback> a acl:Authorization; acl:agentClass acl:AuthenticatedAgent; acl:accessTo <${ROOT}>; acl:mode acl:Control.`;
    await pod.apply({
      changes: [change({ node: `${DOC}#owner`, subject: { kind: "agent", webId: OWNER } })],
    });
  });
  it("rejects non-WAC plans, ACP documents and foreign URLs before writes", async () => {
    const pod = fixture();
    await expect(pod.apply({ changes: [change({ system: "acp" })] })).rejects.toBeInstanceOf(
      UnsupportedAccessError,
    );
    for (const subject of [
      { kind: "client", clientId: "urn:client" },
      { kind: "group", group: "urn:group" },
    ] as Subject[])
      await expect(pod.apply({ changes: [change({ subject })] })).rejects.toBeInstanceOf(
        UnsupportedAccessError,
      );
    for (const options of [
      { source: "https://evil.test/.acl" },
      { resource: "https://evil.test/data" },
    ])
      await expect(pod.apply({ changes: [change(options)] })).rejects.toThrow();
    await expect(
      pod.apply({
        changes: [],
        restore: [{ source: "https://evil.test/.acl", before: "", after: "" }],
      }),
    ).rejects.toThrow();
    pod.docs.get(DOC)!.body =
      `@prefix acp: <http://www.w3.org/ns/solid/acp#>. <> a acp:AccessControlResource; acp:resource <${ROOT}>.`;
    await expect(pod.apply({ changes: [change()] })).rejects.toBeInstanceOf(UnsupportedAccessError);
    expect(pod.puts()).toHaveLength(0);
    const unknown = fixture();
    await unknown.apply({ changes: [change({ system: "unknown" })] });
    await same(await unknown.graph(), body(""));
  });
  it("refuses absent nodes, missing/weak validators, failed reads and failed writes", async () => {
    const pod = fixture();
    await expect(
      pod.apply({ changes: [change({ node: `${DOC}#missing` })] }),
    ).rejects.toBeInstanceOf(AclConflictError);
    for (const etag of ["", 'W/"1"']) {
      pod.docs.get(DOC)!.etag = etag;
      await expect(pod.apply({ changes: [change()] })).rejects.toBeInstanceOf(AclConflictError);
    }
    pod.docs.get(DOC)!.etag = '"1"';
    pod.failure(403);
    await expect(pod.apply({ changes: [change()] })).rejects.toThrow("403");
    await expect(
      pod.apply({ changes: [change({ source: `${ROOT}missing.acl` })] }),
    ).rejects.toThrow();
    expect((await pod.apply({ changes: [] })).undo).toEqual({ changes: [], restore: [] });
  });
  it("refuses undo over a concurrent graph change instead of overwriting unrelated work", async () => {
    const pod = fixture();
    const { undo } = await pod.apply({ changes: [change()] });
    const graph = new Store([...(await pod.graph())]);
    graph.addQuad(
      DataFactory.namedNode("urn:new"),
      DataFactory.namedNode("urn:p"),
      DataFactory.literal("keep"),
    );
    pod.docs.get(DOC)!.body = await serializeTurtle(graph);
    await expect(pod.apply(undo)).rejects.toBeInstanceOf(AclConflictError);
    expect(pod.puts()).toHaveLength(1);
  });
  it("protects owner Control in caller-supplied inverse plans and refuses ambiguous bare lines", async () => {
    const pod = fixture();
    await expect(
      pod.apply({
        changes: [],
        restore: [{ source: DOC, before: `${PREFIX} ${bobRule}`, after: body() }],
      }),
    ).rejects.toBeInstanceOf(LockoutError);
    const state = await snapshot(body());
    const row = state.rows[0]!;
    for (const resource of row.lines[0]!.resources) {
      delete resource.subject;
      delete resource.scope;
      delete resource.system;
    }
    expect(planRevoke(row, "all").changes[0]).toMatchObject({
      subject: { kind: "agent", webId: BOB },
      scope: "resource",
      system: "unknown",
    });
    expect(() => planRevoke(row.lines[0]!, "line")).toThrow(UnsupportedAccessError);
    row.kind = "public";
    expect(planRevoke(row, "make-private").changes[0]!.subject).toEqual({ kind: "public" });
    row.kind = "authenticated";
    row.lines[0]!.resources[0]!.inherited = true;
    expect(planRevoke(row, "make-private").changes[0]).toMatchObject({
      subject: { kind: "authenticated" },
      scope: "members",
    });
    row.kind = "app";
    expect(() => planRevoke(row, "all")).toThrow(UnsupportedAccessError);
  });
  it("returns undo for completed documents if a later document fails", async () => {
    const pod = fixture();
    const second = `${ROOT}other.acl`;
    pod.docs.set(second, { body: body(), etag: '"1"' });
    let error: unknown;
    try {
      await pod.apply({ changes: [change(), change({ source: second, node: "urn:missing" })] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PartialRevokeError);
    await pod.apply((error as PartialRevokeError).undo);
    await same(await pod.graph(), body());
  });
});
