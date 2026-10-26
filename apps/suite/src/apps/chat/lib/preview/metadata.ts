// AUTHORED-BY Codex GPT-6.1-Sol
import { PreviewError } from "./errors";
import { decodeValue, readMetadataTags } from "./html";

export interface PreviewFields {
  title: string | null;
  description: string | null;
  image: string | null;
}

export interface PreviewMetadata {
  pageUrl: string;
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  iconUrl: string | null;
  openGraph: PreviewFields & { siteName: string | null; url: string | null };
  twitter: PreviewFields & { site: string | null; card: string | null };
}

export interface PreviewCard extends PreviewFields {
  title: string;
  siteName: string;
  url: string;
  iconUrl: string | null;
}

function resolveUrl(value: string, base?: string): string {
  // URL() repairs backslashes, controls and incomplete absolute URLs; reject them explicitly.
  if (
    !value.isWellFormed() ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: URL parsing otherwise silently strips controls.
    /[\u0000-\u0020\u007f\\]/.test(value) ||
    (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\/[^/]/i.test(value))
  )
    throw new PreviewError("invalid-url");
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new PreviewError("invalid-url");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new PreviewError("invalid-url");
  }
  return url.href;
}

function text(value: string): string {
  return decodeValue(value).replace(/\s+/g, " ").trim();
}

/** Extract metadata without network or DOM access. See README for the accepted HTML subset. */
export function extractPreviewMetadata(html: string, pageUrl: string): PreviewMetadata {
  if (typeof pageUrl !== "string" || !pageUrl) throw new PreviewError("invalid-url");
  const page = resolveUrl(pageUrl);
  const values = new Map<string, string>();
  const store = (key: string, raw: string, url = false) => {
    const value = url ? decodeValue(raw).trim() : text(raw);
    if (!value) return;
    const normalized = url ? resolveUrl(value, page) : value;
    if (!values.has(key)) values.set(key, normalized);
  };
  for (const tag of readMetadataTags(html)) {
    const attr = (name: string) => tag.attributes.get(name) ?? "";
    if (tag.name === "title") {
      store("title", tag.text);
    } else if (tag.name === "meta") {
      const property = text(attr("property")).toLowerCase();
      const name = text(attr("name")).toLowerCase();
      if (property && name && property !== name) throw new PreviewError("invalid-html");
      const key = property || name;
      const content = attr("content");
      if (
        [
          "og:title",
          "og:description",
          "og:site_name",
          "twitter:title",
          "twitter:description",
          "twitter:site",
          "twitter:card",
          "description",
        ].includes(key)
      ) {
        store(key, content);
      } else if (
        ["og:image", "og:image:url", "og:url", "twitter:image", "twitter:image:src"].includes(key)
      ) {
        store(key.replace(/:(url|src)$/, key === "og:url" ? ":url" : ""), content, true);
      }
    } else {
      const relations = text(attr("rel")).toLowerCase().split(" ");
      if (relations.includes("canonical")) store("canonical", attr("href"), true);
      if (relations.includes("icon") || relations.includes("apple-touch-icon"))
        store("icon", attr("href"), true);
    }
  }
  const get = (key: string) => values.get(key) ?? null;
  return {
    pageUrl: page,
    title: get("title"),
    description: get("description"),
    canonicalUrl: get("canonical"),
    iconUrl: get("icon"),
    openGraph: {
      title: get("og:title"),
      description: get("og:description"),
      image: get("og:image"),
      siteName: get("og:site_name"),
      url: get("og:url"),
    },
    twitter: {
      title: get("twitter:title"),
      description: get("twitter:description"),
      image: get("twitter:image"),
      site: get("twitter:site"),
      card: get("twitter:card"),
    },
  };
}

/** Select each field independently: OpenGraph, Twitter, HTML, then documented defaults. */
export function createLinkPreview(html: string, pageUrl: string): PreviewCard {
  const metadata = extractPreviewMetadata(html, pageUrl);
  const { openGraph, twitter } = metadata;
  const hostname = new URL(metadata.pageUrl).hostname;
  return {
    title: openGraph.title ?? twitter.title ?? metadata.title ?? hostname,
    description: openGraph.description ?? twitter.description ?? metadata.description,
    image: openGraph.image ?? twitter.image,
    siteName: openGraph.siteName ?? twitter.site ?? hostname,
    url: metadata.canonicalUrl ?? openGraph.url ?? metadata.pageUrl,
    iconUrl: metadata.iconUrl,
  };
}
