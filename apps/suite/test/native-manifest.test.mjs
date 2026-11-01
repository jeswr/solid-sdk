// AUTHORED-BY Codex GPT-6
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createManifest, writeManifest } from "../scripts/route-manifest.mjs";
import { resolveRoute } from "../scripts/route-resolver.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "suite-routes-"));
  roots.push(root);
  const appDir = join(root, "src/app");
  const exportDir = join(root, "www");
  await mkdir(appDir, { recursive: true });
  await mkdir(exportDir);
  const put = async (name, body = "") => {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  };
  return { appDir, exportDir, sourceRoot: join(root, "src"), put };
}

it("writes static, grouped, dynamic and catch-all routes with all Flight transports and exact public assets", async () => {
  const f = await fixture();
  for (const [pattern, dir] of [
    ["", ""],
    ["(suite)/tasks/l/[label]", "tasks/l/__"],
    ["docs/[...path]", "docs/__"],
  ]) {
    await f.put(`src/app/${pattern}/page.tsx`, "export default function Page() {}");
    for (const name of ["index.html", "index.txt", "__next._full.txt", "__next._tree.txt"])
      await f.put(`www/${dir}/${name}`);
  }
  await f.put("www/_next/static/chunk.js");
  await f.put("www/icon.svg");
  await f.put("www/404.html");
  const manifest = await writeManifest({ ...f, adaptations: ["fixture routes excluded"] });
  expect(manifest.routes).toHaveLength(3);
  expect(manifest.assets).toEqual(["404.html", "_next/static/chunk.js", "icon.svg"]);
  expect(JSON.parse(await readFile(join(f.exportDir, "route-manifest.json"), "utf8"))).toEqual(
    manifest,
  );
  expect(resolveRoute(manifest, "/tasks/l/work.2026/index.txt")).toEqual({
    path: "tasks/l/__/index.txt",
    status: 200,
  });
  expect(resolveRoute(manifest, "/docs/a/b/index.txt")).toEqual({
    path: "docs/__/index.txt",
    status: 200,
  });
});

it("rejects ambiguous route groups and parameter names", async () => {
  for (const patterns of [
    ["(a)/docs/[ref]", "(b)/docs/[id]"],
    ["(a)/docs/[...a]", "(b)/docs/[...b]"],
  ]) {
    const f = await fixture();
    for (const pattern of patterns) await f.put(`src/app/${pattern}/page.tsx`);
    await f.put("www/docs/__/index.html");
    await expect(createManifest(f)).rejects.toThrow("Ambiguous native routes");
  }
});

it("backtracks from an incomplete static prefix to a complete dynamic route", async () => {
  const f = await fixture();
  for (const [pattern, dir] of [
    ["docs/new", "docs/new"],
    ["docs/[ref]/history", "docs/__/history"],
    ["docs/[...path]", "docs/__"],
  ]) {
    await f.put(`src/app/${pattern}/page.tsx`);
    await f.put(`www/${dir}/index.html`);
  }
  const manifest = await createManifest(f);
  expect(resolveRoute(manifest, "/docs/new/history")).toEqual({
    path: "docs/__/history/index.html",
    status: 200,
  });
});

it("fails a dynamic route without its placeholder HTML", async () => {
  const f = await fixture();
  await f.put("src/app/docs/[ref]/page.tsx");
  await f.put("www/docs/some-value/index.html");
  await expect(createManifest(f)).rejects.toThrow("Missing native placeholder");
});

it.each([
  "index.html",
  "index.txt",
  "__next._full.txt",
])("rejects a reserved static segment %s", async (name) => {
  const f = await fixture();
  await f.put(`src/app/docs/${name}/page.tsx`);
  await expect(createManifest(f)).rejects.toThrow("Reserved transport suffix");
});

it.each([
  ["src/app/api/route.ts", "export function GET() {}"],
  ["src/app/api/route.ts", 'function notRouteConfig() { const dynamic = "force-static"; }'],
  ["middleware.ts", "export default function middleware() {}"],
  ["src/middleware.ts", "export default function middleware() {}"],
  ["src/proxy.ts", "export default function proxy() {}"],
  ["src/app/actions.ts", '"use server"; export async function action() {}'],
  ["src/app/page.tsx", 'import { headers as h } from "next/headers";'],
  ["src/app/page.tsx", 'import * as h from "next/headers";'],
  [
    "src/app/page.tsx",
    'export const dynamic = "force-static"; const { cookies: readCookies } = await import(`next/headers`);',
  ],
  ["src/app/page.tsx", "const { headers: readHeaders } = require(`next/headers`);"],
  ["src/app/page.tsx", 'const h = await import("next/headers");'],
  ["src/app/page.tsx", "export default function Page() { cookies(); }"],
  ["src/app/page.tsx", "export default function Page() { headers(); }"],
])("rejects forbidden server features in %s", async (path, source) => {
  const f = await fixture();
  await f.put(path, source);
  await expect(createManifest(f)).rejects.toThrow(/forbids|force-static/);
});

it("accepts force-static handlers and ignores server-feature comments", async () => {
  const f = await fixture();
  await f.put(
    "src/app/api/route.ts",
    'export const dynamic = "force-static"; export function GET() {} // cookies()',
  );
  expect((await createManifest(f)).routes).toEqual([]);
  await expect(createManifest({ ...f, config: { rewrites: async () => [] } })).rejects.toThrow(
    "rewrites",
  );
});

it("requires interception to be explicitly adapted and rejects nonterminal catch-alls", async () => {
  for (const pattern of ["(.)preview/[ref]", "docs/[...path]/history"]) {
    const f = await fixture();
    await f.put(`src/app/${pattern}/page.tsx`);
    await expect(createManifest(f)).rejects.toThrow(/Intercepting|last segment/);
  }
});

it("checks middleware at the original project root when the app is staged elsewhere", async () => {
  const f = await fixture();
  const projectRoot = join(f.sourceRoot, "../original-project");
  await f.put("original-project/middleware.ts", "export default function middleware() {}");
  await expect(createManifest({ ...f, projectRoot })).rejects.toThrow("forbids middleware");
});
