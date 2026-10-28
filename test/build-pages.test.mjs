// AUTHORED-BY Codex GPT-6

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assemblePages, pagesApps } from "../scripts/build-pages.mjs";

const dirs = [];
afterEach(() => {
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
      `<!doctype html><html><body>${app.slug}<script type="module" src="/solid-sdk/${app.slug}/assets/app.js"></script></body></html>`,
    );
    writeFileSync(join(output, "assets/app.js"), `console.log(${JSON.stringify(app.slug)});`);
  }
  assemblePages(root, apps);
  return { root, apps, destination: join(root, ".pages") };
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
    const { root, apps, destination } = fixture();
    expect(existsSync(join(destination, ".nojekyll"))).toBe(true);
    const index = readFileSync(join(destination, "index.html"), "utf8");
    for (const app of apps) {
      const html = readFileSync(join(root, app.rootDirectory, "dist/index.html"), "utf8");
      expect(readFileSync(join(destination, app.slug, "index.html"), "utf8")).toBe(html);
      expect(readFileSync(join(destination, app.slug, "404.html"), "utf8")).toBe(html);
      expect(existsSync(join(destination, app.slug, "assets/app.js"))).toBe(true);
      expect(index).toContain(`href="/solid-sdk/${app.slug}/"`);
    }
  });

  it.each([
    "pod-drive",
    "access-manager",
    "missing",
    "toString",
  ])("serves the correct shell on a nested %s route without changing OAuth query/hash", (slug) => {
    const { destination } = fixture();
    const fallback = readFileSync(join(destination, "404.html"), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(fallback)[1];
    const href = `https://jeswr.github.io/solid-sdk/${slug}/deep/link?code=code&state=state#autologin/webid`;
    const location = new URL(href);
    const document = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    runInNewContext(script, { location, document });
    expect(location.href).toBe(href);
    if (["pod-drive", "access-manager"].includes(slug)) {
      expect(document.write).toHaveBeenCalledExactlyOnceWith(
        readFileSync(join(destination, slug, "index.html"), "utf8"),
      );
    } else {
      expect(document.write).not.toHaveBeenCalled();
    }
  });
});
