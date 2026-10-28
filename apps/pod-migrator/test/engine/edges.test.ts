// AUTHORED-BY Codex GPT-6
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { writeAccess } from "../../src/engine/access.js";
import {
  createPodHttp,
  executeMigration,
  finalizePlan,
  planMigration,
} from "../../src/engine/index.js";
import { assertNotWider, ownerPolicy, unionPolicies } from "../../src/engine/policy.js";
import { RdfNode, serialize } from "../../src/engine/rdf.js";
import { writeAcp } from "../../src/engine/systems/acp.js";
import { writeWac } from "../../src/engine/systems/wac.js";
import { translatePolicy } from "../../src/engine/translation.js";
import type { PodSide } from "../../src/engine/types.js";
import type { FakePod } from "./fake-pod.js";
import { acl, grant, pods, policy, resolve, stranger } from "./helpers.js";

function transformed(
  pod: FakePod,
  transform: (url: string, method: string, response: Response) => Response,
): PodSide {
  return {
    root: pod.root,
    ownerWebId: pod.owner,
    implementation: pod.implementation,
    http: createPodHttp({
      root: pod.root,
      fetch: async (url, init) =>
        transform(url as string, init?.method ?? "GET", await pod.fetch(url, init)),
    }),
  };
}
function without(response: Response, ...names: string[]): Response {
  const headers = new Headers(response.headers);
  for (const name of names) headers.delete(name);
  return new Response(response.body, { status: response.status, headers });
}
describe("adversarial transport, metadata and planning edges", () => {
  it("validates roots, disjoint trees and destination parent existence", async () => {
    const { source, target } = await pods();
    await expect(
      planMigration({ source: { ...source.side(), root: target.root }, target: target.side() }),
    ).rejects.toThrow("roots differ");
    await expect(planMigration({ source: source.side(), target: source.side() })).rejects.toThrow(
      "disjoint",
    );
    await expect(
      planMigration({
        source: source.side(),
        target: target.side(),
        targetContainer: `${target.root}file`,
      }),
    ).rejects.toThrow("slash");
    await expect(
      planMigration({
        source: source.side(),
        target: target.side(),
        targetContainer: `${target.root}missing/deep/`,
      }),
    ).rejects.toThrow("parent");
    const controller = new AbortController();
    controller.abort();
    await expect(
      planMigration({ source: source.side(), target: target.side(), signal: controller.signal }),
    ).rejects.toThrow();
  });
  it("skips auxiliary suffixes and advertised metadata, rejects crafted listings", async () => {
    const { source, target } = await pods();
    for (const name of ["x.acl", "x.acr", "x.meta", "metadata", "file"])
      source.store(source.root + name, "bytes");
    const base = source.side();
    const wrapped = transformed(source, (url, method, response) => {
      if (method !== "HEAD" || url !== source.root) return response;
      const headers = new Headers(response.headers);
      headers.append("link", `<${source.root}metadata>; rel="describedby"`);
      return new Response(null, { headers });
    });
    const report = await planMigration({ source: wrapped, target: target.side() });
    expect(report.report.filter((i) => i.kind === "metadata-skipped")).toHaveLength(4);
    expect(report.resources.map((r) => r.sourceUrl)).not.toContain(`${source.root}metadata`);
    for (const child of [`${source.root}folder/deep`, "https://shared.example/other/secrets"]) {
      const dataset = new Store();
      new RdfNode(source.root, dataset, DataFactory).add(
        "http://www.w3.org/ns/ldp#contains",
        child,
      );
      const turtle = await serialize(dataset);
      source.responses.set(
        `GET ${source.root}`,
        () => new Response(turtle, { headers: { "content-type": "text/turtle" } }),
      );
      await expect(planMigration({ source: base, target: target.side() })).rejects.toThrow();
      expect(source.requests.some((r) => r.url === child)).toBe(false);
    }
  });
  it("bounds an attacker-controlled crawl before access processing", async () => {
    const { source, target } = await pods();
    const dataset = new Store();
    const root = new RdfNode(source.root, dataset, DataFactory);
    for (let i = 0; i < 10000; i++)
      root.add("http://www.w3.org/ns/ldp#contains", `${source.root}f${i}`);
    const turtle = await serialize(dataset);
    const side = {
      root: source.root,
      ownerWebId: source.owner,
      http: createPodHttp({
        root: source.root,
        fetch: async (_url, init) =>
          init?.method === "HEAD"
            ? new Response()
            : new Response(turtle, { headers: { "content-type": "text/turtle" } }),
      }),
    };
    await expect(planMigration({ source: side, target: target.side() })).rejects.toThrow("10000");
  }, 30000);
  it("handles untyped/unknown-size files and non-Error read failures", async () => {
    const { source, target } = await pods();
    source.store(`${source.root}file`, "bytes");
    const sourceSide = transformed(source, (url, method, response) =>
      method === "HEAD" && url.endsWith("file")
        ? without(response, "content-type", "content-length")
        : response,
    );
    source.responses.set(`GET ${source.acl(`${source.root}file`)}`, () => {
      throw "unreadable";
    });
    const report = await planMigration({ source: sourceSide, target: target.side() });
    expect(report.stats.bytes).toBe(0);
    expect(report.report.find((i) => i.kind === "acl-unreadable")?.explanation).toContain(
      "could not be read",
    );
  });
  it("reports unreadable target ancestors and skips without touching their contents", async () => {
    const { source, target } = await pods();
    source.store(`${source.root}file`, "new");
    target.store(`${target.root}file`, "old");
    let rootReads = 0;
    const targetSide = transformed(target, (url, method, response) => {
      if (url === target.acl(target.root) && method === "GET" && ++rootReads > 1)
        return new Response(null, { status: 403 });
      return response;
    });
    const options = { source: source.side(), target: targetSide };
    const report = await planMigration(options);
    expect(
      report.report.find((i) => i.kind === "protected-target")?.options.map((o) => o.id),
    ).toEqual(["skip", "abort"]);
    expect(report.report.filter((i) => i.kind === "acl-unreadable")).toHaveLength(2);
    const result = await executeMigration(finalizePlan(report, resolve(report)), options);
    // An unreadable root can no longer produce a verified result: owner Control
    // must be proven even when review skips every resource.
    expect(result.verified).toBe(false);
    expect(result.failed[0]?.error).toContain("no longer controls the root");
    expect(target.requests.some((r) => r.method === "PUT")).toBe(false);
  });
  it("protects percent-encoded aliases of the target WebID document", async () => {
    const { source, target } = await pods();
    source.store(`${source.root}%70rofile/`, "", "text/turtle");
    source.store(`${source.root}%70rofile/card`, "evil");
    const report = await planMigration({ source: source.side(), target: target.side() });
    expect(report.report.filter((i) => i.kind === "protected-target")).toHaveLength(2);
  });
  it("reads only in-fence group membership snapshots and notices subsequent membership changes", async () => {
    for (const status of ["ok", "changed", "unreadable", "foreign"] as const) {
      const { source, target } = await pods();
      source.store(`${source.root}file`, "data");
      const group =
        status === "foreign" ? "https://shared.example/other/group#id" : `${source.root}group#id`;
      const dataset = new Store();
      new RdfNode(group, dataset, DataFactory).add(
        "http://www.w3.org/2006/vcard/ns#hasMember",
        stranger,
      );
      source.store(`${source.root}group`, await serialize(dataset), "text/turtle");
      source.setAcl(
        `${source.root}file`,
        await acl(
          source,
          `${source.root}file`,
          policy(grant([[{ kind: "group", group }], [{ kind: "group", group }]])),
        ),
      );
      if (status === "unreadable") source.denied.set(`GET ${source.root}group`, 403);
      const options = { source: source.side(), target: target.side() };
      const report = await planMigration(options);
      const resolutions = Object.fromEntries(
        Object.entries(resolve(report)).map(([id, value]) => [
          id,
          id.startsWith("group-unsupported:") && ["ok", "changed"].includes(status)
            ? "expand"
            : value,
        ]),
      ) as ReturnType<typeof resolve>;
      const executable = finalizePlan(report, resolutions);
      if (status === "changed") source.store(`${source.root}group`, "", "text/turtle");
      if (status !== "unreadable") {
        if (status === "ok")
          target.afterWrite = async () => {
            for (const url of target.data.keys())
              if (url !== target.root)
                for (const identity of [{}, { agent: stranger }]) {
                  const sourceUrl = source.root + url.slice(target.root.length);
                  const allowed = await source.permissions(sourceUrl, identity);
                  for (const mode of await target.permissions(url, identity))
                    expect(allowed.has(mode)).toBe(true);
                }
          };
        const result = await executeMigration(executable, options);
        expect(result.failed.length).toBe(status === "changed" ? 1 : 0);
        if (status === "ok")
          expect(await target.permissions(`${target.root}file`, { agent: stranger })).toEqual(
            new Set(["read"]),
          );
      }
      expect(source.requests.some((r) => r.url.startsWith("https://shared.example/other/"))).toBe(
        false,
      );
    }
  });
});

