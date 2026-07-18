/**
 * Seed the demo persona into a live pod (`pnpm run seed`, or the scaffolder's
 * `--seed`). The target is an EXISTING account on a dev Solid server, named by
 * env (see .env.example). Mode "ensure" converges without clobbering.
 */
import { seedPods } from "@jeswr/solid-seed";
import { generateSeedData, layoutFor } from "./seed.config.ts";

const PREFIX = "__CSD_ENV_PREFIX__";
const baseUrl = process.env[`${PREFIX}_SEED_POD_URL`];
const webid = process.env[`${PREFIX}_SEED_WEBID`];

if (baseUrl === undefined || webid === undefined || baseUrl === "" || webid === "") {
  process.stderr.write(
    `✗ seed target not configured. Set ${PREFIX}_SEED_POD_URL (the pod base URL) and ` +
      `${PREFIX}_SEED_WEBID (the account WebID) — e.g. a local dev Solid server account. ` +
      "See .env.example.\n",
  );
  process.exit(1);
}

const data = await generateSeedData();
const manifest = await seedPods({
  data,
  layout: layoutFor({ authFetch: fetch, baseUrl, webid }),
  mode: "ensure",
});
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write("✔ seeded the demo persona (deterministic — safe to re-run)\n");
