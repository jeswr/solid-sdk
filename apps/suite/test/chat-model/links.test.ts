// AUTHORED-BY Codex GPT-6.1-Sol

import { expect, it } from "vitest";
import { aclLink } from "../../src/apps/chat/lib/model/links";

it.each([
  '<.acl>; type="text/turtle"; rel="acl"',
  '<.acl>; rel="acl describedby"',
  '<.acl>; rel="describedby acl"',
  "<.acl>; ReL = ACL",
  "<.acl>; rel=acl; rel=describedby",
  "<metadata>; rel=describedby, <.acl>; rel=acl",
  '<metadata>; title="rel=acl", <.acl>; rel=acl',
  ", , <.acl>; flag; rel=acl,",
  '<.acl>; title=""; rel=acl',
  '<.acl>; rel="  acl  "',
  String.raw`<metadata>; title="a, b; \"c\""; rel=describedby, <.acl>; rel=acl`,
  String.raw`<.acl>; title="a\\b"; rel="a\cl"`,
])("reads ACL relations from Link fields: %s", (header) => {
  expect(aclLink(header)).toBe(".acl");
});

it("preserves commas and semicolons in target references", () => {
  expect(aclLink("<policy,team;v=1.acl>; rel=acl")).toBe("policy,team;v=1.acl");
});

it.each([
  null,
  "",
  " \t ",
  ", ,",
  "<.acl>",
  "<.acl>; rel",
  '<.acl>; rel=""',
  "<.acl>; rel=notacl",
  "<.acl>; rel=describedby; rel=acl",
  '<.acl>; anchor="/other"; rel=acl',
  '<.acl>; rel=acl; anchor=""',
])("does not invent ACL relations or apply anchored links: %s", (header) => {
  expect(aclLink(header)).toBeUndefined();
});

it.each([
  "garbage",
  "<.acl; rel=acl",
  "<.acl>; =acl",
  "<.acl>; rel=",
  '<.acl>; rel="acl',
  '<.acl>; title="unfinished\\',
  "<.acl>; rel=acl garbage",
  "<.acl>; rel=acl; @bad=x",
])("rejects malformed Link syntax: %s", (header) => {
  expect(() => aclLink(header)).toThrow("invalid-input");
});
