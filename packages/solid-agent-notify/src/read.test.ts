// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
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
  expect(findActivitySubject(`${inbox}n`, dataset)).toBe(`${inbox}n#it`);
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
  ['as:published "2026-11-11T12:00:00.000Z"', undefined],
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
