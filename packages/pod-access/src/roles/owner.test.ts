// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ownerPolicy } from "../policy.js";
import { ACL, ACP } from "../rdf.js";
import { writeAcp } from "../systems/acp.js";
import { writeWac } from "../systems/wac.js";
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
async function privateDocument(
  model: "wac" | "acp",
  target = resource,
  inherit = true,
  full = true,
  ess = false,
  url = endpoint,
) {
  const policy = ownerPolicy(owner, inherit);
  if (!full) policy.grants[0]?.modes.delete("control");
  return model === "wac"
    ? writeWac(policy, target, url)
    : writeAcp(policy, target, url, ess ? "ess" : "css");
}
interface Fixture {
  endpoint?: string;
  target?: string;
  ancestorLink?: string;
  model?: "wac" | "acp";
  own?: string | number;
  ancestor?: string | number;
  link?: string;
  etag?: string | null;
  fail?: { method: string; status: number };
}
function pod(f: Fixture = {}) {
  const accessUrl = f.endpoint ?? endpoint;
  const target = f.target ?? resource;
  const link =
    f.link ?? `<${accessUrl}>; rel="${f.model === "acp" ? `${ACP}accessControl` : "acl"}"`;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (f.fail?.method === method) return new Response(null, { status: f.fail.status });
    if (method === "HEAD")
      return new Response(null, {
        headers: { link: url === target ? link : (f.ancestorLink ?? '<root-policy>; rel="acl"') },
      });
    if (method === "PUT") return new Response(null, { status: 204 });
    const content =
      url === accessUrl
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
  const run = (options: Partial<OwnerOnlyOptions> = {}, resourceUrl = target, webId = owner) =>
    makeOwnerOnly(resourceUrl, webId, { fetch, ...options });
  const puts = () => fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
  return { fetch, run, puts };
}
async function objects(body: BodyInit | null | undefined, predicate: string) {
  const ds = await parseRdf(String(body), "text/turtle", { baseIRI: endpoint });
  return [...ds.match(null, DataFactory.namedNode(predicate))].map((q) => q.object.value);
}
describe("makeOwnerOnly", () => {
  it.each(["wac", "acp"] as const)("defaults to member access for %s containers", async (model) => {
    const p = pod({ model, own: await privateDocument(model, resource, false) });
    await p.run();
    expect(p.puts()).toHaveLength(1);
    expect(
      await objects(
        p.puts()[0]?.[1]?.body,
        model === "wac" ? `${ACL}default` : `${ACP}memberAccessControl`,
      ),
    ).toHaveLength(1);
  });
  it.each([
    "wac",
    "acp",
    "ess",
  ] as const)("preserves existing %s member grants without needing an ETag", async (dialect) => {
    const model = dialect === "wac" ? "wac" : "acp";
    for (const etag of [null, 'W/"weak"']) {
      const p = pod({
        model,
        own: await privateDocument(model, resource, true, true, dialect === "ess"),
        etag,
      });
      await p.run({ implementation: dialect === "ess" ? "ess" : "css" });
      expect(p.puts()).toEqual([]);
    }
  });
  it.each(["wac", "acp"] as const)("defaults files to resource-only %s access", async (model) => {
    const target = `${root}file`;
    const p = pod({ model, target, own: await privateDocument(model, target, false), etag: null });
    await p.run();
    expect(p.puts()).toEqual([]);
  });
  it.each([
    "wac",
    "acp",
  ] as const)("refuses implicit removal of %s defaults on a file", async (model) => {
    const target = `${root}file`;
    const p = pod({ model, target, own: await privateDocument(model, target, true) });
    await expect(p.run()).rejects.toMatchObject({
      code: "unsupported",
      message: expect.stringContaining("inherit: false"),
    });
    expect(p.puts()).toEqual([]);
    await p.run({ inherit: false });
    expect(p.puts()).toHaveLength(1);
  });
  it.each([
    false,
    true,
  ])("writes a real ESS query endpoint (create=%s) with conditional persistence", async (create) => {
    const accessUrl = `${resource}?ext=acr`;
    const p = pod({
      model: "acp",
      endpoint: accessUrl,
      link: `<?ext=acr>; rel="acl"`,
      ancestorLink: '<?ext=acr>; rel="acl"',
      own: create ? 404 : await privateDocument("acp", resource, false, true, true, accessUrl),
      ancestor: await privateDocument("acp", root, false, true, true, `${root}?ext=acr`),
    });
    await p.run({ implementation: "ess" });
    const [url, init] = p.puts()[0] ?? [];
    expect(url).toBe(accessUrl);
    expect(new Headers(init?.headers).get(create ? "if-none-match" : "if-match")).toBe(
      create ? "*" : '"v1"',
    );
    const ds = await parseRdf(String(init?.body), "text/turtle", { baseIRI: accessUrl });
    expect(
      ds.match(DataFactory.namedNode(accessUrl), DataFactory.namedNode(`${ACP}accessControl`)).size,
    ).toBe(1);
    expect(await objects(init?.body, `${ACP}allow`)).toContain(`${ACP}Write`);
  });
  it.each([
    "?ext=acr&extra=1",
    "?ext=acr&ext=acr",
    "?ext=other",
    "?EXT=acr",
    "?ext=%61cr",
    "https://foreign.example/private/?ext=acr",
    "https://pod.example/outside/?ext=acr",
    "https://u:p@pod.example/private/?ext=acr",
    "?ext=acr#fragment",
    "https://pod.example/private/other?ext=acr",
  ])("refuses unsafe ESS query endpoint %s before reading it", async (target) => {
    const p = pod({ model: "acp", link: `<${target}>; rel="${ACP}accessControl"` });
    await expect(p.run({ implementation: "ess", root: resource })).rejects.toMatchObject({
      code: "scope",
    });
    expect(p.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps CSS query-addressed writes refused", async () => {
    const p = pod({ model: "acp", link: `<?ext=acr>; rel="${ACP}accessControl"` });
    await expect(p.run()).rejects.toMatchObject({ code: "scope" });
    expect(p.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    "css",
    "ess",
  ] as const)("bounds %s model-detection ancestor queries before fetching", async (implementation) => {
    const forbidden = `${root}?ext=acr&extra=1`;
    const p = pod({ own: 404, ancestorLink: `<${forbidden}>; rel="acl"` });
    await expect(p.run({ implementation })).rejects.toMatchObject({ code: "scope" });
    expect(p.fetch.mock.calls.some(([url]) => url === forbidden)).toBe(false);
    expect(p.puts()).toEqual([]);
  });
  it.each([
    '<metadata>; rel="describedby"; broken=',
    '<metadata>; rel="describedby"; anchor; rel="next"',
    'broken; rel="describedby"',
    '<metadata>; rel="describedby"; title="unclosed',
  ])("ignores malformed unrelated link %s", async (unrelated) => {
    for (const link of [`${unrelated}, <policy>; rel="acl"`, `<policy>; rel="acl", ${unrelated}`]) {
      const p = pod({ link });
      await p.run();
      expect(p.puts()).toEqual([]);
    }
  });
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
  ] as const)("removes owner member grants only with explicit inherit: false for %s", async (model) => {
    const p = pod({ model, own: await privateDocument(model), etag: '"exact"' });
    await p.run({ inherit: false });
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
    `acl:agentClass <http://xmlns.com/foaf/0.1/Agent>; acl:mode acl:Read`,
    `acl:agent <${other}>; acl:mode acl:Control`,
  ])("rewrites an owner-only ACL that also holds an untyped foreign node (%s)", async (grant) => {
    // Servers may honour an authorization without an rdf:type; the no-op shortcut must not keep it.
    const own = `${await privateDocument("wac")}\n${prefixes} <#x> acl:accessTo <${resource}>; ${grant}.`;
    const p = pod({ own });
    await expect(p.run()).rejects.toMatchObject({ code: "unsupported" });
    expect(p.puts()).toEqual([]);
    await p.run({ replace: true });
    expect(p.puts()).toHaveLength(1);
    const body = p.puts()[0]?.[1]?.body;
    expect(await objects(body, `${ACL}agent`)).toEqual([owner]);
    expect(await objects(body, `${ACL}agentClass`)).toEqual([]);
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
    const p = pod({ etag, own: await privateDocument("wac", resource, true, false) });
    await expect(p.run()).rejects.toMatchObject({ code: "precondition-required" });
    expect(p.puts()).toEqual([]);
  });
  it.each([
    "HEAD",
    "GET",
    "PUT",
  ])("propagates auth/conflict failures on %s without retry", async (method) => {
    for (const status of [401, 403, 412]) {
      const p = pod({
        fail: { method, status },
        own: await privateDocument("wac", resource, true, false),
      });
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
    '<policy>; rel; rel="acl"',
    '<policy>; rel="acl"; anchor',
    "broken",
    '<>; rel="acl"',
    '<policy>; rel="acl"; extension=',
    '<policy>; rel="acl"; title="unclosed',
    '<policy>; rel="acl',
  ])("refuses missing/ambiguous/malformed Link (%s)", async (link) => {
    const p = pod({ link });
    await expect(p.run()).rejects.toMatchObject({
      code:
        ["", "broken"].includes(link) || link.includes("<one>")
          ? "unsupported"
          : "invalid-response",
    });
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
    await expect(p.run()).rejects.toMatchObject({ code: "scope" });
    expect(p.puts()).toEqual([]);
  });
  it.each([
    "",
    "not RDF",
    '<x> <https://example.org/note> "unknown".',
    404,
  ])("refuses unknown/malformed systems (%s)", async (own) => {
    const p = pod({ own, ancestor: 404 });
    if (own === "not RDF")
      await expect(p.run()).rejects.toMatchObject({
        name: "RdfFetchError",
        message: expect.stringContaining("Failed to parse"),
      });
    else await expect(p.run()).rejects.toMatchObject({ code: "unsupported" });
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
      own: await privateDocument("acp"),
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
    await p.run({ inherit: false });
    expect(await objects(p.puts()[0]?.[1]?.body, "https://example.org/note")).toEqual(["keep"]);
    for (const [own, message, code] of [
      [`${wac()} <#p> a acp:Policy.`, "Mixed access-control vocabularies", "invalid-response"],
      [`${wac()} <#a> acl:unknown <#x>.`, "Unknown access-control construct", undefined],
      [`${wac()} <#a> acl:agent "literal".`, "must be NamedNode", undefined],
      [`${wac()} <#a> acl:defaultForNew <${resource}>.`, "acl:defaultForNew", undefined],
    ] as const) {
      const p = pod({ own });
      if (code)
        await expect(p.run({ replace: true })).rejects.toMatchObject({
          code,
          message: expect.stringContaining(message),
        });
      else await expect(p.run({ replace: true })).rejects.toThrow(message);
      expect(p.puts()).toEqual([]);
    }
  });
  it("normalizes resource and owner URLs", async () => {
    const p = pod();
    await p.run(
      { inherit: false },
      "https://POD.example:443/other/../private/",
      "https://ID.example:443/card#me",
    );
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
    if (target === "relative" || target.includes(">"))
      await expect(p.run({}, target)).rejects.toThrow("Unsafe RDF IRI");
    else await expect(p.run({}, target)).rejects.toMatchObject({ code: "scope" });
    expect(p.fetch).not.toHaveBeenCalled();
  });
  it("rejects invalid owner, file inheritance and unknown implementations before I/O", async () => {
    const p = pod();
    await expect(p.run({}, resource, "mailto:owner@example.org")).rejects.toMatchObject({
      code: "scope",
    });
    await expect(p.run({ inherit: true }, `${root}file`)).rejects.toMatchObject({
      code: "scope",
      message: expect.stringContaining("container"),
    });
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
      link: `<policy>; ReL=acl; title=first; title=second; flag; flag=one; title*=UTF-8'en'Policy, <${ACP}AccessControlResource>; rel=type`,
    });
    await p.run();
    expect(p.puts()).toHaveLength(1);
  });
  it.each([
    `<policy>; rel="ACL"`,
    `<other>; rel="ACL", <policy>; rel="${ACP}accessControl"`,
    `<policy>; rel="${ACP}ACCESSCONTROL"`,
  ])("refuses a case variant of the access relation: %s", async (link) => {
    const p = pod({ model: "acp", own: 404, link });
    await expect(p.run()).rejects.toMatchObject({
      code: "invalid-response",
      message: expect.stringContaining("casing"),
    });
    expect(p.puts()).toEqual([]);
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
      await expect(p.run()).rejects.toMatchObject({
        name: "RdfFetchError",
        message: expect.stringContaining("Failed to parse"),
      });
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
