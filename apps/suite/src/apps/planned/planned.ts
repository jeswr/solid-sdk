// AUTHORED-BY Claude Opus 5.5
import type { AppSlug } from "@jeswr/suite-ui";

/**
 * Registered apps whose route is still the PlannedApp placeholder. An app's first-cut PR deletes its
 * line here when it replaces the placeholder, so directories can say "Coming soon" instead of "Early".
 */
export const plannedApps: ReadonlySet<AppSlug> = new Set<AppSlug>([
  "bookmarks",

  "insights",

  "recipes",

  "media",

  "journal",

  "events",

  "whiteboard",

  "wallet",

  "places",

  "slides",

  "publish",

  "trips",

  "ask",
]);
