// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import { entities } from "../src/generated/model.js";
import {
  parsePage,
  parseSite,
  serializePage,
  serializeSite,
  validatePage,
  validateSite,
} from "../src/index.js";
import { at, pageData, root, siteData } from "./fixtures.js";

describe("generated model and policy facade", () => {
  it("round-trips every site and page property using generated RDF", async () => {
    const site = { ...siteData, publicUrl: `${root}public/sites/field/` };
    expect(parseSite(root, await parseRdf(await serializeSite(root, site), "text/turtle"))).toEqual(
      site,
    );
    const page = {
      ...pageData,
      status: "published" as const,
      published: at,
      image: "https://images.example/a.png",
      keywords: ["two", " one ", "one", ""],
    };
    const body = await serializePage(root, page);
    expect(parsePage(root, await parseRdf(body, "text/turtle"))).toEqual({
      ...page,
      keywords: ["one", "two"],
    });
    expect(body).toContain("schema:WebPage");
  });
  it("preserves raw Markdown and normal whitespace", () => {
    expect(validatePage({ ...pageData, body: "<b>raw</b>\n\tline\r\n" }).body).toBe(
      "<b>raw</b>\n\tline\r\n",
    );
    expect(validatePage({ ...pageData, body: "a\u0000b" }).body).toBe("ab");
    expect(validatePage({ ...pageData, body: "", summary: "" }).body).toBe("");
  });
  it.each([
    "name",
    "author",
    "description",
    "theme",
    "inLanguage",
    "created",
    "modified",
  ] as const)("fails closed without site %s", (key) => {
    const data = { ...siteData };
    delete (data as Partial<typeof data>)[key];
    expect(() => validateSite(data)).toThrow(TypeError);
    expect(parseSite(root, entities.Site.build(root, data))).toBeUndefined();
  });
  it.each([
    "title",
    "slug",
    "body",
    "summary",
    "kind",
    "status",
    "position",
    "modified",
  ] as const)("fails closed without page %s", (key) => {
    const data = { ...pageData };
    delete (data as Partial<typeof data>)[key];
    expect(() => validatePage(data)).toThrow(TypeError);
    expect(parsePage(root, entities.Page.build(root, data))).toBeUndefined();
  });
  it.each(["fr-FR", "en", "zh-Hant-TW"])("accepts language %s", (inLanguage) =>
    expect(validateSite({ ...siteData, inLanguage }).inLanguage).toBe(inLanguage));
  it.each(["x", "en GB", "<bad>"])("rejects language %s", (inLanguage) => {
    expect(() => validateSite({ ...siteData, inLanguage })).toThrow();
    expect(parseSite(root, entities.Site.build(root, { ...siteData, inLanguage }))).toBeUndefined();
  });
  it("rejects unpublished publication details, invalid enums, slugs and dates", () => {
    for (const data of [
      { ...pageData, status: "published" },
      { ...pageData, status: "private" },
      { ...pageData, kind: "article" },
      { ...pageData, position: -1 },
      { ...pageData, position: 1.5 },
      { ...pageData, slug: "../elsewhere" },
      { ...pageData, modified: new Date("invalid") },
    ])
      expect(() => validatePage(data as typeof pageData)).toThrow();
    expect(
      parsePage(root, entities.Page.build(root, { ...pageData, slug: "Bad" })),
    ).toBeUndefined();
    expect(
      parsePage(root, entities.Page.build(root, { ...pageData, status: "published" })),
    ).toBeUndefined();
    expect(() => validateSite({ ...siteData, theme: "evil" as "paper" })).toThrow();
  });
  it("ignores unrelated subjects and rejects relative subject URLs", async () => {
    const dataset = await parseRdf(
      "<https://example.org/a> a <https://schema.org/WebPage>.",
      "text/turtle",
    );
    expect(parseSite(root, dataset)).toBeUndefined();
    expect(parsePage(root, dataset)).toBeUndefined();
    expect(() => entities.Page.subject("#it")).toThrow();
  });
});
