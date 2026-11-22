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
  RestoreConflictError,
  type RevokeChange,
  type RevokePlan,
  UnsupportedAccessError,
} from "../src/apps/home/lib/permissions";
import { recordsFrom } from "../src/apps/home/lib/permissions/records";
import { AccessNode } from "../src/apps/home/lib/permissions/vocab";
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
/** Effective access per target: who may do what, without redundant narrower clauses. */
function access(dataset: import("@rdfjs/types").DatasetCore): string[] {
  const targets = new Set([ROOT]);
  for (const scope of ["accessTo", "default", "defaultForNew"])
    for (const quad of dataset.match(null, DataFactory.namedNode(ACL + scope)))
      targets.add(quad.object.value);
  const atoms: { key: string; clause: Set<string> }[] = [];
  for (const target of targets)
    for (const grant of readWacPolicy(dataset, target, DOC).grants)
      for (const scope of grant.appliesTo === "both" ? ["resource", "members"] : [grant.appliesTo])
        for (const clause of grant.who)
          for (const mode of grant.modes)
            atoms.push({
              key: JSON.stringify([
                target,
                scope,
                mode,
                grant.except.map((s) => JSON.stringify(s)).sort(),
              ]),
              clause: new Set(
                clause.map((subject) => JSON.stringify(Object.entries(subject).sort())),
              ),
            });
  const implied = (a: (typeof atoms)[number], b: (typeof atoms)[number]) =>
    a.key === b.key && b.clause.size < a.clause.size && [...b.clause].every((s) => a.clause.has(s));
  return [
    ...new Set(
      atoms
        .filter((atom) => !atoms.some((other) => implied(atom, other)))
        .map((atom) => JSON.stringify([atom.key, [...atom.clause].sort()])),
    ),
  ].sort();
}
/** The documents the tests below revoke from, for the effective-access property test. */
const FIXTURES: string[] = (() => {
  const other = `${ROOT}elsewhere`;
  const carolRule = bobRule.replaceAll("#bob", "#carol").replace(BOB, CAROL);
  const blank = (rest: string) => `[] a acl:Authorization; ${rest}.`;
  return [
    body(),
    body(
      `${bobRule} <#public> a acl:Authorization; acl:accessTo <${ROOT}>; acl:agentClass foaf:Agent; acl:mode acl:Read. <#signed> a acl:Authorization; acl:accessTo <${ROOT}>; acl:agentClass acl:AuthenticatedAgent; acl:mode acl:Read.`,
    ),
    body(
      `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:default <${ROOT}>; acl:mode acl:Read.`,
    ),
    body(
      `<#bob> a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>, <${other}>; acl:default <${ROOT}>; acl:mode acl:Read; <urn:purpose> "retain".`,
    ),
    body(
      `<#bob> a acl:Authorization; acl:agentClass foaf:Agent, acl:AuthenticatedAgent; acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Read.`,
    ),
    body(
      `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:origin <https://app.test>, <https://other.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
    ),
    ...["<#bob>", "[]"].map((root) =>
      body(
        `${root} a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:origin <https://a.test>, <https://b.test>; acl:accessTo <${ROOT}>, <${other}>; acl:default <${ROOT}>; acl:mode acl:Read; <urn:purpose> "retain".`,
      ),
    ),
    body(
      ["Read", "Write"]
        .map((mode) => blank(`acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:${mode}`))
        .join(" "),
    ),
    body(
      `${blank(`acl:agent <${BOB}>, <${CAROL}>; acl:origin <https://app.test>; acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Read`)} ${blank(`acl:agent <${BOB}>; acl:origin <https://other.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read`)}`,
    ),
    body(
      `${blank(`acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read`)} `.repeat(
        2,
      ),
    ),
    ...["named", "blank"].map((kind) =>
      body(
        `${kind === "named" ? "<#temporary>" : "[]"} a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; <http://www.w3.org/ns/odrl/2/purpose> "Preview"; <${NS.ACCESS_MANAGER}expiresAt> "2030-01-01". ${kind === "named" ? "<#permanent>" : "[]"} a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; <http://www.w3.org/ns/odrl/2/purpose> "Archive".`,
      ),
    ),
    body(
      `${blank(`acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; <urn:annotation> _:detail; <urn:also> _:detail`)} _:detail <urn:value> "retain"; <urn:self> _:detail.`,
    ),
    body(
      `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>, <${other}>; acl:mode acl:Read; <urn:annotation> [ <urn:value> "retain" ].`,
    ),
    body(
      blank(
        `acl:agentClass foaf:Agent; acl:origin <https://app.test>; acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Read`,
      ),
    ),
    body(
      blank(
        `acl:origin <https://app.test>, <https://other.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read`,
      ),
    ),
    body(
      `${bobRule} ${carolRule} ${blank(`acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Write`)}`,
    ),
    body(
      `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}drive/>, <${ROOT}docs/>; acl:mode acl:Read.`,
    ),
    ...["<#shared>", "[]"].map((root) =>
      body(
        `${root} a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
      ),
    ),
    body(
      [
        blank(`acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Read`),
        blank(`acl:origin <https://one.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read`),
        blank(`acl:origin <https://two.test>; acl:default <${ROOT}>; acl:mode acl:Read`),
      ].join(" "),
    ),
  ];
})();
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
  it.each([
    "combined",
    "separate",
    "blank",
  ])("revokes both equal folder scopes from a merged %s line and Undo restores both", async (kind) => {
    const graph = new Store([...(await parseRdf(body(""), "text/turtle", { baseIRI: DOC }))]);
    const rule = (id: string) => {
      const node = new AccessNode(
        kind === "blank" ? DataFactory.blankNode(id) : DataFactory.namedNode(`${DOC}#${id}`),
        graph,
        DataFactory,
      );
      node.values(`${NS.RDF}type`).add(`${ACL}Authorization`);
      node.values(`${ACL}agent`).add(BOB);
      node.values(`${ACL}mode`).add(`${ACL}Read`);
      return node;
    };
    const own = rule("bob");
    own.values(`${ACL}accessTo`).add(ROOT);
    (kind === "separate" ? rule("members") : own).values(`${ACL}default`).add(ROOT);
    const data = await serializeTurtle(graph);
    const state = await snapshot(data);
    expect(state.rows[0]!.lines).toHaveLength(1);
    const line = state.rows[0]!.lines[0]!;
    expect(line.inherited).toBe(false);
    expect(line.resources.map((r) => r.scope)).toEqual(["resource", "members"]);
    const plan = planRevoke(line, "line");
    expect(plan.changes).toHaveLength(2);
    const pod = fixture(data);
    const { undo } = await pod.apply(plan);
    await same(await pod.graph(), body(""));
    expect(pod.puts()).toHaveLength(1);
    await pod.apply(undo);
    await same(await pod.graph(), data);
  });
  it.each([
    "resource",
    "members",
  ] as const)("revokes only the selected unequal %s scope and restores it", async (scope) => {
    const graph = new Store([...(await parseRdf(body(""), "text/turtle", { baseIRI: DOC }))]);
    for (const [id, predicate, mode] of [
      ["own", "accessTo", "Read"],
      ["members", "default", "Write"],
    ]) {
      const node = new AccessNode(DataFactory.namedNode(`${DOC}#${id}`), graph, DataFactory);
      for (const [p, value] of [
        [`${NS.RDF}type`, `${ACL}Authorization`],
        [`${ACL}agent`, BOB],
        [`${ACL}${predicate}`, ROOT],
        [`${ACL}mode`, `${ACL}${mode}`],
      ])
        node.values(p!).add(value!);
    }
    const data = await serializeTurtle(graph);
    const state = await snapshot(data);
    expect(state.rows[0]!.lines).toHaveLength(2);
    const line = state.rows[0]!.lines.find((line) => line.folderScope === scope)!;
    const pod = fixture(data);
    const { undo } = await pod.apply(planRevoke(line, "line"));
    const remaining = readWacPolicy(await pod.graph(), ROOT, DOC).grants.filter((g) =>
      g.who.some((clause) => clause.some((s) => s.kind === "agent" && s.webId === BOB)),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.appliesTo).toBe(scope === "resource" ? "members" : "resource");
    await pod.apply(undo);
    await same(await pod.graph(), data);
  });
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
  it.each([
    "named",
    "blank",
  ])("revokes one principal/origin conjunction on a %s rule, preserving other combinations and scopes", async (kind) => {
    const other = `${ROOT}elsewhere`;
    const a = "https://a.test";
    const b = "https://b.test";
    const rule = `${kind === "named" ? "<#bob>" : "[]"} a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:origin <${a}>, <${b}>; acl:accessTo <${ROOT}>, <${other}>; acl:default <${ROOT}>; acl:mode acl:Read; <urn:purpose> "retain".`;
    const data = body(rule);
    const state = await snapshot(data);
    const combinations = async (
      pod: ReturnType<typeof fixture>,
      resource: string,
      members = false,
    ) =>
      readWacPolicy(await pod.graph(), resource, DOC)
        .grants.filter((grant) =>
          members ? grant.appliesTo !== "resource" : grant.appliesTo !== "members",
        )
        .flatMap((grant) => grant.who)
        .filter((clause) => clause.some((subject) => subject.kind === "origin"))
        .map((clause) => JSON.stringify(clause))
        .sort();
    const full = [BOB, CAROL]
      .flatMap((webId) =>
        [a, b].map((origin) =>
          JSON.stringify([
            { kind: "agent", webId },
            { kind: "origin", origin },
          ]),
        ),
      )
      .sort();
    const remaining = full.filter(
      (clause) =>
        clause !==
        JSON.stringify([
          { kind: "agent", webId: BOB },
          { kind: "origin", origin: a },
        ]),
    );
    for (const id of [BOB, a]) {
      const pod = fixture(data);
      const condition: Subject =
        id === BOB ? { kind: "origin", origin: a } : { kind: "agent", webId: BOB };
      const line = state.rows
        .find((row) => row.id === id)!
        .lines.find(
          (line) =>
            !line.inherited && JSON.stringify(line.conditions) === JSON.stringify([condition]),
        )!;
      const plan = planRevoke(line, "line");
      expect(plan.changes).toHaveLength(2);
      expect(plan.changes[0]!.clause).toEqual([
        { kind: "agent", webId: BOB },
        { kind: "origin", origin: a },
      ]);
      const { undo } = await pod.apply(plan);
      expect(await combinations(pod, ROOT)).toEqual(remaining);
      expect(await combinations(pod, ROOT, true)).toEqual(remaining);
      expect(await combinations(pod, other)).toEqual(full);
      const graph = await pod.graph();
      expect([...graph.match(null, DataFactory.namedNode("urn:purpose"))]).toHaveLength(5);
      expect(
        [...graph.match(null, DataFactory.namedNode("urn:purpose"))].every(
          (quad) => quad.object.value === "retain",
        ),
      ).toBe(true);
      await pod.apply(undo);
      await same(await pod.graph(), data);
    }
    for (const id of [BOB, a]) {
      const pod = fixture(data);
      const plan = planRevoke(state.rows.find((row) => row.id === id)!, "all");
      expect(plan.changes).toHaveLength(4);
      await pod.apply(plan);
      const retained = full.filter((clause) => !clause.includes(id));
      expect(await combinations(pod, ROOT)).toEqual(retained);
      expect(await combinations(pod, ROOT, true)).toEqual(retained);
      expect(await combinations(pod, other)).toEqual(full);
    }
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
  it.each([
    ["agent set", `acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read`],
    ["mode set", `acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Write`],
    [
      "accessTo targets",
      `acl:agent <${BOB}>; acl:accessTo <${ROOT}>, <${ROOT}other>; acl:mode acl:Read`,
    ],
    [
      "default targets",
      `acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Read`,
    ],
    [
      "conditions",
      `acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:origin <https://app.test>; acl:mode acl:Read`,
    ],
  ])("matches a selected blank rule structurally by %s after labels and order change", async (_name, properties) => {
    const selected = `[] a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const other = `[] a acl:Authorization; ${properties}.`;
    const state = await snapshot(body(`${selected} ${other}`));
    const expected = await parseRdf(`${PREFIX} ${selected}`, "text/turtle", { baseIRI: DOC });
    const candidates = planRevoke(state.rows.find((row) => row.id === BOB)!, "all").changes;
    const changes: RevokeChange[] = [];
    for (const candidate of candidates) {
      const original = await parseRdf(candidate.authorization!, "text/turtle", { baseIRI: DOC });
      if (isomorphic([...original], [...expected])) changes.push(candidate);
    }
    expect(changes).toHaveLength(1);
    const fresh = body(`${other} ${selected}`);
    const pod = fixture(fresh);
    const { undo } = await pod.apply({ changes });
    await same(await pod.graph(), body(other));
    await pod.apply(undo);
    await same(await pod.graph(), fresh);
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
    // Annotations only the revoked rule referenced leave with it; undo restores both.
    await same(await pod.graph(), body(""));
    await pod.apply(undo);
    await same(await pod.graph(), data);
    pod.docs.get(DOC)!.body = data.replace('"retain"', '"changed"');
    await expect(pod.apply(planRevoke(state.rows[0]!, "all"))).rejects.toBeInstanceOf(
      AclConflictError,
    );
    expect(pod.puts()).toHaveLength(2);
  });
  it("keeps a nested annotation another rule still references, and undo restores the split", async () => {
    const other = `${ROOT}elsewhere`;
    const rule = `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>, <${other}>; acl:mode acl:Read; <urn:annotation> [ <urn:value> "retain" ].`;
    const carol = `<#carol> a acl:Authorization; acl:agent <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read; <urn:annotation> _:shared; <urn:also> _:shared; <urn:note> [ <urn:value> "own"; <urn:detail> [ <urn:value> "own detail" ] ]. <#bob2> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${other}>; acl:mode acl:Read; <urn:annotation> _:shared. _:shared <urn:value> "shared"; <urn:detail> _:deeper. _:deeper <urn:value> "deeper".`;
    const pod = fixture(body(rule));
    const { undo } = await pod.apply({ changes: [change()] });
    // The split copy for this folder is dropped; the retained scope keeps its annotation.
    await same(
      await pod.graph(),
      body(
        `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${other}>; acl:mode acl:Read; <urn:annotation> [ <urn:value> "retain" ].`,
      ),
    );
    await pod.apply(undo);
    await same(await pod.graph(), body(rule));
    // The shared annotation (and what it references) stays; Carol's own nested notes go.
    const shared = fixture(body(carol));
    await shared.apply({
      changes: [change({ node: `${DOC}#carol`, subject: { kind: "agent", webId: CAROL } })],
    });
    await same(
      await shared.graph(),
      body(
        `<#bob2> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${other}>; acl:mode acl:Read; <urn:annotation> _:shared. _:shared <urn:value> "shared"; <urn:detail> _:deeper. _:deeper <urn:value> "deeper".`,
      ),
    );
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
    expect(state.summary.publicItems).toBe(1);
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
    const ownerOff = change({ node: `${DOC}#owner`, subject: { kind: "agent", webId: OWNER } });
    const unrelated = body().replace(
      `<${ROOT}>; acl:default <${ROOT}>`,
      `<${ROOT}other>; acl:default <${ROOT}other>`,
    );
    const otherResource = `${body()} ${unrelated.slice(PREFIX.length).replaceAll("#owner", "#elsewhere")}`;
    await expect(fixture(otherResource).apply({ changes: [ownerOff] })).rejects.toBeInstanceOf(
      LockoutError,
    );
    const constrained = body().replace(
      "<#owner> a acl:Authorization;",
      "<#owner> a acl:Authorization; acl:origin <https://app.test>;",
    );
    const constrainedCopy = `${body()} ${constrained.slice(PREFIX.length).replaceAll("#owner", "#viaApp")}`;
    await expect(fixture(constrainedCopy).apply({ changes: [ownerOff] })).rejects.toBeInstanceOf(
      LockoutError,
    );
    const sharedOwner = body().replace(`<${OWNER}>;`, `<${OWNER}>, <${BOB}>;`);
    const pod = fixture(sharedOwner);
    await expect(pod.apply({ changes: [ownerOff] })).rejects.toBeInstanceOf(LockoutError);
    pod.docs.get(DOC)!.body +=
      ` <#fallback> a acl:Authorization; acl:agentClass acl:AuthenticatedAgent; acl:accessTo <${ROOT}>; acl:mode acl:Control.`;
    await pod.apply({ changes: [ownerOff] });
  });
  it("allows harmless revocations where the owner never had Control of that scope", async () => {
    // Only a change that loses the owner's Control is refused, not one where it was absent.
    for (const data of [
      body().replace(
        `<${ROOT}>; acl:default <${ROOT}>`,
        `<${ROOT}other>; acl:default <${ROOT}other>`,
      ),
      body().replace(
        "<#owner> a acl:Authorization;",
        "<#owner> a acl:Authorization; acl:origin <https://app.test>;",
      ),
    ]) {
      const pod = fixture(data);
      const { undo } = await pod.apply({ changes: [change()] });
      await same(await pod.graph(), data.replace(bobRule, ""));
      await pod.apply(undo);
      await same(await pod.graph(), data);
    }
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
        restore: [{ source: "https://evil.test/.acl", remove: [], add: [] }],
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
  it("refuses a conditional plan missing its subject or naming a stale condition", async () => {
    const pod = fixture();
    for (const clause of [
      [{ kind: "origin", origin: "https://absent.test" }],
      [
        { kind: "agent", webId: BOB },
        { kind: "origin", origin: "https://absent.test" },
      ],
    ] as Subject[][])
      await expect(pod.apply({ changes: [change({ clause })] })).rejects.toBeInstanceOf(
        AclConflictError,
      );
    expect(pod.puts()).toHaveLength(0);
  });
  it("undoes over unrelated concurrent edits, adding back only the removed rule", async () => {
    const pod = fixture();
    const { undo } = await pod.apply({ changes: [change()] });
    expect(undo.restore).toEqual([{ source: DOC, remove: [], add: [expect.any(String)] }]);
    const graph = new Store([...(await pod.graph())]);
    graph.addQuad(
      DataFactory.namedNode("urn:new"),
      DataFactory.namedNode("urn:p"),
      DataFactory.literal("keep"),
    );
    pod.docs.get(DOC)!.body =
      `${await serializeTurtle(graph)} <#carol> a <${ACL}Authorization>; <${ACL}agent> <${CAROL}>; <${ACL}accessTo> <${ROOT}>; <${ACL}mode> <${ACL}Read>.`;
    const concurrent = [...(await pod.graph())];
    await pod.apply(undo);
    const bob = await parseRdf(`${PREFIX} ${bobRule}`, "text/turtle", { baseIRI: DOC });
    // Exactly the concurrent graph plus Bob's rule: nothing else is added or dropped.
    expect(isomorphic([...(await pod.graph())], [...concurrent, ...bob])).toBe(true);
    expect(pod.puts()).toHaveLength(2);
  });
  it("undoes two revocations in one ACL document in either order, including a rule both changed", async () => {
    const carolRule = bobRule.replaceAll("#bob", "#carol").replace(BOB, CAROL);
    const shared = `[] a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Write.`;
    const data = body(`${bobRule} ${carolRule} ${shared}`);
    for (const order of ["earlier first", "later first"]) {
      const pod = fixture(data);
      // Each revoke is planned from a fresh read, as the page does after refreshing.
      const revoke = async (id: string) =>
        pod.apply(
          planRevoke(
            (await snapshot(pod.docs.get(DOC)!.body)).rows.find((row) => row.id === id)!,
            "all",
          ),
        );
      const { undo: undoBob } = await revoke(BOB);
      const { undo: undoCarol } = await revoke(CAROL);
      await same(await pod.graph(), body(""));
      const [first, second] =
        order === "earlier first" ? [undoBob, undoCarol] : [undoCarol, undoBob];
      await pod.apply(first);
      // Only the first undo's grants return: Bob's (or Carol's) part of the shared rule.
      const back = order === "earlier first" ? BOB : CAROL;
      const policy = readWac(await pod.graph(), ROOT, DOC);
      const people = policy.grants.flatMap((g) =>
        g.who.flatMap((clause) => clause.flatMap((s) => (s.kind === "agent" ? [s.webId] : []))),
      );
      expect(new Set(people)).toEqual(new Set([OWNER, back]));
      await pod.apply(second);
      await same(await pod.graph(), data);
      expect(pod.puts()).toHaveLength(4);
    }
    // Separate rules: the earlier revoke can be undone first.
    const separate = body(`${bobRule} ${carolRule}`);
    const second = fixture(separate);
    const separateState = await snapshot(separate);
    const first = await second.apply(
      planRevoke(separateState.rows.find((r) => r.id === BOB)!, "all"),
    );
    const later = await second.apply(
      planRevoke(separateState.rows.find((r) => r.id === CAROL)!, "all"),
    );
    await second.apply(first.undo);
    await same(await second.graph(), body(bobRule));
    await second.apply(later.undo);
    await same(await second.graph(), separate);
  });
  it.each([
    ["earlier first", true],
    ["later first", false],
  ])("restores one rule's targets turned off one at a time, undoing the %s", async (_name, earlier) => {
    const drive = `${ROOT}drive/`;
    const docs = `${ROOT}docs/`;
    const rule = `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${drive}>, <${docs}>; acl:mode acl:Read.`;
    const pod = fixture(body(rule));
    const files = await pod.apply({ changes: [change({ resource: drive })] });
    const documents = await pod.apply({ changes: [change({ resource: docs })] });
    await same(await pod.graph(), body(""));
    const [first, second] = earlier ? [files, documents] : [documents, files];
    await pod.apply(first.undo);
    await same(
      await pod.graph(),
      body(
        rule
          .replace(`<${earlier ? docs : drive}>, `, "")
          .replace(`, <${earlier ? docs : drive}>`, ""),
      ),
    );
    await pod.apply(second.undo);
    await same(await pod.graph(), body(rule));
  });
  it.each([
    ["named", "<#shared>"],
    ["blank", "[]"],
  ])("undoes Revoke all for two people sharing a %s rule in either order", async (_kind, root) => {
    const rule = `${root} a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    for (const bobFirst of [true, false]) {
      const pod = fixture(body(rule));
      const revoke = async (id: string) =>
        pod.apply(
          planRevoke(
            (await snapshot(pod.docs.get(DOC)!.body)).rows.find((row) => row.id === id)!,
            "all",
          ),
        );
      const bob = await revoke(BOB);
      const carol = await revoke(CAROL);
      await same(await pod.graph(), body(""));
      await pod.apply((bobFirst ? bob : carol).undo);
      await same(
        await pod.graph(),
        body(rule.replace(bobFirst ? `, <${CAROL}>` : `<${BOB}>, `, "")),
      );
      await pod.apply((bobFirst ? carol : bob).undo);
      await same(await pod.graph(), body(rule));
    }
  });
  it("refuses undo once someone else changed or re-created the same rule", async () => {
    const shared = `<#bob> a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const pod = fixture(body(shared));
    const { undo } = await pod.apply({ changes: [change()] });
    const changed = body(
      shared.replace(`<${BOB}>, `, "").replace("acl:Read", "acl:Read, acl:Write"),
    );
    pod.docs.get(DOC)!.body = changed;
    await expect(pod.apply(undo)).rejects.toBeInstanceOf(RestoreConflictError);
    await expect(pod.apply(undo)).rejects.toThrow("changed elsewhere");
    expect(pod.docs.get(DOC)!.body).toBe(changed);
    expect(pod.puts()).toHaveLength(1);
    // A removed named rule that someone re-created differently is never overwritten.
    const removed = fixture();
    const { undo: restoreBob } = await removed.apply({ changes: [change()] });
    removed.docs.get(DOC)!.body = body(bobRule.replace("acl:Read", "acl:Write"));
    await expect(removed.apply(restoreBob)).rejects.toBeInstanceOf(RestoreConflictError);
    expect(removed.puts()).toHaveLength(1);
  });
  it("restores into one of two isomorphic blank rules instead of reporting a false conflict", async () => {
    const blank = `[] a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const twin = fixture(body(blank));
    const { undo: twinUndo } = await twin.apply(
      planRevoke((await snapshot(body(blank))).rows.find((r) => r.id === BOB)!, "all"),
    );
    const left = blank.replace(`<${BOB}>, `, "");
    twin.docs.get(DOC)!.body = body(`${left} ${left}`);
    await twin.apply(twinUndo);
    // Bob rejoins one copy; the other copy now grants nothing more and is folded in.
    await same(await twin.graph(), body(blank));
    expect(twin.puts()).toHaveLength(2);
  });
  it("puts back only missing grants, re-creating a named rule and splitting what can't merge", async () => {
    const x = `${ROOT}x/`;
    const y = `${ROOT}y/`;
    const z = `${ROOT}z/`;
    const rule = (root: string, agents: string[], targets: string[]) =>
      `${PREFIX} ${root} a acl:Authorization; acl:agent ${agents.map((a) => `<${a}>`).join(", ")}; acl:accessTo ${targets.map((t) => `<${t}>`).join(", ")}; acl:mode acl:Read.`;
    // The rules the write left are gone, so only the cells it removed are put back:
    // Bob on y and Carol on x and y, which no single rule can express exactly.
    const pod = fixture(body(""));
    const delta = {
      source: DOC,
      remove: [rule("<#r>", [BOB], [x])],
      add: [rule("<#r>", [BOB, CAROL], [x, y])],
    };
    await pod.apply({ changes: [], restore: [delta] });
    await same(
      await pod.graph(),
      body(
        `${rule("<#r>", [BOB], [y]).slice(PREFIX.length)} ${rule("[]", [CAROL], [x, y]).slice(PREFIX.length)}`,
      ),
    );
    // Carol on x alone: adding her to the existing <#r> would also grant her z, so her
    // grant goes in a separate rule and <#r> keeps exactly what it had.
    const named = fixture(body(rule("<#r>", [BOB], [x, z]).slice(PREFIX.length)));
    await named.apply({
      changes: [],
      restore: [
        {
          source: DOC,
          remove: [rule("<#r>", [BOB, CAROL], [z])],
          add: [rule("<#r>", [BOB, CAROL], [x, z])],
        },
      ],
    });
    await same(
      await named.graph(),
      body(
        `${rule("<#r>", [BOB], [x, z]).slice(PREFIX.length)} ${rule("[]", [CAROL], [x]).slice(PREFIX.length)}`,
      ),
    );
  });
  it("succeeds without adding anything when the grants were already put back elsewhere", async () => {
    const shared = `<#bob> a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const pod = fixture(body(shared));
    const { undo } = await pod.apply({ changes: [change()] });
    pod.docs.get(DOC)!.body = body(shared);
    await pod.apply(undo);
    await same(await pod.graph(), body(shared));
  });
  it("undoes origin-only revocations in either order", async () => {
    const rule = `[] a acl:Authorization; acl:origin <https://app.test>, <https://other.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    for (const appFirst of [true, false]) {
      const pod = fixture(body(rule));
      const revoke = async (id: string) =>
        pod.apply(
          planRevoke(
            (await snapshot(pod.docs.get(DOC)!.body)).rows.find((row) => row.id === id)!,
            "all",
          ),
        );
      const app = await revoke("https://app.test");
      const other = await revoke("https://other.test");
      await same(await pod.graph(), body(""));
      await pod.apply((appFirst ? app : other).undo);
      await same(
        await pod.graph(),
        body(rule.replace(appFirst ? ", <https://other.test>" : "<https://app.test>, ", "")),
      );
      await pod.apply((appFirst ? other : app).undo);
      await same(await pod.graph(), body(rule));
    }
  });
  it("refuses an inverse delta that would grant access outside the pod", async () => {
    const pod = fixture(body(""));
    await expect(
      pod.apply({
        changes: [],
        restore: [
          {
            source: DOC,
            remove: [],
            add: [`${PREFIX} ${bobRule.replace(`<${ROOT}>`, "<https://evil.test/data>")}`],
          },
        ],
      }),
    ).rejects.toThrow();
    expect(pod.puts()).toHaveLength(0);
  });
  it("refuses malformed inverse deltas that would add more than one whole rule", async () => {
    const pod = fixture(body(""));
    for (const add of [
      `${PREFIX} ${bobRule} <urn:other> <urn:p> "extra".`,
      `${PREFIX} ${bobRule} ${bobRule.replaceAll("#bob", "#second")}`,
      `<urn:other> <urn:p> "not a rule".`,
    ])
      await expect(
        pod.apply({ changes: [], restore: [{ source: DOC, remove: [], add: [add] }] }),
      ).rejects.toBeInstanceOf(UnsupportedAccessError);
    expect(pod.puts()).toHaveLength(0);
  });
  it("protects owner Control in caller-supplied inverse plans and refuses ambiguous bare lines", async () => {
    const pod = fixture();
    await expect(
      pod.apply({
        changes: [],
        restore: [{ source: DOC, remove: [`${PREFIX} ${ownerRule}`], add: [] }],
      }),
    ).rejects.toBeInstanceOf(LockoutError);
    const state = await snapshot(body());
    const row = state.rows[0]!;
    for (const resource of row.lines[0]!.resources) {
      delete resource.subject;
      delete resource.clause;
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
  it("never widens origin rules through an inert rule when undoing an app revoke", async () => {
    const o1 = "https://one.test";
    const o2 = "https://two.test";
    const data = body(
      [
        `[] a acl:Authorization; acl:accessTo <${ROOT}>; acl:default <${ROOT}>; acl:mode acl:Read.`,
        `[] a acl:Authorization; acl:origin <${o1}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
        `[] a acl:Authorization; acl:origin <${o2}>; acl:default <${ROOT}>; acl:mode acl:Read.`,
      ].join(" "),
    );
    const pod = fixture(data);
    const before = access(await pod.graph());
    const state = await snapshot(data);
    const { undo } = await pod.apply(planRevoke(state.rows.find((row) => row.id === o2)!, "all"));
    expect(access(await pod.graph())).not.toEqual(before);
    await pod.apply(undo);
    expect(access(await pod.graph())).toEqual(before);
    await same(await pod.graph(), data);
  });
  it("restores the effective access of every revoke and undo sequence in these fixtures", async () => {
    let sequences = 0;
    for (const data of FIXTURES) {
      const original = access(await parseRdf(data, "text/turtle", { baseIRI: DOC }));
      const state = await snapshot(data);
      const plans: RevokePlan[] = [planRevoke(state, "make-private")];
      for (const row of state.rows) {
        plans.push(planRevoke(row, "all"));
        for (const line of row.lines)
          try {
            plans.push(planRevoke(line, "line"));
          } catch {
            /* A bare line without a subject is refused before any write. */
          }
      }
      for (const plan of plans.filter((plan) => plan.changes.length)) {
        const pod = fixture(data);
        let undo: RevokePlan;
        try {
          ({ undo } = await pod.apply(plan));
        } catch {
          continue; // A refused revoke writes nothing, so there is nothing to undo.
        }
        await pod.apply(undo);
        expect(access(await pod.graph()), data).toEqual(original);
        sequences++;
      }
      // Two revokes, each planned from a fresh read, undone in either order.
      for (const [a, b] of state.rows.flatMap((x, i) => state.rows.slice(i + 1).map((y) => [x, y])))
        for (const earlierFirst of [true, false]) {
          const pod = fixture(data);
          const revoke = async (id: string) => {
            const row = (await snapshot(pod.docs.get(DOC)!.body)).rows.find((r) => r.id === id);
            return row ? pod.apply(planRevoke(row, "all")) : undefined;
          };
          let first: Awaited<ReturnType<typeof revoke>>;
          let second: Awaited<ReturnType<typeof revoke>>;
          try {
            first = await revoke(a!.id);
            second = await revoke(b!.id);
          } catch {
            continue;
          }
          const undos = [first?.undo, second?.undo].filter((undo) => !!undo);
          for (const undo of earlierFirst ? undos : undos.reverse()) await pod.apply(undo);
          expect(access(await pod.graph()), data).toEqual(original);
          sequences++;
        }
    }
    expect(sequences).toBeGreaterThan(100);
  });
  it.each([
    ["re-created", ""],
    [
      "merged",
      ` [] a acl:Authorization; acl:agent <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`,
    ],
  ])("refuses an undo whose named rule now describes something untyped (%s)", async (_name, extra) => {
    const pod = fixture();
    const { undo } = await pod.apply({ changes: [change()] });
    // Another writer left <#bob> without a type: Undo must not switch Eve's grant on.
    const eve = `<#bob> acl:agent <https://eve.test/profile#me>; acl:accessTo <${ROOT}>; acl:mode acl:Write.`;
    const tampered = body(`${eve}${extra}`);
    pod.docs.get(DOC)!.body = tampered;
    await expect(pod.apply(undo)).rejects.toBeInstanceOf(RestoreConflictError);
    await expect(pod.apply(undo)).rejects.toMatchObject({ source: DOC });
    expect(pod.docs.get(DOC)!.body).toBe(tampered);
    expect(pod.puts()).toHaveLength(1);
    // The same holds when the delta is not an exact inverse any more.
    await expect(
      pod.apply({
        changes: [],
        restore: [
          {
            ...undo.restore![0]!,
            remove: [
              `${PREFIX} ${bobRule.replace("#bob", "#gone").replace("acl:Read", "acl:Write")}`,
            ],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(RestoreConflictError);
    expect(pod.puts()).toHaveLength(1);
  });
  it("rejoins only the pieces the undone write left, never another writer's covered rule", async () => {
    const left = `[] a acl:Authorization; acl:agent <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const foreign = `[] a acl:Authorization; acl:agent <${CAROL}>; acl:origin <https://app.test>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    const shared = `[] a acl:Authorization; acl:agent <${BOB}>, <${CAROL}>; acl:accessTo <${ROOT}>; acl:mode acl:Read.`;
    // The write also changed a rule that has since gone, so this is not an exact inverse.
    const gone = `[] a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${ROOT}>; acl:mode acl:Write.`;
    const pod = fixture(body(`${left} ${foreign}`));
    await pod.apply({
      changes: [],
      restore: [
        {
          source: DOC,
          remove: [`${PREFIX} ${left}`, `${PREFIX} ${gone}`],
          add: [`${PREFIX} ${shared}`],
        },
      ],
    });
    await same(await pod.graph(), body(`${shared} ${foreign}`));
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
