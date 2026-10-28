// AUTHORED-BY Codex GPT-6
import { createRequire, registerHooks } from "node:module";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { ACL, ACP, FOAF, RDF, RdfNode, serialize } from "../../src/engine/rdf.js";
import type { Mode } from "../../src/engine/types.js";
import { FakePod, type Identity } from "./fake-pod.js";
import { acl, resolve, stranger } from "./helpers.js";

const requireCss = createRequire(import.meta.url);
// Enforce strict pnpm dependency ownership even when this checkout happens to
// expose the transitive evaluator to the app through a flatter node_modules.
const strictLayout = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@solid/access-control-policy" && context.parentURL === import.meta.url)
      throw new Error("The app cannot resolve CSS's transitive evaluator directly");
    return nextResolve(specifier, context);
  },
});
const { allowAccessModes } = createRequire(
  requireCss.resolve("@solid/community-server/package.json"),
)("@solid/access-control-policy");
const { getAccessControlledResources } = requireCss(
  "@solid/community-server/dist/authorization/AcpUtil.js",
);
const { WebAclReader } = requireCss("@solid/community-server/dist/authorization/WebAclReader.js");
const { AgentAccessChecker } = requireCss(
  "@solid/community-server/dist/authorization/access/AgentAccessChecker.js",
);
const { AgentClassAccessChecker } = requireCss(
  "@solid/community-server/dist/authorization/access/AgentClassAccessChecker.js",
);
const { AgentGroupAccessChecker } = requireCss(
  "@solid/community-server/dist/authorization/access/AgentGroupAccessChecker.js",
);
const { BooleanHandler } = requireCss(
  "@solid/community-server/dist/util/handlers/BooleanHandler.js",
);
strictLayout.deregister();

const dialects = ["css-wac", "css-acp", "ess", "nss"] as const;
type Dialect = (typeof dialects)[number];
const constructs = [
  "agent",
  "public",
  "authenticated",
  "group-public",
  "group-private",
  "owner",
  "creator",
  "client-only",
  "client-agent",
  "client-separate",
  "issuer",
  "vc",
  "vc-only",
  "origin",
  "allOf",
  "anyOf",
  "deny",
  "noneOf",
  "deny-vc",
  "noneOf-vc",
  "deny-except-vc",
  "resource-scope",
  "member-scope",
  "control",
  "append",
  "write",
  "deny-append",
  "deny-write",
  "defaultForNew",
  "acp-modes",
  "typed-acr",
  "acr-self",
  "access",
  "memberAccess",
  "resource-control-mode",
  "noneOf-client-only",
  "deny-client-only",
  "deny-issuer",
  "noneOf-issuer",
  "deny-except-issuer",
] as const;
type Construct = (typeof constructs)[number];
const other = "https://people.example/other#me";
const client = "urn:client";
const issuer = "urn:issuer";
const vc = "urn:vc";
const origin = "https://app.example";
const matching: Identity = { agent: stranger, client, issuer, vc: [vc], origin };
const identities: Identity[] = [
  {},
  { agent: stranger },
  { agent: other },
  matching,
  { ...matching, agent: undefined },
  { ...matching, agent: other },
  { ...matching, client: "urn:wrong" },
  { ...matching, issuer: "urn:wrong" },
  { ...matching, vc: [] },
  { ...matching, origin: "https://wrong.example" },
];
function pod(dialect: Dialect, name: string): FakePod {
  return new FakePod(
    `https://shared.example/${name}/`,
    dialect === "css-wac" || dialect === "nss" ? "wac" : "acp",
    undefined,
    dialect === "ess" || dialect === "nss" ? dialect : "css",
  );
}

