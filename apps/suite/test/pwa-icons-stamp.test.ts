// AUTHORED-BY Claude Sonnet 5.5
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
// @ts-expect-error plain ESM script shared with the generator
import { buildStamp, STAMP_NAME, stampProblems } from "../scripts/pwa-icons-stamp.mjs";

// No browser: icon bytes are not stable across Chromium versions or platforms, so the committed
// stamp (written by `pnpm --filter @jeswr/app-suite run generate:icons`) is the reference.
const here = (path: string) => pathToFileURL(isAbsolute(path) ? path : join(process.cwd(), path));
const dirUrl = (path: string) => new URL(`${here(path).href.replace(/\/?$/, "/")}`);
const locations = (root?: string) => ({
  publicDir: root ? dirUrl(join(root, "public")) : dirUrl("public"),
  iconsDir: root ? dirUrl(join(root, "public/icons")) : dirUrl("public/icons"),
  tokensCss: new URL("../../packages/suite-ui/src/styles/tokens.css", `${here("").href}/`),
  scriptsDir: root ? dirUrl(join(root, "scripts")) : dirUrl("scripts"),
});
const MESSAGE =
  "PWA icons are stale: run `pnpm --filter @jeswr/app-suite run generate:icons` and commit the icons and icons.stamp.json";
const committed = async (root?: string) =>
  JSON.parse(await readFile(new URL(STAMP_NAME, locations(root).iconsDir), "utf8"));

const copies: string[] = [];
afterEach(async () => {
  for (const dir of copies.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function copy() {
  const root = await mkdtemp(join(tmpdir(), "pwa-stamp-"));
  copies.push(root);
  await cp("public/icon.svg", join(root, "public/icon.svg"), { recursive: true });
  await cp("public/icons", join(root, "public/icons"), { recursive: true });
  await cp("scripts", join(root, "scripts"), { recursive: true });
  return root;
}

it("committed icons match the stamped generator inputs and PNG hashes", async () => {
  const problems = stampProblems(await committed(), await buildStamp(locations()));
  expect(problems, MESSAGE).toEqual([]);
});

it("fails when a committed PNG changes", async () => {
  const root = await copy();
  await writeFile(join(root, "public/icons/icon-192.png"), "not the generated icon");
  const stamp = await buildStamp({ ...locations(root), tokensCss: locations().tokensCss });
  expect(stampProblems(await committed(root), stamp)).toEqual(["icon-192.png differs"]);
});

it("fails when the source logo or the generator changes", async () => {
  const root = await copy();
  await writeFile(join(root, "public/icon.svg"), "<svg/>");
  const stamp = await buildStamp({ ...locations(root), tokensCss: locations().tokensCss });
  expect(stampProblems(await committed(root), stamp)).toEqual([
    "the generator inputs (icon.svg, tokens or script) changed",
  ]);
  const second = await copy();
  await writeFile(join(second, "scripts/generate-pwa-icons.mjs"), "// changed\n");
  const next = await buildStamp({ ...locations(second), tokensCss: locations().tokensCss });
  expect(stampProblems(await committed(second), next)).toHaveLength(1);
});

it("fails when a token the generator reads changes, and ignores unrelated tokens", async () => {
  const root = await copy();
  const css = await readFile(locations().tokensCss, "utf8");
  const edit = async (text: string) => {
    const file = join(root, "tokens.css");
    await writeFile(file, text);
    return buildStamp({ ...locations(root), tokensCss: pathToFileURL(file) });
  };
  const real = await committed(root);
  expect(stampProblems(real, await edit(css))).toEqual([]);
  expect(
    stampProblems(real, await edit(css.replace(/--primary-soft:/, "--primary-soft: red; --x:"))),
  ).toEqual([]);
  expect(
    stampProblems(real, await edit(css.replace(/--primary: [^;]+;/, "--primary: red;"))),
  ).toHaveLength(1);
});

it("reports a missing stamp and extra or missing icons", async () => {
  expect(stampProblems(undefined, { inputs: "", icons: {} })).toEqual([
    "icons.stamp.json is missing",
  ]);
  expect(
    stampProblems(
      { inputs: "a", icons: { "x.png": "1" } },
      { inputs: "a", icons: { "y.png": "2" } },
    ),
  ).toEqual(["x.png differs", "y.png differs"]);
});
