// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  createLinkPreview,
  extractPreviewMetadata,
  MAX_PREVIEW_HTML_BYTES,
  MAX_PREVIEW_TAGS,
  PreviewError,
  type PreviewErrorCode,
} from "../src/apps/chat/lib/preview";

const PAGE = "https://example.org/articles/page?read=1";
const meta = (key: string, value: string) => `<meta property="${key}" content="${value}">`;

function rejects(html: string, code: PreviewErrorCode = "invalid-html", page = PAGE) {
  expect(() => extractPreviewMetadata(html, page)).toThrow(PreviewError);
  expect(() => extractPreviewMetadata(html, page)).toThrow(expect.objectContaining({ code }));
}

describe("chat link preview metadata", () => {
  it("extracts every metadata family and resolves URLs without DOM or fetch", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("Unexpected network request");
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("document", undefined);
    try {
      const html = `<!DOCTYPE html><html lang=en><head>
        <TITLE> A &amp; B </TITLE><meta name=description content='HTML description'>
        ${meta("og:title", "OG title")}${meta("og:description", "OG description")}
        ${meta("og:image", "../cover.png?a=1&amp;b=2")}${meta("og:site_name", "Example Gazette")}
        ${meta("og:url", "/og-page")}${meta("twitter:title", "Twitter title")}
        ${meta("twitter:description", "Twitter description")}${meta("twitter:image", "//images.example.org/card.png")}
        ${meta("twitter:site", "@example")}${meta("twitter:card", "summary_large_image")}
        <link rel=canonical href="/canonical"><link rel="shortcut ICON" href="./icon.png">
        </head><body><h1>Fictional Gazette</h1></body></html>`;
      expect(extractPreviewMetadata(html, PAGE)).toEqual({
        pageUrl: PAGE,
        title: "A & B",
        description: "HTML description",
        canonicalUrl: "https://example.org/canonical",
        iconUrl: "https://example.org/articles/icon.png",
        openGraph: {
          title: "OG title",
          description: "OG description",
          image: "https://example.org/cover.png?a=1&b=2",
          siteName: "Example Gazette",
          url: "https://example.org/og-page",
        },
        twitter: {
          title: "Twitter title",
          description: "Twitter description",
          image: "https://images.example.org/card.png",
          site: "@example",
          card: "summary_large_image",
        },
      });
      expect(createLinkPreview(html, PAGE)).toEqual({
        title: "OG title",
        description: "OG description",
        image: "https://example.org/cover.png?a=1&b=2",
        siteName: "Example Gazette",
        url: "https://example.org/canonical",
        iconUrl: "https://example.org/articles/icon.png",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("chooses independent Twitter, HTML and empty-page fallbacks", () => {
    expect(
      createLinkPreview(
        `${meta("twitter:title", "Tw")}${meta("twitter:description", "Desc")}${meta("twitter:image:src", "/tw.png")}${meta("twitter:site", "@gazette")}${meta("og:url", "/article")}`,
        PAGE,
      ),
    ).toEqual({
      title: "Tw",
      description: "Desc",
      image: "https://example.org/tw.png",
      siteName: "@gazette",
      url: "https://example.org/article",
      iconUrl: null,
    });
    expect(
      createLinkPreview(
        '<head><title> HTML </title><meta NAME=description content="Detail"></head>',
        PAGE,
      ),
    ).toEqual({
      title: "HTML",
      description: "Detail",
      image: null,
      siteName: "example.org",
      url: PAGE,
      iconUrl: null,
    });
    expect(createLinkPreview("", PAGE)).toEqual({
      title: "example.org",
      description: null,
      image: null,
      siteName: "example.org",
      url: PAGE,
      iconUrl: null,
    });
    expect(
      createLinkPreview(
        `${meta("og:title", "OG")}${meta("twitter:description", "Tw desc")}<title>HTML</title>`,
        PAGE,
      ),
    ).toMatchObject({ title: "OG", description: "Tw desc" });
  });

  it("uses first nonempty values and aliases in source order", () => {
    const html = `<meta ignored disabled NAME = 'OG:TITLE' PROPERTY='og:title' content='  ' />
      ${meta("og:title", " First\n title ")}${meta("og:title", "Second")}
      ${meta("og:image:url", "/first.png")}${meta("og:image", "/second.png")}
      <title> </title><title>First title</title><title>Last title</title>
      <link rel=canonical><link rel=canonical href='?canonical=1'><link rel=canonical href=/last>
      <link rel=stylesheet href=javascript:ignored><link rel=apple-touch-icon href='/apple.png' />
      <link rel=icon href='/second-icon.png'>${meta("unknown", "&unsupported;")}`;
    expect(extractPreviewMetadata(html, PAGE)).toMatchObject({
      title: "First title",
      canonicalUrl: "https://example.org/articles/page?canonical=1",
      iconUrl: "https://example.org/apple.png",
      openGraph: { title: "First title", image: "https://example.org/first.png" },
    });
  });

  it("decodes entities once, normalizes text, and treats title markup as text", () => {
    expect(
      createLinkPreview(
        "<title> &quot;A&apos;s&quot;&nbsp;&lt;b&gt; &#65;&#x42;&#X1f600;&#9;&#10;&#12;&#13; &amp;lt; <b> </title>",
        PAGE,
      ).title,
    ).toBe('"A\'s" <b> AB😀 &lt; <b>');
    expect(createLinkPreview("<title>A & B</title>", PAGE).title).toBe("A & B");
  });

  it.each([
    "AT&T",
    "A&width=800",
    "A&fictional",
    "A&123",
    "A&AmP",
    "A&",
  ])("preserves literal ampersands in title and attribute text: %s", (value) => {
    expect(
      createLinkPreview(`<title>${value}</title>${meta("description", value)}`, PAGE),
    ).toMatchObject({ title: value, description: value });
  });

  it.each([
    "width=800",
    "amp=1",
    "copy=1",
    "notebook=1",
    "AMPx=1",
  ])("preserves literal query separators in URL attributes: %s", (query) => {
    const value = `/cover?a=1&${query}`;
    expect(
      createLinkPreview(
        `${meta("og:image", value)}<link rel=canonical href="${value}"><link rel=icon href="${value}">`,
        PAGE,
      ),
    ).toMatchObject({
      image: `https://example.org${value}`,
      url: `https://example.org${value}`,
      iconUrl: `https://example.org${value}`,
    });
  });

  it.each([
    "&copy",
    "&notebook",
    "&amplitude",
    "&AMPx",
    "&nbsp!",
  ])("rejects unsupported semicolonless references in title text: %s", (value) =>
    rejects(`<title>${value}</title>`));

  it.each([
    "&copy",
    "&amp",
    "&nbsp!",
    "&copy;",
    "&fictional;",
    "&#65",
  ])("retains entity rejection in extracted attributes: %s", (value) =>
    rejects(meta("description", value)));

  it.each([
    " ",
    "\t",
    "\n",
    "\f",
    "\r",
    "&#9;",
    "&#10;",
    "&#12;",
    "&#13;",
    "&#32;",
  ])("splits decoded link relations on HTML ASCII whitespace: %s", (space) => {
    expect(
      createLinkPreview(
        `<link rel="${space}CANONICAL${space}alternate${space}" href="/canonical"><link rel="shortcut${space}ICON" href="/icon">`,
        PAGE,
      ),
    ).toMatchObject({ url: "https://example.org/canonical", iconUrl: "https://example.org/icon" });
  });

  it.each([
    "&nbsp;",
    "\u00a0",
    "\u2003",
    "\u202f",
    "\ufeff",
    "&#x2003;",
  ])("does not manufacture link relations from Unicode whitespace: %s", (space) => {
    expect(
      createLinkPreview(
        `<link rel="canonical${space}alternate" href="/other"><link rel="${space}canonical${space}" href="/other"><link rel="shortcut${space}icon" href="/icon"><link rel="${space}apple-touch-icon" href="/apple">`,
        PAGE,
      ),
    ).toMatchObject({ url: PAGE, iconUrl: null });
  });

  it("ignores comment, raw text and body metadata lookalikes", () => {
    const html = `<!-- ${meta("og:title", "Comment")} -->
      <html><head><script>const fake = '${meta("og:title", "Script")}';</script>
      <style>/* ${meta("og:title", "Style")} */</style><title>Actual</title></head>
      <body><div><meta property=og:title content=Body><img src=/photo><br></div>
      <textarea>${meta("og:title", "Textarea")}</textarea><title>Body title</title></body></html>`;
    expect(createLinkPreview(html, PAGE).title).toBe("Actual");
    expect(createLinkPreview("<body>text without tags</body>", PAGE).title).toBe("example.org");
    expect(createLinkPreview("<body>text<div>more</div>tail</body>", PAGE).title).toBe(
      "example.org",
    );
  });

  it.each([
    ["/root", "https://example.org/root"],
    ["../relative", "https://example.org/relative"],
    ["?q=1", "https://example.org/articles/page?q=1"],
    ["#part", `${PAGE}#part`],
    ["//cdn.example.org/image", "https://cdn.example.org/image"],
    ["http://example.org/image", "http://example.org/image"],
    ["HTTPS://EXAMPLE.ORG/image", "https://example.org/image"],
  ])("resolves HTTP(S) URL %s", (value, expected) => {
    expect(createLinkPreview(meta("og:image", value), PAGE).image).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "file:///tmp/image",
    "mailto:a@example.org",
    "ftp://example.org/image",
    "http:example.org",
    "https:///example.org",
    "https://[invalid",
    "https://a:b@example.org",
    "/a b",
    "/a\\b",
    "/a&#9;b",
  ])("rejects unsafe URL %s", (value) => {
    rejects(meta("og:image", value), "invalid-url");
    rejects(`<link rel=icon href="${value}">`, "invalid-url");
    rejects(`<link rel=canonical href="${value}">`, "invalid-url");
  });

  it("rejects unsafe lower-priority and duplicate candidates", () => {
    rejects(meta("og:image", "/safe.png") + meta("twitter:image", "javascript:bad"), "invalid-url");
    rejects(meta("og:image", "/safe.png") + meta("og:image", "data:bad"), "invalid-url");
    rejects(meta("og:url", "javascript:bad"), "invalid-url");
  });

  it.each([
    "",
    "/relative",
    "data:text/html,test",
    " https://example.org",
    "https://example.org\n",
    "https://user@example.org",
    "https://[bad",
    "https://example.org/\ud800",
  ])("rejects invalid page URL %s", (page) => rejects("", "invalid-url", page));

  it("returns typed errors for runtime non-string inputs without exposing input", () => {
    rejects(null as unknown as string);
    rejects("", "invalid-url", null as unknown as string);
    const secret = "https://fictional:credential@example.org";
    try {
      extractPreviewMetadata("", secret);
    } catch (error) {
      expect(error).toMatchObject({
        name: "PreviewError",
        code: "invalid-url",
        message: "Link preview rejected: invalid-url",
      });
      expect(String(error)).not.toContain(secret);
    }
  });

  it.each([
    "&copy;",
    "&constructor;",
    "&toString;",
    "&AMP;",
    "&amp",
    "&#0;",
    "&#xD800;",
    "&#1114112;",
    "&#1;",
    "&#x7f;",
    "&#x80;",
    "&#x9f;",
    "&#xZZ;",
    "&#;",
    "&#12",
    "&#-1;",
  ])("rejects unsupported entity %s", (value) => rejects(`<title>${value}</title>`));

  it.each([
    "<",
    "<?xml version='1.0'?>",
    "<![CDATA[anything]]>",
    "<meta",
    "<meta ",
    "<meta @bad>",
    '<meta name="missing>',
    "<meta name=>",
    "<meta name=`bad`>",
    '<meta name="a"content="b">',
    "<meta name=x NAME=y>",
    "</meta>",
    "<meta></meta>",
    "<title/>",
    "<div/>",
    "<head><div></div></head>",
    "<html><title>Bad</title></html>",
    "<head>",
    "<title>no close",
    "<script>no close",
    "<!-- no close",
    "<!-- bad -- comment -->",
    "<!--> <meta property=og:title content=bad> -->",
    "<!---> <meta property=og:title content=bad> -->",
    "<!-- bad --->",
    "<script></script><!doctype html>",
    "<!doctype html><!doctype html>",
    "<title>Title</title><!doctype html>",
    "<body><!doctype html></body>",
    "<!doctype html SYSTEM 'other'>",
    "<head></head><head></head>",
    "<body></body><head></head>",
    "<html><html></html></html>",
    "<body><head></head></body>",
    "<head></head><html></html>",
    "<body></body><meta name=description>",
    "<head></head><meta name=description>",
    "<title>Fragment</title><html></html>",
    "<html></html><body></body>",
    "<html></html><meta property=og:title content=outside>",
    "<head></head></head>",
    "<body><div></body></div>",
    "<head>unexpected text</head>",
    "trailing text",
    "<title>T</title>tail",
    "<title>\u0000</title>",
    "<title>\ud800</title>",
    '<meta name="description" property="og:title" content="Ambiguous">',
    "<script><!-- escaped --></script>",
    "<script><script >double escaped</script>",
    "</title invalid>",
    "<title>bad</title invalid><title>real</title>",
    "<script></script invalid>bad</script>",
    "<head></head><div></div>",
  ])("fails closed for malformed or unsupported markup %s", (html) => rejects(html));

  it.each([
    "base",
    "svg",
    "math",
    "template",
    "noscript",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "plaintext",
    "listing",
  ])("rejects unsupported context %s", (tag) => rejects(`<${tag}>`));

  it("accepts exact byte and tag limits, rejects rather than truncating", () => {
    const wrap = "<title></title>";
    expect(
      createLinkPreview(`<title>${"x".repeat(MAX_PREVIEW_HTML_BYTES - wrap.length)}</title>`, PAGE)
        .title.length,
    ).toBe(MAX_PREVIEW_HTML_BYTES - wrap.length);
    rejects("x".repeat(MAX_PREVIEW_HTML_BYTES + 1), "input-too-large");
    rejects(`<title>${"😀".repeat(MAX_PREVIEW_HTML_BYTES / 4)}</title>`, "input-too-large");
    expect(createLinkPreview("<meta>".repeat(MAX_PREVIEW_TAGS), PAGE).title).toBe("example.org");
    rejects(`${"<meta>".repeat(MAX_PREVIEW_TAGS)}<!--extra-->`, "too-many-tags");
    rejects(`${"<meta>".repeat(MAX_PREVIEW_TAGS - 1)}<title>end</title>`, "too-many-tags");
    expect(createLinkPreview("<!--ok-->".repeat(MAX_PREVIEW_TAGS), PAGE).title).toBe("example.org");
  });
});
