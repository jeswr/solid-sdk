// AUTHORED-BY Codex GPT-6.1-Sol
import { verifiedReadBackItem } from "@jeswr/site-executor";
import { type Operation, readSiteModel, SCHEMA, writeSiteModel } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { learnIdentityLinks } from "../src/identity-links.js";
import type { RecordedRequest } from "../src/types.js";
import { learnWriteResponses } from "../src/write-responses.js";

const origin = "https://shop.test";
const provenance = {
  method: "demonstration" as const,
  learnedAt: "2026-11-14T00:00:00Z",
  derivedFrom: [],
  confidence: 1,
};
function record(changes: Partial<RecordedRequest>): RecordedRequest {
  return {
    seq: 0,
    phase: "demonstration",
    demonstration: "disposable-item",
    method: "GET",
    url: origin,
    resourceType: "document",
    requestHeaders: {},
    cookieNames: [],
    status: 200,
    contentType: "text/html",
    ...changes,
  };
}
function parameter(name: string, path: string[], location: "form" | "path" | "query") {
  return { name, path, location, required: true, range: "http://www.w3.org/2001/XMLSchema#string" };
}
function creation() {
  const create: Operation = {
    id: "urn:create",
    actionType: `${SCHEMA}CreateAction`,
    label: "Create product",
    effect: "irreversible-write",
    session: "none",
    provenance,
    inputs: [parameter("name", [`${SCHEMA}object`, `${SCHEMA}name`], "form")],
    request: {
      method: "POST",
      urlTemplate: `${origin}/products/save`,
      contentType: "application/x-www-form-urlencoded",
    },
  };
  const read: Operation = {
    ...create,
    id: "urn:rows",
    actionType: `${SCHEMA}ViewAction`,
    effect: "read",
    inputs: [parameter("id", [], "query")],
    request: { method: "GET", urlTemplate: `${origin}/products/rows{?id}` },
    extraction: {
      format: "json",
      itemPath: "/items",
      totalPath: "/total",
      itemType: `${SCHEMA}Product`,
      fields: [
        { property: `${SCHEMA}identifier`, path: "/id" },
        { property: `${SCHEMA}name`, path: "/name", untrusted: true },
        { property: "urn:picture-link", path: "/picture_link", untrusted: true },
      ],
    },
  };
  const landing = `${origin}/stores/main/products/edit/id/42/set/4/back/edit/`;
  const link = `${origin}/stores/main/products/edit/id/42/`;
  const rows = (url = link, id = "42") =>
    JSON.stringify({ total: 1, items: [{ id, name: "Example widget", picture_link: url }] });
  const records = [
    record({
      seq: 1,
      method: "POST",
      url: create.request.urlTemplate,
      status: 303,
      redirectedTo: landing,
      postData: "name=Example+widget",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
    }),
    record({
      seq: 2,
      url: landing,
      redirectedFrom: 1,
      responsePageError: false,
      bodySample: "<main>Editor</main>",
    }),
    record({
      seq: 3,
      url: `${origin}/products/rows?id=42`,
      contentType: "application/json",
      bodySample: rows(),
    }),
  ];
  return { create, read, records, rows, link };
}

it("learns a nonstandard row identity link from the witnessed creation resource and round-trips it", async () => {
  const { create, read, records, rows } = creation();
  expect(learnWriteResponses([create, read], records, origin)).toEqual({});
  learnIdentityLinks([create, read], records, origin);
  expect(read.extraction?.fields).toContainEqual({
    property: "urn:picture-link",
    path: "/picture_link",
    untrusted: true,
  });
  const policy = learnWriteResponses([create, read], records, origin)[create.id];
  expect(policy?.readBack).toMatchObject({
    operation: read.id,
    identityPattern: `${origin}/stores/main/products/edit/id/{id}/`,
  });
  const model = readSiteModel(
    await writeSiteModel({
      id: "urn:model",
      site: origin,
      generatedAt: provenance.learnedAt,
      version: "1",
      operations: [create, read],
      flows: [],
    }),
  );
  const ex = model.operations.find((op) => op.id === read.id)?.extraction;
  if (!ex || !policy?.readBack) throw new Error("Missing learned identity");
  for (const [url, expected] of [
    [`${origin}/stores/main/products/edit/id/73/`, true],
    [`${origin}/stores/other/products/edit/id/73/`, false],
    [`${origin}/stores/main/categories/edit/id/73/`, false],
  ] as const) {
    expect(
      await verifiedReadBackItem(
        ex,
        rows(url, "73"),
        `${origin}/products/rows?id=73`,
        "73",
        `${SCHEMA}name`,
        "Example widget",
        (value) => value,
        policy.readBack,
      ),
    ).toBe(expected);
  }
});

