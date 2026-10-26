#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { provisionValue } from "../packages/agent-credentials/dist/provision.js";
import { CredentialStore } from "../packages/agent-credentials/dist/store.js";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      validate: { type: "boolean" },
      reference: { type: "string" },
      dir: { type: "string" },
      provider: { type: "string" },
      account: { type: "string" },
      purpose: { type: "string" },
      "dry-run": { type: "boolean" },
    },
  });
  const providers = [
    "google",
    "microsoft",
    "anthropic",
    "openai",
    "slack",
    "matrix",
    "discord",
    "telegram",
    "bluesky",
    "mastodon",
  ];
  if (
    !values.dir?.startsWith("/") ||
    !providers.includes(values.provider) ||
    !positionals.length ||
    positionals.some((ref) => !/^op:\/\/[^\s/]+\/[^\s/]+\/[^\s]+$/.test(ref)) ||
    (values.provider === "google" || values.provider === "microsoft"
      ? positionals.length !== 1
      : !/^[a-z0-9][a-z0-9-]{0,63}$/.test(values.account ?? "") ||
        !["read", "send"].includes(values.purpose))
  )
    throw new Error("invalid options");
  if (values.reference !== undefined && !positionals.includes(values.reference))
    throw new Error("unexpected reference");
  if (values.validate || values["dry-run"]) {
    // Validate and open the store before any op process; dry-run never creates it.
    if (!values["dry-run"]) new CredentialStore({ dir: values.dir });
  } else {
    // Each reference starts exactly one op process. Its stdout is a private pipe;
    // completion is a separate signal, so arbitrary output cannot spoof success.
    const child = spawn("op", ["read", values.reference], {
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    });
    const completed = new Promise((resolve, reject) => {
      child.once("error", () => reject(new Error("read failed")));
      child.once("close", (code) => (code === 0 ? resolve() : reject(new Error("read failed"))));
    });
    completed.catch(() => undefined);
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of child.stdout) {
        size += chunk.length;
        if (size > 64 * 1024) throw new Error("value too large");
        chunks.push(chunk);
      }
      await completed;
    } catch {
      child.kill("SIGKILL");
      await completed.catch(() => undefined);
      throw new Error("read failed");
    }
    const bytes = Buffer.concat(chunks);
    const receipt = provisionValue({
      store: new CredentialStore({ dir: values.dir }),
      provider: values.provider,
      account: values.account,
      purpose: values.purpose,
      reference: values.reference,
      value: bytes.toString("utf8"),
      now: new Date(),
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
} catch {
  // Neither provider output nor validation errors can leak token material.
  process.stderr.write(
    "Provisioning refused or failed. Supply --dir DIR --provider PROVIDER [--account ID --purpose read|send] [--dry-run] op://vault/item/field ...\n",
  );
  process.exitCode = 1;
}
