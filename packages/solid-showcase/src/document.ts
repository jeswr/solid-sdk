// AUTHORED-BY Claude Fable 5
/**
 * Read-side helpers over a validated walkthrough document: registry lookups, the
 * document-derived disclaimer pack, and the shell theme resolution the page renderers
 * share.
 */
import {
  createDisclaimerPack,
  type DisclaimerPack,
  type OrgTheme,
  themeFromSpec,
} from "@jeswr/solid-showcase-kit";
import type {
  EcosystemRole,
  RegisteredApp,
  ServiceRegistry,
  WalkthroughChapter,
  WalkthroughDocument,
} from "./schema.js";

/** Look up a chapter by slug; `undefined` for unknown slugs (route to a 404). */
export function chapterBySlug(
  doc: WalkthroughDocument,
  slug: string,
): WalkthroughChapter | undefined {
  return doc.chapters.find((chapter) => chapter.slug === slug);
}

/** A registered app by slug; throws for slugs a validated document cannot contain. */
export function registeredApp(registry: ServiceRegistry, slug: string): RegisteredApp {
  const app = registry.apps[slug];
  if (app === undefined) {
    throw new Error(
      `No app "${slug}" in registry.apps — validate the document with parseWalkthrough first.`,
    );
  }
  return app;
}

/** The launcher dock apps, in `launcherOrder`. */
export function launcherApps(registry: ServiceRegistry): RegisteredApp[] {
  return registry.launcherOrder.map((slug) => registeredApp(registry, slug));
}

/** The centre role (the data-subject's own vault/pod seat). */
export function centerRole(registry: ServiceRegistry): EcosystemRole {
  const role = registry.roles.find((entry) => entry.center === true);
  if (role === undefined) {
    throw new Error(
      "No centre role in registry.roles — validate the document with parseWalkthrough first.",
    );
  }
  return role;
}

/** The non-centre roles, in document order. */
export function surroundingRoles(registry: ServiceRegistry): EcosystemRole[] {
  return registry.roles.filter((entry) => entry.center !== true);
}

/**
 * The shell's own registry entry: the app served at "/" with no zone rewrite —
 * the walkthrough site itself. `undefined` when the document does not register it.
 */
export function shellApp(registry: ServiceRegistry): RegisteredApp | undefined {
  return Object.values(registry.apps).find((app) => app.zoneEnv === undefined && app.path === "/");
}

/**
 * The disclaimer pack for a document. When `branding.consentCookiePrefix` is absent it
 * defaults to `${deploy.slug}-demo-consent-` so every app in the walkthrough shares one
 * cookie namespace.
 */
export function documentDisclaimerPack(doc: WalkthroughDocument): DisclaimerPack {
  return createDisclaimerPack({
    ...doc.branding,
    consentCookiePrefix: doc.branding.consentCookiePrefix ?? `${doc.deploy.slug}-demo-consent-`,
  });
}

/** Neutral fallback palette for a shell entry that declares no theme of its own. */
const SHELL_FALLBACK_THEME = {
  accent: "oklch(0.72 0.1 250)",
  hue: 250,
  primary: "oklch(0.45 0.06 250)",
  role: "guided walkthrough",
} as const;

/**
 * The org theme the shell frame renders with: the shell registry entry's theme when
 * declared, else a neutral fallback. `modelledOn` is the convening organisation.
 */
export function shellTheme(doc: WalkthroughDocument): OrgTheme {
  const shell = shellApp(doc.registry);
  const spec = shell?.theme ?? { ...SHELL_FALLBACK_THEME };
  return themeFromSpec(spec, shell?.modelledOn ?? doc.site.organization);
}
