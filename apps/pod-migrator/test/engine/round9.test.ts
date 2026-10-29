// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { ACL, ACP, RdfNode, serialize } from "../../src/engine/rdf.js";
import { readAcp } from "../../src/engine/systems/acp.js";
import type { Mode } from "../../src/engine/types.js";
import { cssAccess } from "./css-oracle.js";
import { FakePod, type Identity } from "./fake-pod.js";
import { acl, resolve, stranger } from "./helpers.js";

const scopes = ["accessControl", "memberAccessControl", "access", "memberAccess"] as const;
type Scope = (typeof scopes)[number];
const targets = ["wac", "acp"] as const;
const operators = ["allOf", "anyOf", "noneOf"] as const;
const atoms = [
  "agent",
  "PublicAgent",
  "AuthenticatedAgent",
  "OwnerAgent",
  "CreatorAgent",
  "client",
  "PublicClient",
  "issuer",
  "vc",
] as const;
type Atom = (typeof atoms)[number];
const client = "https://client.example/app";
const issuer = "https://issuer.example/";
const vc = "https://credential.example/Type";
const identities: Identity[] = [
  {},
  { agent: stranger },
  { agent: "https://other.example/me" },
  { agent: stranger, client, issuer, vc: [vc] },
  { client, issuer, vc: [vc] },
  { agent: stranger, client: "urn:other", issuer: "urn:other", vc: [] },
];
const isControl = (scope: Scope) => scope === "access" || scope === "memberAccess";
const isMember = (scope: Scope) => scope.startsWith("member");
const mode = (scope: Scope): Mode => (isControl(scope) ? "control" : "read");
const modes = (scope: Scope, vocabulary = ACP) =>
  isControl(scope) ? [`${vocabulary}Read`, `${vocabulary}Write`] : [`${vocabulary}Read`];

