// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { ACL, ACP, RdfNode, serialize } from "../../src/engine/rdf.js";
import { acl, grant, pods, policy, resolve, stranger } from "./helpers.js";

async function scenario(from: "wac" | "acp" = "wac", to: "wac" | "acp" = "acp") {
  const { source, target } = await pods(from, to);
  source.store(`${source.root}file`, "secret");
  const sourceSide = source.side();
  const targetSide = target.side();
  const options = { source: sourceSide, target: targetSide };
  return { source, target, options, plan: () => planMigration(options) };
}
describe("review, snapshots and exceptional execution", () => {
  for (const system of ["wac", "acp"] as const)
    it(`merges ${system} root grants without changing existing member controls or other triples`, async () => {
      const { source, target, options, plan } = await scenario(system, system);
      source.setAcl(source.root, await acl(source, source.root, policy(grant())));
      const original = await parseRdf(
        new TextDecoder().decode(target.access.get(target.acl(target.root))?.bytes),
        "text/turtle",
      );
      new RdfNode("urn:unrelated", original, DataFactory).add("urn:metadata", "urn:retained");
      target.setAcl(target.root, await serialize(original));
      const report = await plan();
      const executable = finalizePlan(report, resolve(report, { "protected-target": "merge" }));
      const result = await executeMigration(executable, options);
      expect(result.failed).toEqual([]);
      expect(result.verified).toBe(true);
      expect(await target.permissions(target.root)).toEqual(new Set(["read"]));
      expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
      const merged = await target.dataset(target.root);
      expect(
        merged?.match(
          DataFactory.namedNode("urn:unrelated"),
          DataFactory.namedNode("urn:metadata"),
          DataFactory.namedNode("urn:retained"),
        ).size,
      ).toBe(1);
    });
  it("allows owner-only copy when source rules are unknown or unreadable", async () => {
    for (const unknown of [false, true]) {
      const { source, target, options, plan } = await scenario();
      if (unknown)
        source.responses.set(
          `HEAD ${source.root}`,
          () => new Response(null, { headers: { "content-type": "text/turtle" } }),
        );
      else source.denied.set(`GET ${source.acl(`${source.root}file`)}`, 403);
      const report = await plan();
      expect(
        report.report.some((i) => i.kind === (unknown ? "acl-system-unknown" : "acl-unreadable")),
      ).toBe(true);
      const result = await executeMigration(finalizePlan(report, resolve(report)), options);
      expect(result.failed).toEqual([]);
      expect(result.copied).toHaveLength(1);
      expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
    }
  });
  it("handles unreadable ancestors, unsupported complexity, and skip decisions", async () => {
    const { source, target, options, plan } = await scenario();
    source.store(`${source.root}folder/`, "", "text/turtle");
    source.store(`${source.root}folder/child`, "child");
    source.denied.set(`GET ${source.acl(`${source.root}folder/`)}`, 403);
    const report = await plan();
    expect(report.report.filter((i) => i.kind === "acl-unreadable").length).toBeGreaterThanOrEqual(
      2,
    );
    const result = await executeMigration(finalizePlan(report, resolve(report)), options);
    expect(result.failed).toEqual([]);
    const complex = new Store();
    const n = (id: string) => new RdfNode(id, complex, DataFactory);
    n(target.acl(target.root)).add(`${ACP}resource`, target.root);
    // Source ACP branch complexity is caught as a report item before execution.
    const next = await scenario("acp", "wac");
    const dataset = new Store();
    const node = (id: string) => new RdfNode(id, dataset, DataFactory);
    node("urn:acr").add(`${ACP}resource`, `${next.source.root}file`);
    node("urn:acr").add(`${ACP}accessControl`, "urn:ac");
    node("urn:ac").add(`${ACP}apply`, "urn:p");
    node("urn:p").add(`${ACP}allow`, `${ACL}Read`);
    node("urn:p").add(`${ACP}allOf`, "urn:m");
    for (let index = 0; index < 65; index++) node("urn:m").add(`${ACP}agent`, `urn:agent-${index}`);
    next.source.setAcl(`${next.source.root}file`, await serialize(dataset));
    const complexPlan = await next.plan();
    expect(complexPlan.report.some((i) => i.kind === "too-complex")).toBe(true);
    const skipped = await executeMigration(
      finalizePlan(complexPlan, resolve(complexPlan, { "too-complex": "skip" })),
      next.options,
    );
    expect(skipped.copied).toEqual([]);
  });
  it("requires identifiable target controls and refuses forged/modified plans and invalid decisions", async () => {
    const { target, options, plan } = await scenario();
    const report = await plan();
    expect(() => finalizePlan(structuredClone(report), resolve(report))).toThrow("unmodified");
    expect(() =>
      finalizePlan(report, { ...resolve(report), [report.report[0]?.id as string]: "expand" }),
    ).toThrow("Resolve");
    (report.resources[0] as import("../../src/engine/types.js").PlannedResource).targetUrl =
      "https://evil.example/";
    expect(() => finalizePlan(report, resolve(report))).toThrow("unmodified");
    target.responses.set(`HEAD ${target.root}`, () => new Response());
    const unknown = await plan();
    expect(unknown.targetSystem).toBe("unknown");
    expect(
      unknown.report.find((i) => i.kind === "acl-system-unknown")?.options.map((o) => o.id),
    ).toEqual(["abort"]);
    await expect(executeMigration({ plan: unknown, resolutions: {} }, options)).rejects.toThrow(
      "finalized",
    );
  });
  it("rejects changed sessions and checks the immutable private execution snapshot", async () => {
    const { options, plan, target } = await scenario();
    const report = await plan();
    const exec = finalizePlan(report, resolve(report));
    for (const difference of [
      { http: target.side().http },
      { root: "https://elsewhere.example/" },
      { ownerWebId: stranger },
    ])
      await expect(
        executeMigration(exec, { ...options, target: { ...options.target, ...difference } }),
      ).rejects.toThrow("sessions");
    (exec.plan.resources[1] as import("../../src/engine/types.js").PlannedResource).targetUrl =
      "https://evil.example/";
    exec.plan.targetSystem = "unknown";
    exec.plan.sourceSystem = "unknown";
    const result = await executeMigration(exec, options);
    expect(result.verified).toBe(true);
    expect(result.copied[0]).toBe(`${target.root}file`);
  });
  it("detects content and policy changes after review without writing", async () => {
    for (const change of ["created", "removed", "etag", "permission", "root-metadata"] as const) {
      const { target, source, options, plan } = await scenario();
      if (["removed", "etag"].includes(change)) target.store(`${target.root}file`, "old");
      const report = await plan();
      const executable = finalizePlan(
        report,
        resolve(
          report,
          change === "root-metadata"
            ? { "protected-target": "merge" }
            : { "target-exists": "overwrite" },
        ),
      );
      if (change === "created") target.store(`${target.root}file`, "concurrent");
      if (change === "removed") target.data.delete(`${target.root}file`);
      if (change === "etag") target.store(`${target.root}file`, "concurrent");
      if (change === "permission")
        target.setAcl(
          target.root,
          await acl(target, target.root, policy(grant(undefined, { appliesTo: "members" }))),
        );
      if (change === "root-metadata") target.setAcl(target.root, await acl(target, target.root));
      const result = await executeMigration(executable, options);
      expect(result.failed[0]?.error).toContain("changed after review");
      expect(target.requests.some((r) => r.method === "PUT")).toBe(false);
      expect(source.requests.every((r) => ["HEAD", "GET"].includes(r.method))).toBe(true);
    }
  });
  it("rechecks source permissions and refuses a stale broad grant", async () => {
    const { source, target, options, plan } = await scenario();
    source.setAcl(`${source.root}file`, await acl(source, `${source.root}file`, policy(grant())));
    const report = await plan();
    const executable = finalizePlan(report, resolve(report));
    source.setAcl(`${source.root}file`, await acl(source, `${source.root}file`));
    const result = await executeMigration(executable, options);
    expect(result.failed[0]?.error).toContain("widens");
    expect(target.requests.some((r) => r.method === "PUT")).toBe(false);
  });
  it("requires ETags for overwrite and root merge", async () => {
    for (const kind of ["content", "acl"] as const) {
      const { target, plan } = await scenario();
      target.store(`${target.root}file`, "old");
      const stored =
        kind === "content"
          ? target.data.get(`${target.root}file`)
          : target.access.get(target.acl(target.root));
      if (stored) stored.etag = "";
      const report = await plan();
      expect(() =>
        finalizePlan(
          report,
          resolve(
            report,
            kind === "content" ? { "target-exists": "overwrite" } : { "protected-target": "merge" },
          ),
        ),
      ).toThrow("requires");
    }
  });
  it("rejects a public orphan ACL before creating a private resource", async () => {
    const { target, plan } = await scenario("wac", "wac");
    target.setAcl(`${target.root}file`, await acl(target, `${target.root}file`, policy(grant())));
    const report = await plan();
    expect(() => finalizePlan(report, resolve(report))).toThrow("widens");
    expect(target.data.has(`${target.root}file`)).toBe(false);
  });
  it("copies RDF verbatim by default and rewrites term positions only when opted in", async () => {
    for (const rewriteIris of [false, true]) {
      const { source, target, options } = await scenario();
      const dataset = new Store();
      const node = new RdfNode(`${source.root}file`, dataset, DataFactory);
      node.add(`${source.root}predicate`, `${source.root}object`);
      node.add("urn:outside", "urn:untouched");
      source.store(`${source.root}file`, await serialize(dataset), "text/turtle; charset=utf-8");
      source.store(`${source.root}plain`, "literal bytes");
      const report = await planMigration({
        ...options,
        rewriteIris,
        targetContainer: `${target.root}destination/`,
      });
      const result = await executeMigration(finalizePlan(report, resolve(report)), options);
      expect(result.failed).toEqual([]);
      const text = new TextDecoder().decode(
        target.data.get(`${target.root}destination/file`)?.bytes,
      );
      expect(text).toContain(
        rewriteIris ? `${target.root}destination/object` : `${source.root}object`,
      );
    }
  });
  it("returns request failures and storage failures without abandoning safe locks", async () => {
    const { source, options, plan } = await scenario();
    const report = await plan();
    source.responses.set(`GET ${source.root}file`, () => new Response(null, { status: 500 }));
    const result = await executeMigration(finalizePlan(report, resolve(report)), options);
    expect(result.failed[0]?.error).toContain("500");
    expect(result.skipped).toHaveLength(2);
    const report2 = await plan();
    source.responses.set(`GET ${source.root}file`, () => {
      throw "transport failed";
    });
    const storage = vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("quota");
      },
    });
    const failed = await executeMigration(finalizePlan(report2, resolve(report2)), options);
    expect(failed.failed[0]?.error).toBe("transport failed");
    storage.unstubAllGlobals();
  });
});