it.each([
  "other resource",
  "other store",
  "off origin",
  "query",
  "fragment",
  "credentials",
  "wrong identity",
  "unlinked landing",
  "failed landing",
  "missing landing body",
  "partial landing",
  "other demonstration",
  "earlier read",
  "unfiltered",
  "mismatched submitted value",
  "partial rows",
  "two items",
  "two link fields",
])("does not learn a row identity link from %s", (mode) => {
  const { create, read, records, rows, link } = creation();
  const [write, landing, follow] = records;
  if (!write || !landing || !follow || !read.extraction) throw new Error("Missing fixture");
  const other: Record<string, string> = {
    "other resource": link.replace("products", "categories"),
    "other store": link.replace("/main/", "/other/"),
    "off origin": link.replace("shop.test", "other.test"),
    query: `${link}?tenant=other`,
    fragment: `${link}#other`,
    credentials: link.replace("https://", "https://alex@"),
    "wrong identity": link.replace("/42/", "/43/"),
  };
  if (other[mode]) follow.bodySample = rows(other[mode]);
  if (mode === "unlinked landing") landing.redirectedFrom = undefined;
  if (mode === "failed landing") landing.responsePageError = true;
  if (mode === "missing landing body") landing.bodySample = undefined;
  if (mode === "partial landing") {
    landing.bodyTruncated = true;
    landing.responsePageError = undefined;
  }
  if (mode === "other demonstration") follow.demonstration = "unrelated";
  if (mode === "earlier read") follow.seq = 0;
  if (mode === "unfiltered") follow.url = `${origin}/products/rows`;
  if (mode === "mismatched submitted value")
    follow.bodySample = rows().replace("Example widget", "Other widget");
  if (mode === "partial rows") follow.bodySample = rows().replace('"total":1', '"total":2');
  if (mode === "two items")
    follow.bodySample = JSON.stringify({
      total: 2,
      items: [
        { id: "42", name: "Example widget", picture_link: link },
        { id: "42", name: "Example widget", picture_link: link },
      ],
    });
  if (mode === "two link fields") {
    read.extraction.fields.push({ property: "urn:edit-link", path: "/edit_link", untrusted: true });
    follow.bodySample = JSON.stringify({
      total: 1,
      items: [{ id: "42", name: "Example widget", picture_link: link, edit_link: link }],
    });
  }
  learnIdentityLinks([create, read], records, origin);
  expect(read.extraction.fields.some((field) => field.property === `${SCHEMA}url`)).toBe(false);
  expect(learnWriteResponses([create, read], records, origin)).toEqual({});
});

it("learns the witnessed row resource despite an unclassified failed background POST", () => {
  const { create, read, records } = creation();
  const follow = records[2];
  if (!follow) throw new Error("Missing fixture read");
  follow.seq = 4;
  records.push(
    record({ seq: 3, method: "POST", url: `${origin}/preferences/save`, status: undefined }),
  );
  // A per-page route can abort a background request before the context recorder's
  // guard runs. No response is observed. It cannot erase the witnessed namespace;
  // creation still requires its own redirect, singleton read and submitted equality.
  learnIdentityLinks([create, read], records, origin);
  expect(
    learnWriteResponses([create, read], records, origin)[create.id]?.readBack?.identityPattern,
  ).toBe(`${origin}/stores/main/products/edit/id/{id}/`);
});

