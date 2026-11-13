// AUTHORED-BY Codex GPT-6.1-Sol
import { isDirectChild } from "@jeswr/suite-sdk/shared";

export { isDirectChild } from "@jeswr/suite-sdk/shared";

export const DOCS_SLUG = "docs/";
export const LEGACY_DOCS_SLUG = "pod-docs/";

/** Pod Docs' portable ASCII slug convention, bounded to 48 characters. */
export function toSlug(input: string | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** Derive the layout from an absolute .ttl resource URL, including legacy reads. */
export function docContainerUrls(slugOrResource: string, docsContainer?: string) {
  if (
    docsContainer !== undefined &&
    (!docsContainer.endsWith("/") || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugOrResource))
  ) {
    throw new TypeError("Expected a document slug");
  }
  const url = new URL(
    docsContainer === undefined ? slugOrResource : `${docsContainer}${slugOrResource}.ttl`,
  );
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(".ttl") ||
    /%2f|%5c/i.test(url.pathname)
  ) {
    throw new TypeError("Expected an absolute document .ttl URL");
  }
  const container = `${url.href.slice(0, -4)}/`;
  return {
    resource: url.href,
    container,
    updateLog: `${container}updates/`,
    assets: `${container}assets/`,
    comments: `${container}comments/`,
    versions: `${container}versions/`,
  };
}

/** Validate snapshot-selected logs before any authenticated discovery or replay. */
export function documentUpdateLocation(document: {
  url: string;
  data: { updateLog?: string | undefined };
}): string {
  const layout = docContainerUrls(document.url);
  const container = document.data.updateLog ?? layout.updateLog;
  if (!container.endsWith("/") || !isDirectChild(container.slice(0, -1), layout.container))
    throw new Error("Invalid update location");
  return container;
}
