// AUTHORED-BY Claude Sonnet 5.5
// Browser-free fingerprint of the PWA icon generator's inputs and outputs. The generator
// (generate-pwa-icons.mjs) writes it; test/pwa-icons-stamp.test.ts recomputes it. PNG bytes are
// not stable across Chromium versions or platforms, so equality is checked against the committed
// stamp, never against a fresh render.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

export const STAMP_NAME = "icons.stamp.json";
/** The only design tokens the generator reads (from the root, light scheme). */
const TOKENS = ["--primary", "--primary-foreground", "--background"];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** The value of each token the generator reads, from the first declaration in tokens.css. */
export function tokenValues(css) {
  return Object.fromEntries(
    TOKENS.map((name) => {
      const match = new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;]+);`).exec(css);
      return [name, match?.[1]?.trim() ?? null];
    }),
  );
}

/** Hash of icon.svg, the token values and the generator's own source. */
export async function inputsHash({ publicDir, tokensCss, scriptsDir }) {
  const parts = [
    await readFile(new URL("icon.svg", publicDir)),
    JSON.stringify(tokenValues(await readFile(tokensCss, "utf8"))),
    await readFile(new URL("generate-pwa-icons.mjs", scriptsDir)),
    await readFile(new URL("pwa-icons-stamp.mjs", scriptsDir)),
  ];
  return sha256(parts.map(sha256).join("\n"));
}

/** SHA-256 of every file in the icons directory except the stamp itself. */
export async function iconHashes(iconsDir) {
  const names = (await readdir(iconsDir)).filter((name) => name !== STAMP_NAME).sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, sha256(await readFile(new URL(name, iconsDir)))]),
    ),
  );
}

export async function buildStamp(locations) {
  return {
    inputs: await inputsHash(locations),
    icons: await iconHashes(locations.iconsDir),
  };
}

/** Human-readable reasons the committed icons are out of date; empty when they are current. */
export function stampProblems(committed, current) {
  const problems = [];
  if (!committed) return ["icons.stamp.json is missing"];
  if (committed.inputs !== current.inputs)
    problems.push("the generator inputs (icon.svg, tokens or script) changed");
  for (const name of new Set([...Object.keys(committed.icons), ...Object.keys(current.icons)]))
    if (committed.icons[name] !== current.icons[name]) problems.push(`${name} differs`);
  return problems;
}
