// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { applyExtraction, proposeHtmlExtraction } from "../src/extraction.js";
import { isCsrfFieldName, parseForms } from "../src/forms.js";
import { htmlRecordExtractions } from "../src/html-records.js";
import { clusterRequests } from "../src/templates.js";
import type { RecordedRequest } from "../src/types.js";
import { learnDemonstratedForm } from "../src/write-learning.js";

const s = "https://schema.org/";
const html = `<main><article class="entry entry--expanded"><header><h2><a href="/topics/42/a-story">A story</a></h2><a rel="author" href="/user/alex">Alex</a><time datetime="2026-11-13T10:00:00Z"></time></header><nav><a href="/topics/42/a-story">2 comments</a><span data-entry-id="42" data-comment-count="2"></span></nav><div class="entry__body">Untrusted body</div></article>
<article class="comment" id="comment_51"><div class="row"><header><h2><a href="/user/alex">Alex</a><time datetime="2026-11-13T11:00:00Z"></time></h2></header><div class="comment__body">First text</div><nav><a class="comment__permalink" href="/topics/42/comment/51">Permalink</a><a rel="up" href="/topics/42">Parent</a></nav></div><div class="replies"><article class="comment"><div class="row"><header><h2><a href="/user/blair">Blair</a><time datetime="2026-11-13T12:00:00Z"></time></h2></header><div class="comment__body">Nested text</div><nav><a class="comment__permalink" href="/topics/42/comment/52">Permalink</a></nav></div></article></div></article></main>`;
it("learns typed HTML posts and comments, trusts identities and dates, and keeps nested comments separate", () => {
  const views = htmlRecordExtractions(html);
  expect(views.map((e) => e.itemType)).toEqual([`${s}DiscussionForumPosting`, `${s}Comment`]);
  const posts = views[0],
    comments = views[1];
  expect(posts?.totalPath).toBeUndefined();
  expect(
    posts?.fields
      .filter((f) => [`${s}headline`, `${s}text`, `${s}author`].includes(f.property))
      .every((f) => f.untrusted),
  ).toBe(true);
  expect(
    posts?.fields.some((f) => f.property === `${s}commentCount` && f.datatype?.endsWith("integer")),
  ).toBe(true);
  expect(comments?.fields.find((f) => f.property === `${s}text`)?.untrusted).toBe(true);
  if (!comments) throw new Error("missing comments");
  const items = applyExtraction(comments, html, "https://forum.test/");
  expect(items.map((i) => i[`${s}text`])).toEqual([["First text"], ["Nested text"]]);
  expect(items[0]?.[`${s}parentItem`]).toEqual(["https://forum.test/topics/42"]);
});
it("learns collections and a profile without mistaking the author's posts for a Person", () => {
  const cards = '<article class="tile"><h2><a href="/groups/example">Example</a></h2></article>';
  expect(htmlRecordExtractions(cards)[0]?.itemType).toBe(`${s}CreativeWork`);
  const profile = htmlRecordExtractions(
    `<aside><h1><a href="/user/alex">Alex</a></h1></aside>${html}`,
    "https://forum.test/user/alex",
  );
  expect(profile[0]?.itemType).toBe(`${s}Person`);
  expect(profile[0]?.fields.find((f) => f.property === `${s}name`)?.untrusted).toBe(true);
});
it("learns bracketed CSRF and numeric form-name slots from the demonstrated referring form", () => {
  const url = "https://forum.test/topics/42/comment";
  const request: RecordedRequest = {
    seq: 1,
    phase: "demonstration",
    method: "POST",
    url,
    resourceType: "document",
    requestHeaders: {
      "content-type": "application/x-www-form-urlencoded",
      referer: "https://forum.test/topics/42",
    },
    cookieNames: [],
    status: 302,
    postData: new URLSearchParams({
      "reply_42[comment]": "Hello",
      "reply_42[_token]": "[redacted]",
    }).toString(),
  };
  const c = clusterRequests([request], "https://forum.test")[0];
  if (!c) throw new Error("missing candidate");
  const learned = learnDemonstratedForm(c, [
    {
      url: "https://forum.test/topics/42",
      html: `<form action="${url}" method="post"><textarea name="reply_42[comment]"></textarea><input type="hidden" name="reply_42[_token]" value="secret-token-example"></form>`,
    },
  ]);
  expect(new URLSearchParams(learned.bodyTemplate).get("reply_{id}[comment]")).toBe("{text}");
  expect(learned.csrf[0]?.target.name).toBe("reply_{id}[_token]");
  expect(learned.csrf[0]?.source).toMatchObject({
    kind: "html",
    urlTemplate: "https://forum.test/topics/{id}",
  });
  expect(
    parseForms('<form><input type="hidden" name="data[_token]"></form>', url)[0]?.fields[0]?.hidden,
  ).toBe(true);
  expect(isCsrfFieldName("data[_token]")).toBe(true);
});

it("preserves price-based extraction for product article cards", () => {
  const product =
    '<main><article class="product"><h2><a href="/products/42">Example</a></h2><span class="price" data-price="12.34">12.34</span></article></main>';
  expect(htmlRecordExtractions(product)).toEqual([]);
  expect(proposeHtmlExtraction(product)?.itemType).toBe(`${s}Product`);
});

it("r11 reads a single order's identifier and submitted delivery field without typing it as a product", () => {
  const body =
    '<main><h1>Order <span class="order-id">42</span></h1><p>Delivery: <span class="delivery">express</span></p><p class="price">£20.00</p></main>';
  const extraction = proposeHtmlExtraction(body, "https://shop.test/orders/42");
  expect(extraction?.itemType).toBe(`${s}Order`);
  expect(extraction?.itemPath).toBeUndefined();
  if (!extraction) throw new Error("Missing order extraction");
  expect(applyExtraction(extraction, body, "https://shop.test/orders/42")[0]).toMatchObject({
    [`${s}identifier`]: ["42"],
    [`${s}deliveryMethod`]: ["express"],
  });
});

it.each([
  "single resource",
  "parent collection",
  "other parent",
  "multiple comments",
])("r11 promotes a comment to a main-item extraction only on its own witnessed permalink (%s)", (kind) => {
  const permalink = kind === "other parent" ? "/topics/99/-/comment/51" : "/topics/42/-/comment/51";
  const body = `<main><article class="entry"><h1><a href="/topics/42/example-story">Example story</a></h1><time datetime="2026-11-13T10:00:00Z"></time></article><article class="comment"><div class="comment__body">Example reply</div><a class="comment__permalink" href="${permalink}">Permalink</a></article>${kind === "multiple comments" ? '<article class="comment"><div class="comment__body">Other reply</div><a class="comment__permalink" href="/topics/42/-/comment/52">Permalink</a></article>' : ""}</main>`;
  const page =
    kind === "parent collection"
      ? "https://forum.test/topics/42/example-story"
      : "https://forum.test/topics/42/example-story/comment/51";
  const extraction = htmlRecordExtractions(body, page).find((ex) => ex.itemType === `${s}Comment`);
  expect(extraction).toBeDefined();
  expect(extraction?.itemPath).toBe(kind === "single resource" ? undefined : "article.comment");
  if (extraction && kind === "single resource")
    expect(applyExtraction(extraction, body, page)[0]?.[`${s}text`]).toEqual(["Example reply"]);
});