/** Actual installed CSS readers/evaluator, independent of the neutral model and serializers. */
async function cssAccess(pod: FakePod, url: string, identity: Identity): Promise<Set<Mode>> {
  if (pod.implementation !== "css") return pod.permissions(url, identity);
  const credentials = {
    agent: identity.agent ? { webId: identity.agent } : undefined,
    client: identity.client ? { clientId: identity.client } : undefined,
    issuer: identity.issuer ? { url: identity.issuer } : undefined,
  };
  if (pod.system === "wac") {
    const groupChecker = new AgentGroupAccessChecker();
    groupChecker.fetchQuads = async (groupUrl: string) => {
      const groupPod = pod.groupSource?.data.has(groupUrl) ? pod.groupSource : pod;
      const response = await groupPod.publicFetch(groupUrl);
      if (!response.ok) return new Store();
      const { parseRdf } = await import("@jeswr/fetch-rdf");
      return parseRdf(await response.text(), "text/turtle", { baseIRI: groupUrl });
    };
    const reader = new WebAclReader(
      {},
      {},
      {},
      {},
      new BooleanHandler([new AgentAccessChecker(), new AgentClassAccessChecker(), groupChecker]),
    );
    for (const ancestor of pod.ancestors(url)) {
      const dataset = await pod.dataset(ancestor);
      if (!dataset) continue;
      const selected = await reader.filterStore(dataset, ancestor, ancestor === url);
      const result = await reader.determinePermissions(selected, credentials);
      return new Set((Object.keys(result) as Mode[]).filter((mode) => result[mode]));
    }
    return new Set();
  }
  const policies = [];
  for (const ancestor of pod.ancestors(url)) {
    const dataset = await pod.dataset(ancestor);
    if (!dataset) continue;
    for (const entry of getAccessControlledResources(dataset))
      for (const control of entry.accessControlResource[
        entry.iri === url ? "accessControl" : "memberAccessControl"
      ])
        policies.push(...control.policy);
  }
  // AcpReader.createContext supplies exactly these attributes, never owner/creator/VC.
  const modes: Set<string> = allowAccessModes(policies, {
    target: url,
    agent: identity.agent,
    client: identity.client,
    issuer: identity.issuer,
  });
  const result = new Set<Mode>();
  for (const mode of ["read", "write", "append", "control"] as const)
    if (modes.has(ACL + mode[0]?.toUpperCase() + mode.slice(1))) result.add(mode);
  if (result.has("write")) result.add("append");
  return result;
}

