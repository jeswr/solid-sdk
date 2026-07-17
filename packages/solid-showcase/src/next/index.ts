// AUTHORED-BY Claude Fable 5
/**
 * `@jeswr/solid-showcase/next` — everything that consumes the walkthrough document for
 * DEPLOY wiring: multi-zone rewrites, the per-project env-var matrix, per-app
 * `vercel.json`, the zone health route, and shell metadata. Document-shaped types live in
 * this package, so these helpers do too (the kit stays document-agnostic).
 */
import type { DemoMetadata } from "@jeswr/solid-showcase-kit";
import { documentDisclaimerPack, shellApp } from "../document.js";
import type { RegisteredApp, WalkthroughDocument } from "../schema.js";

/** One Next.js rewrite rule (structurally `next`'s Rewrite — no dependency on next). */
export interface ZoneRewrite {
  source: string;
  destination: string;
}

export interface ZoneRewritesOptions {
  /**
   * Suffix of the guaranteed-unresolvable fallback host used when a zone's env var is
   * unset (`https://{slug}{fallbackSuffix}`). Default ".invalid" — the reserved TLD —
   * so a missing env var can never route traffic anywhere real.
   */
  fallbackSuffix?: string | undefined;
  /** Env source, injectable for tests. Default `process.env`. */
  env?: Record<string, string | undefined> | undefined;
}

/**
 * The shell's multi-zone rewrite table, derived from every registry app that declares a
 * `zoneEnv`. Each zone gets two rules: the bare prefix and `prefix/:path+`, both pointing
 * at the zone URL read from the env var (trailing slashes stripped). Async so it drops
 * straight into `next.config.ts`:
 *
 * ```ts
 * const nextConfig: NextConfig = { rewrites: () => zoneRewrites(walkthrough) };
 * ```
 */
export async function zoneRewrites(
  doc: WalkthroughDocument,
  options?: ZoneRewritesOptions,
): Promise<ZoneRewrite[]> {
  const suffix = options?.fallbackSuffix ?? ".invalid";
  const env = options?.env ?? process.env;
  return Object.values(doc.registry.apps)
    .filter((app) => app.zoneEnv !== undefined)
    .flatMap((app) => {
      const fallback = `https://${app.slug}${suffix}`;
      const zoneUrl = (env[app.zoneEnv as string] ?? fallback).replace(/\/+$/, "");
      return [
        { destination: `${zoneUrl}${app.path}`, source: app.path },
        { destination: `${zoneUrl}${app.path}/:path+`, source: `${app.path}/:path+` },
      ];
    });
}

/** One env var a deploy of this walkthrough needs, and which app projects need it. */
export interface EnvVarSpec {
  name: string;
  /** Registry slugs of the app projects the var must be set on. */
  apps: string[];
  /** Fixed value where one is known (e.g. "1"); otherwise deploy-specific. */
  value?: string | undefined;
  purpose: string;
  /** Read at build time — changing it requires a redeploy of the consuming app. */
  buildTime: boolean;
}

/**
 * The full env-var matrix for a deploy of this document:
 *
 * - one zone-URL var per `zoneEnv` app, set on the SHELL project (rewrites read them at
 *   build time);
 * - `{envPrefix}_TRUST_FORWARDED_HEADERS=1` on every app that declares `podRoutes` —
 *   behind a proxy, authenticated pod routes must compute their bound request URL from
 *   the forwarded public host or every call fails closed.
 */
export function envMatrix(doc: WalkthroughDocument): EnvVarSpec[] {
  const shell = shellApp(doc.registry);
  const shellApps = shell === undefined ? [] : [shell.slug];
  const specs: EnvVarSpec[] = [];

  for (const app of Object.values(doc.registry.apps)) {
    if (app.zoneEnv === undefined) continue;
    specs.push({
      apps: shellApps,
      buildTime: true,
      name: app.zoneEnv,
      purpose: `Production URL of ${app.appName} ("${app.slug}"), no trailing slash — read at build time by the shell's zone rewrites.`,
      value: undefined,
    });
  }

  const podRouteApps = Object.values(doc.registry.apps)
    .filter((app) => (app.podRoutes?.length ?? 0) > 0)
    .map((app) => app.slug);
  if (podRouteApps.length > 0) {
    specs.push({
      apps: podRouteApps,
      buildTime: false,
      name: `${doc.deploy.envPrefix}_TRUST_FORWARDED_HEADERS`,
      purpose:
        "Trust proxy-forwarded host headers on authenticated pod routes; without it the proof-bound request URL is computed from the internal host and every authenticated call is rejected.",
      value: "1",
    });
  }

  return specs;
}

export interface AppVercelJsonOptions {
  /**
   * Workspace package name the turbo build filters on. Default
   * `@{deploy.slug}/app-{app.slug}`.
   */
  packageName?: string | undefined;
}

/**
 * The per-app `vercel.json` for a turbo monorepo deploy: framework pin, workspace-rooted
 * turbo build, and `turbo-ignore` so a push rebuilds only affected apps. Pair it with a
 * project-level `rootDirectory` of `apps/{slug}` and CLEARED project-level build
 * overrides (a project-level buildCommand silently wins over this file).
 */
export function appVercelJson(
  app: RegisteredApp,
  doc: WalkthroughDocument,
  options?: AppVercelJsonOptions,
): Record<string, unknown> {
  const packageName = options?.packageName ?? `@${doc.deploy.slug}/app-${app.slug}`;
  return {
    // biome-ignore lint/style/useNamingConvention: fixed vercel.json wire field
    $schema: "https://openapi.vercel.sh/vercel.json",
    buildCommand: `pnpm --dir ../.. exec turbo run build --filter=${packageName}`,
    framework: "nextjs",
    ignoreCommand: "npx turbo-ignore --fallback=HEAD^1",
  };
}

/**
 * A zone health probe for the live-status dock: same-origin via the shell's multi-zone
 * rewrites, honest `simulated: true` payload. Spread it from a route file:
 *
 * ```ts
 * // app/api/health/route.ts
 * export const { GET } = healthRoute("vault");
 * ```
 */
// biome-ignore lint/style/useNamingConvention: GET is the Next route-handler export name
export function healthRoute(service: string): { GET(): Response } {
  return {
    // biome-ignore lint/style/useNamingConvention: GET is the Next route-handler export name
    GET(): Response {
      return Response.json({ ok: true, service, simulated: true });
    },
  };
}

/**
 * Metadata for the shell's root layout (variant "own" — the walkthrough publishes under
 * the convener's own branding): concept-demo title suffix, non-affiliation description,
 * and noindex/nofollow. Structurally compatible with Next `Metadata`.
 */
export function showcaseMetadata(doc: WalkthroughDocument): DemoMetadata {
  return documentDisclaimerPack(doc).demoMetadata({
    appName: doc.site.appName,
    organization: doc.site.organization,
    variant: "own",
  });
}