describe("execution failure containment and verification", () => {
  for (const failure of [
    "missing-link-file",
    "missing-link-container",
    "missing-etag",
    "acl-etag",
    "fallback-link",
    "no-type",
    "missing-acl",
    "resource-acl",
    "members-acl",
    "short-content",
    "wrong-content",
  ] as const)
    it(failure, async () => {
      const { source, target } = await pods("wac", "wac");
      const isContainer = failure.includes("container") || failure === "members-acl";
      const path = isContainer ? "folder/" : "file";
      source.store(
        source.root + path,
        isContainer ? "" : "secret",
        isContainer ? "text/turtle" : "text/plain",
      );
      if (isContainer) source.store(`${source.root}${path}nested/`, "", "text/turtle");
      if (failure === "resource-acl" || failure === "members-acl")
        source.setAcl(
          source.root + path,
          await acl(
            source,
            source.root + path,
            policy(grant(undefined, { appliesTo: isContainer ? "both" : "resource" })),
          ),
        );
      const url = target.root + path;
      const targetSide = transformed(target, (requestUrl, method, response) => {
        if (requestUrl !== url && requestUrl !== target.acl(url)) return response;
        if (failure.startsWith("missing-link") && requestUrl === url)
          return without(response, "link");
        if (failure === "fallback-link" && method === "PUT" && requestUrl === url)
          return without(response, "link");
        if (failure === "missing-etag" && requestUrl === url) return without(response, "etag");
        if (failure === "acl-etag" && requestUrl === target.acl(url))
          return without(response, "etag");
        if (
          ["short-content", "wrong-content"].includes(failure) &&
          method === "GET" &&
          requestUrl === url
        )
          return new Response(failure === "short-content" ? "short" : "WRONG!", {
            headers: response.headers,
          });
        return response;
      });
      const sourceSide =
        failure === "no-type"
          ? transformed(source, (u, m, r) =>
              m === "GET" && u.endsWith("file") ? without(r, "content-type") : r,
            )
          : source.side();
      const options = { source: sourceSide, target: targetSide };
      const report = await planMigration(options);
      let aclWrites = 0;
      target.afterWrite = async (written) => {
        if (written !== target.acl(url) || ++aclWrites !== 2) return;
        if (failure === "missing-acl") target.access.delete(target.acl(url));
        if (failure === "resource-acl") target.setAcl(url, await acl(target, url));
        if (failure === "members-acl") target.setAcl(url, await acl(target, url, policy(grant())));
      };
      const result = await executeMigration(finalizePlan(report, resolve(report)), options);
      expect(result.verified).toBe(["fallback-link", "no-type"].includes(failure));
      if (!result.verified) expect(result.failed).toHaveLength(1);
      if (["missing-etag", "acl-etag"].includes(failure))
        expect(await target.permissions(url)).toEqual(new Set());
    });
  it("bounds an exponentially expensive policy proof", () => {
    const source = policy(
      ...Array.from({ length: 350 }, (_, i) =>
        grant([[{ kind: "group", group: `urn:group-${i}` }]]),
      ),
    );
    expect(() => assertNotWider(source, source)).toThrow("too complex");
  });
  it("covers conservative symbolic exclusions and denials", () => {
    const context = {
      resourceUrl: "urn:resource",
      sourceOwner: "urn:source",
      targetOwner: "urn:target",
      groups: new Map<string, string[]>(),
    };
    const source = {
      grants: [grant(undefined, { except: [{ kind: "owner" }] })],
      denials: [
        grant([[{ kind: "owner" }]], {
          except: [{ kind: "owner" }, { kind: "creator" }, { kind: "agent", webId: stranger }],
        }),
      ],
    };
    const result = translatePolicy(source, "acp", context);
    assertNotWider(source, result.policy, context);
    const excludedCreator = translatePolicy(
      policy(grant(undefined, { except: [{ kind: "creator" }] })),
      "acp",
      context,
    );
    expect(excludedCreator.policy.grants).toEqual([]);
    const deniedCreator = { grants: [grant()], denials: [grant([[{ kind: "creator" }]])] };
    const narrowed = translatePolicy(deniedCreator, "acp", context);
    assertNotWider(deniedCreator, narrowed.policy, context);
    expect(narrowed.policy.grants[0]?.modes.size).toBe(0);
  });
  it("refuses unnormalized emitted policies and intersecting WAC origins", async () => {
    const { source } = await pods();
    const model = unionPolicies(
      ownerPolicy(source.owner),
      policy(grant([[{ kind: "agent", webId: stranger }]], { modes: new Set(["write"]) })),
    );
    await expect(
      writeAccess(
        source.side(),
        `${source.root}file`,
        source.acl(`${source.root}file`),
        model,
        "wac",
        "css",
      ),
    ).rejects.toThrow("differs");
    await expect(
      writeWac(
        policy(
          grant([
            [
              { kind: "agent", webId: stranger },
              { kind: "origin", origin: "urn:a" },
              { kind: "origin", origin: "urn:b" },
            ],
          ]),
        ),
        "urn:resource",
        "urn:acl",
      ),
    ).rejects.toThrow("origins");
    await writeAcp(
      policy(
        grant(undefined, {
          modes: new Set(["control"]),
          except: [{ kind: "agent", webId: stranger }],
        }),
      ),
      "urn:resource",
      "urn:acl",
    );
  });
  it("propagates RDF writer failures", async () => {
    const spy = vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback: unknown) => {
      (callback as (error: Error) => void)(new Error("writer failure"));
      return undefined as never;
    });
    await expect(serialize(new Store())).rejects.toThrow("writer failure");
    spy.mockRestore();
  });
});