async function fixture(scope: Scope, targetSystem: "wac" | "acp", explicit = false) {
  const source = new FakePod("https://shared.example/alice/", "acp", undefined, "ess");
  const target = new FakePod("https://shared.example/bob/", targetSystem);
  await source.initialize(await acl(source, source.root));
  await target.initialize(await acl(target, target.root));
  const folder = `${source.root}folder/`;
  const file = `${folder}file`;
  source.store(folder, "", "text/turtle");
  source.store(file, "secret");
  const resource = isMember(scope) ? folder : file;
  source.setAcl(resource, await acl(source, resource));
  if (explicit && isMember(scope)) source.setAcl(file, await acl(source, file));
  const dataset = (await source.dataset(resource)) as Store;
  const n = (id: string) => new RdfNode(id, dataset, DataFactory);
  const add = (id: string, field: "allow" | "deny", values = modes(scope)) => {
    n(source.acl(resource)).add(ACP + scope, isControl(scope) ? id : `${id}:control`);
    if (!isControl(scope)) n(`${id}:control`).add(`${ACP}apply`, id);
    for (const value of values) n(id).add(ACP + field, value);
    return n(id);
  };
  return { source, target, file, resource, dataset, n, add };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function atom(f: Fixture, id: string, kind: Atom, withAgent = false) {
  if (withAgent) f.n(id).add(`${ACP}agent`, `${ACP}PublicAgent`);
  const attribute =
    kind === "client" || kind === "PublicClient"
      ? "client"
      : kind === "issuer" || kind === "vc"
        ? kind
        : "agent";
  const value =
    kind === "agent"
      ? stranger
      : kind === "client"
        ? client
        : kind === "issuer"
          ? issuer
          : kind === "vc"
            ? vc
            : ACP + kind;
  f.n(id).add(ACP + attribute, value);
}
function ownerExemption(f: Fixture, id: string) {
  f.n(id).add(`${ACP}noneOf`, "urn:r9:owner");
  f.n("urn:r9:owner").add(`${ACP}agent`, f.source.owner);
}
async function migrate(f: Fixture, check?: () => Promise<void>) {
  f.source.setAcl(f.resource, await serialize(f.dataset));
  const options = { source: f.source.side(), target: f.target.side() };
  const plan = await planMigration(options);
  if (check) f.target.afterWrite = check;
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([]);
  expect(result.verified).toBe(true);
  expect(result.copied).toContain(`${f.target.root}folder/file`);
  if (check) await check();
  return plan;
}

describe.each(scopes)("round 9: ESS source %s", (scope) => {
  describe.each(targets)("CSS %s target", (target) => {
    it.each([
      ACL,
      "urn:foreign:",
      `${ACP}unknown/`,
    ])("reports inactive %s grant modes before normalization", async (vocabulary) => {
      const f = await fixture(scope, target);
      f.add("urn:r9:bad", "allow", modes(scope, vocabulary)).add(`${ACP}allOf`, "urn:r9:public");
      atom(f, "urn:r9:public", "PublicAgent");
      expect(
        readAcp(f.dataset, f.resource, f.source.acl(f.resource), "ess").grants.some(
          (rule) => rule.source.node === "urn:r9:bad",
        ),
      ).toBe(false);
      const plan = await migrate(f);
      const report = plan.report.find(
        (item) =>
          item.kind === "condition-unsupported" && item.sourceRuleTurtle?.includes("urn:r9:bad"),
      );
      expect(report?.options.map((option) => option.id)).toEqual(["skip", "abort"]);
      expect(report?.explanation).toMatch(/mode/i);
      expect(await cssAccess(f.target, `${f.target.root}folder/file`, { agent: stranger })).toEqual(
        new Set(),
      );
    });
    it("keeps established grant modes and broad mixed-vocabulary denials", async () => {
      const f = await fixture(scope, target);
      f.add("urn:r9:grant", "allow", [...modes(scope), `${ACL}Write`]).add(
        `${ACP}allOf`,
        "urn:r9:public",
      );
      atom(f, "urn:r9:public", "PublicAgent");
      f.add("urn:r9:deny", "deny", modes(scope, ACL)).add(`${ACP}allOf`, "urn:r9:public");
      ownerExemption(f, "urn:r9:deny");
      await migrate(f);
      expect(await cssAccess(f.target, `${f.target.root}folder/file`, { agent: stranger })).toEqual(
        new Set(),
      );
    });
    it("preserves only established modes of a mixed source grant", async () => {
      const f = await fixture(scope, target);
      const established = isControl(scope) ? [`${ACP}Read`] : modes(scope);
      f.add("urn:r9:mixed", "allow", [...established, `${ACL}Write`]).add(
        `${ACP}allOf`,
        "urn:r9:public",
      );
      atom(f, "urn:r9:public", "PublicAgent");
      await migrate(f);
      expect(await cssAccess(f.target, `${f.target.root}folder/file`, { agent: stranger })).toEqual(
        new Set(isControl(scope) ? [] : ["read"]),
      );
    });
    it.each([
      "issuer",
      "vc",
    ] as const)("removes an unestablished %s denial exemption", async (kind) => {
      const f = await fixture(scope, target);
      f.add("urn:r9:grant", "allow").add(`${ACP}allOf`, "urn:r9:public");
      f.add("urn:r9:deny", "deny").add(`${ACP}allOf`, "urn:r9:public");
      atom(f, "urn:r9:public", "PublicAgent");
      f.n("urn:r9:deny").add(`${ACP}noneOf`, "urn:r9:uncertain");
      atom(f, "urn:r9:uncertain", kind, true);
      ownerExemption(f, "urn:r9:deny");
      const denial = readAcp(f.dataset, f.resource, f.source.acl(f.resource), "ess").denials.find(
        (rule) => rule.source.node === "urn:r9:deny",
      );
      expect(denial?.except).toEqual([{ kind: "agent", webId: f.source.owner }]);
      const plan = await migrate(f);
      expect(
        plan.report.some(
          (item) =>
            item.kind === "condition-unsupported" && item.explanation.includes("denial exemptions"),
        ),
      ).toBe(true);
      expect(
        await cssAccess(f.target, `${f.target.root}folder/file`, identities[3] as Identity),
      ).toEqual(new Set());
    });
  });
});

describe.each([
  "memberAccessControl",
  "memberAccess",
] as const)("round 9: strictest ESS ancestor %s composition", (scope) => {
  it.each(targets)("rechecks explicit source grants before CSS %s writes", async (target) => {
    const f = await fixture(scope, target);
    f.add("urn:r9:grant", "allow").add(`${ACP}allOf`, "urn:r9:public");
    atom(f, "urn:r9:public", "PublicAgent");
    f.source.setAcl(f.resource, await serialize(f.dataset));
    const options = { source: f.source.side(), target: f.target.side() };
    const plan = await planMigration(options);
    const executable = finalizePlan(plan, resolve(plan));
    f.source.setAcl(f.file, await acl(f.source, f.file));
    const result = await executeMigration(executable, options);
    expect(result.failed[0]?.error).toMatch(/widens/);
    expect(f.target.requests.filter((request) => request.method === "PUT")).toEqual([]);
  });
  it.each(targets)("rechecks explicit source grants before CSS %s final grants", async (target) => {
    const f = await fixture(scope, target);
    f.add("urn:r9:grant", "allow").add(`${ACP}allOf`, "urn:r9:public");
    atom(f, "urn:r9:public", "PublicAgent");
    f.source.setAcl(f.resource, await serialize(f.dataset));
    const changed = await acl(f.source, f.file);
    const options = {
      source: f.source.side(),
      target: f.target.side(),
      onProgress: (progress: { phase: string }) => {
        if (progress.phase === "copy") f.source.setAcl(f.file, changed);
      },
    };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed[0]?.error).toMatch(/widens/);
    expect(await cssAccess(f.target, `${f.target.root}folder/file`, { agent: stranger })).toEqual(
      new Set(),
    );
  });
  it.each(
    targets,
  )("suppresses ancestor grants with an explicit child ACR for CSS %s", async (target) => {
    const f = await fixture(scope, target, true);
    f.add("urn:r9:grant", "allow").add(`${ACP}allOf`, "urn:r9:public");
    atom(f, "urn:r9:public", "PublicAgent");
    await migrate(f);
    expect(
      (await cssAccess(f.target, `${f.target.root}folder/file`, { agent: stranger })).has(
        mode(scope),
      ),
    ).toBe(false);
  });
  it.each(
    targets,
  )("suppresses ancestor grants under a denial-only child ACR for CSS %s", async (target) => {
    const f = await fixture(scope, target);
    f.add("urn:r9:grant", "allow").add(`${ACP}allOf`, "urn:r9:public");
    atom(f, "urn:r9:public", "PublicAgent");
    const child = new Store();
    const n = (id: string) => new RdfNode(id, child, DataFactory);
    n(f.source.acl(f.file)).add(`${ACP}resource`, f.file);
    n(f.source.acl(f.file)).add(`${ACP}accessControl`, "urn:child:control");
    n("urn:child:control").add(`${ACP}apply`, "urn:child:deny");
    n("urn:child:deny").add(`${ACP}deny`, `${ACP}Append`);
    n("urn:child:deny").add(`${ACP}allOf`, "urn:child:stranger");
    n("urn:child:stranger").add(`${ACP}agent`, stranger);
    f.source.setAcl(f.file, await serialize(child));
    await migrate(f);
    for (const identity of [{}, { agent: stranger }])
      expect(
        (await cssAccess(f.target, `${f.target.root}folder/file`, identity)).has(mode(scope)),
      ).toBe(false);
  });
  it.each(
    targets,
  )("retains ancestor denials with explicit child grants for CSS %s", async (target) => {
    const f = await fixture(scope, target, true);
    f.add("urn:r9:deny", "deny").add(`${ACP}allOf`, "urn:r9:public");
    atom(f, "urn:r9:public", "PublicAgent");
    ownerExemption(f, "urn:r9:deny");
    const child = (await f.source.dataset(f.file)) as Store;
    const n = (id: string) => new RdfNode(id, child, DataFactory);
    const direct = scope === "memberAccess" ? "access" : "accessControl";
    n(f.source.acl(f.file)).add(
      ACP + direct,
      direct === "access" ? "urn:child:grant" : "urn:child:control",
    );
    if (direct === "accessControl") n("urn:child:control").add(`${ACP}apply`, "urn:child:grant");
    for (const value of modes(scope)) n("urn:child:grant").add(`${ACP}allow`, value);
    n("urn:child:grant").add(`${ACP}allOf`, "urn:child:public");
    n("urn:child:public").add(`${ACP}agent`, `${ACP}PublicAgent`);
    f.source.setAcl(f.file, await serialize(child));
    await migrate(f);
    expect(
      (await cssAccess(f.target, `${f.target.root}folder/file`, { agent: stranger })).has(
        mode(scope),
      ),
    ).toBe(false);
  });
});

