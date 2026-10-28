// AUTHORED-BY Codex GPT-6

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { assemblePages, pagesApps } from "../scripts/build-pages.mjs";

// Reuse the existing app DOM dependency for generated HTML behavior tests.
const appRequire = createRequire(new URL("../apps/access-manager/package.json", import.meta.url));
const { JSDOM, VirtualConsole } = appRequire("jsdom");
const dirs = [];
const windows = [];
afterEach(() => {
  for (const window of windows.splice(0)) window.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pages-"));
  dirs.push(root);
  const apps = [
    { slug: "pod-drive", rootDirectory: "apps/pod-drive/web" },
    { slug: "access-manager", rootDirectory: "apps/access-manager" },
  ];
  for (const app of apps) {
    const output = join(root, app.rootDirectory, "dist");
    mkdirSync(join(output, "assets"), { recursive: true });
    writeFileSync(
      join(output, "index.html"),
      `<!doctype html><html><head><title>${app.slug}</title>
      <script>window.routerStartUrl = location.href;</script></head>
      <body><main id="app">${app.slug}</main><script type="module" src="/solid-sdk/${app.slug}/assets/app.js"></script></body></html>`,
    );
    writeFileSync(join(output, "assets/app.js"), `console.log(${JSON.stringify(app.slug)});`);
  }
  assemblePages(root, apps);
  return { root, apps, destination: join(root, ".pages") };
}

function loadHtml(html, url) {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(html, { url, runScripts: "dangerously", virtualConsole });
  windows.push(dom.window);
  expect(errors).toEqual([]);
  return dom.window;
}

function redirect(fallback, href) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(fallback)?.[1];
  expect(script).toBeDefined();
  // jsdom does not implement navigation. Capture the 404's destination, then
  // parse that artifact as a fresh document with real DOM/history semantics.
  const url = new URL(href);
  let destination = null;
  runInNewContext(script, {
    location: {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      replace: (path) => {
        destination = new URL(path, url).href;
      },
    },
  });
  return destination;
}

describe("Pages artifact", () => {
  it("selects all ten Vite apps with the Vercel project prefixes removed", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    expect(
      pagesApps(root)
        .map((app) => app.slug)
        .sort(),
    ).toEqual([
      "access-manager",
      "app-store",
      "pod-chat",
      "pod-docs",
      "pod-drive",
      "pod-health",
      "pod-mail",
      "pod-money",
      "pod-music",
      "pod-photos",
    ]);
  });

  it("copies assets, writes a fallback per app and links every app at the root", () => {
    const { apps, destination } = fixture();
    expect(existsSync(join(destination, ".nojekyll"))).toBe(true);
    const index = readFileSync(join(destination, "index.html"), "utf8");
    for (const app of apps) {
      const html = readFileSync(join(destination, app.slug, "index.html"), "utf8");
      expect(readFileSync(join(destination, app.slug, "404.html"), "utf8")).toBe(html);
      const window = loadHtml(html, `https://jeswr.github.io/solid-sdk/${app.slug}/?normal=1#hash`);
      expect(window.document.title).toBe(app.slug);
      expect(window.routerStartUrl).toBe(window.location.href);
      expect(window.location.search).toBe("?normal=1");
      expect(window.location.hash).toBe("#hash");
      expect(existsSync(join(destination, app.slug, "assets/app.js"))).toBe(true);
      expect(index).toContain(`href="/solid-sdk/${app.slug}/"`);
    }
  });

  for (const slug of ["pod-drive", "access-manager"]) {
    it.each([
      "/deep/link?code=code&state=state#autologin/webid",
      "/deep/a%2Fb?state=a%2Bb%26c&state=again&empty=&url=https%3A%2F%2Fpod.example%2F#autologin/https%3A%2F%2Fpod.example%2F%23me",
      "/?code=return&state=state#fragment",
      "?code=return&state=state#fragment",
      "#autologin/webid",
      "",
    ])(`renders only the ${slug} app and restores %s before the router starts`, (route) => {
      const { destination } = fixture();
      const fallback = readFileSync(join(destination, "404.html"), "utf8");
      const href = `https://jeswr.github.io/solid-sdk/${slug}${route}`;
      const redirected = redirect(fallback, href);
      expect(new URL(redirected).pathname).toBe(`/solid-sdk/${slug}/`);
      const window = loadHtml(
        readFileSync(join(destination, slug, "index.html"), "utf8"),
        redirected,
      );
      expect(window.location.href).toBe(href);
      expect(window.routerStartUrl).toBe(href);
      expect(window.document.title).toBe(slug);
      expect(window.document.querySelectorAll("main")).toHaveLength(1);
      expect(window.document.querySelector("#app").textContent).toBe(slug);
      expect(window.document.body.textContent).not.toContain("Solid Suite apps");
      expect(window.document.querySelector('script[type="module"]').getAttribute("src")).toBe(
        `/solid-sdk/${slug}/assets/app.js`,
      );
    });
  }

  it.each([
    "/solid-sdk/missing/deep/link",
    "/solid-sdk/toString/deep/link",
    "/solid-sdk/pod-drive-other/deep/link",
    "/elsewhere/pod-drive/deep/link",
  ])("keeps the site index for unknown route %s", (path) => {
    const { destination } = fixture();
    const fallback = readFileSync(join(destination, "404.html"), "utf8");
    const href = `https://jeswr.github.io${path}?query=1#fragment`;
    expect(redirect(fallback, href)).toBeNull();
    const window = loadHtml(fallback, href);
    expect(window.document.title).toBe("Solid Suite apps");
    expect(window.document.querySelector("h1").textContent).toBe("Solid Suite apps");
    expect(window.location.href).toBe(href);
  });

  it.each([
    "https://outside.example/solid-sdk/pod-drive/",
    "//outside.example/solid-sdk/pod-drive/",
    "/solid-sdk/access-manager/",
    "/solid-sdk/pod-drive-other/",
    "/solid-sdk/pod-drive/../../access-manager/",
    "http://[invalid",
  ])("ignores a forged restore destination %s", (route) => {
    const { destination } = fixture();
    const href = `https://jeswr.github.io/solid-sdk/pod-drive/?__solid_sdk_path=${encodeURIComponent(route)}`;
    const window = loadHtml(readFileSync(join(destination, "pod-drive/index.html"), "utf8"), href);
    expect(window.location.href).toBe(href);
    expect(window.routerStartUrl).toBe(href);
    expect(window.document.title).toBe("pod-drive");
  });
});
