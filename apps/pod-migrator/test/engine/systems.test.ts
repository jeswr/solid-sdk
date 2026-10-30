// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { detectAccessSystem, readAccess, writeAccess } from "../../src/engine/access.js";
import { emptyPolicy, ownerPolicy } from "../../src/engine/policy.js";
import { ACL, ACP, aclLink } from "../../src/engine/rdf.js";
import { pods } from "./helpers.js";

const resource = "https://pod.example/folder/";
describe("access HTTP safety", () => {
  it("rejects ambiguous and out-of-scope ACL advertisements and ignores anchored links", () => {
    expect(() =>
      aclLink(
        new Response(null, { headers: { link: '<a>; rel="acl", <b>; rel="acl"' } }),
        resource,
        resource,
      ),
    ).toThrow("Ambiguous");
    expect(
      aclLink(
        new Response(null, {
          headers: { link: '<a>; rel="acl"; anchor="https://elsewhere.example/"' },
        }),
        resource,
        resource,
      ),
    ).toBeUndefined();
    expect(() =>
      aclLink(
        new Response(null, { headers: { link: '<https://elsewhere.example/>; rel="acl"' } }),
        resource,
        resource,
      ),
    ).toThrow();
  });
});

describe("system detection and access safety", () => {
  it("detects RDF signals, unreadable advertised ACP, conflict, absent/empty/malformed documents", async () => {
    for (const model of ["wac", "acp"] as const) {
      const { source } = await pods(model, model);
      expect(await detectAccessSystem(source.side())).toBe(model);
      source.responses.set(`HEAD ${source.root}`, () => new Response());
      expect(await detectAccessSystem(source.side())).toBe("unknown");
      source.responses.clear();
      source.responses.set(
        `GET ${source.acl(source.root)}`,
        () =>
          new Response(null, {
            status: 403,
            headers: { link: `<${ACP}AccessControlResource>; rel="type"` },
          }),
      );
      expect(await detectAccessSystem(source.side())).toBe("acp");
      source.responses.set(
        `GET ${source.acl(source.root)}`,
        () => new Response(null, { status: 403 }),
      );
      expect(await detectAccessSystem(source.side())).toBe("unknown");
      source.responses.set(
        `GET ${source.acl(source.root)}`,
        () => new Response("not turtle", { headers: { "content-type": "text/turtle" } }),
      );
      expect(await detectAccessSystem(source.side())).toBe("unknown");
      source.responses.set(
        `GET ${source.acl(source.root)}`,
        () => new Response("", { headers: { "content-type": "text/turtle" } }),
      );
      expect(await detectAccessSystem(source.side())).toBe("unknown");
      const doc = new TextDecoder().decode(source.access.get(source.acl(source.root))?.bytes);
      source.responses.set(
        `GET ${source.acl(source.root)}`,
        () =>
          new Response(
            `${doc}\n<urn:conflict> a <${model === "wac" ? `${ACP}AccessControlResource` : `${ACL}Authorization`}>.`,
            { headers: { "content-type": "text/turtle" } },
          ),
      );
      expect(await detectAccessSystem(source.side())).toBe("unknown");
    }
  });
  it("requires owner Control before writing, handles missing links/404, refuses unknown writes", async () => {
    const { source } = await pods();
    const side = source.side();
    await expect(
      writeAccess(side, source.root, source.acl(source.root), emptyPolicy(), "wac", "css"),
    ).rejects.toThrow("widens");
    await expect(
      writeAccess(
        side,
        source.root,
        source.acl(source.root),
        ownerPolicy(source.owner),
        "wac",
        "css",
      ),
    ).rejects.toThrow();
    await expect(
      writeAccess(
        side,
        source.root,
        source.acl(source.root),
        ownerPolicy(source.owner, true),
        "unknown",
        "css",
      ),
    ).rejects.toThrow("unknown");
    await expect(readAccess(side, source.root, "unknown")).rejects.toThrow("unknown");
    source.responses.set(`HEAD ${source.root}`, () => new Response());
    expect(await readAccess(side, source.root, "wac")).toBeUndefined();
    source.responses.clear();
    source.access.clear();
    expect(await readAccess(side, source.root, "wac")).toBeUndefined();
  });
});
