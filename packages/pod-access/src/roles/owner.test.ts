// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ACL, ACP } from "../rdf.js";
import { isRoleError } from "./errors.js";
import { makeOwnerOnly, type OwnerOnlyOptions } from "./owner.js";

const root = "https://pod.example/";
const resource = `${root}private/`;
const endpoint = `${resource}policy`;
const owner = "https://id.example/card#me";
const other = "https://id.example/other#me";
const prefixes = `@prefix acl: <${ACL}>. @prefix acp: <${ACP}>.`;
const wac = (agent = owner, target = resource) => `${prefixes}
 <#a> a acl:Authorization; acl:accessTo <${target}>; acl:default <${target}>;
 acl:agent <${agent}>; acl:mode acl:Read, acl:Write, acl:Control.`;
const acp = (agent = owner, target = resource, ess = false) => `${prefixes}
 <> a acp:AccessControlResource; acp:resource <${target}>; acp:accessControl <#c>.
 <#c> acp:apply <#p>. <#p> acp:allow ${ess ? "acp" : "acl"}:Read; acp:allOf <#m>.
 <#m> acp:agent <${agent}>.`;
interface Fixture {
  model?: "wac" | "acp";
  own?: string | number;
  ancestor?: string | number;
  link?: string;
  etag?: string | null;
  fail?: { method: string; status: number };
}
function pod(f: Fixture = {}) {
  const link = f.link ?? `<policy>; rel="${f.model === "acp" ? `${ACP}accessControl` : "acl"}"`;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (f.fail?.method === method) return new Response(null, { status: f.fail.status });
    if (method === "HEAD")
      return new Response(null, {
        headers: { link: url === resource ? link : '<root-policy>; rel="acl"' },
      });
    if (method === "PUT") return new Response(null, { status: 204 });
    const content =
      url === endpoint
        ? (f.own ?? wac())
        : (f.ancestor ??
          (f.model === "acp"
            ? `${prefixes} <> a acp:AccessControlResource; acp:resource <${root}>.`
            : wac(owner, root)));
    return typeof content === "number"
      ? new Response(null, { status: content })
      : new Response(content, {
          headers: {
            "content-type": "text/turtle",
            ...(f.etag === null ? {} : { etag: f.etag ?? '"v1"' }),
          },
        });
  });
  const run = (options: Partial<OwnerOnlyOptions> = {}, target = resource, webId = owner) =>
    makeOwnerOnly(target, webId, { fetch, ...options });
  const puts = () => fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
  return { fetch, run, puts };
}
async function objects(body: BodyInit | null | undefined, predicate: string) {
  const ds = await parseRdf(String(body), "text/turtle", { baseIRI: endpoint });
  return [...ds.match(null, DataFactory.namedNode(predicate))].map((q) => q.object.value);
}
describe("makeOwnerOnly", () => {
  it.each([
    "wac",
    "acp",
  ] as const)("creates %s at its advertised endpoint conditionally", async (model) => {
    const p = pod({ model, own: 404 });
    await p.run({ inherit: true });
    expect(p.puts()).toHaveLength(1);
    const [url, init] = p.puts()[0] ?? [];
    expect(url).toBe(endpoint);
    expect(new Headers(init?.headers).get("if-none-match")).toBe("*");
    expect(new Headers(init?.headers).has("if-match")).toBe(false);
    expect(await objects(init?.body, `${model === "wac" ? ACL : ACP}agent`)).toEqual([owner]);
    expect(
      await objects(init?.body, model === "wac" ? `${ACL}default` : `${ACP}memberAccessControl`),
    ).toHaveLength(1);
    for (const [, init] of p.fetch.mock.calls) {
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
    }
  });
  it.each([
    "wac",
    "acp",
  ] as const)("replaces owner-only %s with strong If-Match and resource-only scope", async (model) => {
    const p = pod({ model, own: model === "acp" ? acp() : wac(), etag: '"exact"' });
    await p.run();
    const init = p.puts()[0]?.[1];
    expect(new Headers(init?.headers).get("if-match")).toBe('"exact"');
    expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
    expect(
      await objects(init?.body, model === "wac" ? `${ACL}default` : `${ACP}memberAccessControl`),
    ).toEqual([]);
  });
  it("uses ESS modes and separate ACR management", async () => {
    const p = pod({ model: "acp", own: acp(owner, resource, true) });
    await p.run({ implementation: "ess", inherit: true });
    const body = p.puts()[0]?.[1]?.body;
    expect(await objects(body, `${ACP}allow`)).toEqual(
      expect.arrayContaining([`${ACP}Read`, `${ACP}Write`, `${ACP}Append`]),
    );
    expect(await objects(body, `${ACP}access`)).toHaveLength(1);
    expect(await objects(body, `${ACP}memberAccess`)).toHaveLength(1);
  });
  it.each([
    "wac",
    "acp",
  ] as const)("requires explicit replace for foreign %s agents", async (model) => {
    const p = pod({ model, own: model === "wac" ? wac(other) : acp(other) });
    await expect(p.run()).rejects.toMatchObject({ code: "unsupported" });
    expect(p.puts()).toEqual([]);
    await p.run({ replace: true });
    expect(await objects(p.puts()[0]?.[1]?.body, `${model === "wac" ? ACL : ACP}agent`)).toEqual([
      owner,
    ]);
  });
  it.each([
    "acl:agentClass <http://xmlns.com/foaf/0.1/Agent>",
    "acl:agentClass acl:AuthenticatedAgent",
    "acl:agentGroup <https://group.example/#it>",
  ])("requires consent for selector %s", async (selector) => {
    const p = pod({ own: wac().replace(`acl:agent <${owner}>`, selector) });
    await expect(p.run()).rejects.toThrow(/replace: true/);
    expect(p.puts()).toEqual([]);
    await p.run({ replace: true });
    expect(p.puts()).toHaveLength(1);
  });
  it.each([
    null,
    "",
    "*",
    'W/"weak"',
    "unquoted",
    '"a", "b"',
  ])("refuses unsafe ETag %s", async (etag) => {
    const p = pod({ etag });
    await expect(p.run()).rejects.toMatchObject({ code: "precondition-required" });
    expect(p.puts()).toEqual([]);
  });
  it.each([
    "HEAD",
    "GET",
    "PUT",
  ])("propagates auth/conflict failures on %s without retry", async (method) => {
    for (const status of [401, 403, 412]) {
      const p = pod({ fail: { method, status } });
      const error = await p.run().catch((e: unknown) => e);
      expect(isRoleError(error)).toBe(true);
      expect(error).toMatchObject({ code: status === 412 ? "conflict" : "invalid-response" });
      expect(
        p.fetch.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method),
      ).toHaveLength(1);
    }
  });
  it.each([
    "",
    '<one>; rel="acl", <two>; rel="acl"',
    '<policy>; rel="acl"; rel="acl"',
    '<policy>; rel="acl"; anchor',
    "broken",
    '<>; rel="acl"',
    '<policy>; rel="acl"; extension=',
    '<policy>; rel="acl"; title="unclosed',
  ])("refuses missing/ambiguous/malformed Link (%s)", async (link) => {
    const p = pod({ link });
    await expect(p.run()).rejects.toThrow();
    expect(p.puts()).toEqual([]);
  });
  it.each([
    '<https://foreign.example/policy>; rel="acl"',
    '<https://u:p@pod.example/policy>; rel="acl"',
    '<policy?x=1>; rel="acl"',
    '<policy#it>; rel="acl"',
    '<./>; rel="acl"',
  ])("refuses unsafe access URL (%s)", async (link) => {
    const p = pod({ link });
    await expect(p.run()).rejects.toThrow();
    expect(p.puts()).toEqual([]);
  });
  it.each([
    "",
    "not RDF",
    '<x> <https://example.org/note> "unknown".',
    404,
  ])("refuses unknown/malformed systems (%s)", async (own) => {
    const p = pod({ own, ancestor: 404 });
    await expect(p.run()).rejects.toThrow();
    expect(p.puts()).toEqual([]);
  });
  it("never treats a suffix as model evidence", async () => {
    const p = pod({ link: '<policy.acr>; rel="acl"', own: 404, ancestor: 404 });
    await expect(p.run()).rejects.toMatchObject({ code: "unsupported" });
    expect(p.puts()).toEqual([]);
  });
  it.each([
    false,
    true,
  ])("refuses foreign additive inheritance even with replace=%s", async (replace) => {
    const p = pod({
      model: "acp",
      own: acp(),
      ancestor: acp(other, root).replace("acp:accessControl", "acp:memberAccessControl"),
    });
    await expect(p.run({ replace })).rejects.toMatchObject({ code: "inherited-grant" });
    expect(p.puts()).toEqual([]);
  });
  it("accepts owner-only inherited ACP", async () => {
    const p = pod({
      model: "acp",
      own: acp(),
      ancestor: acp(owner, root).replace("acp:accessControl", "acp:memberAccessControl"),
    });
    await p.run();
    expect(p.puts()).toHaveLength(1);
  });
  it("refuses foreign targets even with replace", async () => {
    const p = pod({ own: wac(owner, `${root}other/`) });
    await expect(p.run({ replace: true })).rejects.toMatchObject({ code: "scope" });
    expect(p.puts()).toEqual([]);
  });
  it("preserves annotations and refuses mixed or unsupported RDF", async () => {
    const p = pod({ own: `${wac()} <#a> <https://example.org/note> "keep".` });
    await p.run();
    expect(await objects(p.puts()[0]?.[1]?.body, "https://example.org/note")).toEqual(["keep"]);
    for (const own of [
      `${wac()} <#p> a acp:Policy.`,
      `${wac()} <#a> acl:unknown <#x>.`,
      `${wac()} <#a> acl:agent "literal".`,
      `${wac()} <#a> acl:defaultForNew <${resource}>.`,
    ]) {
      const p = pod({ own });
      await expect(p.run({ replace: true })).rejects.toThrow();
      expect(p.puts()).toEqual([]);
    }
  });
  it("normalizes resource and owner URLs", async () => {
    const p = pod();
    await p.run({}, "https://POD.example:443/other/../private/", "https://ID.example:443/card#me");
    expect(p.fetch.mock.calls[0]?.[0]).toBe(resource);
    expect(await objects(p.puts()[0]?.[1]?.body, `${ACL}agent`)).toEqual([owner]);
  });
  it.each([
    "file:///private/",
    "https://u:p@pod.example/private/",
    `${resource}?x=1`,
    `${resource}#it`,
    "https://pod.example/a%2fb/",
    "relative",
    "https://pod.example/a>bad/",
  ])("rejects unsafe resource before I/O (%s)", async (target) => {
    const p = pod();
    await expect(p.run({}, target)).rejects.toThrow();
    expect(p.fetch).not.toHaveBeenCalled();
  });
  it("rejects invalid owner, file inheritance and unknown implementations before I/O", async () => {
    const p = pod();
    await expect(p.run({}, resource, "mailto:owner@example.org")).rejects.toThrow();
    await expect(p.run({ inherit: true }, `${root}file`)).rejects.toThrow(/container/);
    await expect(p.run({ implementation: "unknown" as "css" })).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(p.fetch).not.toHaveBeenCalled();
  });
  it("refuses ACP on NSS", async () => {
    const p = pod({ model: "acp" });
    await expect(p.run({ implementation: "nss" })).rejects.toMatchObject({ code: "unsupported" });
    expect(p.puts()).toEqual([]);
  });
  it("accepts repeated descriptive attributes and ACP type evidence", async () => {
    const p = pod({
      model: "acp",
      own: 404,
      link: `<policy>; ReL=ACL; title=first; title=second; flag; flag=one; title*=UTF-8'en'Policy, <${ACP}AccessControlResource>; rel=type`,
    });
    await p.run();
    expect(p.puts()).toHaveLength(1);
  });
  it("refuses discovery changing between reads", async () => {
    const p = pod({ model: "acp", own: acp() });
    p.fetch.mockImplementationOnce(
      async () =>
        new Response(null, { headers: { link: `<different>; rel="${ACP}accessControl"` } }),
    );
    await expect(p.run()).rejects.toMatchObject({ code: "conflict" });
    expect(p.puts()).toEqual([]);
  });
  it.each([
    "replace",
    "create",
  ])("refuses %s validators changing during preparation", async (operation) => {
    const p = pod({ model: "acp", own: operation === "create" ? 404 : acp() });
    const original = p.fetch.getMockImplementation();
    let reads = 0;
    p.fetch.mockImplementation(async (input, init) => {
      if (String(input) === endpoint && (init?.method ?? "GET") === "GET" && ++reads === 2)
        return new Response(acp(), {
          headers: { "content-type": "text/turtle", etag: '"changed"' },
        });
      return original?.(input, init) as Promise<Response>;
    });
    await expect(p.run()).rejects.toMatchObject({ code: "conflict" });
    expect(p.puts()).toEqual([]);
  });
  it.each([
    `${ACP}PublicAgent`,
    `${ACP}AuthenticatedAgent`,
  ])("requires consent for ACP selector %s", async (agent) => {
    const p = pod({ model: "acp", own: acp(agent) });
    await expect(p.run()).rejects.toThrow(/replace: true/);
    expect(p.puts()).toEqual([]);
    await p.run({ replace: true });
    expect(await objects(p.puts()[0]?.[1]?.body, `${ACP}agent`)).toEqual([owner]);
  });
  it("supports ACP RDF advertised through rel=acl", async () => {
    const p = pod({ model: "acp", own: acp(), link: '<policy>; rel="acl"' });
    await p.run();
    expect(p.puts()).toHaveLength(1);
  });
  it.each([301, 302, 307, 308])("refuses a %s redirect before writing", async (status) => {
    const p = pod({ fail: { method: "HEAD", status } });
    await expect(p.run()).rejects.toThrow(String(status));
    expect(p.puts()).toEqual([]);
  });
  it.each([
    "unsafe language",
    "foreign blank label",
    "remote context",
  ])("validates retained JSON-LD metadata: %s", async (kind) => {
    const p = pod();
    const original = p.fetch.getMockImplementation();
    const annotation = {
      "@id": "_:foreign label; break",
      "https://example.org/note": [
        { "@value": "keep", "@language": kind === "unsafe language" ? "en .\n<#injected>" : "en" },
      ],
    };
    const data = [
      {
        "@id": "#a",
        "@type": [`${ACL}Authorization`],
        [`${ACL}accessTo`]: [{ "@id": resource }],
        [`${ACL}agent`]: [{ "@id": owner }],
        [`${ACL}mode`]: [{ "@id": `${ACL}Read` }],
      },
      annotation,
    ];
    p.fetch.mockImplementation(async (input, init) => {
      if (String(input) === endpoint && (init?.method ?? "GET") === "GET")
        return new Response(
          JSON.stringify(
            kind === "remote context"
              ? { "@context": "https://foreign.example/context", "@graph": data }
              : data,
          ),
          {
            headers: { "content-type": "application/ld+json", etag: '"json-v1"' },
          },
        );
      return original?.(input, init) as Promise<Response>;
    });
    if (kind !== "remote context") {
      await p.run();
      // fetch-rdf discards invalid language annotations before they enter the dataset.
      expect(await objects(p.puts()[0]?.[1]?.body, "https://example.org/note")).toEqual(
        kind === "unsafe language" ? [] : ["keep"],
      );
      expect(await objects(p.puts()[0]?.[1]?.body, `${ACL}agent`)).toEqual([owner]);
    } else {
      await expect(p.run()).rejects.toThrow();
      expect(p.puts()).toEqual([]);
    }
  });
  it.each([
    "PublicAgent",
    "AuthenticatedAgent",
    "OwnerAgent",
    "CreatorAgent",
    "UnknownAgent",
  ])("refuses reserved ACP owner %s before I/O", async (name) => {
    const p = pod({ model: "acp" });
    await expect(p.run({}, resource, `${ACP}${name}`)).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(p.fetch).not.toHaveBeenCalled();
  });
});
