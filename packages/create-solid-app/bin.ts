#!/usr/bin/env node
// AUTHORED-BY Claude Opus 4.8
/**
 * create-solid-app (PROTOTYPE) — scaffold a house-rules-conformant Solid web app
 * from the proven app-builder template.
 *
 * Run modes (both documented in README):
 *   node dx/create-solid-app/bin.ts my-app          # workspace-relative
 *   create-solid-app my-app                          # after `npm link`
 *
 * Flags:
 *   --no-install   skip `npm install` in the scaffolded dir
 *   --seed-pod     after scaffold, boot local in-memory CSS + seed + print logins
 *
 * SEAM map to spec decisions:
 *   D1 dev-pod default   -> src/seed-pod.ts (run-time seeding mechanism)
 *   D2 auto-run dev      -> this file stops at "Next steps" (no --start yet)
 *   D3 skills copy/link  -> template carries skills inline (copy); link is future
 *   D4 doctor subcommand -> not implemented (would live here as a subcommand)
 *   D5 template location -> scaffold.ts resolveTemplateDir() (only seam to swap)
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scaffold } from "./src/scaffold.ts";
import { requestClientCredentialsToken, seedPod } from "./src/seed-pod.ts";

interface ParsedArgs {
  appName?: string;
  install: boolean;
  seedPod: boolean;
  help: boolean;
  /** GitHub `owner/repo` the baked-in FeedbackButton files issues against (--repo). */
  repo?: string;
  /** A usage error (unknown flag / extra positional). Non-null means abort with this message. */
  error?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { install: true, seedPod: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue; // unreachable (i < length), but narrows for noUncheckedIndexedAccess
    if (arg === "--no-install") out.install = false;
    else if (arg === "--seed-pod") out.seedPod = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--repo") {
      // `--repo owner/name` — the next token is the value. Reject a missing
      // value, another flag, OR an empty/whitespace-only value (`--repo ""`):
      // any of those would otherwise silently fall back to the placeholder repo
      // and look like the feedback target was configured when it wasn't.
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-") || value.trim().length === 0) {
        out.error ??= "--repo requires a value (owner/repo)";
        if (value !== undefined && !value.startsWith("-")) i++; // consume the empty value
      } else {
        out.repo = value;
        i++; // consume the value
      }
    } else if (arg.startsWith("--repo=")) {
      // `--repo=owner/name`. An EMPTY or whitespace-only value (`--repo=`) is a
      // usage error, for symmetry with the value-less `--repo` form — otherwise
      // a typo would silently fall back to the placeholder repo and look like it
      // succeeded.
      const value = arg.slice("--repo=".length);
      if (value.trim().length === 0) out.error ??= "--repo requires a value (owner/repo)";
      else out.repo = value;
    } else if (arg.startsWith("-")) {
      // Unknown flag — fail rather than silently ignore (a typo'd flag would otherwise no-op).
      out.error ??= `unknown flag: ${arg}`;
    } else if (!out.appName) {
      out.appName = arg;
    } else {
      // A second positional — the user passed multiple app names; reject rather than drop one.
      out.error ??= `unexpected extra argument: ${arg} (only one app name is allowed)`;
    }
  }
  return out;
}

