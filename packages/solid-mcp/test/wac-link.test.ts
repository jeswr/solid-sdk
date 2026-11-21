// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { auxiliaryResourceLinks, wacAclLink } from "../src/wac-link.js";

const BASE = "https://pod.example/data/item";
const ACP = "http://www.w3.org/ns/solid/acp#accessControl";

describe("shared authoritative Link parsing", () => {
  it("resolves links and accepts RFC parameters and anchors naming the response resource", () => {
    const header =
      '<acl>; rel="ACL alternate"; title="a, b"; flag; anchor="", <meta>; rel=describedBy, <links>; rel=linkset';
    expect(auxiliaryResourceLinks(header, BASE)).toEqual([
      "https://pod.example/data/acl",
      "https://pod.example/data/meta",
      "https://pod.example/data/links",
    ]);
    expect(wacAclLink(header, BASE)).toBe("https://pod.example/data/acl");
  });

  it.each([
    "garbage",
    "<acl>; rel=acl, malformed",
    "<acl>; rel=acl; rel=alternate",
    "<acl>; rel=acl; title=a; title=b",
    '<acl>; rel=acl; anchor="other"',
    '<acl>; rel=acl; anchor="http://["',
    "<http://[>; rel=acl",
    "<>; rel=acl",
    '<acl>; rel=acl; title="unfinished',
    '<acl>; rel=acl; anchor=""; anchor="other"',
    "<acl>; rel=acl; flag; flag",
    "<a b>; rel=acl",
    "<a\\b>; rel=acl",
    `${"<other>; rel=alternate,".repeat(64)}<acl>; rel=acl`,
    `<acl>; rel=acl; title="${"x".repeat(8192)}"`,
  ])("refuses incomplete/ambiguous metadata %j", (header) => {
    expect(() => auxiliaryResourceLinks(header, BASE)).toThrow();
    expect(() => wacAclLink(header, BASE)).toThrow();
  });

  it.each([
    "urn:acl",
    "https://user@pod.example/acl",
    "https://pod.example/acl#fragment",
  ])("rejects unsafe auxiliary targets %s", (target) => {
    const header = `<${target}>; rel=acl`;
    expect(() => auxiliaryResourceLinks(header, BASE)).toThrow();
    expect(() => wacAclLink(header, BASE)).toThrow();
  });

  it("retains ACP links but refuses them for WAC provisioning", () => {
    const header = `<item?ext=acr>; rel="${ACP}"`;
    expect(auxiliaryResourceLinks(header, BASE)).toEqual([`${BASE}?ext=acr`]);
    expect(() => wacAclLink(header, BASE)).toThrow("ACP");
  });

  it("requires one WAC link and accepts absent auxiliary headers", () => {
    expect(auxiliaryResourceLinks("", BASE)).toEqual([]);
    for (const header of ["", "<other>; rel=alternate", "<a>; rel=acl, <b>; rel=acl"])
      expect(() => wacAclLink(header, BASE)).toThrow();
  });
});
