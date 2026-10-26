// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
  [
    'user="READ WRITE", public="ApPeNd CONTROL"',
    { user: ["read", "write"], public: ["append", "control"] },
  ],
  [
    'user="READ read WRITE", user="Read write APPEND"',
    { user: ["read", "write", "append"], public: [] },
  ],
  [',user="read"', { user: ["read"], public: [] }],
  ['user="read",', { user: ["read"], public: [] }],
  [', ,\tuser="read", ,public="WRITE", , ', { user: ["read"], public: ["write"] }],
])("parses valid WAC scopes: %s", (header, expected) => {
  expect(parseProbeHeaders(url, [["WAC-Allow", header as string]], 0).wacAllow).toEqual(expected);
});

test.each([
  "",
  " ",
  ", ,\t,",
  "user=read",
  'user="read" garbage',
  'user="read", garbage',
  'user="read", public="write',
  'user="read\nwrite"',
  'user="read\rwrite"',
  'user="read,write"',
  'user="read\u0000write"',
  'user="read K"',
  'group-id="read", user="read"',
  'user="read", group=write',
  'user="read", group="write\n"',
  'user="read", group="write,read"',
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

test.each([
  ['user="read", group="write", public="read"', { user: ["read"], public: ["read"] }],
  ['group="write", user="read"', { user: ["read"], public: [] }],
  ['user="read", group="write"', { user: ["read"], public: [] }],
  ['user="read delete write", public="future read"', { user: ["read", "write"], public: ["read"] }],
  ['user="Read read readwrite", public="delete"', { user: ["read"], public: [] }],
  ['group="read delete", user="append future"', { user: ["append"], public: [] }],
  ['group="read"', { user: [], public: [] }],
  ['user="delete"', { user: [], public: [] }],
  [
    'user="read read", user="write", public="read", public=""',
    { user: ["read", "write"], public: ["read"] },
  ],
])("preserves known WAC permissions alongside extensions: %s", (value, expected) => {
  const result = parseProbeHeaders(url, [["WAC-Allow", value as string]], 0);
  expect(result.wacAllow).toEqual(expected);
  expect(result.evidence).toEqual([{ header: "WAC-Allow", value }]);
});

test.each([
  ['text/n3; p="comma, semicolon; and \\"quote\\"", text/turtle', ["text/n3", "text/turtle"]],
  ['text/n3; p="\\\\", APPLICATION/LD+JSON', ["text/n3", "application/ld+json"]],
  ['text/n3, text/turtle; p="unterminated, application/ld+json', ["text/n3"]],
  ['text/n3; p="trailing\\', []],
  ['text/n3; p=""; q=plain, , text/turtle;', ["text/n3", "text/turtle"]],
])("tokenizes media parameter quoting without retrying: %s", (value, expected) => {
  for (const header of ["Accept-Patch", "Accept-Post"]) {
    const result = parseProbeHeaders(url, [[header, value as string]], 0);
    expect(header === "Accept-Patch" ? result.acceptPatch : result.acceptPost).toEqual(expected);
  }
});

const boundedFields = [
  ["Accept-Patch", "acceptPatch"],
  ["Accept-Post", "acceptPost"],
  ["Allow", "allow"],
] as const;

test.each(boundedFields)("bounds combined %s to 8 KiB including separators", (header, property) => {
  const first = "a".repeat(4096);
  const second = "b".repeat(4095);
  const headers: [string, string][] = [
    [header, first],
    [header.toLowerCase(), second],
  ];
  const normalise = (value: string) => (header === "Allow" ? value.toUpperCase() : value);
  expect(parseProbeHeaders(url, headers, 0)[property]).toEqual([
    normalise(first),
    normalise(second),
  ]);
  headers[1] = [header.toLowerCase(), `${second}b`];
  const result = parseProbeHeaders(url, headers, 0);
  expect(result).not.toHaveProperty(property);
  expect(result.evidence).toEqual(headers.map(([header, value]) => ({ header, value })));
});

test.each(boundedFields)("counts UTF-8 bytes and rejects huge %s fields", (header, property) => {
  const boundary = "é".repeat(4096);
  expect(parseProbeHeaders(url, [[header, boundary]], 0)[property]).toEqual([
    header === "Allow" ? boundary.toUpperCase() : boundary,
  ]);
  for (const value of [`${boundary}a`, "a".repeat(8193)]) {
    const result = parseProbeHeaders(
      url,
      [
        [header, value],
        ["WAC-Allow", 'user="read"'],
      ],
      0,
    );
    expect(result).not.toHaveProperty(property);
    expect(result.wacAllow).toEqual({ user: ["read"], public: [] });
  }
});

test("skips empty WAC list members across repeated fields", () => {
  expect(
    parseProbeHeaders(
      url,
      [
        ["WAC-Allow", ',user="READ",,'],
        ["WAC-Allow", ',public="read", '],
      ],
      0,
    ).wacAllow,
  ).toEqual({ user: ["read"], public: ["read"] });
});

test("parses pathological probe headers in less than 50 ms", () => {
  const pathological = `text/n3; p="${'\\"'.repeat(4080)}\\`;
  const huge = '"\\'.repeat(100_000);
  const headers: [string, string][] = [
    ["Accept-Patch", pathological],
    ["Accept-Post", `text/n3; p="${"\\\\".repeat(4080)}\\`],
    ["Allow", " ".repeat(8192)],
    ["WAC-Allow", `${",".repeat(8192)}user="READ"`],
  ];
  const start = performance.now();
  const result = parseProbeHeaders(url, headers, 0);
  const oversized = parseProbeHeaders(url, [["Accept-Post", huge]], 0);
  const elapsed = performance.now() - start;
  expect(result.acceptPatch).toEqual([]);
  expect(result.acceptPost).toEqual([]);
  expect(oversized).not.toHaveProperty("acceptPost");
  expect(result.allow).toEqual([]);
  expect(result.wacAllow).toEqual({ user: ["read"], public: [] });
  expect(elapsed).toBeLessThan(50);
});