it("does not copy encoded auxiliaries or data mapped onto an advertised target ACR", async () => {
  const { source, target } = await pods();
  source.store(`${source.root}forged%2Eacl`, "unsafe ACL");
  source.store(`${source.root}forged.%41CR`, "unsafe ACR");
  source.store(`${source.root}permissions`, "unsafe ACR content");
  target.access.delete(target.acl(target.root));
  target.aclOverrides.set(target.root, `${target.root}permissions`);
  target.setAcl(target.root, await acl(target, target.root));
  const previous = target.access.get(target.acl(target.root));
  const options = { source: source.side(), target: target.side() };
  const plan = await planMigration(options);
  expect(plan.report.filter((item) => item.kind === "metadata-skipped")).toHaveLength(2);
  expect(plan.report.find((item) => item.resourceUrl.endsWith("permissions"))?.kind).toBe(
    "protected-target",
  );
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.verified).toBe(true);
  expect(result.copied).toEqual([]);
  expect(target.access.get(target.acl(target.root))).toBe(previous);
});

it("removes auxiliary resources and their descendants advertised later in the crawl", async () => {
  const { source, target } = await pods();
  source.store(`${source.root}metadata/`, "", "text/turtle");
  source.store(`${source.root}metadata/child`, "metadata");
  source.store(`${source.root}late`, "ordinary data");
  const sourceSide = transformed(source, (url, method, response) => {
    if (method !== "HEAD" || !url.endsWith("late")) return response;
    const headers = new Headers(response.headers);
    headers.append("link", `<${source.root}metadata/>; rel="describedby"`);
    return new Response(null, { headers });
  });
  const plan = await planMigration({ source: sourceSide, target: target.side() });
  expect(plan.resources.some((item) => item.sourceUrl.includes("metadata"))).toBe(false);
  expect(plan.report.filter((item) => item.kind === "metadata-skipped")).toHaveLength(2);
});

