// AUTHORED-BY Codex GPT-6.1-Sol

import { expect, it } from "vitest";
import { aclLink } from "../../src/apps/chat/lib/model/links";
import { invitationRoom } from "../../src/apps/chat/lib/model/paths";

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

it("normalises room Offers to containers, scoped to the own-pod room directory", () => {
  const storage = "https://pod.example/alice/";
  const room = `${storage}chat/rooms/team-1/`;
  for (const value of [room, `${room}index.ttl`, `${room}index.ttl#it`]) {
    expect(invitationRoom(value)).toBe(room);
    expect(invitationRoom(value, storage)).toBe(room);
  }
  expect(invitationRoom("http://foreign.example/chat/rooms/team/", storage)).toBe(
    "http://foreign.example/chat/rooms/team/",
  );
  for (const value of [
    `${storage}nested/chat/rooms/team/`,
    `${storage}chat/rooms/nested/chat/rooms/team/`,
    `${room}?`,
    `${room}?secret=1`,
    `${room}#`,
    `${room}#it`,
    `${room}index.ttl#other`,
    `${room}index.ttl?`,
    `${storage}private/`,
    `${storage}file.pdf`,
    `${storage}chat/rooms/a%2Fb/`,
    `${storage}chat/rooms/a/b/`,
    "https://user:password@pod.example/chat/rooms/team/",
    "urn:room:1",
  ])
    expect(() => invitationRoom(value, storage)).toThrow();
});
