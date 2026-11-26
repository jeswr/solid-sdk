// AUTHORED-BY Claude Sonnet 5.5
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { describe, expect, it, vi } from "vitest";
import { checkOwnerOnly } from "../owner-only.js";
import { readWac } from "../systems/wac.js";
import { setGrants } from "./client.js";

const root = "https://pod.example/";
const folder = `${root}journal/`;
const acl = `${folder}.acl`;
const owner = "https://alice.example/profile#me";
const bob = "https://bob.example/#me";
const carol = "https://carol.example/#me";
const PIM = "http://www.w3.org/ns/pim/space#Storage";
const PREFIX =
  "@prefix acl: <http://www.w3.org/ns/auth/acl#>. @prefix foaf: <http://xmlns.com/foaf/0.1/>.\n";

function pod(aclBody: string, model: "wac" | "acp" = "wac", rootAcr?: string) {
  const suffix = model === "wac" ? ".acl" : ".acr";
  const aclUrl = folder + suffix;
  let body = PREFIX + aclBody;
  let etag = 1;
  const writes: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    if (url === root || url === folder) {
      const link = [
        `<${url}${suffix}>; rel="acl"`,
        '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      ];
      if (url === root) link.push(`<${PIM}>; rel="type"`);
      return new Response(method === "HEAD" ? null : "", {
        headers: { link: link.join(", "), etag: '"c"', "content-type": "text/turtle" },
      });
    }
    if (url === `${root}${suffix}`) {
      const rootAcl =
        model === "wac"
          ? `${PREFIX}[] a acl:Authorization; acl:accessTo <${root}>; acl:default <${root}>; acl:agent <${owner}>; acl:mode acl:Read, acl:Write, acl:Control.`
          : (rootAcr ?? acr(root, []));
      return new Response(method === "HEAD" ? null : rootAcl, {
        headers: { "content-type": "text/turtle", etag: '"r"' },
      });
    }
    if (url !== aclUrl) return new Response(null, { status: 404 });
    if (method === "PUT") {
      if (new Headers(init.headers).get("if-match") !== `"${etag}"`)
        return new Response(null, { status: 412 });
      body = String(init.body);
      etag++;
      writes.push(body);
      return new Response(null, { status: 204 });
    }
    return new Response(method === "HEAD" ? null : body, {
      headers: { "content-type": "text/turtle", etag: `"${etag}"` },
    });
  }) as unknown as typeof globalThis.fetch;
  const storage = createSolidBackend({
    fetch,
    root,
    features: {
      ...createMemoryStorage({ root }).features,
      accessControl: { state: "available", detail: { model }, evidence: "fixture" },
    },
  });
  return { fetch, storage, writes, body: () => body };
}
const ACP_POLICIES: Record<string, string> = {
  bob: `<#p-bob> acp:allow acl:Read; acp:allOf <#m-bob>. <#m-bob> acp:agent <${bob}>.`,
  publicRead: `<#p-pub> acp:allow acl:Read; acp:allOf <#m-pub>. <#m-pub> acp:agent acp:PublicAgent.`,
  publicAppend: `<#p-app> acp:allow acl:Append; acp:allOf <#m-app>. <#m-app> acp:agent acp:PublicAgent.`,
  authenticated: `<#p-auth> acp:allow acl:Read; acp:allOf <#m-auth>. <#m-auth> acp:agent acp:AuthenticatedAgent.`,
  anyOf: `<#p-any> acp:allow acl:Read; acp:anyOf <#m-a1>, <#m-a2>. <#m-a1> acp:agent <${bob}>. <#m-a2> acp:agent <${carol}>.`,
  allOf: `<#p-all> acp:allow acl:Read; acp:allOf <#m-b1>, <#m-b2>. <#m-b1> acp:agent <${bob}>. <#m-b2> acp:agent <${carol}>.`,
  twoAgents: `<#p-two> acp:allow acl:Read; acp:allOf <#m-two>. <#m-two> acp:agent <${bob}>, <${carol}>.`,
};
const acr = (
  target: string,
  extra: string[],
) => `@prefix acp: <http://www.w3.org/ns/solid/acp#>. @prefix acl: <http://www.w3.org/ns/auth/acl#>.
<> a acp:AccessControlResource; acp:resource <${target}>; acp:accessControl <#own>; acp:memberAccessControl <#own>.
<#own> acp:apply <#ownerPolicy>${extra.map((name) => `, <#p-${ACP_POLICY_IDS[name]}>`).join("")}.
<#ownerPolicy> acp:allow acl:Read, acl:Write, acl:Control; acp:allOf <#owner>.
<#owner> acp:agent <${owner}>.
${extra.map((name) => ACP_POLICIES[name]).join(" ")}
`;
const ACP_POLICY_IDS: Record<string, string> = {
  bob: "bob",
  publicRead: "pub",
  publicAppend: "app",
  authenticated: "auth",
  anyOf: "any",
  allOf: "all",
  twoAgents: "two",
};
const rule = (principal: string, modes: string, extra = "") =>
  `[] a acl:Authorization; acl:accessTo <${folder}>; acl:default <${folder}>; ${principal}; acl:mode ${modes}${extra}.\n`;
const ALL = "acl:Read, acl:Write, acl:Control";
const ownerRule = rule(`acl:agent <${owner}>`, ALL);

async function seal(aclBody: string, kind: "folder" | "resource" = "folder") {
  const p = pod(aclBody);
  const result = await setGrants(
    [folder],
    [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
    { fetch: p.fetch, root, kind, webId: owner, ownOnly: true },
  );
  const verdict = await checkOwnerOnly({ storage: p.storage, url: folder, ownerWebId: owner });
  return { ...p, result, verdict };
}
const inert = `[] a acl:Authorization; acl:accessTo <${folder}>; acl:default <${folder}>; acl:mode acl:Read.\n`;
const noScope = `[] a acl:Authorization; acl:agent <${bob}>; acl:mode acl:Read.\n`;
const untyped = `[] acl:accessTo <${folder}>; acl:default <${folder}>; acl:agent <${bob}>; acl:mode acl:Read.\n`;
const pieces: Record<string, string> = {
  "multi-agent rule": rule(`acl:agent <${owner}>, <${bob}>`, ALL),
  "separate per-agent rules": rule(`acl:agent <${bob}>`, "acl:Read, acl:Write"),
  "public Read": rule("acl:agentClass foaf:Agent", "acl:Read"),
  "public Append": rule("acl:agentClass foaf:Agent", "acl:Append"),
  "authenticated agents": rule("acl:agentClass acl:AuthenticatedAgent", "acl:Read"),
  "authenticated Append": rule("acl:agentClass acl:AuthenticatedAgent", "acl:Append"),
  group: rule("acl:agentGroup <https://g.example/g#g>", "acl:Read"),
  "mixed principals in one rule": rule(
    `acl:agent <${carol}>; acl:agentClass foaf:Agent`,
    "acl:Read",
  ),
  "principal-less rule": inert,
  "scope-less rule": noScope,
  "untyped rule": untyped,
  "other agent Control": rule(`acl:agent <${carol}>`, "acl:Control"),
};
const owners = {
  "one owner rule": ownerRule,
  "owner rule per mode":
    rule(`acl:agent <${owner}>`, "acl:Read") +
    rule(`acl:agent <${owner}>`, "acl:Write, acl:Control"),
};

describe("ownOnly on WAC produces an owner-only document", () => {
  it.each(Object.entries(pieces))("removes %s (folder and resource)", async (name, extra) => {
    const body = (name === "multi-agent rule" ? "" : ownerRule) + extra;
    for (const kind of ["folder", "resource"] as const) {
      const r = await seal(body, kind);
      expect(r.result.failed, `${name} ${kind}`).toEqual([]);
      expect(r.verdict, `${name} ${kind}`).toEqual({ private: true });
      const text = r.body();
      for (const other of [bob, carol, "foaf/0.1/Agent", "AuthenticatedAgent", "g.example"])
        expect(text).not.toContain(other);
      expect(text).toContain(owner);
      expect(text).toContain("Control");
    }
  });
  it.each(Object.entries(owners))("keeps the owner's own rules: %s", async (_name, ownerBody) => {
    const r = await seal(ownerBody + pieces["public Read"] + pieces["public Append"]);
    expect(r.verdict).toEqual({ private: true });
    const policy = readWac((await r.storage.readRdf(acl)).dataset, folder, acl, "css", true);
    expect(policy.grants.every((g) => g.who.every((c) => c.every((w) => w.kind === "agent")))).toBe(
      true,
    );
    const modes = new Set(policy.grants.flatMap((g) => [...g.modes]));
    expect(modes).toEqual(new Set(["read", "write", "control", "append"]));
  });
  it("seals every combination of shapes to a verified owner-only document", async () => {
    const names = Object.keys(pieces);
    let sealed = 0;
    for (let mask = 0; mask < 2 ** names.length; mask += 17) {
      const chosen = names.filter((_, i) => mask & (1 << i));
      const body = ownerRule + chosen.map((n) => pieces[n]).join("");
      const r = await seal(body);
      expect(r.result.failed, chosen.join(", ")).toEqual([]);
      expect(r.verdict, chosen.join(", ")).toEqual({ private: true });
      sealed++;
    }
    expect(sealed).toBeGreaterThan(200);
  }, 30_000);
  it("writes nothing when the document is already owner-only", async () => {
    const r = await seal(ownerRule);
    expect(r.writes).toEqual([]);
    expect(r.verdict).toEqual({ private: true });
  });
  it("rewrites an owner-only looking document that holds an inert rule", async () => {
    const r = await seal(ownerRule + inert);
    expect(r.writes).toHaveLength(1);
    expect(r.verdict).toEqual({ private: true });
  });
  it("removes a default-only member rule on a resource-kind container", async () => {
    const r = await seal(
      `${ownerRule}[] a acl:Authorization; acl:default <${folder}>; acl:agent <${bob}>; acl:mode acl:Read.\n`,
      "resource",
    );
    expect(r.verdict).toEqual({ private: true });
  });
  it("refuses, unchanged, a folder whose members differ from the folder", async () => {
    const body = `${ownerRule}[] a acl:Authorization; acl:default <${folder}>; acl:agent <${bob}>; acl:mode acl:Read.\n`;
    const p = pod(body);
    const result = await setGrants(
      [folder],
      [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
      { fetch: p.fetch, root, kind: "folder", webId: owner, ownOnly: true },
    );
    expect(result.failed[0]?.error).toMatchObject({ code: "partial-scope" });
    expect(p.writes).toEqual([]);
  });
  it("refuses, unchanged, an origin-restricted rule it cannot model", async () => {
    const body = `${ownerRule}${rule(`acl:agent <${bob}>`, "acl:Read", "; acl:origin <https://app.example>")}`;
    const p = pod(body);
    const result = await setGrants(
      [folder],
      [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
      { fetch: p.fetch, root, kind: "folder", webId: owner, ownOnly: true },
    );
    expect(result.failed[0]?.error).toMatchObject({ code: "unsupported" });
    expect(p.writes).toEqual([]);
    expect(
      await checkOwnerOnly({ storage: p.storage, url: folder, ownerWebId: owner }),
    ).toMatchObject({ private: false });
  });
  it("never widens: the sealed document grants nothing the original did not", async () => {
    const r = await seal(ownerRule + pieces["public Read"] + pieces["separate per-agent rules"]);
    const policy = readWac((await r.storage.readRdf(acl)).dataset, folder, acl, "css", true);
    for (const grant of policy.grants)
      expect(grant.who).toEqual([[{ kind: "agent", webId: owner }]]);
  });
});

describe("ownOnly on ACP produces an owner-only document", () => {
  const cases = Object.keys(ACP_POLICIES).filter((name) => name !== "allOf");
  const seal = async (extra: string[]) => {
    const p = pod(acr(folder, extra), "acp");
    const result = await setGrants(
      [folder],
      [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
      { fetch: p.fetch, root, kind: "folder", webId: owner, ownOnly: true, implementation: "css" },
    );
    const verdict = await checkOwnerOnly({
      storage: p.storage,
      url: folder,
      ownerWebId: owner,
      acpDialect: "css",
    });
    return { ...p, result, verdict };
  };
  it.each(cases)("removes the %s policy without leaving an inert one", async (name) => {
    const r = await seal([name]);
    expect(r.result.failed).toEqual([]);
    expect(r.verdict).toEqual({ private: true });
    for (const other of [bob, carol, "PublicAgent", "AuthenticatedAgent"])
      expect(r.body()).not.toContain(other);
  });
  it("seals every combination of policies", async () => {
    for (let mask = 1; mask < 2 ** cases.length; mask++) {
      const chosen = cases.filter((_, i) => mask & (1 << i));
      const r = await seal(chosen);
      expect(r.result.failed, chosen.join()).toEqual([]);
      expect(r.verdict, chosen.join()).toEqual({ private: true });
    }
  }, 30_000);
  it("drops an ESS management policy of a removed agent", async () => {
    const ess = `@prefix acp: <http://www.w3.org/ns/solid/acp#>.
