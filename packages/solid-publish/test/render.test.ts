// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  assertSlug,
  CSP,
  escapeHtml,
  escapeXml,
  isSlug,
  pageUrl,
  renderFeed,
  renderIndex,
  renderMarkdown,
  renderPage,
  safeContentUrl,
  slugify,
  uniqueSlug,
} from "../src/index.js";
import { at, pageData, root, siteData } from "./fixtures.js";

const site = { ...siteData, publicUrl: `${root}public/sites/field/` };
const post = { ...pageData, status: "published" as const, published: at };
describe("safe standalone output", () => {
  it("renders complete accessible HTML, metadata, skip link and strict script-free CSP", () => {
    const html = renderPage(site, { ...post, image: "https://images.example/cover.png" }, [post]);
    for (const text of [
      "<!doctype html>",
      '<html lang="en-GB">',
      "<header>",
      '<main id="content"',
      "<footer>",
      "Skip to content",
      '<meta name="description"',
      'property="og:title"',
      'property="og:image"',
      'rel="canonical"',
      "<strong>Hello</strong>",
      "<time datetime=",
    ])
      expect(html).toContain(text);
    expect(html).toContain(escapeHtml(CSP));
    expect(html).not.toMatch(/<script\b/i);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(renderPage(site, { ...post, kind: "page" })).not.toContain("<time");
    expect(renderPage(site, pageData)).not.toContain("<time");
  });
  it.each(["paper", "journal", "garden"] as const)("ships a standalone %s stylesheet", (theme) =>
    expect(renderPage({ ...site, theme }, post)).toContain(`<body class="${theme}">`));
  it("escapes interpolated site, page, navigation and XML text", () => {
    const hostile = `"><img src=x onerror=evil()> & ' <script>bad()</script>`;
    const html = renderPage(
      { ...site, name: hostile, author: hostile, description: hostile, inLanguage: hostile },
      { ...post, title: hostile, summary: hostile },
      [{ ...post, kind: "page", title: hostile }],
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain(escapeHtml(hostile));
    const xml = renderFeed({ ...site, name: hostile, description: hostile, inLanguage: hostile }, [
      { ...post, title: hostile, summary: hostile, keywords: [hostile] },
    ]);
    expect(xml).toContain(escapeXml(hostile));
    expect(xml).not.toContain("<img");
    expect(xml).toContain("<category>");
    expect(escapeXml("a\u0000b\ud800c\ufffed😀\n\t\r")).toBe("abcd😀\n\t\r");
    expect(escapeHtml("clean")).toBe("clean");
  });
  it.each([
    "<script>alert(1)</script>",
    '<svg onload="evil()"><a href="javascript:evil()">bad</a></svg>',
    '<iframe src="https://evil.example"></iframe>',
    '<form action="https://evil.example"><input autofocus></form>',
    "<style>body{display:none}</style>",
    '<img src="data:image/svg+xml,evil" onerror="evil()">',
    '<a href="jAvAsCrIpT:evil()">bad</a>',
    '<a href="java&#x73;cript:evil()">bad</a>',
    '<a href="//evil.example/x">bad</a>',
    '<img src="//evil.example/image">',
    '<a href="data:text/html,evil">bad</a>',
    '<img src="mailto:x@example.org">',
    '<a href="https://user:secret@evil.example/">bad</a>',
    '<a href="https://[">bad</a>',
  ])("sanitises adversarial Markdown %s", (markdown) => {
    const html = renderMarkdown(markdown, site.publicUrl);
    expect(html).not.toMatch(
      /<script|<iframe|<style|<form|<input|<svg|onerror=|onload=|href="(?:javascript:|data:|\/\/)|src="(?:data:|mailto:|\/\/)/i,
    );
    expect(html).not.toContain("user:secret");
  });
  it("allows a narrow Markdown/HTML vocabulary and safe links", () => {
    const html = renderMarkdown(
      '# Heading\n\n[External](https://elsewhere.example/a "Title") [Internal](../about/index.html) [Mail](mailto:writer@example.org)\n\n![Alt](cover.jpg)\n\n<kbd>ignored tag</kbd><b style="color:red">Plain</b>\n\n| A | B |\n|---|---|\n| one | two |',
      site.publicUrl,
    );
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="../about/index.html"');
    expect(html).toContain('href="mailto:writer@example.org"');
    expect(html).toContain('src="cover.jpg"');
    expect(html).toContain('alt="Alt"');
    expect(html).toContain("<table>");
    expect(html).not.toContain("style=");
    expect(html).not.toContain("<kbd>");
    expect(renderMarkdown('<a title="Greeting">No link</a><img>', site.publicUrl)).toContain(
      'alt=""',
    );
  });
  it.each([
    "",
    "//evil.example",
    "https://a b",
    "a\\b",
    "java\u0000script:x",
    "data:text/plain,x",
    "https://[",
    "https://user@host/",
  ])("rejects unsafe URL %s", (url) => expect(safeContentUrl(url)).toBeUndefined());
  it.each([
    "https://example.org/",
    "http://example.org/",
    "mailto:x@example.org",
    "../page",
    "/page",
    "#section",
    "?query=yes",
  ])("admits URL %s", (url) => expect(safeContentUrl(url)).toBe(url));
  it("rejects image mailto and invalid public site bases/slugs", () => {
    expect(safeContentUrl("mailto:x@y.org", true)).toBeUndefined();
    for (const publicUrl of [
      "/relative/",
      "javascript:evil()",
      "https://pod.example/path",
      `${site.publicUrl}?a`,
      `${site.publicUrl}#b`,
    ])
      expect(() => renderPage({ ...site, publicUrl }, post)).toThrow();
    expect(() => pageUrl(site, { slug: "../evil" })).toThrow();
  });
  it("orders page navigation, excludes drafts and keeps newest posts first", () => {
    const pages = [
      { ...post, kind: "page" as const, title: "Later", slug: "later", position: 4 },
      { ...post, kind: "page" as const, title: "First", slug: "first", position: 1 },
      { ...pageData, title: "Secret draft", slug: "secret" },
    ];
    const html = renderPage(site, post, pages);
    expect(html.indexOf(">First</a>")).toBeLessThan(html.indexOf(">Later</a>"));
    expect(html).not.toContain("Secret draft");
    const posts = [
      { ...post, slug: "older", title: "Older", published: new Date(0) },
      { ...post, slug: "newer", title: "Newer" },
      ...pages,
    ];
    const index = renderIndex(site, posts, pages);
    expect(index.indexOf(">Newer</a>")).toBeLessThan(index.indexOf(">Older</a>"));
    expect(index).not.toContain("Secret draft");
    const feed = renderFeed(site, posts);
    expect(feed.indexOf("<title>Newer</title>")).toBeLessThan(feed.indexOf("<title>Older</title>"));
    expect(feed).not.toContain("<title>Later</title>");
    expect(feed).not.toContain("Secret draft");
    expect(renderIndex(site, [])).toContain("There are no posts");
    expect(renderFeed(site, [])).not.toContain("<item>");
    expect(renderPage(site, { ...post, summary: "", image: "javascript:x" })).toContain(
      site.description.replace("&", "&amp;"),
    );
    expect(renderIndex(site, [{ ...post, published: undefined }])).toContain(post.title);
    expect(renderFeed(site, [{ ...post, published: undefined }])).not.toContain("<pubDate>");
    const undated = [
      { ...post, published: undefined, slug: "undated-a" },
      post,
      { ...post, published: undefined, slug: "undated-b" },
    ];
    expect(renderIndex(site, undated)).toContain("undated-a/index.html");
    expect(renderFeed(site, undated)).toContain("undated-b/index.html");
  });
});
describe("URL slugs", () => {
  it.each(["about", "two-words", "123", "a".repeat(80)])("accepts %s", (slug) => {
    expect(isSlug(slug)).toBe(true);
    expect(() => assertSlug(slug)).not.toThrow();
  });
  it.each([
    "",
    "Bad",
    "-bad",
    "bad-",
    "bad--slug",
    "../x",
    "a/b",
    "a%2fb",
    "a".repeat(81),
    "with space",
    "résumé",
  ])("rejects %s", (slug) => {
    expect(isSlug(slug)).toBe(false);
    expect(() => assertSlug(slug)).toThrow();
  });
  it("normalises and makes collision-free bounded slugs", () => {
    expect(slugify("Résumé & Tea!")).toBe("resume-tea");
    expect(slugify("💚")).toBe("untitled");
    expect(slugify(`${"a".repeat(79)}---hello`)).toHaveLength(79);
    expect(uniqueSlug("A title", [])).toBe("a-title");
    expect(uniqueSlug("A title", ["a-title", "a-title-2"])).toBe("a-title-3");
    expect(uniqueSlug("a".repeat(80), ["a".repeat(80)])).toHaveLength(72);
  });
});
