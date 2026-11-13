// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { navigationLinks } from "../src/crawl.js";
import { mapKey, proposeJsonExtraction } from "../src/extraction.js";
import { addFilterInputs } from "../src/filters.js";
import { parseForms } from "../src/forms.js";
import { heuristicLabeller } from "../src/labeller.js";
import { loginFallbackUrl } from "../src/login.js";
import { buildOperation, toParameter } from "../src/operations.js";
import { analyseScript, analyseScripts, SCRIPT_SIZE_LIMIT } from "../src/scripts.js";
import { discoverSessionTokens, redactTrace } from "../src/session-tokens.js";
import { clusterRequests, mergeCandidates } from "../src/templates.js";
import type { RecordedRequest } from "../src/types.js";
import { isDangerousLink, isStatic, s, sab, xsd } from "../src/util.js";
import { findProbeUrl, readable, verifyOperations } from "../src/verify.js";

const origin = "https://shop.test";
const request = (path: string, extra: Partial<RecordedRequest> = {}): RecordedRequest => ({
  seq: 0,
  phase: "crawl",
  method: "GET",
  url: origin + path,
  resourceType: "xhr",
  requestHeaders: {},
  cookieNames: [],
  status: 200,
  contentType: "application/json",
  bodySample: '{"items":[{"id":1,"name":"Example","price":"1.00"}]}',
  ...extra,
});
const label = {
  actionType: s("ViewAction"),
  label: "View items",
  effect: "read" as const,
  confidence: 0.8,
};
describe("generic application discovery", () => {
  it("prioritises hidden navigation anchors without clicking controls", () => {
    expect(
      navigationLinks(
        '<a href="/row/1">Row</a><nav hidden><a href="/people">People</a></nav><div role="menu"><a href="/items">Items</a></div><button>Delete</button>',
      ),
    ).toEqual([
      ["/people", "People"],
      ["/items", "Items"],
      ["/row/1", "Row"],
    ]);
  });
  it("keeps a path base for login fallbacks, removing old query and fragment", () => {
    expect(loginFallbackUrl(`${origin}/portal`)).toBe(`${origin}/portal/login`);
    expect(loginFallbackUrl(`${origin}/portal/?next=x#login`)).toBe(`${origin}/portal/login`);
    expect(loginFallbackUrl(`${origin}/`)).toBe(`${origin}/login`);
  });
  it("recognises hidden form keys and keeps bracketed credentials vault-only", () => {
    const form = requireValue(
      parseForms(
        '<form method="post"><input type="hidden" name="form_key" value="abc"><input name="account[username]"><input type="password" name="account[password]"></form>',
        `${origin}/portal`,
      )[0],
    );
    // Form construction is exercised through the same public candidate path as profiling.
    expect(form.hasPassword).toBe(true);
    const c = requireValue(
      clusterRequests(
        [
          request("/portal", {
            method: "POST",
            postData: "account%5Busername%5D=a&account%5Bpassword%5D=%5Bredacted%5D",
            requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
          }),
        ],
        origin,
      )[0],
    );
    const login = { ...label, actionType: sab("LoginAction") };
    expect(c.params.map((p) => toParameter(c, p, login).path)).toEqual([[], []]);
  });
  it("separates resource dispatch values while retaining encoded paging, sorting and search keys", async () => {
    const cs = clusterRequests(
      [
        request("/data?namespace=people_listing&search=&paging[pageSize]=100&sorting[field]=name"),
        request("/data?namespace=stock_listing&search=x&paging[pageSize]=5"),
      ],
      origin,
    );
    expect(cs).toHaveLength(2);
    expect(cs[0]?.urlTemplate).toContain(
      "?namespace=people_listing{&search,paging%5BpageSize%5D,sorting%5Bfield%5D}",
    );
    expect(cs[0]?.params.some((p) => p.name === "namespace")).toBe(false);
    expect((await heuristicLabeller.label(requireValue(cs[0]))).label).toBe("Search people (JSON)");
    expect(mergeCandidates(cs)).toHaveLength(2);
    const ex = requireValue(
      proposeJsonExtraction(requireValue(requireValue(requireValue(cs[0]).samples[0]).bodySample)),
    );
    const size = toParameter(
      requireValue(cs[0]),
      requireValue(requireValue(cs[0]).params.find((p) => p.name === "paging%5BpageSize%5D")),
      label,
      ex,
    );
    expect(size).toMatchObject({ default: "25", range: xsd("integer") });
  });
  it("infers filter members only from a witnessed nested filter prefix and its referring page", () => {
    const c = requireValue(
      clusterRequests(
        [
          request("/data?filters[placeholder]=true", {
            requestHeaders: { referer: `${origin}/people` },
          }),
        ],
        origin,
      )[0],
    );
    const html =
      '<input name="name"><input name="age[from]" type="number"><input name="csrf" type="hidden"><form method="post"><input name="password"></form>';
    const withFilters = addFilterInputs(c, [{ url: `${origin}/people`, html }]);
    expect(withFilters.params.map((p) => p.name)).toEqual([
      "filters%5Bplaceholder%5D",
      "filters%5Bname%5D",
      "filters%5Bage%5D%5Bfrom%5D",
    ]);
    expect(addFilterInputs(c, [{ url: `${origin}/other`, html }]).params).toHaveLength(1);
    expect(
      addFilterInputs({ ...c, params: [] }, [{ url: `${origin}/people`, html }]).params,
    ).toEqual([]);
  });
  it("does not treat search values as actions, but splits camel-case action paths", () => {
    expect(isDangerousLink(`${origin}/search?q=delete`)).toBe(false);
    expect(isDangerousLink(`${origin}/refreshStatistics`)).toBe(true);
    expect(isStatic(`${origin}/assets/templates/save-content.html`, "xhr")).toBe(true);
    expect(isStatic(`${origin}/static/locale/words.json`, "xhr")).toBe(true);
    expect(isStatic(`${origin}/api/words.json`, "xhr")).toBe(false);
  });
  it.each([
    "/logout",
    "/delete/1",
    "/refresh",
    "/reset",
    "/save",
    "/reorder",
    "/flush",
    "/create",
    "/run",
  ])("avoids potentially state-changing GET navigation %s", (path) =>
    expect(isDangerousLink(origin + path)).toBe(true));
  it("tolerates classic/minified scripts, ES modules, invalid and oversized bundles", () => {
    expect(analyseScript('with(x){fetch("/a")}', `${origin}/a.js`).calls).toHaveLength(1);
    expect(analyseScript('export const x=fetch("/b");', `${origin}/b.js`).calls).toHaveLength(1);
    expect(analyseScript("function(", `${origin}/bad.js`).error).toContain("could not parse");
    expect(analyseScript("x".repeat(SCRIPT_SIZE_LIMIT + 1), `${origin}/huge.js`)).toMatchObject({
      calls: [],
      error: expect.stringContaining("size limit"),
    });
  });
});
describe("session material", () => {
  it("requires a page/cookie source AND repetition, leaving ordinary IDs and one-off opaque values alone", () => {
    const token = "A1b2C3d4E5f6G7h8";
    const cookie = "cookie-session-value";
    const pages = [
      { url: `${origin}/portal`, html: `<input type="hidden" name="nonce" value="${token}">` },
    ];
    const rs = [
      request(`/data/key/${token}?ticket=${cookie}&id=12`),
      request(`/other/key/${token}?ticket=${cookie}&id=13`),
    ];
    const tokens = discoverSessionTokens(pages, [{ name: "sid", value: cookie }], rs);
    expect(tokens.size).toBe(2);
    const candidates = clusterRequests(rs, origin, new Set(), tokens);
    expect(candidates[0]?.urlTemplate).toContain("/key/{sessionPath3}");
    expect(candidates[0]?.params.map((p) => p.name)).toEqual(["id"]);
    expect(candidates[0]?.csrf).toEqual(
      expect.arrayContaining([
        { source: { kind: "cookie", name: "sid" }, target: { kind: "query", name: "ticket" } },
      ]),
    );
    const op = buildOperation(requireValue(candidates[0]), label, {
      modelId: "urn:m",
      learnedAt: "now",
      derivedFrom: [],
      method: "crawl",
      usedIds: new Set(),
      sessionCookies: ["sid"],
    });
    expect(JSON.stringify(op)).not.toContain(token);
    expect(JSON.stringify(op)).not.toContain(cookie);
    expect(discoverSessionTokens(pages, [], rs.slice(0, 1)).size).toBe(0);
    expect(discoverSessionTokens([], [], rs).size).toBe(0);
    expect(discoverSessionTokens([], [], [request("/bad%zz")]).size).toBe(0);
    const trace = JSON.stringify(redactTrace(rs, tokens.keys()));
    expect(trace).not.toContain(token);
    expect(trace).not.toContain(cookie);
    expect(redactTrace([request("/x", { bodySample: 'a " secret' })], ['"'])[0]?.bodySample).toBe(
      'a " secret',
    );
    expect(
      redactTrace([request("/x", { bodySample: 'a "secret" echo' })], ['"secret"'])[0]?.bodySample,
    ).toBe("a [redacted] echo");
  });
  it("recognises HTTP 200 password pages as signed-out probes, and rejects redirect JSON as data", async () => {
    const form = '<form><input type="password" name="password"></form>';
    expect(
      await findProbeUrl([`${origin}/portal`], {
        get: async (_u, { signedIn }) => ({
          status: 200,
          body: signedIn ? "<h1>Account</h1>" : form,
          contentType: "text/html",
        }),
      }),
    ).toBe(`${origin}/portal`);
    const c = requireValue(clusterRequests([request("/data")], origin)[0]);
    const op = buildOperation(c, label, {
      modelId: "urn:m",
      learnedAt: "now",
      derivedFrom: [],
      method: "crawl",
      usedIds: new Set(),
      sessionCookies: [],
      extraction: proposeJsonExtraction(requireValue(requireValue(c.samples[0]).bodySample)),
    });
    expect(readable(op, { status: 200, body: form, contentType: "text/html" })).toBe(false);
    expect(
      readable(op, {
        status: 200,
        body: '{"ajaxRedirect":"/login"}',
        contentType: "application/json",
      }),
    ).toBe(false);
    expect(
      readable(op, {
        status: 200,
        body: '{"error":false,"items":[]}',
        contentType: "application/json",
      }),
    ).toBe(true);
    const checked = await verifyOperations([op], {
      haveSession: true,
      now: () => new Date(),
      replayer: {
        get: async (_u, { signedIn }) => ({
          status: 200,
          body: signedIn ? '{"items":[]}' : '{"ajaxRedirect":"/login"}',
          contentType: "application/json",
        }),
      },
    });
    expect(checked.operations[0]?.session).toBe("signed-in");
  });
});
describe("JSON record lifting", () => {
  it("types people and orders, retains keyed scalar facts, and never emits secrets or nested objects", () => {
    const person = requireValue(
      proposeJsonExtraction({
        items: [
          {
            entity_id: "1",
            name: "Alex Example",
            email: "alex@example.test",
            segment_code: "sample",
            notes: { body: "ignored" },
            session_token: "secret",
          },
        ],
      }),
    );
    expect(person.itemType).toBe(s("Person"));
    expect(person.fields).toContainEqual({
      property: sab("segment_code"),
      path: "/segment_code",
      untrusted: true,
    });
    expect(person.fields.some((f) => /notes|token/.test(f.path))).toBe(false);
    const order = requireValue(
      proposeJsonExtraction({
        items: [
          {
            entity_id: "7",
            increment_id: "0007",
            grand_total: "$12.00",
            status: "pending",
            order_currency_code: "USD",
          },
        ],
      }),
    );
    expect(order.itemType).toBe(s("Order"));
    expect(order.fields).toContainEqual({ property: s("totalPrice"), path: "/grand_total" });
    expect(order.fields).toContainEqual({ property: s("orderStatus"), path: "/status" });
    expect(
      proposeJsonExtraction({ items: [{ sku: "EX-1", name: "Example", status: "enabled" }] })
        ?.fields,
    ).toContainEqual({ property: sab("status"), path: "/status", untrusted: true });
    expect(proposeJsonExtraction({ items: [{ "a/b~c": true, other: 1 }] })?.fields[0]).toEqual({
      property: sab("a%2Fb~c"),
      path: "/a~1b~0c",
    });
  });
});
it("summarizes incomplete or unparseable scripts once per URL", () => {
  const bad = request("/bad.js", { resourceType: "script", bodySample: "function (" });
  const cut = request("/cut.js", {
    resourceType: "script",
    bodyTruncated: true,
    bodySample: "const x=",
  });
  const good = request("/ok.js", { resourceType: "script", bodySample: 'fetch("/data")' });
  expect(analyseScripts([bad, bad, cut, good])).toMatchObject({
    skipped: 2,
    calls: [expect.objectContaining({ urlPattern: `${origin}/data` })],
  });
});

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing required fixture value");
  return value;
}

it("does not assign numeric RDF datatypes to incompatible lexical forms", () => {
  expect(mapKey("qty", "0.0000")).toEqual({ property: s("orderQuantity") });
  expect(mapKey("stock", "12")).toEqual({
    property: s("inventoryLevel"),
    datatype: xsd("integer"),
  });
  expect(mapKey("price", "1e-7")).toEqual({ property: s("price") });
  expect(mapKey("price", " ")).toEqual({ property: s("price") });
});
