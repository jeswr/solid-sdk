#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
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
  if (values.validate) {
    // Validate and open the store before any op process; dry-run never creates it.
    if (!values["dry-run"]) new CredentialStore({ dir: values.dir });
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 64 * 1024) throw new Error("value too large");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length || bytes[bytes.length - 1] !== 0 || bytes.subarray(0, -1).includes(0))
      throw new Error("read failed");
    const receipt = provisionValue({
      store: new CredentialStore({ dir: values.dir }),
      provider: values.provider,
      account: values.account,
      purpose: values.purpose,
      reference: values.reference,
      value: bytes.subarray(0, -1).toString("utf8"),
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
