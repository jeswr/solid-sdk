// AUTHORED-BY Codex
import { normaliseDestination } from "../lib/editor/destination";
import { protectiveLinkRel } from "./link-rel";

/** Block images carry their own link; block containers continue to reject marks. */
export function normaliseImageLink(value: unknown): Record<string, string | null> | null {
  if (!value || typeof value !== "object") return null;
  const attrs = value as Record<string, unknown>;
  const href = typeof attrs.href === "string" ? normaliseDestination(attrs.href) : null;
  if (!href) return null;
  const defaults = { title: null, target: "_blank", class: null };
  return {
    href,
    rel: protectiveLinkRel(attrs.rel),
    ...Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => [
        key,
        attrs[key] === undefined ? fallback : typeof attrs[key] === "string" ? attrs[key] : null,
      ]),
    ),
  };
}

export function imageLinkFromHtml(element: HTMLElement) {
  const anchor = element.closest("a[href]");
  return anchor
    ? normaliseImageLink(
        Object.fromEntries(
          ["href", "title", "target", "rel", "class"].map((key) => [key, anchor.getAttribute(key)]),
        ),
      )
    : null;
}
