// AUTHORED-BY Codex GPT-6
import { DataFactory, type Store } from "n3";
import { describe, expect, it } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { ACL, ACP, RDF, RdfNode, serialize } from "../../src/engine/rdf.js";
import { readAcp } from "../../src/engine/systems/acp.js";
import { targetFixture } from "./allowlist-fixtures.js";
import { allowedEssTarget, FakePod } from "./fake-pod.js";
import { acl, grant, policy, resolve, stranger } from "./helpers.js";

async function pair() {
  const source = new FakePod("https://shared.example/alice/", "wac");
  const target = new FakePod("https://shared.example/bob/", "acp", undefined, "ess");
  await source.initialize(await acl(source, source.root));
  await target.initialize(await acl(target, target.root));
  source.store(`${source.root}file`, "private replacement");
  return { source, target };
}

function addRule(dataset: Store, root: string, scope: string, field: string, mode: string) {
  const n = (id: string) => new RdfNode(id, dataset, DataFactory);
  n(root).add(ACP + scope, scope.endsWith("Control") ? "urn:r8:control" : "urn:r8:policy");
  if (scope.endsWith("Control")) n("urn:r8:control").add(`${ACP}apply`, "urn:r8:policy");
  n("urn:r8:policy").add(ACP + field, mode);
  n("urn:r8:policy").add(`${ACP}allOf`, "urn:r8:matcher");
  n("urn:r8:matcher").add(`${ACP}agent`, `${ACP}PublicAgent`);
  return n;
}

describe("round 8: unvalidated target allowlist", () => {
  it.each([
    "acr-append",
    "acl-denial",
    "public-client-denial",
  ])("%s refuses existing resource and ancestor paths before writes", async (shape) => {
    for (const ancestor of [false, true]) {
      const { source, target } = await pair();
      const file = `${target.root}file`;
      target.store(file, "old private content");
      const resource = ancestor ? target.root : file;
      target.setAcl(resource, await acl(target, resource));
      const dataset = (await target.dataset(resource)) as Store;
      const scope = ancestor ? "memberAccessControl" : "accessControl";
      if (shape === "acr-append") {
        addRule(
          dataset,
          target.acl(resource),
          ancestor ? "memberAccess" : "access",
          "allow",
          `${ACP}Append`,
        );
      } else {
        // A public grant is masked only by an unestablished denial.
        target.setAcl(
          target.root,
          await acl(target, target.root, policy(grant(undefined, { appliesTo: "members" }))),
        );
        if (ancestor) {
          const root = (await target.dataset(target.root)) as Store;
          for (const quad of root) dataset.add(quad);
        }
        const n = addRule(
          dataset,
          target.acl(resource),
          scope,
          "deny",
          `${shape === "acl-denial" ? ACL : ACP}Read`,
        );
        n("urn:r8:policy").add(`${ACP}noneOf`, "urn:r8:owner");
        n("urn:r8:owner").add(`${ACP}agent`, target.owner);
        if (shape === "public-client-denial")
          n("urn:r8:matcher").add(`${ACP}client`, `${ACP}PublicClient`);
      }
      target.setAcl(resource, await serialize(dataset));
      expect(allowedEssTarget(dataset, resource)).toBe(false);
      expect(
        (await target.permissions(file, shape === "acr-append" ? { agent: stranger } : {})).has(
          shape === "acr-append" ? "control" : "read",
        ),
      ).toBe(true);
      expect(() => readAcp(dataset, resource, target.acl(resource), "ess", true)).toThrow(
        /allowlist/,
      );
      const options = { source: source.side(), target: target.side() };
      const plan = await planMigration(options);
      expect(
        plan.report
          .find(
            (item) => item.kind === "acl-unreadable" && item.resourceUrl === `${source.root}file`,
          )
          ?.options.map((option) => option.id),
      ).toEqual(["skip", "abort"]);
      const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
      expect(result.copied).toEqual([]);
      expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
      expect(new TextDecoder().decode(target.data.get(file)?.bytes)).toBe("old private content");
    }
  });

  it("the fake independently refuses unallowlisted access writes without changing the document", async () => {
    const { target } = await pair();
    const bad = await targetFixture(target, "public-client");
    const before = target.access.get(target.acl(target.root));
    const response = await target.request(target.acl(target.root), {
      method: "PUT",
      body: await serialize(bad),
      headers: { "content-type": "text/turtle" },
    });
    expect(response.status).toBe(400);
    expect(target.access.get(target.acl(target.root))).toEqual(before);
  });

  it.each([
    "owner-lock",
    "typed-root",
  ])("plans ordinary ESS migrations with the %s fixture", async (shape) => {
    const { source, target } = await pair();
    if (shape === "typed-root") {
      // Existing ESS typed-root fixture contract: the ACR is typed and has no resource binding.
      const dataset = (await target.dataset(target.root)) as Store;
      for (const quad of [...dataset.match(null, DataFactory.namedNode(`${ACP}resource`))])
        dataset.delete(quad);
      expect(
        dataset.match(
          null,
          DataFactory.namedNode(`${RDF}type`),
          DataFactory.namedNode(`${ACP}AccessControlResource`),
        ).size,
      ).toBe(1);
      target.setAcl(target.root, await serialize(dataset));
    }
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    expect(plan.report.filter((item) => item.kind === "acl-unreadable")).toEqual([]);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(result.copied).toContain(`${target.root}file`);
  });
});

