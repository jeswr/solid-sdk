#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const pagesBase = "/solid-sdk/";

export function pagesApps(root) {
  return JSON.parse(readFileSync(join(root, "scripts/vercel-apps.json"), "utf8"))
    .filter((app) => app.framework === "vite")
    .map((app) => ({ ...app, slug: app.project.replace(/^solid-(?:sdk-)?/, "") }));
}

/** Assemble one Pages artifact, including the site-wide SPA fallback Pages uses. */
export function assemblePages(root, apps) {
  const destination = join(root, ".pages");
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const pages = {};
  for (const app of apps) {
    const output = join(destination, app.slug);
    cpSync(join(root, app.rootDirectory, "dist"), output, { recursive: true });
    const html = readFileSync(join(output, "index.html"), "utf8");
    writeFileSync(join(output, "404.html"), html);
    pages[app.slug] = html;
  }
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
${apps.map((app) => `        <li><a href="${pagesBase}${app.slug}/">${app.slug}</a></li>`).join("\n")}
      </ul>
    </main>
  </body>
</html>
`;
  writeFileSync(join(destination, "index.html"), index);
  // GitHub Pages serves the publishing root's 404.html for every missing path,
  // including nested apps. Select the built shell without changing the requested
  // URL, query, or hash (which may contain an OAuth return or an autologin link).
  // Escape < so a shell's </script> cannot terminate this script literal.
  const fallback = `<script>
    const pages = ${JSON.stringify(pages).replaceAll("<", "\\u003c")};
    const base = ${JSON.stringify(pagesBase)};
    const slug = location.pathname.startsWith(base)
      ? location.pathname.slice(base.length).split("/")[0] : "";
    if (Object.hasOwn(pages, slug)) {
      document.open();
      document.write(pages[slug]);
      document.close();
    }
  </script>`;
  writeFileSync(join(destination, "404.html"), index.replace("</body>", `${fallback}\n  </body>`));
  writeFileSync(join(destination, ".nojekyll"), "");
}

function run(root, args, env = process.env) {
  const result = spawnSync("pnpm", args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed (${result.status})`);
}

export function buildPages(root, slugs = []) {
  const available = pagesApps(root);
  for (const slug of slugs) {
    if (!available.some((app) => app.slug === slug)) throw new Error(`Unknown Pages app: ${slug}`);
  }
  const apps = slugs.length ? available.filter((app) => slugs.includes(app.slug)) : available;
  // Build workspace dependencies first. App builds below bypass Turbo so their
  // explicit --base and CLIENT_BASE_PATH can never reuse a domain-root build.
  run(root, [
    "exec",
    "turbo",
    "run",
    "build",
    "--concurrency=4",
    ...apps.map((app) => `--filter=${app.package}^...`),
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
  assemblePages(root, apps);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildPages(resolve(fileURLToPath(new URL("..", import.meta.url))), process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
