// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { expect, test, vi } from "vitest";
import { createInboxReader } from "./client.js";
import { containerMembers, sortInboxNotifications } from "./inbox.js";
import { findActivitySubject, isDirectChild, parseInboxNotification, readInbox } from "./read.js";
import type { GuardedFetchResult } from "./security/guardedFetch.js";

const inbox = "https://8.8.4.4/inbox/";
const as = "@prefix as: <https://www.w3.org/ns/activitystreams#>.";
const documents = new Map([
  [
    inbox,
    `<${inbox}> <http://www.w3.org/ns/ldp#contains> <${inbox}b>, <${inbox}a>, <${inbox}old>, <https://1.1.1.1/secret>, <${inbox}bad>, <${inbox}gone>, <${inbox}empty>.`,
  ],
  [`${inbox}b`, `${as} <#it> a as:Announce; as:summary "undated".`],
  [
    `${inbox}a`,
    `${as} <#it> a as:Create; as:actor <https://alice.example/#me>; as:published "2026-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>.`,
  ],
  [
    `${inbox}old`,
    `${as} <#it> a as:Offer; as:published "2025-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>.`,
  ],
  [`${inbox}bad`, "not { RDF"],
  [`${inbox}empty`, ""],
]);
function result(url: string, text = documents.get(url) ?? ""): GuardedFetchResult {
  return {
    response: new Response(text),
    bytes: Buffer.from(text),
    status: url.endsWith("gone") ? 404 : 200,
    text,
    contentType: "text/turtle",
    finalUrl: url,
  };
}

test("keeps the Node reader's transport options, member parsing and ordering unchanged", async () => {
  const fetchImpl = vi.fn(async (url: string) => result(url));
  const dnsLookup = vi.fn();
  const node = await readInbox(inbox, {
    fetchImpl,
    timeoutMs: 123,
    allowLoopback: true,
    dnsLookup,
  });
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async (url) =>
      new Response(documents.get(String(url)) ?? "", {
        status: String(url).endsWith("gone") ? 404 : 200,
        headers: { "content-type": "text/turtle" },
      }),
  );
  expect(await createInboxReader({ fetch }).list(inbox)).toEqual(node);
  expect(node.map((n) => n.url)).toEqual([`${inbox}a`, `${inbox}old`, `${inbox}b`]);
  expect(fetchImpl.mock.calls.map(([url]) => url)).not.toContain("https://1.1.1.1/secret");
  expect(fetchImpl).toHaveBeenCalledWith(inbox, {
    method: "GET",
    maxBytes: 64 * 1024,
    timeoutMs: 123,
    allowLoopback: true,
    dnsLookup,
  });
});

