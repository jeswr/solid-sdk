// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { ACL, ACP, RDF, RdfNode, serialize } from "../../src/engine/rdf.js";
import { readAcp, writeAcp } from "../../src/engine/systems/acp.js";
import { translatePolicy } from "../../src/engine/translation.js";
import { FakePod } from "./fake-pod.js";
import { acl, grant, pods, policy, resolve, stranger } from "./helpers.js";

const requireCss = createRequire(import.meta.url);
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
const wacConfig = requireCss("@solid/community-server/config/ldp/authorization/readers/acl.json");

describe("round 2: source dialects and target execution phases", () => {
  it("rechecks phase safety when a changed root grant was masked by an orphan denial", async () => {
    const { source, target } = await pods("acp", "acp");
    const folder = `${source.root}folder/`;
    source.store(folder, "", "text/turtle");
    source.setAcl(folder, await acl(source, folder, policy(grant())));
    source.store(`${folder}secret`, "secret");
    const restricted = policy(grant());
    restricted.denials.push(
      grant(undefined, { appliesTo: "members", except: [{ kind: "agent", webId: target.owner }] }),
    );
    target.setAcl(`${target.root}folder/`, await acl(target, `${target.root}folder/`, restricted));
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const executable = finalizePlan(plan, resolve(plan));
    target.setAcl(
      target.root,
      await acl(target, target.root, policy(grant(undefined, { appliesTo: "members" }))),
    );
    const result = await executeMigration(executable, options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toContain("widens read");
    expect(target.requests.filter((r) => r.method === "PUT")).toEqual([]);
  });
  it.each([
    "deny",
    "exclude",
  ])("does not retain a replaced ancestor %s in the ACP proof", async (restriction) => {
    const { source, target } = await pods("acp", "acp");
    const folder = `${source.root}folder/`;
    source.store(folder, "", "text/turtle");
    source.setAcl(folder, await acl(source, folder, policy(grant())));
    source.store(`${folder}secret`, "secret");
    target.setAcl(
      target.root,
      await acl(
        target,
        target.root,
        policy(
          grant(undefined, {
            appliesTo: "members",
            except: restriction === "exclude" ? [{ kind: "agent", webId: stranger }] : [],
          }),
        ),
      ),
    );
    const restricted = policy();
    restricted.denials.push(
      grant(undefined, {
        appliesTo: "members",
        except: [{ kind: "agent", webId: target.owner }],
      }),
    );
    target.setAcl(`${target.root}folder/`, await acl(target, `${target.root}folder/`, restricted));
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    expect(() => finalizePlan(plan, resolve(plan))).toThrow("widens read");
    expect(target.requests.filter((r) => r.method === "PUT")).toEqual([]);
  });

  it.each([
    "self",
    "access",
  ])("does not manufacture CSS Control from %s policies", async (construct) => {
    const { source, target } = await pods("acp", "wac");
    const file = `${source.root}file`;
    source.store(file, "secret");
    source.setAcl(file, await acl(source, file));
    const dataset = await source.dataset(file);
    if (!dataset) throw new Error("Expected ACR");
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    if (construct === "self") {
      n("urn:self").add(`${ACP}resource`, source.acl(file));
      n("urn:self").add(`${ACP}accessControl`, "urn:ac");
      n("urn:ac").add(`${ACP}apply`, "urn:p");
    } else n(source.acl(file)).add(`${ACP}access`, "urn:p");
    n("urn:p").add(`${ACP}allow`, `${ACL}Read`);
    n("urn:p").add(`${ACP}allow`, `${ACL}Write`);
    n("urn:p").add(`${ACP}allOf`, "urn:m");
    n("urn:m").add(`${ACP}agent`, stranger);
    source.setAcl(file, await serialize(dataset));
    expect(await source.permissions(file, { agent: stranger })).toEqual(new Set());
    expect((await source.request(source.acl(file), {}, { agent: stranger })).status).toBe(403);
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    expect(
      plan.report.some(
        (item) => item.resourceUrl === file && item.options.some((o) => o.id === "abort"),
      ),
    ).toBe(true);
    const result = await executeMigration(
      finalizePlan(plan, resolve(plan, { "acl-unreadable": "owner-only" })),
      options,
    );
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(new Set());
  });

  it.each(["typed", "modes"])("does not activate CSS-ignored ACP %s grants", async (construct) => {
    const { source, target } = await pods("acp", "wac");
    const file = `${source.root}file`;
    source.store(file, "secret");
    source.setAcl(file, await acl(source, file));
    const dataset = await source.dataset(file);
    if (!dataset) throw new Error("Expected ACR");
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    const root = construct === "typed" ? "urn:typed" : source.acl(file);
    if (construct === "typed") {
      // A wholly typed fallback (the old reader supports it when there are no bindings).
      for (const quad of [...dataset]) dataset.delete(quad);
      n(root).add(`${RDF}type`, `${ACP}AccessControlResource`);
    }
    n(root).add(`${ACP}accessControl`, "urn:ac");
    n("urn:ac").add(`${ACP}apply`, "urn:p");
    n("urn:p").add(`${ACP}allow`, `${construct === "modes" ? ACP : ACL}Read`);
    n("urn:p").add(`${ACP}allOf`, "urn:m");
    n("urn:m").add(`${ACP}agent`, `${ACP}PublicAgent`);
    source.setAcl(file, await serialize(dataset));
    expect(await source.permissions(file)).toEqual(new Set());
    const options = {
      source: { ...source.side(), implementation: undefined },
      target: target.side(),
    };
    const plan = await planMigration(options);
    expect(
      plan.report.some((item) => item.resourceUrl === file && item.kind === "acl-unreadable"),
    ).toBe(true);
    const result = await executeMigration(
      finalizePlan(plan, resolve(plan, { "acl-unreadable": "owner-only" })),
      options,
    );
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
  });

  it.each([
    "css",
    "nss",
  ] as const)("does not invent defaultForNew access from a %s source", async (implementation) => {
    const source = new FakePod("https://shared.example/alice/", "wac", undefined, implementation);
    const { target } = await pods("wac", "wac");
    await source.initialize(await acl(source, source.root));
    source.store(`${source.root}file`, "secret");
    const dataset = await source.dataset(source.root);
    if (!dataset) throw new Error("Expected ACL");
    const auth = new RdfNode("urn:legacy", dataset, DataFactory);
    auth.add(`${RDF}type`, `${ACL}Authorization`);
    auth.add(`${ACL}defaultForNew`, source.root);
    auth.add(`${ACL}agentClass`, "http://xmlns.com/foaf/0.1/Agent");
    auth.add(`${ACL}mode`, `${ACL}Read`);
    source.setAcl(source.root, await serialize(dataset));
    expect((await source.permissions(`${source.root}file`)).has("read")).toBe(
      implementation === "nss",
    );
    // The engine has no established dialect here, even when the fixture enforces NSS.
    const options = {
      source: { ...source.side(), implementation: undefined },
      target: target.side(),
    };
    const plan = await planMigration(options);
    expect(plan.report.some((item) => item.kind === "acl-unreadable")).toBe(true);
    const result = await executeMigration(
      finalizePlan(plan, resolve(plan, { "acl-unreadable": "owner-only" })),
      options,
    );
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
  });

  it.each(["wac", "acp"] as const)("drops origin grants on a CSS %s target", async (system) => {
    const source = new FakePod("https://shared.example/alice/", "wac", undefined, "nss");
    const { target } = await pods("wac", system);
    await source.initialize(await acl(source, source.root));
    const file = `${source.root}file`;
    source.store(file, "secret");
    source.setAcl(file, await acl(source, file));
    const graph = await source.dataset(file);
    if (!graph) throw new Error("Expected ACL");
    const auth = new RdfNode("urn:origin", graph, DataFactory);
    auth.add(`${RDF}type`, `${ACL}Authorization`);
    auth.add(`${ACL}accessTo`, file);
    auth.add(`${ACL}agent`, stranger);
    auth.add(`${ACL}origin`, "https://allowed.example");
    auth.add(`${ACL}mode`, `${ACL}Read`);
    source.setAcl(file, await serialize(graph));
    expect(await source.permissions(file, { agent: stranger })).toEqual(new Set());
    expect(
      await source.permissions(file, { agent: stranger, origin: "https://allowed.example" }),
    ).toEqual(new Set(["read"]));
    // Use the exact shipped checker chain, so fixture enforcement cannot hide this gap.
    const configured = wacConfig["@graph"].find(
      (node: { "@type": string }) => node["@type"] === "WebAclReader",
    );
    expect(
      configured.accessChecker.handlers.map((handler: { "@id": string }) => handler["@id"]),
    ).toEqual([
      "urn:solid-server:default:AgentAccessChecker",
      "urn:solid-server:default:AgentClassAccessChecker",
      "urn:solid-server:default:AgentGroupAccessChecker",
    ]);
    const css = new WebAclReader(
      {},
      {},
      {},
      {},
      new BooleanHandler([
        new AgentAccessChecker(),
        new AgentClassAccessChecker(),
        new AgentGroupAccessChecker(),
      ]),
    );
    const cssPermissions = await css.determinePermissions(await source.dataset(file), {
      agent: { webId: stranger },
    });
    expect(cssPermissions.read).toBe(true);
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const item = plan.report.find((item) => item.kind === "origin-unsupported");
    expect(item?.options.map((o) => o.id)).toEqual(["skip", "abort"]);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(
      await target.permissions(`${target.root}file`, {
        agent: stranger,
        origin: "https://allowed.example",
      }),
    ).toEqual(new Set());
    expect(
      await target.permissions(`${target.root}file`, {
        agent: stranger,
        origin: "https://elsewhere.example",
      }),
    ).toEqual(new Set());
  });

  it("requires independent ACP target implementation evidence, even with ESS mode IRIs", async () => {
    const { source, target } = await pods("wac", "acp");
    const dataset = await target.dataset(target.root);
    if (!dataset) throw new Error("Expected ACR");
    new RdfNode("urn:decoy", dataset, DataFactory).add("urn:metadata", `${ACP}Read`);
    target.setAcl(target.root, await serialize(dataset));
    for (const implementation of [undefined, "nss"] as const) {
      const plan = await planMigration({
        source: source.side(),
        target: { ...target.side(), implementation },
      });
      expect(plan.targetSystem).toBe("unknown");
      expect(
        plan.report.find((item) => item.kind === "acl-system-unknown")?.options.map((o) => o.id),
      ).toEqual(["abort"]);
      expect(() => finalizePlan(plan, resolve(plan))).toThrow("aborted");
    }
    const plan = await planMigration({ source: source.side(), target: target.side() });
    expect(plan.targetSystem).toBe("acp");
  });

  it.each([
    "self",
    "access",
    "modes",
    "typed",
  ])("evaluates ESS %s forms independently and drops them when the source dialect is unestablished", async (construct) => {
    const source = new FakePod("https://shared.example/alice/", "acp", undefined, "ess");
    const { target } = await pods("acp", "wac");
    await source.initialize(await acl(source, source.root));
    const file = `${source.root}file`;
    source.store(file, "secret");
    source.setAcl(file, await acl(source, file));
    const dataset = await source.dataset(file);
    if (!dataset) throw new Error("Expected ACR");
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    let root = source.acl(file);
    if (construct === "typed") {
      for (const quad of [...dataset.match(null, DataFactory.namedNode(`${ACP}resource`))])
        dataset.delete(quad);
    }
    if (construct === "self") {
      root = "urn:self";
      n(root).add(`${ACP}resource`, source.acl(file));
    }
    if (construct === "access") n(root).add(`${ACP}access`, "urn:p");
    else {
      n(root).add(`${ACP}accessControl`, "urn:ac");
      n("urn:ac").add(`${ACP}apply`, "urn:p");
    }
    n("urn:p").add(`${ACP}allow`, `${ACP}Read`);
    if (construct === "self" || construct === "access")
      n("urn:p").add(`${ACP}allow`, `${ACP}Write`);
    n("urn:p").add(`${ACP}allOf`, "urn:m");
    n("urn:m").add(`${ACP}agent`, stranger);
    source.setAcl(file, await serialize(dataset));
    const expected = new Set([construct === "self" || construct === "access" ? "control" : "read"]);
    expect(await source.permissions(file, { agent: stranger })).toEqual(expected);
    expect(
      readAcp(dataset, file, source.acl(file), "ess").grants.some((rule) =>
        rule.who.some((clause) => clause.some((s) => s.kind === "agent" && s.webId === stranger)),
      ),
    ).toBe(true);
    const options = {
      source: { ...source.side(), implementation: undefined },
      target: target.side(),
    };
    const plan = await planMigration(options);
    expect(
      plan.report.some(
        (item) =>
          item.kind === "acl-unreadable" && item.options.some((option) => option.id === "abort"),
      ),
    ).toBe(true);
    const result = await executeMigration(
      finalizePlan(plan, resolve(plan, { "acl-unreadable": "owner-only" })),
      options,
    );
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(new Set());
  });

  it("translates defaultForNew only for an explicitly established NSS source", async () => {
    const source = new FakePod("https://shared.example/alice/", "wac", undefined, "nss");
    const { target } = await pods("wac", "wac");
    await source.initialize(await acl(source, source.root));
    source.store(`${source.root}file`, "public");
    const dataset = await source.dataset(source.root);
    if (!dataset) throw new Error("Expected ACL");
    const auth = new RdfNode("urn:legacy", dataset, DataFactory);
    auth.add(`${RDF}type`, `${ACL}Authorization`);
    auth.add(`${ACL}defaultForNew`, source.root);
    auth.add(`${ACL}agentClass`, "http://xmlns.com/foaf/0.1/Agent");
    auth.add(`${ACL}mode`, `${ACL}Read`);
    source.setAcl(source.root, await serialize(dataset));
    expect(await source.permissions(`${source.root}file`)).toEqual(new Set(["read"]));
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    expect(plan.report.some((item) => item.kind === "acl-unreadable")).toBe(false);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`)).toEqual(new Set(["read"]));
  });

  it("uses explicitly established ESS semantics without adding ineffective CSS Control policies", async () => {
    const source = new FakePod("https://shared.example/alice/", "acp", undefined, "ess");
    const { target } = await pods("acp", "wac");
    await source.initialize(await acl(source, source.root));
    const file = `${source.root}file`;
    source.store(file, "secret");
    source.setAcl(
      file,
      await acl(
        source,
        file,
        policy(
          grant([[{ kind: "agent", webId: stranger }]], {
            modes: new Set(["read", "write", "append", "control"]),
          }),
        ),
      ),
    );
    expect(await source.permissions(file, { agent: stranger })).toEqual(
      new Set(["read", "write", "append", "control"]),
    );
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(
      await source.permissions(file, { agent: stranger }),
    );
  });

  it("writes established ESS controls only when initial owner Control is provable", async () => {
    const { source } = await pods("wac", "wac");
    source.store(`${source.root}file`, "secret");
    const target = new FakePod("https://shared.example/bob/", "acp", undefined, "ess");
    await target.initialize(await acl(target, target.root));
    const targetFile = `${target.root}file`;
    target.setAcl(targetFile, await acl(target, targetFile));
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(new TextDecoder().decode(target.data.get(targetFile)?.bytes)).toBe("secret");
    expect(await target.permissions(targetFile, { agent: stranger })).toEqual(new Set());
  });

  it.each([
    "modes",
    "typed",
    "self",
    "access",
  ])("retains uncertain source %s denials and rejects them as target enforcement", async (construct) => {
    const { source } = await pods("acp", "acp");
    const file = `${source.root}file`;
    source.setAcl(file, await acl(source, file));
    const dataset = await source.dataset(file);
    if (!dataset) throw new Error("Expected ACR");
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    let root = source.acl(file);
    if (construct === "typed") {
      for (const quad of [...dataset]) dataset.delete(quad);
      n(root).add(`${RDF}type`, `${ACP}AccessControlResource`);
    }
    if (construct === "self") {
      root = "urn:self";
      n(root).add(`${ACP}resource`, source.acl(file));
    }
    if (construct === "access") n(root).add(`${ACP}access`, "urn:p");
    else {
      n(root).add(`${ACP}accessControl`, "urn:ac");
      n("urn:ac").add(`${ACP}apply`, "urn:p");
    }
    n("urn:p").add(`${ACP}deny`, `${construct === "modes" ? ACP : ACL}Read`);
    n("urn:p").add(`${ACP}allOf`, "urn:m");
    n("urn:m").add(`${ACP}agent`, `${ACP}PublicAgent`);
    expect(readAcp(dataset, file, source.acl(file)).denials.at(-1)?.modes).toEqual(
      new Set([construct === "self" || construct === "access" ? "control" : "read"]),
    );
    expect(() => readAcp(dataset, file, source.acl(file), "css", true)).toThrow("ESS");
  });

  it.each([
    "OwnerAgent",
    "CreatorAgent",
    "vc",
  ])("does not exempt a source denial based on uncertain %s matching", async (role) => {
    const { source } = await pods("acp", "acp");
    const file = `${source.root}file`;
    source.setAcl(file, await acl(source, file, policy(grant())));
    const dataset = await source.dataset(file);
    if (!dataset) throw new Error("Expected ACR");
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    n(source.acl(file)).add(`${ACP}accessControl`, "urn:ac");
    n("urn:ac").add(`${ACP}apply`, "urn:p");
    n("urn:p").add(`${ACP}deny`, `${ACL}Read`);
    n("urn:p").add(`${ACP}allOf`, "urn:public");
    n("urn:p").add(`${ACP}noneOf`, "urn:role");
    n("urn:public").add(`${ACP}agent`, `${ACP}PublicAgent`);
    n("urn:role").add(`${ACP}${role === "vc" ? "vc" : "agent"}`, ACP + role);
    source.setAcl(file, await serialize(dataset));
    expect((await source.permissions(file, { agent: source.owner })).has("read")).toBe(false);
    expect(readAcp(dataset, file, source.acl(file)).denials.at(-1)?.except).toEqual([]);
    expect(() => readAcp(dataset, file, source.acl(file), "css", true)).toThrow("owner/creator");
  });

  it.each([
    "append",
    "write",
  ] as const)("refuses a target %s-only denial that could mask derived Append", async (mode) => {
    const { source } = await pods("acp", "acp");
    const file = `${source.root}file`;
    const extra = policy(
      grant(undefined, { modes: new Set(mode === "append" ? ["write", "append"] : ["append"]) }),
    );
    extra.denials.push(grant(undefined, { modes: new Set([mode]) }));
    await expect(writeAcp(extra, file, source.acl(file))).rejects.toThrow("both Write and Append");
    const translated = translatePolicy(extra, "acp", {
      resourceUrl: file,
      sourceOwner: source.owner,
      targetOwner: "urn:owner",
      groups: new Map(),
    });
    expect(translated.policy.denials[0]?.modes).toEqual(new Set(["write", "append"]));
    extra.denials = [];
    source.setAcl(file, await acl(source, file, extra));
    const dataset = await source.dataset(file);
    if (!dataset) throw new Error("Expected ACR");
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    n(source.acl(file)).add(`${ACP}accessControl`, "urn:ac");
    n("urn:ac").add(`${ACP}apply`, "urn:p");
    n("urn:p").add(`${ACP}deny`, mode === "append" ? `${ACL}Append` : `${ACL}Write`);
    n("urn:p").add(`${ACP}allOf`, "urn:public");
    n("urn:public").add(`${ACP}agent`, `${ACP}PublicAgent`);
    source.setAcl(file, await serialize(dataset));
    expect((await source.permissions(file)).has("append")).toBe(true);
    expect(() => readAcp(dataset, file, source.acl(file), "css", true)).toThrow("Write/Append");
  });
});
