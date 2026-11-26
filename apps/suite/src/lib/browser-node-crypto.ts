// AUTHORED-BY Codex GPT-6.2-Sol
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();

export function createHash(algorithm: string) {
  if (algorithm !== "sha1" && algorithm !== "sha256") {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }
  const hash = (algorithm === "sha1" ? sha1 : sha256).create();

  function digest(): Buffer;
  function digest(encoding: string): string;
  function digest(encoding?: string): Buffer | string {
    // pkg-memory's UUID helper mutates the digest bytes.
    if (encoding === undefined) return Buffer.from(hash.digest());
    if (encoding !== "hex") throw new Error(`Unsupported digest encoding: ${encoding}`);
    return bytesToHex(hash.digest());
  }

  return {
    update(data: string | Uint8Array, encoding?: string) {
      if (encoding !== undefined && encoding !== "utf8" && encoding !== "utf-8")
        throw new Error(`Unsupported input encoding: ${encoding}`);
      hash.update(typeof data === "string" ? encoder.encode(data) : data);
      return this;
    },
    digest,
  };
}