test("preserves empty results for Node transport, HTTP and parse failures", async () => {
  expect(
    await readInbox(inbox, {
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
  ).toEqual([]);
  for (const status of [199, 403, 404, 500]) {
    expect(
      await readInbox(inbox, { fetchImpl: async () => ({ ...result(inbox), status }) }),
    ).toEqual([]);
  }
  expect(await readInbox(inbox, { fetchImpl: async () => result(inbox, "invalid { RDF") })).toEqual(
    [],
  );
  expect(await readInbox(inbox, { fetchImpl: async () => result(inbox, "") })).toEqual([]);
  expect(await readInbox("https://127.0.0.1/inbox/")).toEqual([]);
});

test.each([
  ["<#it> as:actor <https://alice.example/#me>.", "Notification"],
  ['<#it> as:summary "summary only".', "Notification"],
  ['<#it> as:content "content only".', "Notification"],
  ['<#it> a <https://other.example/Type>, as:; as:summary "no local type".', "Notification"],
  ["<#it> a as:Announce, as:Offer.", "Announce, Offer"],
])("preserves actor and conventional #it discovery: %s", async (body, type) => {
  const dataset = await parseRdf(`${as} ${body}`, "text/turtle", { baseIRI: `${inbox}n` });
  expect(findActivitySubject(`${inbox}n`, dataset)?.value).toBe(`${inbox}n#it`);
  expect(parseInboxNotification(`${inbox}n`, dataset)?.type).toBe(type);
});

test("preserves scope filtering, deduplication and ordering ties", async () => {
  expect(isDirectChild("invalid", inbox)).toBe(false);
  expect(isDirectChild(`${inbox}n`, "invalid")).toBe(false);
  expect(isDirectChild(`${inbox}n`, inbox.slice(0, -1))).toBe(true);
  const dataset = await parseRdf(
    `<${inbox}> <http://www.w3.org/ns/ldp#contains> <${inbox}n>, <${inbox}n>, "literal", <${inbox}sub/n>, <${inbox}a%2fb>, <${inbox}n?query>, <${inbox}n#fragment>.`,
    "text/turtle",
  );
  // Invalid RDF/JS IRIs cannot normally survive the parser; retain the helper's defensive path.
  const hostile = new Store([...dataset]);
  hostile.addQuad(
    DataFactory.namedNode(inbox),
    DataFactory.namedNode("http://www.w3.org/ns/ldp#contains"),
    DataFactory.namedNode("https://[invalid"),
  );
  expect(containerMembers(inbox, hostile)).toEqual([`${inbox}n`]);
  const duplicate = { url: `${inbox}n`, type: "Offer" };
  expect(sortInboxNotifications([duplicate, duplicate])).toEqual([duplicate, duplicate]);
});

// AUTHORED-BY Claude Opus 5.5
test.each([
  ['as:published "2026-11-11T12:00:00.000Z"', "2026-11-11T12:00:00.000Z"],
  ['as:published "not a date"^^<http://www.w3.org/2001/XMLSchema#dateTime>', undefined],
  [
    'as:published "2026-11-11T12:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
    "2026-11-11T12:00:00.000Z",
  ],
])("keeps the notification when as:published is untyped or malformed: %s", async (published, expected) => {
  const dataset = await parseRdf(`${as} <#it> a as:Announce; ${published}.`, "text/turtle", {
    baseIRI: `${inbox}n`,
  });
  const notification = parseInboxNotification(`${inbox}n`, dataset);
  expect(notification?.type).toBe("Announce");
  expect(notification?.published).toBe(expected);
});

test("retains legacy display names and untyped dates for migrated readers", async () => {
  const dataset = await parseRdf(
    `${as} <#it> a as:Announce; as:name "Legacy name"; as:published "2026-11-11T12:00:00Z".`,
    "text/turtle",
    { baseIRI: `${inbox}n` },
  );
  expect(parseInboxNotification(`${inbox}n`, dataset)).toMatchObject({
    name: "Legacy name",
    published: "2026-11-11T12:00:00.000Z",
  });
  for (const url of ["https://user:pass@8.8.4.4/inbox/n", `${inbox}a%5cb`])
    expect(isDirectChild(url, inbox)).toBe(false);
});

test("non-date publication metadata never hides an otherwise readable activity", async () => {
  const dataset = await parseRdf(
    `${as} <#it> a as:Announce; as:name <https://pod.example/name>; as:published <https://pod.example/date>.`,
    "text/turtle",
    { baseIRI: `${inbox}n` },
  );
  expect(parseInboxNotification(`${inbox}n`, dataset)).toEqual({
    url: `${inbox}n`,
    type: "Announce",
    name: "https://pod.example/name",
  });
});

test("retains RDF/JS blank-node subjects and repeated malformed publication values", async () => {
  const ds = await parseRdf(
    `@prefix as: <https://www.w3.org/ns/activitystreams#>.
    [] a as:Offer; as:actor <https://alice.example/#me>; as:object <https://pod.example/poll>;
      as:summary "yes"; as:content "response"; as:published "bad", <https://bad.example/>, "2026-11-11T12:00:00Z".`,
    "text/turtle",
  );
  expect(findActivitySubject(`${inbox}n`, ds)?.termType).toBe("BlankNode");
  expect(parseInboxNotification(`${inbox}n`, ds)).toMatchObject({
    type: "Offer",
    actor: "https://alice.example/#me",
    object: "https://pod.example/poll",
    summary: "yes",
    content: "response",
    published: "2026-11-11T12:00:00.000Z",
  });
});

test("untyped activities survive with a display fallback and no fabricated activity IRI", async () => {
  const ds = await parseRdf(
    '[] <https://www.w3.org/ns/activitystreams#name> "Legacy".',
    "text/turtle",
  );
  expect(parseInboxNotification(`${inbox}n`, ds)).toEqual({
    url: `${inbox}n`,
    type: "Notification",
    name: "Legacy",
  });
});

test("ignores unrelated foreign subjects before finding untyped display content", async () => {
  const ds = await parseRdf(
    '<https://other.example/doc> <http://purl.org/dc/terms/title> "Other". [] <https://www.w3.org/ns/activitystreams#name> "Legacy".',
    "text/turtle",
  );
  expect(parseInboxNotification(`${inbox}n`, ds)?.name).toBe("Legacy");
});

test("reserved sidecar suffixes cannot be bypassed with percent encodings", async () => {
  const { isReadMarker } = await import("./inbox.js");
  for (const url of ["bad URL", `${inbox}n.read.ttl`, `${inbox}n.read%2Ettl`, `${inbox}%zz`])
    expect(isReadMarker(url)).toBe(true);
  expect(isReadMarker(`${inbox}n`)).toBe(false);
  expect(isReadMarker(`${inbox}n%25done`)).toBe(false);
  expect(isReadMarker(`${inbox}n%252Eread.ttl`)).toBe(false);
  expect(isReadMarker("https://pod.example/a%25/inbox/n")).toBe(false);
});

test("a malformed foreign rdf:type does not hide an untyped or recognizable activity", async () => {
  for (const body of [
    '<#it> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> "garbage"; <https://www.w3.org/ns/activitystreams#summary> "Legacy".',
    '<#it> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> "garbage", <https://www.w3.org/ns/activitystreams#Offer>; <https://www.w3.org/ns/activitystreams#summary> "Legacy".',
  ]) {
    const ds = await parseRdf(body, "text/turtle", { baseIRI: `${inbox}n` });
    expect(parseInboxNotification(`${inbox}n`, ds)?.summary).toBe("Legacy");
  }
});

test("auxiliary resources and LDP containers never become notifications through the self-subject fallback", async () => {
  const { isAuxiliaryResource } = await import("./inbox.js");
  expect(isAuxiliaryResource("bad URL")).toBe(true);
  expect(isAuxiliaryResource(`${inbox}%zz`)).toBe(true);
  for (const name of [
    ".acl",
    ".acr",
    ".meta",
    ".hidden",
    "n.acl",
    "n.acr",
    "n.meta",
    "%2Eacl",
    "n%2Emeta",
    "n.ACL",
  ]) {
    const url = `${inbox}${name}`;
    const ds = await parseRdf('<> <http://purl.org/dc/terms/title> "Metadata".', "text/turtle", {
      baseIRI: url,
    });
    expect(findActivitySubject(url, ds)).toBeUndefined();
    expect(parseInboxNotification(url, ds)).toBeUndefined();
    expect(isDirectChild(url, inbox)).toBe(false);
  }
  for (const type of ["Container", "BasicContainer", "DirectContainer", "IndirectContainer"]) {
    const url = `${inbox}slashless`;
    const ds = await parseRdf(`<> a <http://www.w3.org/ns/ldp#${type}>.`, "text/turtle", {
      baseIRI: url,
    });
    expect(parseInboxNotification(url, ds)).toBeUndefined();
  }
  expect(parseInboxNotification(`${inbox}folder/`, new Store())).toBeUndefined();
});

test.each([
  "document",
  "fragment",
  "blank",
  "foreign",
])("unrelated self-describing RDF is not a notification (%s subject)", async (kind) => {
  const url = `${inbox}n`;
  const subject =
    kind === "blank"
      ? DataFactory.blankNode()
      : DataFactory.namedNode(
          kind === "document"
            ? url
            : kind === "fragment"
              ? `${url}#it`
              : "https://other.example/doc",
        );
  const doc = new TermWrapper(subject, new Store(), DataFactory);
  OptionalAs.object(doc, "http://purl.org/dc/terms/title", "Unrelated", LiteralFrom.string);
  SetFrom.subjectPredicate(
    doc,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    NamedNodeAs.string,
    NamedNodeFrom.string,
  ).add("https://other.example/Type");
  const dataset = await parseRdf(await serialize([...doc.dataset]), "text/turtle", {
    baseIRI: url,
  });
  expect(findActivitySubject(url, dataset)).toBeUndefined();
  expect(parseInboxNotification(url, dataset)).toBeUndefined();
});

test.each([
  "actor",
  "object",
  "summary",
  "content",
  "published",
  "name",
])("unknown-type activities retain recognizable as:%s metadata on named and blank subjects", async (property) => {
  const url = `${inbox}n`;
  for (const subject of [
    DataFactory.namedNode(url),
    DataFactory.namedNode(`${url}#it`),
    DataFactory.blankNode(),
  ]) {
    const doc = new TermWrapper(subject, new Store(), DataFactory);
    SetFrom.subjectPredicate(
      doc,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      NamedNodeAs.string,
      NamedNodeFrom.string,
    ).add("https://other.example/UnknownActivity");
    const predicate = `https://www.w3.org/ns/activitystreams#${property}`;
    if (property === "actor" || property === "object")
      OptionalAs.object(doc, predicate, "https://alice.example/#me", NamedNodeFrom.string);
    else
      OptionalAs.object(
        doc,
        predicate,
        property === "published" ? "2026-11-11T12:00:00Z" : "Metadata",
        LiteralFrom.string,
      );
    const dataset = await parseRdf(await serialize([...doc.dataset]), "text/turtle", {
      baseIRI: url,
    });
    expect(parseInboxNotification(url, dataset)).toMatchObject({ url, type: "Notification" });
  }
});

test.each([
  "https://www.w3.org/ns/activitystreams#UnknownActivity",
  "http://www.w3.org/ns/ldp#Resource",
])("recognizes notification vocabulary types without metadata: %s", async (type) => {
  const url = `${inbox}n`;
  const doc = new TermWrapper(`${url}#it`, new Store(), DataFactory);
  SetFrom.subjectPredicate(
    doc,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    NamedNodeAs.string,
    NamedNodeFrom.string,
  ).add(type);
  const dataset = await parseRdf(await serialize([...doc.dataset]), "text/turtle", {
    baseIRI: url,
  });
  expect(parseInboxNotification(url, dataset)).toEqual({
    url,
    type: type.endsWith("#Resource") ? "Notification" : "UnknownActivity",
  });
});
