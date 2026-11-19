#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const pagesBase = "/solid-sdk/";
const routeParameter = "__solid_sdk_path";

function withRouteRestore(html, base) {
  // This classic script must run before any app/router script in the built head.
  const restore = `<script>
    (() => {
      const base = ${JSON.stringify(base)};
      const route = new URLSearchParams(location.search).get(${JSON.stringify(routeParameter)});
      if (route === null || !route.startsWith(base.slice(0, -1))) return;
      const url = new URL(route, location.origin);
      if (url.origin === location.origin &&
          (url.pathname.startsWith(base) || url.pathname === base.slice(0, -1))) {
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    })();
  </script>`;
  return html.replace(/<head\b[^>]*>/i, (head) => `${head}\n  ${restore}`);
}

function vercelApps(root) {
  return JSON.parse(readFileSync(join(root, "scripts/vercel-apps.json"), "utf8"));
}

const slugOf = (app) => app.project.replace(/^solid-(?:sdk-)?/, "");

export function pagesApps(root) {
  return vercelApps(root)
    .filter((app) => app.framework === "vite")
    .map((app) => ({ ...app, slug: slugOf(app) }));
}

// Next.js apps with a static export (`out/`), served from real per-route HTML files rather
// than an SPA fallback. Each reads its base path from NEXT_PUBLIC_BASE_PATH and its origin
// from the `originEnv` in vercel-apps.json; `env` adds what its static build needs.
const NEXT_STATIC_APPS = [
  { project: "solid-pod-manager", env: {} },
  { project: "solid-sdk-issues", env: { APP_STATIC_EXPORT: "1" } },
];

export function pagesNextApps(root) {
  const all = vercelApps(root);
  return NEXT_STATIC_APPS.map(({ project, env }) => {
    const app = all.find((candidate) => candidate.project === project);
    if (app?.framework !== "next") throw new Error(`Unknown Next.js Pages app: ${project}`);
    return { ...app, slug: slugOf(app), staticEnv: env };
  });
}

/** Assemble one Pages artifact, including the site-wide SPA fallback Pages uses. */
export function assemblePages(root, apps, nextApps = []) {
  const destination = join(root, ".pages");
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const app of apps) {
    const output = join(destination, app.slug);
    cpSync(join(root, app.rootDirectory, "dist"), output, { recursive: true });
    const html = withRouteRestore(
      readFileSync(join(output, "index.html"), "utf8"),
      `${pagesBase}${app.slug}/`,
    );
    writeFileSync(join(output, "index.html"), html);
    writeFileSync(join(output, "404.html"), html);
  }
  for (const app of nextApps) {
    cpSync(join(root, app.rootDirectory, "out"), join(destination, app.slug), { recursive: true });
  }
  const listed = [...apps, ...nextApps];
  const index = `<!doctype html>
<!-- AUTHORED-BY Codex GPT-6 -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Solid Suite apps</title>
  </head>
  <body>
    <main>
      <h1>Solid Suite apps</h1>
      <ul>
${listed.map((app) => `        <li><a href="${pagesBase}${app.slug}/">${app.slug}</a></li>`).join("\n")}
      </ul>
    </main>
  </body>
</html>
`;
  writeFileSync(join(destination, "index.html"), index);
  // GitHub Pages serves the publishing root's 404.html for every missing path,
  // including nested apps. Redirect to the app's real entry point, carrying the
  // complete route (including OAuth query/hash) for restoration before it starts.
  const fallback = `<script>
    const slugs = ${JSON.stringify(apps.map((app) => app.slug))};
    const base = ${JSON.stringify(pagesBase)};
    const slug = location.pathname.startsWith(base)
      ? location.pathname.slice(base.length).split("/")[0] : "";
    if (slugs.includes(slug)) {
      const route = location.pathname + location.search + location.hash;
      location.replace(base + slug + "/?${routeParameter}=" + encodeURIComponent(route));
    }
  </script>`;
  writeFileSync(join(destination, "404.html"), index.replace("</head>", `${fallback}\n  </head>`));
  writeFileSync(join(destination, ".nojekyll"), "");
}

function run(root, args, env = process.env) {
  const result = spawnSync("pnpm", args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed (${result.status})`);
}

export function buildPages(root, slugs = []) {
  const available = pagesApps(root);
  const availableNext = pagesNextApps(root);
  for (const slug of slugs) {
    if (![...available, ...availableNext].some((app) => app.slug === slug))
      throw new Error(`Unknown Pages app: ${slug}`);
  }
  const apps = slugs.length ? available.filter((app) => slugs.includes(app.slug)) : available;
  const nextApps = slugs.length
    ? availableNext.filter((app) => slugs.includes(app.slug))
    : availableNext;
  // Build workspace dependencies first. App builds below bypass Turbo so their
  // explicit --base and CLIENT_BASE_PATH can never reuse a domain-root build.
  run(root, [
    "exec",
    "turbo",
    "run",
    "build",
    "--concurrency=4",
    ...[...apps, ...nextApps].map((app) => `--filter=${app.package}^...`),
  ]);
  for (const app of apps) {
    const base = `${pagesBase}${app.slug}/`;
    run(root, ["--dir", app.rootDirectory, "run", "build", "--base", base], {
      ...process.env,
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: This CLI runs outside Turbo; app build configs declare APP_ORIGIN.
      APP_ORIGIN: process.env.APP_ORIGIN || "https://jeswr.github.io",
      CLIENT_BASE_PATH: base,
    });
  }
  for (const app of nextApps) {
    run(root, ["--dir", app.rootDirectory, "run", "build"], {
      ...process.env,
      ...app.staticEnv,
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: This CLI runs outside Turbo; each app's build reads its own origin variable.
      [app.originEnv]: process.env.APP_ORIGIN || "https://jeswr.github.io",
      NEXT_PUBLIC_BASE_PATH: `${pagesBase}${app.slug}`,
    });
  }
  assemblePages(root, apps, nextApps);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildPages(resolve(fileURLToPath(new URL("..", import.meta.url))), process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