// Independent strict source oracle for the atomic enumeration. Unknown positive
// grant conditions cannot activate; unknown denial exemptions cannot activate.
// No engine parser, neutral policy, or implication prover supplies this answer.
function strictMatch(
  kind: Atom,
  identity: Identity,
  owner: string,
  use: "grant" | "deny" | "grant-except" | "deny-except",
  withAgent: boolean,
) {
  switch (kind) {
    case "agent":
      return identity.agent === stranger;
    case "PublicAgent":
      return true;
    case "AuthenticatedAgent":
      return !!identity.agent;
    case "OwnerAgent":
      return identity.agent === owner;
    case "CreatorAgent":
      return use === "deny-except" ? false : identity.agent === owner;
    case "client":
      return (
        ((use !== "grant" && use !== "deny-except") || (withAgent && !!identity.agent)) &&
        identity.client === client
      );
    case "PublicClient":
      return (use !== "grant" && use !== "deny-except") || (withAgent && !!identity.agent);
    case "issuer":
    case "vc":
      return use === "deny" || use === "grant-except";
  }
}
const combinations = atoms.flatMap((matcher) =>
  operators.flatMap((operator) =>
    (["allow", "deny"] as const).flatMap((field) =>
      scopes.flatMap((scope) =>
        targets.map((target) => ({ matcher, operator, field, scope, target })),
      ),
    ),
  ),
);
expect(combinations).toHaveLength(432);
async function enumerate(c: (typeof combinations)[number], withAgent = false) {
  const f = await fixture(c.scope, c.target);
  const p = f.add("urn:r9:rule", c.field);
  atom(f, "urn:r9:atom", c.matcher, withAgent);
  p.add(ACP + c.operator, "urn:r9:atom");
  if (c.operator === "noneOf") p.add(`${ACP}allOf`, "urn:r9:public");
  if (c.operator === "noneOf" || c.field === "deny") atom(f, "urn:r9:public", "PublicAgent");
  if (c.field === "deny") {
    f.add("urn:r9:companion", "allow").add(`${ACP}allOf`, "urn:r9:public");
    ownerExemption(f, "urn:r9:rule");
  }
  const sourceAllows = (identity: Identity) => {
    const use = c.field === "allow" ? "grant" : "deny";
    const matches = strictMatch(
      c.matcher,
      identity,
      f.source.owner,
      c.operator === "noneOf" ? `${use}-except` : use,
      withAgent,
    );
    const applies = c.operator === "noneOf" ? !matches : matches;
    const login =
      c.field === "allow" && (c.matcher === "client" || c.matcher === "PublicClient")
        ? !!identity.agent
        : true;
    return c.field === "allow" ? applies && login : !applies;
  };
  let observed = 0;
  const probes = [
    ...identities,
    { agent: f.source.owner, client, issuer, vc: [vc] },
    { agent: f.target.owner },
  ];
  await migrate(f, async () => {
    const url = `${f.target.root}folder/file`;
    if (!f.target.data.has(url)) return;
    for (const identity of probes) {
      const actual = await cssAccess(f.target, url, identity);
      if (identity.agent !== f.target.owner)
        for (const granted of actual)
          expect(
            identity.agent === f.source.owner ||
              (granted === mode(c.scope) && sourceAllows(identity)),
            `${JSON.stringify(identity)} acquired ${granted}`,
          ).toBe(true);
      observed++;
    }
  });
  expect(observed).toBeGreaterThan(probes.length);
  // Avoid a vacuous implementation that drops every ordinary active grant.
  if (
    c.field === "allow" &&
    c.operator !== "noneOf" &&
    ["agent", "PublicAgent", "AuthenticatedAgent"].includes(c.matcher)
  )
    expect(
      (await cssAccess(f.target, `${f.target.root}folder/file`, { agent: stranger })).has(
        mode(c.scope),
      ),
    ).toBe(true);
}
describe("round 9: 432 atomic ESS source combinations", () => {
  it.each(combinations)("$matcher $operator $field $scope → CSS $target", async (c) =>
    enumerate(c));
});
describe("round 9: PublicAgent and conditional attribute in the same matcher", () => {
  it.each(
    combinations.filter((c) => ["client", "PublicClient", "issuer", "vc"].includes(c.matcher)),
  )("$matcher $operator $field $scope → CSS $target", async (c) => enumerate(c, true));
});

