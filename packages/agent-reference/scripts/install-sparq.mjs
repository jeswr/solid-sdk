#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";

export const SHA256 = "9832ef937efbcc8970db3f70ec4e72e3384a867f3ecb40a1be81ea002a6a6830";
export const RESULT_SHA256 = "42a52776b3046efab999d8555ea9e815175f1b2ac0dce3f2832e8905748410e0";
export const QUERY_SHA256 = "8b4bacb109c5f190e04565483c86c11efe3af5050b23ada80ab48512dbedc8b3";
const packages = new Map([
  [SHA256, "sparq-verifiable-aggregate"],
  [RESULT_SHA256, "sparq-zk-result"],
  [QUERY_SHA256, "sparq-zk-query"],
]);
export function install(tarball, destination) {
  // Read once: unpack exactly the authenticated bytes without a subprocess or network.
  const bytes = readFileSync(resolve(tarball));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const name = packages.get(hash);
  if (!name) throw new Error("SPARQ tarball SHA-256 mismatch; nothing unpacked");
  destination ??= fileURLToPath(new URL(`../.sparq/${name}`, import.meta.url));
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = mkdtempSync(join(dirname(destination), ".install-"));
  try {
    const tar = gunzipSync(bytes);
    for (let offset = 0; offset + 512 <= tar.length; ) {
      const header = tar.subarray(offset, offset + 512);
      const leaf = header.subarray(0, 100).toString().replace(/\0.*$/s, "");
      if (!leaf) break;
      const prefix = header.subarray(345, 500).toString().replace(/\0.*$/s, "");
      const name = prefix ? `${prefix}/${leaf}` : leaf;
      const size = Number.parseInt(
        header.subarray(124, 136).toString().replace(/\0.*$/s, "").trim(),
        8,
      );
      const relative = name.replace(/^package\//, "");
      if (
        !name.startsWith("package/") ||
        relative.split("/").some((p) => p === "..") ||
        relative.startsWith("/") ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        offset + 512 + size > tar.length
      )
        throw new Error("Invalid tar member");
      const type = header[156];
      if (type === 0 || type === 48) {
        mkdirSync(dirname(join(temporary, relative)), { recursive: true });
        writeFileSync(join(temporary, relative), tar.subarray(offset + 512, offset + 512 + size));
      } else if (type === 53) mkdirSync(join(temporary, relative), { recursive: true });
      else throw new Error("Unsupported tar member type");
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    rmSync(destination, { recursive: true, force: true });
    renameSync(temporary, destination);
    return { name, sha256: hash };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error("Usage: node scripts/install-sparq.mjs <tarball> [<tarball> ...]");
  for (const tarball of process.argv.slice(2)) {
    const installed = install(tarball);
    console.log(
      `Installed research-grade, unaudited ${installed.name} (${installed.sha256})${installed.name === "sparq-zk-result" ? "; sparq commitment-signed credentials, not standard VCs; test-only issuer keys" : installed.name === "sparq-zk-query" ? "; sparq Merkle-suite credentials; test-only issuer keys" : ""}`,
    );
  }
}
