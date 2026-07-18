#!/usr/bin/env node
// AUTHORED-BY Claude Fable 5
/**
 * create-solid-demo — scaffold a domain-generic multistakeholder pod-data
 * walkthrough (showcase-framework design §4). The published executable is
 * `dist/bin.mjs`, an esbuild bundle of this file: Node does NOT type-strip
 * inside node_modules, so a TS bin would fail under npx.
 *
 * The example below is wholly FICTIONAL (the framework carries no use case);
 * your own flags carry your domain into the generated walkthrough.json.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { promptMissing } from "./prompts.js";
import { scaffold } from "./scaffold.js";
import type { DemoSpec } from "./walkthrough.js";

const HELP = `create-solid-demo — scaffold a multistakeholder pod-data walkthrough

Usage:
  npx create-solid-demo <dir> [flags]

  npx create-solid-demo my-demo \\
    --use-case trails \\
    --convener "Meridian Trails Collective" \\
    --negation "Nothing here is an offer of guided travel." \\
    --app vault:"Traveller Vault":"personal data custodian" \\
    --app permits:"Permit Desk":"day-permit issuer" \\
    --modelled-on permits="Ridgeway Range Authority"

Flags (missing required answers are prompted on a TTY):
  --use-case <slug>        Deploy slug; derives the env + consent-cookie prefixes.
  --convener <name>        Publishing organisation (branding.convener + site.organization).
  --negation <line>        Repeatable; branding.domainNegations (>=1 required). Full
                           sentences appended to the FIXED safety copy.
  --app slug:name:role     Repeatable (>=1). Registers a zone app + skeleton. The FIRST
                           app is the data subject's own custodian seat (the centre).
  --modelled-on slug=Org   Repeatable; the app's modelled-on organisation
                           (default: its role text).
  --seed                   After install, run the generated repo's deterministic
                           persona seed (pnpm run seed).
  --no-install             Skip pnpm install in the scaffolded repo.
  -h, --help               Show this help.

Every answer lands in apps/tour/content/walkthrough.json — the single document a
team edits afterwards. The generated branding.bannedMarks roster starts EMPTY:
add your domain's never-render marks there (the framework ships none).
`;

function run(command: string, args: string[], cwd: string): number {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  return result.status ?? 1;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (options.errors.length > 0) {
    process.stderr.write(`${options.errors.map((error) => `✗ ${error}`).join("\n")}\n\n${HELP}`);
    process.exit(1);
  }

  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (options.targetDir === undefined) {
        const dir = (await rl.question("Target directory: ")).trim();
        if (dir.length > 0) options.targetDir = dir;
      }
      await promptMissing(options, rl);
    } finally {
      rl.close();
    }
  }

  const missing: string[] = [];
  if (options.targetDir === undefined) missing.push("<dir>");
  if (options.useCase === undefined) missing.push("--use-case");
  if (options.convener === undefined) missing.push("--convener");
  if (options.negations.length === 0) missing.push("--negation");
  if (options.apps.length === 0) missing.push("--app");
  if (missing.length > 0) {
    process.stderr.write(`✗ missing required: ${missing.join(", ")}\n\n${HELP}`);
    process.exit(1);
  }

  const spec: DemoSpec = {
    apps: options.apps,
    convener: options.convener as string,
    modelledOn: options.modelledOn,
    negations: options.negations,
    useCase: options.useCase as string,
  };
  const targetDir = options.targetDir as string;

  process.stdout.write(`Scaffolding "${targetDir}" (${spec.apps.length} app(s) + tour shell)…\n`);
  const result = await scaffold({ spec, targetDir });
  process.stdout.write(`✔ Created ${result.targetDir} (${result.files.length} files)\n`);

  if (options.install) {
    process.stdout.write("Installing dependencies (pnpm install)…\n");
    if (run("pnpm", ["install"], result.targetDir) !== 0) {
      process.stderr.write(
        "✗ pnpm install failed. NOTE: the @jeswr framework packages are pending their npm\n" +
          "  publish — until they land on the registry, point them at packed tarballs or git\n" +
          "  pins via pnpm.overrides (see docs/deploy.md § Framework dependency status),\n" +
          "  then re-run pnpm install.\n",
      );
      process.exit(1);
    }
    process.stdout.write("✔ Installed dependencies\n");
  } else {
    process.stdout.write("• Skipped install (--no-install)\n");
  }

  if (options.seed) {
    if (!options.install) {
      process.stderr.write("✗ --seed needs installed dependencies (drop --no-install)\n");
      process.exit(1);
    }
    process.stdout.write("Seeding the demo persona (pnpm run seed)…\n");
    if (run("pnpm", ["run", "seed"], result.targetDir) !== 0) {
      process.stderr.write(
        "✗ seed failed — configure the seed target env vars first (see .env.example).\n",
      );
      process.exit(1);
    }
  }

  process.stdout.write(`
  Next:
    cd ${targetDir}${options.install ? "" : "\n    pnpm install"}
    pnpm lint && pnpm typecheck && pnpm test
    pnpm --filter @${spec.useCase}/app-tour dev   # the walkthrough shell

  Then edit apps/tour/content/walkthrough.json — the whole site renders from it.
  Deploy: read docs/deploy.md first (env matrix + the per-project gotchas).
`);
}

/**
 * True when this file is the CLI entry (not an import). npm/pnpm expose the bin
 * through a `.bin` SYMLINK while the loader realpath-resolves `import.meta.url`,
 * so argv[1] must be realpath'd too — a plain `resolve` comparison would
 * silently no-op under npx (the fatal published-bin failure mode).
 */
function invokedAsCli(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  let entry: string;
  try {
    entry = realpathSync(argv1);
  } catch {
    entry = resolve(argv1);
  }
  return fileURLToPath(import.meta.url) === entry;
}

// Run only when invoked as the CLI entry (not when imported by tests).
if (invokedAsCli()) {
  main().catch((error: unknown) => {
    process.stderr.write(`✗ ${(error as Error).message}\n`);
    process.exit(1);
  });
}