function deletion() {
  const remove: Operation = {
    id: "urn:delete",
    label: "Delete discussion",
    actionType: `${SCHEMA}DeleteAction`,
    effect: "irreversible-write",
    session: "none",
    provenance,
    inputs: [
      parameter("forum", [`${SCHEMA}object`, `${SCHEMA}isPartOf`, `${SCHEMA}name`], "path"),
      parameter("id", [`${SCHEMA}object`, `${SCHEMA}identifier`], "path"),
    ],
    request: {
      method: "POST",
      urlTemplate: `${origin}/f/{forum}/{id}/-/delete`,
      contentType: "application/x-www-form-urlencoded",
    },
  };
  const read: Operation = {
    ...remove,
    id: "urn:detail",
    effect: "read",
    actionType: `${SCHEMA}ViewAction`,
    inputs: [
      parameter("forum", [], "path"),
      parameter("id", [], "path"),
      parameter("slug", [], "path"),
    ],
    request: { method: "GET", urlTemplate: `${origin}/f/{forum}/{id}/{slug}` },
    extraction: {
      format: "html",
      itemType: `${SCHEMA}DiscussionForumPosting`,
      idField: `${SCHEMA}url`,
      fields: [
        {
          property: `${SCHEMA}url`,
          path: "main a[rel=bookmark]",
          attribute: "href",
          datatype: "iri",
        },
      ],
    },
  };
  const url = `${origin}/f/ExampleForum/42/example-post`;
  const action = `${origin}/f/ExampleForum/42/-/delete`;
  const records = [
    record({
      seq: 1,
      url,
      bodySample: `<main><a rel="bookmark" href="${url}">Example post</a><form method="post" action="${action}"><button>Delete</button></form></main>`,
    }),
    record({
      seq: 2,
      method: "POST",
      url: action,
      status: 303,
      redirectedTo: `${origin}/f/ExampleForum`,
    }),
    record({
      seq: 3,
      url: `${origin}/f/ExampleForum`,
      redirectedFrom: 2,
      responsePageError: false,
      bodySample:
        '<main>Forum</main><div role="alert" class="alert-success">Discussion deleted</div>',
    }),
    record({ seq: 4, url, status: 404, bodySample: "<h1>Not found</h1>" }),
  ];
  return { remove, read, records };
}

it.each([
  404, 410,
])("learns a deletion flash after the witnessed form's exact detail returns %s, even when cleanup drops the read from replay", (status) => {
  const { remove, read, records } = deletion();
  const after = records[3];
  if (!after) throw new Error("Missing follow-up");
  after.status = status;
  after.phase = "crawl";
  after.demonstration = undefined;
  // The main detail was learned and read successfully before deletion; replaying it
  // after cleanup must not erase that independently witnessed evidence.
  expect(
    learnWriteResponses([remove, read], records, origin, [remove])[remove.id]?.successFlash,
  ).toHaveLength(1);
});

it.each([
  "no follow-up",
  "still present",
  "access denied",
  "server failure",
  "other resource",
  "other forum",
  "off origin",
  "unrelated demonstration",
  "blocked follow-up",
  "redirect follow-up",
  "after another write",
  "unclassified failed background POST",
  "no prior item",
  "prior read superseded",
  "failed prior item",
  "collection",
  "wrong permalink",
  "missing form",
  "other form",
  "failed landing",
  "unmarked landing",
])("does not learn a deletion flash from %s", (mode) => {
  const { remove, read, records } = deletion();
  const [before, write, landing, after] = records;
  if (!before || !write || !landing || !after || !read.extraction)
    throw new Error("Missing fixture");
  if (mode === "no follow-up") records.pop();
  if (mode === "still present") after.status = 200;
  if (mode === "access denied") after.status = 403;
  if (mode === "server failure") after.status = 500;
  if (mode === "other resource") after.url = after.url.replace("/f/", "/categories/");
  if (mode === "other forum") after.url = after.url.replace("ExampleForum", "OtherForum");
  if (mode === "off origin") after.url = after.url.replace("shop.test", "other.test");
  if (mode === "unrelated demonstration") after.demonstration = "unrelated";
  if (mode === "blocked follow-up") after.blocked = true;
  if (mode === "redirect follow-up") after.redirectedTo = `${origin}/login`;
  if (mode === "after another write") {
    after.seq = 6;
    records.push(record({ seq: 5, method: "POST" }));
  }
  if (mode === "unclassified failed background POST") {
    after.seq = 6;
    records.push(
      record({ seq: 5, method: "POST", url: `${origin}/preferences/save`, status: undefined }),
    );
  }
  if (mode === "no prior item") records.shift();
  if (mode === "prior read superseded") {
    write.seq = 3;
    landing.seq = 4;
    landing.redirectedFrom = write.seq;
    after.seq = 5;
    records.push(record({ seq: 2, method: "POST" }));
  }
  if (mode === "failed prior item") before.status = 404;
  if (mode === "collection") read.extraction.itemPath = "main";
  if (mode === "wrong permalink")
    before.bodySample = before.bodySample?.replace(
      'rel="bookmark" href="https://shop.test/f/',
      'rel="bookmark" href="https://shop.test/categories/',
    );
  if (mode === "missing form")
    before.bodySample = `<main><a rel="bookmark" href="${before.url}">Example post</a></main>`;
  if (mode === "other form") before.bodySample = before.bodySample?.replace("/-/delete", "/-/edit");
  if (mode === "failed landing") landing.responsePageError = true;
  if (mode === "unmarked landing") landing.responsePageError = undefined;
  expect(
    learnWriteResponses([remove, read], records, origin)[remove.id]?.successFlash,
  ).toBeUndefined();
});