it("refuses partial source representations before copying content", async () => {
  const { source, target } = await pods();
  source.store(`${source.root}file`, "secret");
  const options = { source: source.side(), target: target.side() };
  const plan = await planMigration(options);
  source.responses.set(`GET ${source.root}file`, () => new Response("sec", { status: 206 }));
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed[0]?.error).toContain("complete representation (206)");
  expect(target.data.has(`${target.root}file`)).toBe(false);
});

it("rechecks source grants after copying and records the final cancellation report", async () => {
  const { source, target } = await pods();
  const file = `${source.root}file`;
  source.store(file, "secret");
  source.setAcl(file, await acl(source, file, policy(grant())));
  const options = { source: source.side(), target: target.side() };
  const plan = await planMigration(options);
  const stored = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  let writes = 0;
  target.afterWrite = async (url) => {
    if (url === `${target.root}file` && ++writes === 2)
      source.setAcl(file, await acl(source, file));
  };
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed[0]?.error).toContain("widens");
  expect(await target.permissions(`${target.root}file`)).toEqual(new Set());
  expect(JSON.parse(stored.get("pod-migrator:last-run") as string)).toEqual(result);
  vi.unstubAllGlobals();
});

it("requires owner control even during placeholder creation", async () => {
  const { source, target } = await pods("wac", "wac");
  const file = `${source.root}file`;
  source.store(file, "public");
  source.setAcl(file, await acl(source, file, policy(grant())));
  target.setAcl(
    target.root,
    await writeWac(
      unionPolicies(ownerPolicy(target.owner), policy(grant(undefined, { appliesTo: "members" }))),
      target.root,
      target.acl(target.root),
    ),
  );
  const plan = await planMigration({ source: source.side(), target: target.side() });
  expect(() => finalizePlan(plan, resolve(plan))).toThrow("widens");
  expect(target.requests.some((request) => request.method === "PUT")).toBe(false);
});
