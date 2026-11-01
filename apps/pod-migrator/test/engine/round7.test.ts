// AUTHORED-BY Codex GPT-6
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { assertNotWider, emptyPolicy } from "../../src/engine/policy.js";
import { ACL, ACP, RdfNode, serialize } from "../../src/engine/rdf.js";
import { readAcp } from "../../src/engine/systems/acp.js";
import { readWac } from "../../src/engine/systems/wac.js";
import { translatePolicy } from "../../src/engine/translation.js";
import { FakePod } from "./fake-pod.js";
import { acl, grant, policy, resolve, stranger } from "./helpers.js";

async function pair() {
  const source = new FakePod("https://shared.example/alice/", "acp");
  const target = new FakePod("https://shared.example/bob/", "acp", undefined, "ess");
  await source.initialize(await acl(source, source.root));
  await target.initialize(await acl(target, target.root));
  source.store(`${source.root}file`, "private source");
  return { source, target };
}

async function accessGraph(pod: FakePod, resource: string) {
  const dataset = await pod.dataset(resource);
  if (!dataset) throw new Error("Expected fixture access document");
  return dataset;
}

describe("round 7: widest existing-target readings", () => {
  it.each([
    "wac",
    "acp",
  ] as const)("rejects unmodelled %s target predicates outside the known namespace", async (system) => {
    const target = new FakePod("https://shared.example/bob/", system);
    await target.initialize(await acl(target, target.root));
    const dataset = await accessGraph(target, target.root);
    const subject = [
      ...dataset.match(null, DataFactory.namedNode(`${system === "wac" ? ACL : ACP}agent`)),
    ][0]?.subject;
    if (!subject) throw new Error("Expected fixture principal");
    new RdfNode(subject, dataset, DataFactory).add("urn:extension:grant", stranger);
    const read = system === "wac" ? readWac : readAcp;
    expect(() => read(dataset, target.root, target.acl(target.root), "css", true)).toThrow(
      "unknown",
    );
  });

  it.each([
    "allow",
    "deny",
  ] as const)("rejects partial existing-target ACR %s permissions", async (field) => {
    const { target } = await pair();
    const dataset = await accessGraph(target, target.root);
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    n(target.acl(target.root)).add(`${ACP}memberAccess`, "urn:partial");
    n("urn:partial").add(ACP + field, `${ACP}Write`);
    n("urn:partial").add(`${ACP}allOf`, "urn:partial:matcher");
    n("urn:partial:matcher").add(`${ACP}agent`, stranger);
    expect(() => readAcp(dataset, target.root, target.acl(target.root), "ess", true)).toThrow(
      "allowlist",
    );
  });
  it.each([
    "separate-client",
    "vc-only",
    "empty",
    "unknown",
    "creator",
    "owner",
    "issuer",
    "no-positive",
  ])("reports unsupported existing-target %s grants on the resource and ancestor", async (shape) => {
    for (const ancestor of [false, true]) {
      const { source, target } = await pair();
      const file = `${target.root}file`;
      target.store(file, "collaborator's old content");
      target.creators.set(file, stranger);
      const resource = ancestor ? target.root : file;
      target.setAcl(resource, await acl(target, resource));
      const dataset = await accessGraph(target, resource);
      const n = (id: string) => new RdfNode(id, dataset, DataFactory);
      n(target.acl(resource)).add(
        ACP + (ancestor ? "memberAccessControl" : "accessControl"),
        "urn:hostile:control",
      );
      n("urn:hostile:control").add(`${ACP}apply`, "urn:hostile:policy");
      n("urn:hostile:policy").add(`${ACP}allow`, `${ACP}Read`);
      n("urn:hostile:policy").add(
        ACP + (shape === "no-positive" ? "noneOf" : "allOf"),
        "urn:hostile:matcher",
      );
      if (shape === "vc-only") n("urn:hostile:matcher").add(`${ACP}vc`, "urn:credential");
      else if (shape !== "empty") {
        n("urn:hostile:matcher").add(
          `${ACP}agent`,
          shape === "creator"
            ? `${ACP}CreatorAgent`
            : shape === "owner"
              ? `${ACP}OwnerAgent`
              : stranger,
        );
        if (shape === "separate-client") {
          n("urn:hostile:policy").add(`${ACP}allOf`, "urn:hostile:client");
          n("urn:hostile:client").add(`${ACP}client`, "urn:client");
        }
        if (shape === "unknown") n("urn:hostile:matcher").add(`${ACP}extension`, "urn:value");
        if (shape === "issuer") n("urn:hostile:matcher").add(`${ACP}issuer`, "urn:issuer");
      }
      target.setAcl(resource, await serialize(dataset));
      const options = { source: source.side(), target: target.side() };
      const plan = await planMigration(options);
      const item = plan.report.find(
        (item) => item.kind === "acl-unreadable" && item.resourceUrl === `${source.root}file`,
      );
      expect(item?.options.map((option) => option.id)).toEqual(["skip", "abort"]);
      expect(
        plan.report
          .find((item) => item.kind === "target-exists")
          ?.options.map((option) => option.id),
      ).toEqual(["skip", "abort"]);
      const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
      expect(result.copied).toEqual([]);
      expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
    }
  });

  it("ignores ESS resource Control denials that cannot restrict inherited ACR permissions", async () => {
    const { source, target } = await pair();
    const file = `${target.root}file`;
    target.store(file, "old content");
    target.setAcl(
      target.root,
      await acl(
        target,
        target.root,
        policy(
          grant([[{ kind: "agent", webId: stranger }]], {
            modes: new Set(["control"]),
            appliesTo: "members",
          }),
        ),
      ),
    );
    target.setAcl(file, await acl(target, file));
    const dataset = await accessGraph(target, file);
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    n(target.acl(file)).add(`${ACP}accessControl`, "urn:deny:control");
    n("urn:deny:control").add(`${ACP}apply`, "urn:deny:policy");
    n("urn:deny:policy").add(`${ACP}deny`, `${ACP}Control`);
    n("urn:deny:policy").add(`${ACP}allOf`, "urn:deny:matcher");
    n("urn:deny:matcher").add(`${ACP}agent`, stranger);
    target.setAcl(file, await serialize(dataset));
    expect(readAcp(dataset, file, target.acl(file), "ess", true).denials).toEqual([]);
    expect(await target.permissions(file, { agent: stranger })).toEqual(new Set(["control"]));
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    expect(() => finalizePlan(plan, resolve(plan, { "target-exists": "overwrite" }))).toThrow(
      "widens control",
    );
    expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
  });

  it("does not exempt a symbolic target creator as the target owner", () => {
    expect(() =>
      assertNotWider(emptyPolicy(), policy(grant([[{ kind: "creator" }]])), {
        targetOwner: "urn:owner",
      }),
    ).toThrow("widens read");
  });

  it.each(["pre-write", "verification"])("uses the target reading during %s", async (stage) => {
    const { source, target } = await pair();
    const file = `${target.root}file`;
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const executable = finalizePlan(plan, resolve(plan));
    const inject = async (resource: string) => {
      const dataset = await accessGraph(target, resource);
      const n = (id: string) => new RdfNode(id, dataset, DataFactory);
      n(target.acl(resource)).add(
        ACP + (resource === target.root ? "memberAccessControl" : "accessControl"),
        "urn:changed:ac",
      );
      n("urn:changed:ac").add(`${ACP}apply`, "urn:changed:policy");
      n("urn:changed:policy").add(`${ACP}allow`, `${ACP}Read`);
      n("urn:changed:policy").add(`${ACP}allOf`, "urn:changed:agent");
      n("urn:changed:agent").add(`${ACP}agent`, stranger);
      n("urn:changed:policy").add(`${ACP}allOf`, "urn:changed:client");
      n("urn:changed:client").add(`${ACP}client`, "urn:client");
      target.setAcl(resource, await serialize(dataset));
    };
    if (stage === "pre-write") await inject(target.root);
    else {
      let writes = 0;
      target.afterWrite = async (url) => {
        if (url === target.acl(file) && ++writes === 2) await inject(file);
      };
    }
    const result = await executeMigration(executable, options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toContain("unestablished");
    if (stage === "pre-write") {
      expect(result.copied).toEqual([]);
      expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
    } else {
      expect(result.copied).toEqual([file]);
      expect(await target.permissions(file, { agent: stranger, client: "urn:client" })).toEqual(
        new Set(["read"]),
      );
    }
  });

  it("evaluates separate ESS client matchers, VC-only policies and collaborator creation independently", async () => {
    const { target } = await pair();
    const file = `${target.root}file`;
    target.store(file, "old content");
    target.creators.set(file, stranger);
    for (const shape of ["client", "vc", "creator"]) {
      target.setAcl(file, await acl(target, file));
      const dataset = await accessGraph(target, file);
      const n = (id: string) => new RdfNode(id, dataset, DataFactory);
      n(target.acl(file)).add(`${ACP}accessControl`, "urn:independent:ac");
      n("urn:independent:ac").add(`${ACP}apply`, "urn:independent:p");
      n("urn:independent:p").add(`${ACP}allow`, `${ACP}Read`);
      n("urn:independent:p").add(`${ACP}allOf`, "urn:independent:m");
      if (shape === "client") {
        n("urn:independent:m").add(`${ACP}agent`, stranger);
        n("urn:independent:p").add(`${ACP}allOf`, "urn:independent:client");
        n("urn:independent:client").add(`${ACP}client`, "urn:client");
      } else
        n("urn:independent:m").add(
          ACP + (shape === "vc" ? "vc" : "agent"),
          shape === "vc" ? "urn:credential" : `${ACP}CreatorAgent`,
        );
      target.setAcl(file, await serialize(dataset));
      expect(
        (
          await target.permissions(file, {
            agent: stranger,
            client: "urn:client",
            vc: ["urn:credential"],
          })
        ).has("read"),
      ).toBe(true);
      if (shape === "client")
        expect(
          (await target.permissions(file, { agent: stranger, client: "urn:wrong" })).has("read"),
        ).toBe(false);
    }
  });
});

describe("round 7: established target conditions", () => {
  it.each([
    "issuer",
    "vc",
  ] as const)("does not promote unestablished ESS source %s grants", async (kind) => {
    const { target: source } = await pair();
    const file = `${source.root}file`;
    source.store(file, "secret");
    const condition =
      kind === "issuer" ? { kind, issuer: "urn:condition" } : { kind, vcType: "urn:condition" };
    source.setAcl(file, await acl(source, file, policy(grant([[condition]]))));
    const omitted: string[] = [];
    const read = readAcp(
      await accessGraph(source, file),
      file,
      source.acl(file),
      "ess",
      false,
      (node) => omitted.push(node),
    );
    expect(
      read.grants.flatMap((rule) => rule.who.flat()).some((subject) => subject.kind === kind),
    ).toBe(false);
    expect(omitted).toHaveLength(1);
  });
  it("omits issuer-conditioned CSS grants to ESS with provenance and skip/abort", async () => {
    const { source, target } = await pair();
    const file = `${source.root}file`;
    source.setAcl(
      file,
      await acl(source, file, policy(grant([[{ kind: "issuer", issuer: "urn:issuer" }]]))),
    );
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const item = plan.report.find((item) => item.kind === "condition-unsupported");
    expect(item?.options.map((option) => option.id)).toEqual(["skip", "abort"]);
    expect(item?.sourceRuleTurtle).toContain("urn:issuer");
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(
      await target.permissions(`${target.root}file`, { agent: stranger, issuer: "urn:wrong" }),
    ).toEqual(new Set());
    expect(
      new TextDecoder().decode(target.access.get(target.acl(`${target.root}file`))?.bytes),
    ).not.toContain("urn:issuer");
  });

  it.each([
    "issuer",
    "vc",
  ] as const)("broadens unestablished ESS %s denials and omits conditioned grants/exclusions", (kind) => {
    const condition =
      kind === "issuer" ? { kind, issuer: "urn:condition" } : { kind, vcType: "urn:condition" };
    const translated = translatePolicy(
      {
        grants: [grant(), grant([[condition]]), grant(undefined, { except: [condition] })],
        denials: [grant([[condition]], { except: [condition] })],
      },
      "acp",
      {
        resourceUrl: "urn:file",
        sourceOwner: "urn:source",
        targetOwner: "urn:target",
        targetImplementation: "ess",
        groups: new Map(),
      },
    );
    expect(translated.policy.grants).toHaveLength(1);
    expect(translated.policy.denials[0]?.who).toEqual([[{ kind: "public" }]]);
    expect(translated.policy.denials[0]?.except).toEqual([{ kind: "agent", webId: "urn:target" }]);
    expect(translated.report.some((item) => item.kind === "deny-unsupported")).toBe(true);
    expect(() =>
      assertNotWider({ grants: [grant()], denials: [grant([[condition]])] }, translated.policy, {
        targetOwner: "urn:target",
      }),
    ).not.toThrow();
  });
});
