// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import { parseProbeHeaders } from "./probe-headers.js";
import { ACP } from "./vocab.js";

const url = "https://pod.example/root/";

test("parses all ProbeResult fields and records raw evidence in response order", () => {
  const headers: [string, string][] = [
    ["Date", "Sun, 25 Oct 2026 00:00:00 GMT"],
    ["Accept-Patch", ' Text/N3; charset="utf-8", Application/JSON-PATCH+JSON; p="a,b"'],
    ["Link", `<.acl>; rel="acl alternate", <.acr>; rel="${ACP.accessControl}"`],
    ["accept-patch", ' Application/SPARQL-Update; p="escaped \\"quote\\", comma"'],
    ["Accept-Post", " Text/Turtle; charset=UTF-8, application/ld+json "],
    ["WAC-Allow", 'user="read write append control", public="read"'],
    ["Allow", "get, HEAD, options, post, patch, delete"],
    ["allow", "put"],
    ["Server", "example"],
  ];
  expect(parseProbeHeaders("HTTPS://POD.EXAMPLE:443/root/#fragment", headers, 123)).toEqual({
    url,
    observedAt: 123,
    acceptPatch: ["text/n3", "application/json-patch+json", "application/sparql-update"],
    acceptPost: ["text/turtle", "application/ld+json"],
    allow: ["GET", "HEAD", "OPTIONS", "POST", "PATCH", "DELETE", "PUT"],
    wacAllow: { user: ["read", "write", "append", "control"], public: ["read"] },
    aclLink: `${url}.acl`,
    acpLink: `${url}.acr`,
    evidence: headers.slice(1, -1).map(([header, value]) => ({ header, value })),
  });
});

test("absent headers leave optional observations absent", () => {
  expect(parseProbeHeaders(url, [], 0)).toEqual({ url, observedAt: 0, evidence: [] });
});

test("supports Headers objects, repeated WAC scopes, and multiple Link fields", () => {
  const headers = new Headers();
  headers.append("WAC-Allow", 'user="read"');
  headers.append("WAC-Allow", 'public=""');
  headers.append("Link", '<first>; rel="acl"');
  headers.append("Link", '<second>; rel="acl"');
  headers.append("Link", `<acp>; rel="${ACP.accessControl.toUpperCase()}"`);
  expect(parseProbeHeaders(url, headers, 2)).toMatchObject({
    wacAllow: { user: ["read"], public: [] },
    aclLink: `${url}first`,
    acpLink: `${url}acp`,
  });
});

test("empty media/method fields are observed empty lists", () => {
  expect(
    parseProbeHeaders(
      url,
      [
        ["Accept-Patch", " , "],
        ["Accept-Post", ""],
        ["Allow", " , "],
      ],
      4,
    ),
  ).toMatchObject({ acceptPatch: [], acceptPost: [], allow: [] });
});

test.each([
  ['user="read"', { user: ["read"], public: [] }],
  ['public="read"', { user: [], public: ["read"] }],
  [' user = " read  append\t" , public = "" ', { user: ["read", "append"], public: [] }],
])("parses valid WAC scopes: %s", (header, expected) => {
  expect(parseProbeHeaders(url, [["WAC-Allow", header as string]], 0).wacAllow).toEqual(expected);
});

test.each([
  "",
  " ",
  "user=read",
  'user="Read"',
  'user="delete"',
  'user="readwrite"',
  'user="read", user="write"',
  'public="read", public=""',
  'group="read"',
  'user="read" garbage',
  'user="read", garbage',
  'user="read",',
  'user="read", public="write',
  'user="read\nwrite"',
])("leaves malformed WAC-Allow unknown: %j", (value) => {
  const result = parseProbeHeaders(url, [["WAC-Allow", value]], 0);
  expect(result).not.toHaveProperty("wacAllow");
  expect(result.evidence).toEqual([{ header: "WAC-Allow", value }]);
});

test("ignores foreign anchor contexts and keeps the first access-control link", () => {
  const result = parseProbeHeaders(
    url,
    [
      ["Link", `<evil>; rel="acl ${ACP.accessControl}"; anchor="https://other.example/"`],
      ["Link", '<fragment>; rel=acl; anchor="#part"'],
      ["Link", `<.acl>; rel=acl; anchor="", <.acr>; rel="${ACP.accessControl}"`],
      ["Link", `<later-acl>; rel=acl, <later-acp>; rel="${ACP.accessControl}"`],
      ["Link", "<unrelated>; rel=next"],
    ],
    0,
  );
  expect(result.aclLink).toBe(`${url}.acl`);
  expect(result.acpLink).toBe(`${url}.acr`);
});

test("rejects an invalid probe URL", () => {
  expect(() => parseProbeHeaders("not absolute", [], 0)).toThrow(TypeError);
});