describe("round 8: source client wildcards", () => {
  it.each([
    "wac",
    "acp",
  ] as const)("never promotes an ESS PublicClient grant to public on %s", async (system) => {
    const source = new FakePod("https://shared.example/alice/", "acp", undefined, "ess");
    const target = new FakePod("https://shared.example/bob/", system);
    await source.initialize(await acl(source, source.root));
    await target.initialize(await acl(target, target.root));
    const file = `${source.root}file`;
    source.store(file, "login required");
    source.setAcl(file, await acl(source, file));
    const dataset = (await source.dataset(file)) as Store;
    const n = addRule(dataset, source.acl(file), "accessControl", "allow", `${ACP}Read`);
    n("urn:r8:matcher").add(`${ACP}client`, `${ACP}PublicClient`);
    source.setAcl(file, await serialize(dataset));
    const read = readAcp(dataset, file, source.acl(file), "ess");
    expect(read.grants.find((rule) => rule.source.node === "urn:r8:policy")?.who).toEqual([
      [{ kind: "authenticated" }],
    ]);
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(
      new Set(["read"]),
    );
  });

  it.each([
    "wac",
    "acp",
  ] as const)("requires login for every alternative of an ESS policy with a client matcher on %s", async (system) => {
    const source = new FakePod("https://shared.example/alice/", "acp", undefined, "ess");
    const target = new FakePod("https://shared.example/bob/", system);
    await source.initialize(await acl(source, source.root));
    await target.initialize(await acl(target, target.root));
    const file = `${source.root}file`;
    source.store(file, "login required");
    source.setAcl(file, await acl(source, file));
    const dataset = (await source.dataset(file)) as Store;
    const n = addRule(dataset, source.acl(file), "accessControl", "allow", `${ACP}Read`);
    dataset.removeMatches(
      DataFactory.namedNode("urn:r8:policy"),
      DataFactory.namedNode(`${ACP}allOf`),
    );
    n("urn:r8:policy").add(`${ACP}anyOf`, "urn:r8:matcher");
    n("urn:r8:policy").add(`${ACP}anyOf`, "urn:r8:client");
    n("urn:r8:client").add(`${ACP}agent`, `${ACP}PublicAgent`);
    n("urn:r8:client").add(`${ACP}client`, `${ACP}PublicClient`);
    source.setAcl(file, await serialize(dataset));
    const who = readAcp(dataset, file, source.acl(file), "ess").grants.find(
      (rule) => rule.source.node === "urn:r8:policy",
    )?.who;
    expect(who?.length).toBeGreaterThan(0);
    for (const clause of who ?? []) {
      expect(clause.some((subject) => subject.kind === "public")).toBe(false);
      expect(clause.some((subject) => subject.kind === "authenticated")).toBe(true);
    }
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
  });

  it("never turns a client conjunction in a source denial exclusion into broad exemptions", async () => {
    const source = new FakePod("https://shared.example/alice/", "acp", undefined, "ess");
    const target = new FakePod("https://shared.example/bob/", "acp");
    await source.initialize(await acl(source, source.root));
    await target.initialize(await acl(target, target.root));
    const file = `${source.root}file`;
    source.store(file, "denied to strangers");
    source.setAcl(file, await acl(source, file));
    const dataset = (await source.dataset(file)) as Store;
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    n(source.acl(file)).add(`${ACP}accessControl`, "urn:r8:deny-control");
    n("urn:r8:deny-control").add(`${ACP}apply`, "urn:r8:grant");
    n("urn:r8:deny-control").add(`${ACP}apply`, "urn:r8:denial");
    n("urn:r8:grant").add(`${ACP}allow`, `${ACP}Read`);
    n("urn:r8:grant").add(`${ACP}allOf`, "urn:r8:public");
    n("urn:r8:denial").add(`${ACP}deny`, `${ACP}Read`);
    n("urn:r8:denial").add(`${ACP}allOf`, "urn:r8:public");
    n("urn:r8:denial").add(`${ACP}noneOf`, "urn:r8:trusted");
    n("urn:r8:denial").add(`${ACP}noneOf`, "urn:r8:owner");
    n("urn:r8:public").add(`${ACP}agent`, `${ACP}PublicAgent`);
    n("urn:r8:trusted").add(`${ACP}agent`, "https://trusted.example/person");
    n("urn:r8:trusted").add(`${ACP}client`, `${ACP}PublicClient`);
    n("urn:r8:owner").add(`${ACP}agent`, source.owner);
    source.setAcl(file, await serialize(dataset));
    const denial = readAcp(dataset, file, source.acl(file), "ess").denials.find(
      (rule) => rule.source.node === "urn:r8:denial",
    );
    expect(denial?.except.some((subject) => subject.kind === "authenticated")).toBe(false);
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(new Set());
    expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
  });

  it("requires login for a source grant whose client matcher appears only in noneOf", async () => {
    const source = new FakePod("https://shared.example/alice/", "acp", undefined, "ess");
    const target = new FakePod("https://shared.example/bob/", "acp");
    await source.initialize(await acl(source, source.root));
    await target.initialize(await acl(target, target.root));
    const file = `${source.root}file`;
    source.store(file, "login required");
    source.setAcl(file, await acl(source, file));
    const dataset = (await source.dataset(file)) as Store;
    const n = addRule(dataset, source.acl(file), "accessControl", "allow", `${ACP}Read`);
    n("urn:r8:policy").add(`${ACP}noneOf`, "urn:r8:client");
    n("urn:r8:client").add(`${ACP}agent`, `${ACP}PublicAgent`);
    n("urn:r8:client").add(`${ACP}client`, "https://trusted.example/app");
    source.setAcl(file, await serialize(dataset));
    const who = readAcp(dataset, file, source.acl(file), "ess").grants.find(
      (rule) => rule.source.node === "urn:r8:policy",
    )?.who;
    for (const clause of who ?? [])
      expect(clause.some((subject) => subject.kind === "public")).toBe(false);
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
  });
});