const HELP = `create-solid-app (prototype)

Usage:
  node dx/create-solid-app/bin.ts <app-name> [--no-install] [--seed-pod] [--repo owner/repo]
  create-solid-app <app-name> [--no-install] [--seed-pod] [--repo owner/repo]   # after npm link

Flags:
  --no-install   Skip running npm install in the scaffolded directory.
  --seed-pod     Boot a local in-memory CSS on :3088 + seed an account and print
                 the issuer + client credentials for instant login.
  --repo <o/r>   GitHub owner/repo the baked-in feedback button files issues
                 against (e.g. --repo jeswr/my-app). Defaults to a placeholder
                 you edit in lib/app-shell-config.ts.
  -h, --help     Show this help.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Explicit help wins, even alongside an error.
  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  // A bad invocation (unknown flag / extra arg) is a usage error: report it + show help on stderr.
  if (args.error) {
    process.stderr.write(`✗ ${args.error}\n\n${HELP}`);
    process.exit(1);
  }

  if (!args.appName) {
    process.stdout.write(HELP);
    process.exit(1);
  }

  const appName = args.appName as string;
  process.stdout.write(`Scaffolding "${appName}" from the app-builder template…\n`);
  const result = await scaffold({ targetDir: appName, appName, repo: args.repo });
  process.stdout.write(`✔ Created ${result.targetDir} (${result.files.length} files)\n`);

  if (args.install) {
    // The scaffold ships the template lockfile (see scaffold.ts SKIP_ENTRIES), so this
    // install is resolution-free. `--prefer-offline` reuses the warm npm cache, `--no-audit`
    // / `--no-fund` drop the post-install network round-trips. We use `npm install` rather
    // than `npm ci` so a lockfile generated on a different platform/arch (cross-platform
    // optional-native-dep drift) is reconciled instead of hard-failing — robustness over the
    // marginal `ci` speed gain. Measured ~13.9s → ~7.3s warm (dx/ttfs-benchmark.md).
    process.stdout.write(
      "Installing dependencies (npm install --prefer-offline --no-audit --no-fund)…\n",
    );
    const r = spawnSync("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund"], {
      cwd: result.targetDir,
      stdio: "inherit",
    });
    if (r.status !== 0) {
      process.stderr.write("✗ npm install failed — fix the error above and re-run.\n");
      process.exit(1);
    }
    process.stdout.write("✔ Installed dependencies\n");
  } else {
    process.stdout.write("• Skipped install (--no-install)\n");
  }

  if (args.seedPod) {
    process.stdout.write("Booting local in-memory CSS on :3088 + seeding (slow ~15s)…\n");
    const pod = await seedPod();
    const tokenResult = await requestClientCredentialsToken(pod);

    process.stdout.write(`\n${"═".repeat(64)}\n`);
    process.stdout.write("  🟢 Local dev pod ready — SEEDED TEST ACCOUNT (in-memory)\n");
    process.stdout.write(`${"─".repeat(64)}\n`);
    process.stdout.write(`   issuer:    ${pod.issuer}\n`);
    process.stdout.write(`   WebID:     ${pod.webId}\n`);
    process.stdout.write(`   email:     ${pod.email}\n`);
    process.stdout.write(`   password:  ${pod.password}\n`);
    if (pod.clientId) {
      process.stdout.write(`   client_id: ${pod.clientId}\n`);
      process.stdout.write(`   secret:    ${pod.clientSecret}\n`);
      process.stdout.write(
        `   login check: client-credentials token ${
          tokenResult.ok ? "OK" : `FAILED (${tokenResult.status})`
        }\n`,
      );
    } else {
      process.stdout.write("   (client-credentials provisioning skipped — account API drift)\n");
    }
    process.stdout.write(`${"═".repeat(64)}\n`);
    process.stdout.write("   (CSS stays up in this process — Ctrl-C to stop)\n");
    // Keep the process alive so the pod stays reachable.
    process.on("SIGINT", () => {
      void pod.stop().then(() => process.exit(0));
    });
    await new Promise(() => {
      /* run until SIGINT */
    });
    return;
  }

  process.stdout.write(`\n  Next:\n    cd ${appName}\n`);
  if (!args.install) process.stdout.write("    npm install\n");
  process.stdout.write(
    "    npm run dev          # boots local pod (seeded) + app, prints logins\n",
  );
  process.stdout.write("\n  Then open http://localhost:3200 and log in with the printed WebID.\n");
}

// Run only when invoked as the CLI entry point (not when imported by a test for `parseArgs`).
// Compare normalised filesystem paths — a hand-built `file://${argv[1]}` URL would mismatch when the
// path contains spaces or other URL-significant characters, silently skipping the CLI body.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(`✗ ${(err as Error).message}\n`);
    process.exit(1);
  });
}