<> a acp:AccessControlResource; acp:resource <${folder}>; acp:accessControl <#c>; acp:memberAccessControl <#c>;
  acp:access <#own-mgmt>, <#bob-mgmt>.
<#c> acp:apply <#p>. <#p> acp:allow acp:Read, acp:Write; acp:allOf <#m>. <#m> acp:agent <${owner}>.
<#own-mgmt> acp:allow acp:Read, acp:Write; acp:allOf <#m>.
<#bob-mgmt> acp:allow acp:Read, acp:Write; acp:allOf <#mb>. <#mb> acp:agent <${bob}>.`;
    const essRoot = `@prefix acp: <http://www.w3.org/ns/solid/acp#>.
<> a acp:AccessControlResource; acp:resource <${root}>; acp:accessControl <#c>; acp:memberAccessControl <#c>;
  acp:access <#m-mgmt>.
<#c> acp:apply <#p>. <#p> acp:allow acp:Read, acp:Write; acp:allOf <#m>. <#m> acp:agent <${owner}>.
<#m-mgmt> acp:allow acp:Read, acp:Write; acp:allOf <#m>.`;
    const p = pod(ess, "acp", essRoot);
    const result = await setGrants(
      [folder],
      [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
      { fetch: p.fetch, root, kind: "folder", webId: owner, ownOnly: true, implementation: "ess" },
    );
    expect(result.failed).toEqual([]);
    expect(p.body()).not.toContain(bob);
    expect(
      await checkOwnerOnly({
        storage: p.storage,
        url: folder,
        ownerWebId: owner,
        acpDialect: "ess",
      }),
    ).toEqual({ private: true });
  });
  it("refuses, unchanged, a conjunction of agents it cannot model", async () => {
    const r = await seal(["allOf"]);
    expect(r.result.failed[0]?.error).toMatchObject({ message: expect.stringContaining("richer") });
    expect(r.writes).toEqual([]);
  });
  it("writes nothing for an already owner-only document", async () => {
    const r = await seal([]);
    expect(r.writes).toEqual([]);
    expect(r.verdict).toEqual({ private: true });
  });
});