/** Author hostile source RDF independently; unsupported language constructs are inert. */
async function fixture(
  source: FakePod,
  construct: Construct,
  existing?: "resource" | "ancestor",
): Promise<void> {
  const folder = existing ? source.root : `${source.root}folder/`;
  const file = `${folder}file`;
  source.store(folder, "", "text/turtle");
  source.store(file, "secret");
  const member = existing
    ? existing === "ancestor"
    : ["member-scope", "defaultForNew", "memberAccess"].includes(construct);
  const resource = member ? folder : file;
  source.setAcl(resource, await acl(source, resource));
  const dataset = (await source.dataset(resource)) as Store;
  const n = (id: string) => new RdfNode(id, dataset, DataFactory);
  const rule = n("urn:matrix:policy");
  const matcher = n("urn:matrix:matcher");
  const scope = member ? "memberAccessControl" : "accessControl";
  const mode =
    construct === "append"
      ? "Append"
      : construct === "write"
        ? "Write"
        : construct === "control" || construct === "resource-control-mode"
          ? "Control"
          : "Read";
  const common = [
    "agent",
    "public",
    "authenticated",
    "resource-scope",
    "member-scope",
    "control",
    "append",
    "write",
  ];
  const principal =
    construct === "public" ||
    construct === "member-scope" ||
    construct === "resource-scope" ||
    construct === "control" ||
    construct === "append" ||
    construct === "write"
      ? "public"
      : construct;
  if (source.system === "wac") {
    if (
      common.includes(construct) ||
      construct.startsWith("group-") ||
      construct === "origin" ||
      construct === "defaultForNew"
    ) {
      rule.add(`${RDF}type`, `${ACL}Authorization`);
      rule.add(
        ACL + (construct === "defaultForNew" ? "defaultForNew" : member ? "default" : "accessTo"),
        resource,
      );
      rule.add(`${ACL}mode`, ACL + mode);
      if (construct.startsWith("group-")) {
        const group = `${source.root}group#team`;
        const groupGraph = new Store();
        new RdfNode(group, groupGraph, DataFactory).add(
          "http://www.w3.org/2006/vcard/ns#hasMember",
          stranger,
        );
        source.store(`${source.root}group`, await serialize(groupGraph), "text/turtle");
        if (construct === "group-public") {
          const text = await acl(source, `${source.root}group`);
          const { parseRdf } = await import("@jeswr/fetch-rdf");
          const publicGraph = await parseRdf(text, "text/turtle");
          const auth = new RdfNode("urn:public:group", publicGraph, DataFactory);
          auth.add(`${RDF}type`, `${ACL}Authorization`);
          auth.add(`${ACL}accessTo`, `${source.root}group`);
          auth.add(`${ACL}agentClass`, `${FOAF}Agent`);
          auth.add(`${ACL}mode`, `${ACL}Read`);
          source.setAcl(`${source.root}group`, await serialize(publicGraph));
        }
        rule.add(`${ACL}agentGroup`, group);
      } else if (principal === "authenticated")
        rule.add(`${ACL}agentClass`, `${ACL}AuthenticatedAgent`);
      else if (principal === "agent" || construct === "origin") rule.add(`${ACL}agent`, stranger);
      else rule.add(`${ACL}agentClass`, `${FOAF}Agent`);
      if (construct === "origin") rule.add(`${ACL}origin`, origin);
    }
    // No ACP construct is invented in a WAC document.
  } else if (
    !construct.startsWith("group-") &&
    construct !== "origin" &&
    construct !== "defaultForNew"
  ) {
    const root = n(source.acl(resource));
    root.add(`${ACP}${scope}`, "urn:matrix:control");
    n("urn:matrix:control").add(`${ACP}apply`, rule.value);
    rule.add(
      `${ACP}allow`,
      (construct === "acp-modes" || source.implementation === "ess" ? ACP : ACL) + mode,
    );
    rule.add(`${ACP}allOf`, matcher.value);
    matcher.add(
      `${ACP}agent`,
      principal === "agent" || construct === "client-agent" || construct === "client-separate"
        ? stranger
        : principal === "authenticated"
          ? `${ACP}AuthenticatedAgent`
          : principal === "owner"
            ? `${ACP}OwnerAgent`
            : principal === "creator"
              ? `${ACP}CreatorAgent`
              : `${ACP}PublicAgent`,
    );
    if (construct === "client-only") {
      for (const q of [
        ...dataset.match(
          DataFactory.namedNode(matcher.value),
          DataFactory.namedNode(`${ACP}agent`),
        ),
      ])
        dataset.delete(q);
      matcher.add(`${ACP}client`, client);
    }
    if (construct === "client-agent") {
      matcher.add(`${ACP}client`, client);
      matcher.add(`${ACP}agent`, stranger);
    }
    if (construct === "client-separate") {
      rule.add(`${ACP}allOf`, "urn:matrix:separate-client");
      n("urn:matrix:separate-client").add(`${ACP}client`, client);
    }
    if (construct === "issuer") matcher.add(`${ACP}issuer`, issuer);
    if (construct === "vc" || construct === "vc-only") matcher.add(`${ACP}vc`, vc);
    if (construct === "vc-only")
      for (const q of [
        ...dataset.match(
          DataFactory.namedNode(matcher.value),
          DataFactory.namedNode(`${ACP}agent`),
        ),
      ])
        dataset.delete(q);
    if (construct === "allOf" || construct === "anyOf") {
      if (construct === "anyOf")
        for (const q of [
          ...dataset.match(DataFactory.namedNode(rule.value), DataFactory.namedNode(`${ACP}allOf`)),
        ])
          dataset.delete(q);
      rule.add(ACP + construct, "urn:matrix:condition");
      if (construct === "anyOf") rule.add(`${ACP}anyOf`, matcher.value);
      matcher.add(`${ACP}client`, client);
      n("urn:matrix:condition").add(`${ACP}agent`, `${ACP}AuthenticatedAgent`);
      n("urn:matrix:condition").add(`${ACP}issuer`, issuer);
    }
    if (
      [
        "deny",
        "noneOf",
        "deny-vc",
        "noneOf-vc",
        "deny-except-vc",
        "deny-append",
        "deny-write",
        "noneOf-client-only",
        "deny-client-only",
        "deny-issuer",
        "noneOf-issuer",
        "deny-except-issuer",
      ].includes(construct)
    ) {
      const excluded = n("urn:matrix:excluded");
      excluded.add(
        `${ACP}agent`,
        construct.includes("vc") || construct.includes("issuer") ? `${ACP}PublicAgent` : other,
      );
      if (construct.includes("vc")) excluded.add(`${ACP}vc`, vc);
      if (construct.includes("issuer")) excluded.add(`${ACP}issuer`, issuer);
      if (construct.includes("client-only")) {
        for (const q of [
          ...dataset.match(
            DataFactory.namedNode(excluded.value),
            DataFactory.namedNode(`${ACP}agent`),
          ),
        ])
          dataset.delete(q);
        excluded.add(`${ACP}client`, client);
      }
      if (construct.startsWith("noneOf")) rule.add(`${ACP}noneOf`, excluded.value);
      else {
        const denial = n("urn:matrix:denial");
        denial.add(`${ACP}noneOf`, "urn:matrix:migration-owner");
        n("urn:matrix:migration-owner").add(`${ACP}agent`, source.owner);
        n("urn:matrix:control").add(`${ACP}apply`, denial.value);
        denial.add(
          `${ACP}deny`,
          (source.implementation === "ess" ? ACP : ACL) +
            (construct === "deny-append"
              ? "Append"
              : construct === "deny-write"
                ? "Write"
                : "Read"),
        );
        denial.add(
          `${ACP}allOf`,
          construct.startsWith("deny-except-") ? matcher.value : excluded.value,
        );
        if (construct.startsWith("deny-except-")) denial.add(`${ACP}noneOf`, excluded.value);
        if (construct === "deny-append" || construct === "deny-write")
          rule.add(`${ACP}allow`, `${ACL}Write`);
      }
    }
    if (
      (["control", "access", "memberAccess", "acr-self"].includes(construct) &&
        source.implementation === "ess") ||
      ["access", "memberAccess", "acr-self"].includes(construct)
    ) {
      // ESS Control is Read+Write on access/memberAccess, never resource body access.
      for (const q of [
        ...dataset.match(DataFactory.namedNode(rule.value), DataFactory.namedNode(`${ACP}allow`)),
      ])
        dataset.delete(q);
      rule.add(`${ACP}allow`, `${ACP}Read`);
      rule.add(`${ACP}allow`, `${ACP}Write`);
      for (const q of [
        ...dataset.match(
          DataFactory.namedNode(root.value),
          DataFactory.namedNode(ACP + scope),
          DataFactory.namedNode("urn:matrix:control"),
        ),
      ])
        dataset.delete(q);
      if (construct === "acr-self") {
        n("urn:matrix:self").add(`${ACP}resource`, source.acl(resource));
        n("urn:matrix:self").add(`${ACP}accessControl`, "urn:matrix:control");
      } else {
        root.add(ACP + (member ? "memberAccess" : "access"), rule.value);
        for (const q of [...dataset.match(DataFactory.namedNode("urn:matrix:control"))])
          dataset.delete(q);
      }
    }
    if (construct === "typed-acr") {
      // Keep a separate explicitly bound owner policy on existing CSS ancestors:
      // the unsupported typed node must be readable to test planning's refusal.
      if (existing)
        for (const q of [
          ...dataset.match(
            DataFactory.namedNode(root.value),
            DataFactory.namedNode(`${ACP}accessControl`),
          ),
          ...dataset.match(
            DataFactory.namedNode(root.value),
            DataFactory.namedNode(`${ACP}memberAccessControl`),
          ),
        ]) {
          if (q.object.value === "urn:matrix:control") continue;
          n("urn:matrix:readable-owner").add(`${ACP}resource`, resource);
          n("urn:matrix:readable-owner").add(q.predicate.value, q.object.value);
        }
      for (const q of [
        ...dataset.match(
          DataFactory.namedNode(root.value),
          DataFactory.namedNode(`${ACP}resource`),
        ),
      ])
        dataset.delete(q);
    }
  }
  source.setAcl(resource, await serialize(dataset));
}

