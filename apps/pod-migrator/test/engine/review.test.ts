// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { policiesEqual, scopePolicy } from "../../src/engine/policy.js";
import { ACL, ACP, parse, RDF, RdfNode, serialize } from "../../src/engine/rdf.js";
import { readAcp } from "../../src/engine/systems/acp.js";
import { writeWac } from "../../src/engine/systems/wac.js";
import { acl, grant, pods, policy, resolve, stranger } from "./helpers.js";

const requireCss = createRequire(import.meta.url);
const { AcpReader } = requireCss("@solid/community-server/dist/authorization/AcpReader.js");
const { getAccessControlledResources } = requireCss(
  "@solid/community-server/dist/authorization/AcpUtil.js",
);
const { allowAccessModes } = createRequire(
  requireCss.resolve("@solid/community-server/package.json"),
)("@solid/access-control-policy");

async function foreignPolicy(field: "allow" | "deny", scope = "memberAccessControl") {
  const { source, target } = await pods("acp", "wac");
  const file = `${source.root}file`;
  source.store(file, "secret");
  const dataset = await parse(
    new Response(await acl(source, file, policy(grant())), {
      headers: { "content-type": "text/turtle" },
    }),
    source.acl(file),
  );
  const node = (id: string) => new RdfNode(id, dataset, DataFactory);
  node("urn:foreign").add(`${ACP}resource`, "urn:another-resource");
  node("urn:foreign").add(ACP + scope, "urn:foreign-control");
  node("urn:foreign-control").add(`${ACP}apply`, "urn:foreign-policy");
  node("urn:foreign-policy").add(ACP + field, `${ACL}Read`);
  node("urn:foreign-policy").add(`${ACP}allOf`, "urn:foreign-matcher");
  node("urn:foreign-matcher").add(`${ACP}agent`, stranger);
  source.setAcl(file, await serialize(dataset));
  return { source, target, file, dataset, node };
}

