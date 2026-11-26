// AUTHORED-BY Claude Opus 5.5
// `setGrants` `securing: true` combined with the WAC residue cleanup of `ownOnly` (the merge point
// in `plan()`): one conditional PUT that is owner-only by checkOwnerOnly and carries the mark.
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { describe, expect, it, vi } from "vitest";
import { checkOwnerOnly } from "../owner-only.js";
import { setGrants } from "./client.js";
import { isSealed, isSecuring } from "./seal.js";

const root = "https://pod.example/";
const folder = `${root}journal/`;
const acl = `${folder}.acl`;
const owner = "https://alice.example/profile#me";
const bob = "https://bob.example/#me";
const carol = "https://carol.example/#me";
const PIM = "http://www.w3.org/ns/pim/space#Storage";
const PREFIX =
  "@prefix acl: <http://www.w3.org/ns/auth/acl#>. @prefix foaf: <http://xmlns.com/foaf/0.1/>. @prefix pa: <https://jeswr.org/ns/pod-access#>.\n";

/** A WAC pod whose folder ACL is `aclBody`, recording every conditional PUT to it. */
function pod(aclBody: string) {
  let body = PREFIX + aclBody;
  let etag = 1;
  const writes: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    if (url === root || url === folder) {
      const link = [
        `<${url}.acl>; rel="acl"`,
        '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      ];
      if (url === root) link.push(`<${PIM}>; rel="type"`);
      return new Response(method === "HEAD" ? null : "", {
        headers: { link: link.join(", "), etag: '"c"', "content-type": "text/turtle" },
      });
    }
    if (url === `${root}.acl`)
      return new Response(
        method === "HEAD"
          ? null
          : `${PREFIX}[] a acl:Authorization; acl:accessTo <${root}>; acl:default <${root}>; acl:agent <${owner}>; acl:mode acl:Read, acl:Write, acl:Control.`,
        { headers: { "content-type": "text/turtle", etag: '"r"' } },
      );
    if (url !== acl) return new Response(null, { status: 404 });
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
      accessControl: { state: "available", detail: { model: "wac" }, evidence: "fixture" },
    },
  });
  return { fetch, storage, writes, body: () => body };
}
const rule = (principal: string, modes: string) =>
  `[] a acl:Authorization; acl:accessTo <${folder}>; acl:default <${folder}>; ${principal}; acl:mode ${modes}.\n`;
const ALL = "acl:Read, acl:Write, acl:Control";
const ownerRule = rule(`acl:agent <${owner}>`, ALL);
const mark = `<> pa:securingBy <${owner}>.\n`;
const residue: Record<string, string> = {
  "multi-agent rule": rule(`acl:agent <${owner}>, <${bob}>`, ALL),
  "separate per-agent rules": ownerRule + rule(`acl:agent <${bob}>`, "acl:Read, acl:Write"),
  "public Read": ownerRule + rule("acl:agentClass foaf:Agent", "acl:Read"),
  "public Append": ownerRule + rule("acl:agentClass foaf:Agent", "acl:Append"),
  "authenticated agents": ownerRule + rule("acl:agentClass acl:AuthenticatedAgent", "acl:Read"),
  group: ownerRule + rule("acl:agentGroup <https://g.example/g#g>", "acl:Read"),
  "principal-less rule":
    ownerRule +
    `[] a acl:Authorization; acl:accessTo <${folder}>; acl:default <${folder}>; acl:mode acl:Read.\n`,
  "scope-less rule": `${ownerRule}[] a acl:Authorization; acl:agent <${bob}>; acl:mode acl:Read.\n`,
  "untyped rule": `${ownerRule}[] acl:accessTo <${folder}>; acl:default <${folder}>; acl:agent <${bob}>; acl:mode acl:Read.\n`,
  "other agent Control": ownerRule + rule(`acl:agent <${carol}>`, "acl:Control"),
};

async function secure(p: ReturnType<typeof pod>) {
  const options = { fetch: p.fetch, root, kind: "folder" as const, webId: owner };
  const result = await setGrants(
    [folder],
    [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
    { ...options, ownOnly: true, securing: true },
  );
  const verdict = await checkOwnerOnly({ storage: p.storage, url: folder, ownerWebId: owner });
  return { result, verdict, marked: await isSecuring(folder, options), options };
}

describe("securing: true with the WAC residue cleanup", () => {
  it.each(
    Object.entries(residue).flatMap(([name, body]) => [
      [name, "unmarked", body],
      [name, "already marked", body + mark],
    ]),
  )("removes %s (%s) in one PUT that keeps the mark", async (_name, _state, body) => {
    const p = pod(body);
    const { result, verdict, marked, options } = await secure(p);
    expect(result.failed).toEqual([]);
    expect(p.writes).toHaveLength(1);
    expect(verdict).toEqual({ private: true });
    expect(marked).toBe(true);
    expect(await isSealed(folder, options)).toBe(false);
    const text = p.body();
    for (const other of [bob, carol, "foaf/0.1/Agent", "AuthenticatedAgent", "g.example"])
      expect(text).not.toContain(other);
    expect(text).toContain("securingBy");
    // Owner-only and marked now: a repeat pass writes nothing.
    await secure(p);
    expect(p.writes).toHaveLength(1);
  });
  it("marks an owner-only document in one write, then writes nothing", async () => {
    const p = pod(ownerRule);
    const first = await secure(p);
    expect(first.verdict).toEqual({ private: true });
    expect(first.marked).toBe(true);
    expect(p.writes).toHaveLength(1);
    await secure(p);
    expect(p.writes).toHaveLength(1);
  });
});