describe.each(dialects)("dialect safety matrix: source %s", (from) => {
  describe.each(dialects)("target %s", (to) => {
    it.each(
      constructs,
    )("%s: every observed target permission is enforced at the source", async (construct) => {
      const source = pod(from, "alice");
      const target = pod(to, "bob");
      await source.initialize(await acl(source, source.root));
      await target.initialize(await acl(target, target.root));
      target.groupSource = source;
      await fixture(source, construct);
      const probes = [...identities, { ...matching, agent: source.owner }];
      const paths = ["folder/", "folder/file", "folder/future"];
      const original = new Map<string, Set<Mode>>();
      for (const path of paths)
        for (const [i, identity] of probes.entries())
          original.set(`${path}:${i}`, await cssAccess(source, source.root + path, identity));
      // Validate the fixture positively against the server oracle wherever supported.
      const basic = ["agent", "public", "authenticated", "resource-scope", "append", "write"];
      if (basic.includes(construct) || (construct === "group-public" && source.system === "wac"))
        expect(original.get("folder/file:3")?.size).toBeGreaterThan(0);
      if (
        (construct === "client-only" && from === "ess") ||
        (construct === "vc" && from === "css-acp") ||
        construct === "group-private"
      )
        expect(original.get("folder/file:3")).toEqual(new Set());
      let observations = 0;
      const check = async () => {
        for (const path of paths) {
          if (!target.data.has(target.root + path) && path !== "folder/future") continue;
          for (const [i, identity] of probes.entries()) {
            const actual = await cssAccess(target, target.root + path, identity);
            for (const mode of actual)
              expect(
                original.get(`${path}:${i}`)?.has(mode),
                `${from} → ${to}, ${construct}, ${path}, ${JSON.stringify(identity)} acquired ${mode}`,
              ).toBe(true);
            observations++;
          }
        }
      };
      target.afterWrite = check;
      const options = { source: source.side(), target: target.side() };
      const plan = await planMigration(options);
      const decisions = resolve(plan, { "acl-unreadable": "skip" });
      for (const item of plan.report)
        if (
          item.kind === "group-unsupported" &&
          item.options.some((option) => option.id === "expand")
        )
          (decisions as Record<string, string>)[item.id] = "expand";
      const result = await executeMigration(finalizePlan(plan, decisions), options);
      expect(result.failed).toEqual([]);
      expect(result.verified).toBe(true);
      if (
        plan.report.some(
          (item) => item.kind === "acl-unreadable" && item.resourceUrl.endsWith("/file"),
        )
      )
        expect(result.skipped.some((item) => item.url === `${source.root}folder/file`)).toBe(true);
      else expect(result.copied).toContain(`${target.root}folder/file`);
      await check();
      expect(observations).toBeGreaterThan(0);
      if (basic.includes(construct) || (construct === "group-public" && source.system === "wac"))
        expect(await cssAccess(target, `${target.root}folder/file`, matching)).toEqual(
          original.get("folder/file:3"),
        );
    });
  });
});