describe("review regressions: document-wide ACP enforcement", () => {
  it("retains CSS-effective denials under a second resource node through verified ACP → WAC", async () => {
    const { source, target, file, dataset } = await foreignPolicy("deny");
    const css = new AcpReader({}, {}, {});
    const policies = [
      ...css.getEffectivePolicies({ path: file }, [...getAccessControlledResources(dataset)]),
    ];
    expect([...allowAccessModes(policies, { target: file, agent: stranger })]).toEqual([]);
    expect(await source.permissions(file, { agent: stranger })).toEqual(new Set());
    const read = readAcp(dataset, file, source.acl(file));
    expect(read.denials.some((rule) => rule.source.node === "urn:foreign-policy")).toBe(true);
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    expect(plan.report.some((item) => item.kind === "deny-unsupported")).toBe(true);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(true);
    expect(result.failed).toEqual([]);
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(new Set());
  });

  it("conservatively includes foreign accessControl denials and refuses foreign grants", async () => {
    const { source, file, dataset } = await foreignPolicy("deny", "accessControl");
    expect(readAcp(dataset, file, source.acl(file)).denials.at(-1)?.appliesTo).toBe("both");
    for (const scope of ["accessControl", "memberAccessControl", "access"]) {
      const example = await foreignPolicy("allow", scope);
      expect(() =>
        readAcp(example.dataset, example.file, example.source.acl(example.file)),
      ).toThrow();
    }
  });

  it("fails closed on detached, unknown and ambiguous ACP constructs", async () => {
    for (const mutation of ["detached", "unknown", "ambiguous", "unplaced", "wrong-role"]) {
      const { source, file, dataset, node } = await foreignPolicy("deny");
      if (mutation === "detached") node("urn:detached").add(`${ACP}deny`, `${ACL}Read`);
      if (mutation === "wrong-role") node("urn:foreign-matcher").add(`${ACP}deny`, `${ACL}Read`);
      if (mutation === "unknown") node("urn:foreign-matcher").add(`${ACP}extension`, "urn:value");
      if (mutation === "unplaced")
        node("urn:unplaced").add(`${RDF}type`, `${ACP}AccessControlResource`);
      if (mutation === "ambiguous") node("urn:foreign").add(`${ACP}resource`, file);
      expect(() => readAcp(dataset, file, source.acl(file))).toThrow();
    }
  });

  it("rejects verification when CSS-effective controls are injected under another node", async () => {
    const { source, target } = await pods("acp", "acp");
    source.store(`${source.root}file`, "secret");
    let writes = 0;
    target.afterWrite = async (url) => {
      if (url !== target.acl(`${target.root}file`) || ++writes !== 2) return;
      const dataset = await target.dataset(`${target.root}file`);
      if (!dataset) throw new Error("Expected the written ACR");
      const n = (id: string) => new RdfNode(id, dataset, DataFactory);
      n("urn:foreign").add(`${ACP}resource`, "urn:elsewhere");
      n("urn:foreign").add(`${ACP}memberAccessControl`, "urn:control");
      n("urn:control").add(`${ACP}apply`, "urn:policy");
      n("urn:policy").add(`${ACP}allow`, `${ACL}Read`);
      n("urn:policy").add(`${ACP}allOf`, "urn:matcher");
      n("urn:matcher").add(`${ACP}agent`, stranger);
      target.setAcl(`${target.root}file`, await serialize(dataset));
    };
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toContain("another ACP resource");
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(
      new Set(["read"]),
    );
  });

  it("does not let an ineffective foreign denial mask a broader target grant during verification", async () => {
    const { source, target } = await pods("acp", "acp");
    source.store(`${source.root}file`, "secret");
    let writes = 0;
    target.afterWrite = async (url) => {
      if (url !== target.acl(`${target.root}file`) || ++writes !== 2) return;
      const dataset = await target.dataset(`${target.root}file`);
      if (!dataset) throw new Error("Expected ACR");
      const n = (id: string) => new RdfNode(id, dataset, DataFactory);
      n(url).add(`${ACP}accessControl`, "urn:grant-control");
      n("urn:grant-control").add(`${ACP}apply`, "urn:broad-grant");
      n("urn:broad-grant").add(`${ACP}allow`, `${ACL}Read`);
      n("urn:broad-grant").add(`${ACP}allOf`, "urn:public");
      n("urn:public").add(`${ACP}agent`, `${ACP}PublicAgent`);
      n("urn:foreign").add(`${ACP}resource`, "urn:elsewhere");
      n("urn:foreign").add(`${ACP}accessControl`, "urn:deny-control");
      n("urn:deny-control").add(`${ACP}apply`, "urn:deny");
      n("urn:deny").add(`${ACP}deny`, `${ACL}Read`);
      n("urn:deny").add(`${ACP}allOf`, "urn:public");
      target.setAcl(`${target.root}file`, await serialize(dataset));
    };
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toContain("not specific");
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(
      new Set(["read"]),
    );
  });

  it("treats PublicClient as matching any context, including denials", async () => {
    const { source, file, dataset, node } = await foreignPolicy("deny");
    node("urn:foreign-matcher").add(`${ACP}client`, `${ACP}PublicClient`);
    const read = readAcp(dataset, file, source.acl(file));
    expect(read.denials.at(-1)?.who).toEqual([[{ kind: "agent", webId: stranger }]]);
    expect(policiesEqual(scopePolicy(read, "resource"), scopePolicy(read, "resource"))).toBe(true);
  });
});

