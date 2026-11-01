// AUTHORED-BY Codex GPT-6
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  createPodHttp,
  executeMigration,
  finalizePlan,
  planMigration,
} from "../../src/engine/index.js";
import { ACL, ACP, RdfNode, serialize } from "../../src/engine/rdf.js";
import { readAcp } from "../../src/engine/systems/acp.js";
import { FakePod } from "./fake-pod.js";
import { acl, grant, pods, policy, resolve, stranger } from "./helpers.js";

describe("round 6 regressions", () => {
  it.each([
    "missing-transport",
    "public-redirect",
    "revoked-after-review",
  ])("keeps anonymous group evidence fail closed: %s", async (change) => {
    const { source, target } = await pods();
    const file = `${source.root}file`;
    const url = `${source.root}group`;
    const group = `${url}#team`;
    source.store(file, "secret");
    const dataset = await source.dataset(source.root);
    if (!dataset) throw new Error("Expected ACL");
    new RdfNode(group, dataset, DataFactory).add(
      "http://www.w3.org/2006/vcard/ns#hasMember",
      stranger,
    );
    source.store(url, await serialize(dataset), "text/turtle");
    source.setAcl(url, await acl(source, url, policy(grant())));
    source.setAcl(file, await acl(source, file, policy(grant([[{ kind: "group", group }]]))));
    const publicFetch = vi.fn(source.publicFetch);
    const sourceSide = source.side();
    sourceSide.publicHttp =
      change === "missing-transport"
        ? undefined
        : createPodHttp({ root: source.root, fetch: publicFetch });
    if (change === "public-redirect")
      publicFetch.mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://evil.example/group" } }),
      );
    const options = { source: sourceSide, target: target.side() };
    const plan = await planMigration(options);
    const item = plan.report.find((item) => item.kind === "group-unsupported");
    expect(item?.options.some((option) => option.id === "expand")).toBe(
      change === "revoked-after-review",
    );
    if (change !== "revoked-after-review") return;
    expect(publicFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ credentials: "omit", redirect: "manual" }),
    );
    const executable = finalizePlan(plan, resolve(plan, { "group-unsupported": "expand" }));
    source.setAcl(url, await acl(source, url));
    expect((await source.fetch(url)).ok).toBe(true);
    const result = await executeMigration(executable, options);
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toContain("401");
    expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
  });

  it("refuses a public transport fenced to another pod", async () => {
    const { source, target } = await pods();
    await expect(
      planMigration({
        source: { ...source.side(), publicHttp: target.side().publicHttp },
        target: target.side(),
      }),
    ).rejects.toThrow("public transport roots");
  });

  it.each([
    "css",
    "ess",
  ] as const)("retains active alternatives while dropping inactive %s clauses", async (dialect) => {
    const source = new FakePod("https://shared.example/alice/", "acp", undefined, dialect);
    const { target } = await pods("acp", "acp");
    await source.initialize(await acl(source, source.root));
    const file = `${source.root}file`;
    source.store(file, "secret");
    source.setAcl(file, await acl(source, file));
    const dataset = await source.dataset(file);
    if (!dataset) throw new Error("Expected ACR");
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    n(source.acl(file)).add(`${ACP}accessControl`, "urn:mixed:control");
    n("urn:mixed:control").add(`${ACP}apply`, "urn:mixed:policy");
    n("urn:mixed:policy").add(`${ACP}allow`, dialect === "ess" ? `${ACP}Read` : `${ACL}Read`);
    n("urn:mixed:policy").add(`${ACP}anyOf`, "urn:mixed:active");
    n("urn:mixed:policy").add(`${ACP}anyOf`, "urn:mixed:inactive");
    n("urn:mixed:active").add(`${ACP}agent`, stranger);
    n("urn:mixed:inactive").add(`${ACP}${dialect === "ess" ? "client" : "vc"}`, "urn:inactive");
    source.setAcl(file, await serialize(dataset));
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    // A discarded ESS alternative must be reported even when another anyOf branch survives.
    expect(plan.report.some((item) => item.kind === "condition-unsupported")).toBe(true);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(
      new Set(["read"]),
    );
    expect(
      await target.permissions(`${target.root}file`, {
        agent: "urn:other",
        client: "urn:inactive",
        vc: ["urn:inactive"],
      }),
    ).toEqual(new Set());
    // Direct reads without a reporting callback have the same conservative meaning.
    expect(
      readAcp(dataset, file, source.acl(file), dialect).grants.find(
        (rule) => rule.source.node === "urn:mixed:policy",
      )?.who,
    ).toEqual([[{ kind: "agent", webId: stranger }]]);
  });
  it.each([
    "css",
    undefined,
  ] as const)("refuses private group expansion from %s sources", async (implementation) => {
    const { source, target } = await pods();
    const file = `${source.root}file`;
    const groupUrl = `${source.root}group`;
    const group = `${groupUrl}#team`;
    source.store(file, "secret");
    const dataset = await source.dataset(source.root);
    if (!dataset) throw new Error("Expected ACL");
    // The document is readable by the owner, but not by CSS's unauthenticated group resolver.
    new RdfNode(group, dataset, DataFactory).add(
      "http://www.w3.org/2006/vcard/ns#hasMember",
      stranger,
    );
    source.store(groupUrl, await serialize(dataset), "text/turtle");
    source.setAcl(file, await acl(source, file, policy(grant([[{ kind: "group", group }]]))));
    const options = { source: { ...source.side(), implementation }, target: target.side() };
    const plan = await planMigration(options);
    expect(
      plan.report
        .find((item) => item.kind === "group-unsupported")
        ?.options.map((option) => option.id),
    ).toEqual(["skip", "abort"]);
    expect(await source.permissions(file, { agent: stranger })).toEqual(new Set());
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(new Set());
  });

  it.each([
    "client",
    "vc",
  ] as const)("drops source-inactive %s grants with a report", async (attribute) => {
    const source = new FakePod(
      "https://shared.example/alice/",
      "acp",
      undefined,
      attribute === "client" ? "ess" : "css",
    );
    const target = new FakePod(
      "https://shared.example/bob/",
      "acp",
      undefined,
      attribute === "client" ? "css" : "ess",
    );
    await source.initialize(await acl(source, source.root));
    await target.initialize(await acl(target, target.root));
    const file = `${source.root}file`;
    source.store(file, "secret");
    source.setAcl(file, await acl(source, file));
    const dataset = await source.dataset(file);
    if (!dataset) throw new Error("Expected ACR");
    const n = (id: string) => new RdfNode(id, dataset, DataFactory);
    n(source.acl(file)).add(`${ACP}accessControl`, "urn:inactive:ac");
    n("urn:inactive:ac").add(`${ACP}apply`, "urn:inactive:policy");
    n("urn:inactive:policy").add(`${ACP}allow`, `${ACL}Read`);
    n("urn:inactive:policy").add(`${ACP}allOf`, "urn:inactive:matcher");
    n("urn:inactive:matcher").add(ACP + attribute, "urn:condition");
    source.setAcl(file, await serialize(dataset));
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    expect(
      plan.report.some(
        (item) =>
          item.kind === "condition-unsupported" &&
          item.sourceRuleTurtle?.includes("urn:inactive:policy"),
      ),
    ).toBe(true);
    const identity = { agent: stranger, client: "urn:condition", vc: ["urn:condition"] };
    expect(await source.permissions(file, identity)).toEqual(new Set());
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(await target.permissions(`${target.root}file`, identity)).toEqual(new Set());
  });

  it("locks nested ESS destinations with resource and member Control", async () => {
    const { source } = await pods();
    const target = new FakePod("https://shared.example/bob/", "acp", undefined, "ess");
    await target.initialize(await acl(target, target.root));
    source.store(`${source.root}nested/`, "", "text/turtle");
    source.store(`${source.root}nested/deeper/`, "", "text/turtle");
    source.store(`${source.root}nested/deeper/file`, "secret");
    const options = {
      source: source.side(),
      target: target.side(),
      targetContainer: `${target.root}destination/`,
    };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(result.copied).toEqual([`${target.root}destination/nested/deeper/file`]);
    expect(
      await target.permissions(`${target.root}destination/nested/deeper/future`, {
        agent: target.owner,
      }),
    ).toEqual(new Set(["read", "append", "write", "control"]));
  });
});