describe.each(dialects)("existing-target matrix: %s", (dialect) => {
  describe.each(["resource", "ancestor"] as const)("collaborator-created %s", (placement) => {
    it.each(
      constructs,
    )("%s: retained controls cannot expose private replacement content", async (construct) => {
      const source = pod("css-wac", "alice");
      const target = pod(dialect, "bob");
      await source.initialize(await acl(source, source.root));
      await target.initialize(await acl(target, target.root));
      source.store(`${source.root}file`, "private replacement");
      await fixture(target, construct, placement);
      target.creators.set(target.root, stranger);
      target.creators.set(`${target.root}file`, stranger);
      const file = `${target.root}file`;
      const old = target.data.get(file);
      const originalAccess = new Map(target.access);
      const probes = [...identities, { ...matching, agent: target.owner }];
      let observations = 0;
      const check = async () => {
        if (new TextDecoder().decode(target.data.get(file)?.bytes) !== "private replacement")
          return;
        for (const identity of probes) {
          if (identity.agent === target.owner) continue;
          expect(
            await cssAccess(target, file, identity),
            `${dialect}, ${placement}, ${construct}, ${JSON.stringify(identity)}`,
          ).toEqual(new Set());
          observations++;
        }
      };
      target.afterWrite = check;
      const options = { source: source.side(), target: target.side() };
      const plan = await planMigration(options);
      const decisions = resolve(plan);
      for (const item of plan.report)
        if (
          item.kind === "target-exists" &&
          item.options.some((option) => option.id === "overwrite")
        )
          (decisions as Record<string, string>)[item.id] = "overwrite";
      let executable: ReturnType<typeof finalizePlan>;
      try {
        executable = finalizePlan(plan, decisions);
      } catch (error) {
        expect(String(error)).toMatch(/widens|too complex/);
        expect(target.data.get(file)).toEqual(old);
        expect(target.access).toEqual(originalAccess);
        expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
        return;
      }
      const result = await executeMigration(executable, options);
      await check();
      if (result.copied.includes(file)) {
        expect(result.failed).toEqual([]);
        expect(result.verified).toBe(true);
        expect(observations).toBeGreaterThan(0);
      } else {
        expect(result.skipped.some((entry) => entry.url === `${source.root}file`)).toBe(true);
        expect(plan.report.some((item) => item.kind === "acl-unreadable")).toBe(true);
        expect(target.data.get(file)).toEqual(old);
        expect(target.access).toEqual(originalAccess);
        expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
      }
    });
  });
});