describe("review regressions: exclusive target access documents", () => {
  it.each([
    "wac",
    "acp",
  ] as const)("reports a shared root document and preserves skipped %s root permissions", async (system) => {
    const { source, target } = await pods(system, system);
    source.store(`${source.root}file`, "secret");
    target.aclOverrides.set(`${target.root}file`, target.acl(target.root));
    const before = target.access.get(target.acl(target.root));
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    expect(
      plan.report.some(
        (item) => item.kind === "acl-unreadable" && item.resourceUrl === `${source.root}file`,
      ),
    ).toBe(true);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.aclWritten).toEqual([]);
    expect(target.access.get(target.acl(target.root))).toEqual(before);
    expect((await target.permissions(target.root, { agent: target.owner })).has("control")).toBe(
      true,
    );
  });

  it("preserves the root ACL when the shared document explicitly authorizes both root and new file", async () => {
    const { source, target } = await pods("wac", "wac");
    source.store(`${source.root}file`, "secret");
    const file = `${target.root}file`;
    const dataset = await target.dataset(target.root);
    if (!dataset) throw new Error("Expected root ACL");
    for (const quad of [
      ...dataset.match(
        null,
        DataFactory.namedNode(`${ACL}accessTo`),
        DataFactory.namedNode(target.root),
      ),
    ])
      new RdfNode(quad.subject, dataset, DataFactory).add(`${ACL}accessTo`, file);
    target.setAcl(target.root, await serialize(dataset));
    target.aclOverrides.set(file, target.acl(target.root));
    const before = target.access.get(target.acl(target.root));
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const choices = resolve(plan);
    const root = plan.report.find((item) => item.kind === "protected-target");
    expect(root && choices[root.id]).toBe("skip");
    expect(
      plan.report.some(
        (item) => item.resourceUrl === `${source.root}file` && item.kind === "acl-unreadable",
      ),
    ).toBe(true);
    const result = await executeMigration(finalizePlan(plan, choices), options);
    expect(result.copied).toEqual([]);
    expect(result.aclWritten).toEqual([]);
    expect(target.access.get(target.acl(target.root))).toEqual(before);
    expect((await target.permissions(target.root, { agent: target.owner })).has("control")).toBe(
      true,
    );
  });

  it("rejects a shared URL first advertised after placeholder creation, before copying bytes", async () => {
    const { source, target } = await pods("wac", "wac");
    source.store(`${source.root}file`, "secret");
    const before = target.access.get(target.acl(target.root));
    target.afterWrite = (url) => {
      if (url === `${target.root}file`) target.aclOverrides.set(url, target.acl(target.root));
    };
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toContain("shared");
    expect(result.copied).toEqual([]);
    expect(result.aclWritten).toEqual([]);
    expect(target.data.get(`${target.root}file`)?.bytes).toHaveLength(0);
    expect(target.access.get(target.acl(target.root))).toEqual(before);
  });

  it.each([
    "missing",
    "changed",
  ])("refuses a %s ACL advertisement immediately before the final grant", async (change) => {
    const { source, target } = await pods("wac", "wac");
    source.store(`${source.root}file`, "secret");
    const file = `${target.root}file`;
    const options = {
      source: source.side(),
      target: target.side(),
      onProgress(event: { phase: string }) {
        if (event.phase === "copy")
          target.responses.set(
            `HEAD ${file}`,
            () =>
              new Response(null, {
                headers: change === "changed" ? { link: `<${file}.new-acl>; rel="acl"` } : {},
              }),
          );
      },
    };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toContain("changed before write");
    expect(result.aclWritten).toHaveLength(1);
  });

  it("finds shared profile and unmigrated sibling ACLs", async () => {
    for (const path of ["profile/card", "unmigrated"]) {
      const { source, target } = await pods("wac", "wac");
      source.store(`${source.root}file`, "secret");
      target.store(`${target.root}${path}`, "protected");
      target.setAcl(`${target.root}${path}`, await acl(target, `${target.root}${path}`));
      target.aclOverrides.set(`${target.root}file`, target.acl(`${target.root}${path}`));
      const options = { source: source.side(), target: target.side() };
      const plan = await planMigration(options);
      expect(
        plan.report.some(
          (item) => item.kind === "acl-unreadable" && item.resourceUrl === `${source.root}file`,
        ),
      ).toBe(true);
      const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
      expect(result.aclWritten).toEqual([]);
    }
  });

  it("checks the owner's root access again even when the root was skipped", async () => {
    const { source, target } = await pods("wac", "wac");
    source.store(`${source.root}file`, "secret");
    const options = {
      source: source.side(),
      target: target.side(),
      onProgress(event: { phase: string }) {
        if (event.phase === "verify") target.setAcl(target.root, "");
      },
    };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toBe("Pod request failed (403)");
  });

  it("reports actual Control loss when recovery still allows the root ACL to be read", async () => {
    const { source, target } = await pods("wac", "wac");
    source.store(`${source.root}file`, "secret");
    const withoutControl = await writeWac(
      policy(
        grant([[{ kind: "agent", webId: target.owner }]], {
          modes: new Set(["read", "write", "append"]),
        }),
      ),
      target.root,
      target.acl(target.root),
    );
    const options = {
      source: source.side(),
      target: target.side(),
      onProgress(event: { phase: string }) {
        if (event.phase !== "verify") return;
        target.setAcl(target.root, withoutControl);
        // Model CSS's recovery read independently of the policy under test.
        target.responses.set(
          `GET ${target.acl(target.root)}`,
          () => new Response(withoutControl, { headers: { "content-type": "text/turtle" } }),
        );
      },
    };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toBe("Target owner no longer controls the root");
  });
});