describe("round 10: auxiliary ACR nodes", () => {
  it.each(
    targets,
  )("never treats an auxiliary node's direct access as Control on CSS %s", async (target) => {
    const f = await fixture("accessControl", target);
    const aux = `${f.source.acl(f.file)}#aux`;
    f.n(aux).add(`${ACP}resource`, f.source.acl(f.file));
    f.n(aux).add(`${ACP}access`, "urn:r10:public");
    f.n("urn:r10:public").add(`${ACP}allow`, `${ACP}Read`);
    f.n("urn:r10:public").add(`${ACP}allow`, `${ACP}Write`);
    f.n("urn:r10:public").add(`${ACP}allOf`, "urn:r10:anyone");
    f.n("urn:r10:anyone").add(`${ACP}agent`, `${ACP}PublicAgent`);
    expect(() => readAcp(f.dataset, f.file, f.source.acl(f.file), "ess")).toThrow(
      /another ACP resource node/,
    );
    f.source.setAcl(f.resource, await serialize(f.dataset));
    const options = { source: f.source.side(), target: f.target.side() };
    const plan = await planMigration(options);
    await executeMigration(finalizePlan(plan, resolve(plan)), options).catch(() => undefined);
    for (const identity of [{}, { agent: stranger }])
      expect(
        (await cssAccess(f.target, `${f.target.root}folder/file`, identity)).has("control"),
      ).toBe(false);
  });

  it.each(
    targets.flatMap((target) =>
      ["shadow", "foreign", "blank"].map((subject) => [target, subject] as const),
    ),
  )("refuses direct access on a %s secondary %s subject bound to the resource", async (target, kind) => {
    const f = await fixture("accessControl", target);
    const subject =
      kind === "shadow"
        ? DataFactory.namedNode(`${f.source.acl(f.file)}#shadow`)
        : kind === "foreign"
          ? DataFactory.namedNode("https://elsewhere.example/acr")
          : DataFactory.blankNode("shadow");
    const add = (s: typeof subject, p: string, o: string) =>
      f.dataset.addQuad(s, DataFactory.namedNode(p), DataFactory.namedNode(o));
    add(subject, `${ACP}resource`, f.file);
    add(subject, `${ACP}access`, "urn:r11:public");
    f.n("urn:r11:public").add(`${ACP}allow`, `${ACP}Read`);
    f.n("urn:r11:public").add(`${ACP}allow`, `${ACP}Write`);
    f.n("urn:r11:public").add(`${ACP}allOf`, "urn:r11:anyone");
    f.n("urn:r11:anyone").add(`${ACP}agent`, `${ACP}PublicAgent`);
    expect(() => readAcp(f.dataset, f.file, f.source.acl(f.file), "ess")).toThrow();
    f.source.setAcl(f.resource, await serialize(f.dataset));
    const options = { source: f.source.side(), target: f.target.side() };
    const plan = await planMigration(options);
    await executeMigration(finalizePlan(plan, resolve(plan)), options).catch(() => undefined);
    for (const identity of [{}, { agent: stranger }])
      expect(
        (await cssAccess(f.target, `${f.target.root}folder/file`, identity)).has("control"),
      ).toBe(false);
  });
});
