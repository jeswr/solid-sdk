// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// api:report / api:check — the public-API SNAPSHOT, the reviewability cornerstone.
//
// `@jeswr/solid-elements` exposes THREE entry points (`.`, `./react`, `./auth`).
// This driver runs Microsoft's api-extractor over each one and writes a committed,
// diffable Markdown report per entry into `etc/`:
//
//   etc/solid-elements.api.md         ← the default `.` entry (chrome components + theme + seam)
//   etc/solid-elements.react.api.md   ← the `./react` @lit/react adapter
//   etc/solid-elements.auth.api.md    ← the `./auth` createReactiveAuthController adapter
//
// So "what is the public API?" — and "did this change perturb it?" — is a one-file
// diff, not a code-reading exercise. A pure internal refactor leaves all three reports
// BYTE-IDENTICAL; a deliberate contract change shows up as a reviewed report diff
// (mapped to semver).
//
//   npm run api:report   → REGENERATE the reports (after an intended API change). Commit them.
//   npm run api:check     → GATE: fail if the committed reports differ from the current dist.
//
// api-extractor is a DEV-ONLY tool run via `npx` (pinned major) — it is NOT a
// dependency of the package (mirrors the suite's attw-via-npx pattern), so it never
// reaches the committed self-contained `dist/`. It reads the EMITTED `dist/**/*.d.ts`,
// so run `npm run build` first (the npm scripts do, via the gate order).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const local = process.argv.includes("--local");
const ENTRIES = ["main", "react", "auth"];

for (const entry of ENTRIES) {
  const args = [
    "--yes",
    "-p",
    "@microsoft/api-extractor@7",
    "api-extractor",
    "run",
    "--config",
    `api-extractor.${entry}.json`,
  ];
  if (local) args.push("--local");
  // Launch `npx` (a Node program) to fetch + run the pinned api-extractor. argv
  // array, no quoting hazard. On Windows `npx` is the `npx.cmd` shim, which
  // `execFileSync` cannot launch without a shell, so enable the shell there only.
  execFileSync("npx", args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
