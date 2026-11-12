// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex (GPT-6.1 Sol)
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { PageData, SiteData } from "./model.js";
import { assertSlug } from "./slugs.js";

export type RenderSite = SiteData & { publicUrl: string };
export const CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'";

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] as string,
  );
}
export function escapeXml(value: string): string {
  return escapeHtml(
    [...value]
      .filter((c) => {
        const n = c.codePointAt(0) as number;
        return (
          n === 9 ||
          n === 10 ||
          n === 13 ||
          (n >= 32 && n <= 0xd7ff) ||
          (n >= 0xe000 && n <= 0xfffd) ||
          (n >= 0x10000 && n <= 0x10ffff)
        );
      })
      .join(""),
  );
}
/** Refuse protocol-relative references, backslashes, credentials and hidden schemes. */
export function safeContentUrl(value: string, image = false): string | undefined {
  if (!value || /[\s\p{Cc}\\]/u.test(value) || value.startsWith("//")) return undefined;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (!scheme) return value;
  if (scheme === "mailto" && !image) return value;
  if (image && scheme === "http") return undefined;
  if (scheme !== "http" && scheme !== "https") return undefined;
  try {
    const url = new URL(value);
    return !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function baseUrl(site: RenderSite): string {
  const safe = safeContentUrl(site.publicUrl);
  if (!safe || !/^https?:\/\//.test(safe))
    throw new TypeError("A public HTTP(S) site URL is required.");
  const base = new URL(safe);
  if (base.search || base.hash || !base.pathname.endsWith("/"))
    throw new TypeError("The public site URL must be a container.");
  return base.href;
}
export function pageUrl(site: RenderSite, page: Pick<PageData, "slug">): string {
  assertSlug(page.slug);
  return new URL(`${page.slug}/index.html`, baseUrl(site)).href;
}
export function renderMarkdown(markdown: string, publicUrl: string): string {
  return sanitizeHtml(marked.parse(markdown, { async: false, gfm: true }), {
    allowedTags: [
      "p",
      "br",
      "hr",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "s",
      "del",
      "pre",
      "code",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "caption",
    ],
    allowedAttributes: {
      a: ["href", "title", "rel"],
      img: ["src", "alt", "title", "loading"],
      th: ["scope"],
      ol: ["start"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    transformTags: {
      h1: "h2",
      a: (_tag, attributes) => {
        const href = safeContentUrl(attributes.href ?? "");
        const external = href && new URL(href, publicUrl).origin !== new URL(publicUrl).origin;
        return {
          tagName: "a",
          attribs: {
            ...(href ? { href } : {}),
            ...(attributes.title ? { title: attributes.title } : {}),
            ...(external ? { rel: "noopener noreferrer" } : {}),
          },
        };
      },
      img: (_tag, attributes) => {
        const candidate = safeContentUrl(attributes.src ?? "", true);
        const src =
          candidate && new URL(candidate, publicUrl).protocol === "https:" ? candidate : undefined;
        return {
          tagName: "img",
          attribs: { ...(src ? { src } : {}), alt: attributes.alt ?? "", loading: "lazy" },
        };
      },
    },
  });
}
const STYLE = `:root{color-scheme:light dark;--paper:#fffdf8;--ink:#252a29;--link:#205c59;--line:#b9c6c3}*{box-sizing:border-box}body{margin:0;overflow-wrap:anywhere;background:var(--paper);color:var(--ink);font:1.1rem/1.75 system-ui,sans-serif}header,main,footer{max-width:48rem;margin:auto;padding:1.5rem}header{border-bottom:1px solid var(--line)}a{color:var(--link);text-underline-offset:.2em}a:focus-visible{outline:3px solid var(--link);outline-offset:4px}.skip{position:absolute;top:-8rem;left:1rem;padding:1rem;background:var(--paper)}.skip:focus{top:0}nav ul{display:flex;gap:1.2rem;flex-wrap:wrap;padding:0;list-style:none}h1,h2,h3{line-height:1.25;overflow-wrap:anywhere}h1{font-size:clamp(2rem,6vw,3rem)}img{max-width:100%;height:auto}pre{overflow:auto;padding:1rem;border:1px solid var(--line)}blockquote{margin-left:0;padding-left:1rem;border-left:3px solid var(--line)}table{display:block;overflow:auto;border-collapse:collapse}td,th{padding:.5rem;border:1px solid var(--line)}article+article{margin-top:3rem;padding-top:2rem;border-top:1px solid var(--line)}footer{border-top:1px solid var(--line)}.journal{font-family:Georgia,serif}.garden{--paper:#f4faf3;--ink:#233529;--link:#285c36}@media(prefers-color-scheme:dark){:root,.garden{--paper:#192321;--ink:#e7efec;--link:#a1d5c7;--line:#68867c}}`;
function publishedPages(pages: readonly PageData[]): PageData[] {
  return pages
    .filter((p) => p.status === "published")
    .slice()
    .sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug));
}
function document(
  site: RenderSite,
  title: string,
  description: string,
  url: string,
  content: string,
  pages: readonly PageData[],
  image?: string,
): string {
  const e = escapeHtml;
  const base = baseUrl(site);
  const navigation = publishedPages(pages)
    .filter((p) => p.kind === "page")
    .map((p) => `<li><a href="${e(pageUrl(site, p))}">${e(p.title)}</a></li>`)
    .join("");
  const candidateImage = image && safeContentUrl(image, true);
  const safeImage =
    candidateImage && new URL(candidateImage, url).protocol === "https:"
      ? candidateImage
      : undefined;
  return `<!doctype html><html lang="${e(site.inLanguage)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${e(CSP)}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)} · ${e(site.name)}</title><meta name="description" content="${e(description)}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${e(url)}"><meta property="og:site_name" content="${e(site.name)}">${safeImage ? `<meta property="og:image" content="${e(new URL(safeImage, url).href)}">` : ""}<link rel="canonical" href="${e(url)}"><link rel="alternate" type="application/rss+xml" title="${e(site.name)}" href="${e(new URL("feed.xml", base).href)}"><style>${STYLE}</style></head><body class="${site.theme === "journal" ? "journal" : site.theme === "garden" ? "garden" : "paper"}"><a class="skip" href="#content">Skip to content</a><header><a href="${e(new URL("index.html", base).href)}">${e(site.name)}</a><p>${e(site.description)}</p><nav aria-label="Site navigation"><ul><li><a href="${e(new URL("index.html", base).href)}">Home</a></li>${navigation}</ul></nav></header><main id="content" tabindex="-1">${content}</main><footer><p>Written by ${e(site.author)}</p><a href="${e(new URL("feed.xml", base).href)}">RSS feed</a></footer></body></html>`;
}
export function renderPage(
  site: RenderSite,
  page: PageData,
  pages: readonly PageData[] = [],
): string {
  const url = pageUrl(site, page);
  const date = page.published
    ? `<p><time datetime="${escapeHtml(page.published.toISOString())}">${escapeHtml(page.published.toISOString().slice(0, 10))}</time></p>`
    : "";
  const content = `<article><h1>${escapeHtml(page.title)}</h1>${page.kind === "post" ? date : ""}${renderMarkdown(page.body, url)}</article>`;
  return document(
    site,
    page.title,
    page.summary || site.description,
    url,
    content,
    pages,
    page.image,
  );
}
export function renderIndex(
  site: RenderSite,
  posts: readonly PageData[],
  navigation: readonly PageData[] = [],
): string {
  const content = publishedPages(posts)
    .filter((p) => p.kind === "post")
    .sort((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0))
    .map(
      (p) =>
        `<article><h2><a href="${escapeHtml(pageUrl(site, p))}">${escapeHtml(p.title)}</a></h2><p>${escapeHtml(p.summary)}</p>${p.published ? `<time datetime="${escapeHtml(p.published.toISOString())}">${escapeHtml(p.published.toISOString().slice(0, 10))}</time>` : ""}</article>`,
    )
    .join("");
  return document(
    site,
    site.name,
    site.description,
    new URL("index.html", baseUrl(site)).href,
    `<h1>${escapeHtml(site.name)}</h1>${content || "<p>There are no posts to read yet.</p>"}`,
    navigation,
  );
}
export function renderFeed(site: RenderSite, posts: readonly PageData[]): string {
  const x = escapeXml;
  const items = publishedPages(posts)
    .filter((p) => p.kind === "post")
    .sort((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0))
    .map(
      (p) =>
        `<item><title>${x(p.title)}</title><link>${x(pageUrl(site, p))}</link><guid isPermaLink="true">${x(pageUrl(site, p))}</guid><description>${x(p.summary)}</description>${p.published ? `<pubDate>${x(p.published.toUTCString())}</pubDate>` : ""}${(p.keywords ?? []).map((keyword) => `<category>${x(keyword)}</category>`).join("")}</item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${x(site.name)}</title><link>${x(new URL("index.html", baseUrl(site)).href)}</link><description>${x(site.description)}</description><language>${x(site.inLanguage)}</language>${items}</channel></rss>`;
}
