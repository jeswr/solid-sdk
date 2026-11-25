// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@jeswr/fetch-rdf";
import { entities, type PageData, type SiteData } from "./generated/model.js";
import { assertSlug } from "./slugs.js";

export type { PageData, SiteData };
export const SITE_CLASS = "https://schema.org/WebSite";
export const PAGE_CLASS = "https://schema.org/WebPage";
export const THEMES = ["paper", "journal", "garden"] as const;

/** Generated MUSTs are enforced on writes as well as reads. */
export function validateSite(data: SiteData): SiteData {
  const valid = entities.Site.parse(
    "https://validation.invalid/site",
    entities.Site.build("https://validation.invalid/site", data),
  );
  if (!valid || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(valid.inLanguage))
    throw new TypeError("Please enter a site name, author, language and a shipped theme.");
  return valid;
}
export function validatePage(data: PageData): PageData {
  assertSlug(data.slug);
  const valid = entities.Page.parse(
    "https://validation.invalid/page",
    entities.Page.build("https://validation.invalid/page", data),
  );
  if (!valid || (valid.status === "published" && !valid.published))
    throw new TypeError("A page needs a title, content fields and valid publication details.");
  return valid;
}
export function serializeSite(url: string, data: SiteData): Promise<string> {
  return entities.Site.serialize(url, validateSite(data));
}
export function serializePage(url: string, data: PageData): Promise<string> {
  return entities.Page.serialize(url, validatePage(data));
}
export function parseSite(url: string, dataset: DatasetCore): SiteData | undefined {
  const data = entities.Site.parse(url, dataset);
  if (!data) return undefined;
  try {
    return validateSite(data);
  } catch {
    return undefined;
  }
}
export function parsePage(url: string, dataset: DatasetCore): PageData | undefined {
  const data = entities.Page.parse(url, dataset);
  if (!data) return undefined;
  try {
    return validatePage(data);
  } catch {
    return undefined;
  }
}
