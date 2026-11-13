#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";

export const SHA256 = "9832ef937efbcc8970db3f70ec4e72e3384a867f3ecb40a1be81ea002a6a6830";
export function install(
  tarball,
  destination = fileURLToPath(new URL("../.sparq/sparq-verifiable-aggregate", import.meta.url)),
) {
  // Read once: unpack exactly the authenticated bytes without a subprocess or network.
  const bytes = readFileSync(resolve(tarball));
  if (createHash("sha256").update(bytes).digest("hex") !== SHA256)
    throw new Error("SPARQ tarball SHA-256 mismatch; nothing unpacked");
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = mkdtempSync(join(dirname(destination), ".install-"));
  try {
    const tar = gunzipSync(bytes);
    for (let offset = 0; offset + 512 <= tar.length; ) {
      const header = tar.subarray(offset, offset + 512);
      const name = header.subarray(0, 100).toString().replace(/\0.*$/s, "");
      if (!name) break;
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
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/install-sparq.mjs <tarball>");
  install(process.argv[2]);
  console.log(`Installed research-grade, unaudited sparq-verifiable-aggregate 61989f5 (${SHA256})`);
}
