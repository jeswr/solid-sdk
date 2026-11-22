// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { digestOf } from "../core/canonical.js";
import { parseBoundedJson, resolveLimits } from "../core/limits.js";
import type { JsonObject } from "../core/types.js";
import type { JsonValue, ProofSystem } from "./verifiers.js";
import { DERIVATION_LIMITS } from "./verifiers.js";
export type ProofInput = Parameters<ProofSystem["prove"]>[0];
export function proofRequestDigest(input: ProofInput): string {
  return digestOf({
    query: input.query,
    policy: input.policy,
    nonce: input.nonce,
    credentials: input.credentials.map(digestOf),
  });
}
export class ProofCache {
  constructor(readonly directory: string) {}
  read(
    method: string,
    input: ProofInput,
  ): { presentation: JsonObject; result: JsonValue } | undefined {
    const requestDigest = proofRequestDigest(input);
    try {
      const entry = parseBoundedJson(
        readFileSync(join(this.directory, `${requestDigest.slice(8)}.json`), "utf8"),
        resolveLimits(DERIVATION_LIMITS),
      ) as {
        method?: string;
        requestDigest?: string;
        inputDigest?: string;
        proof?: { presentation: JsonObject; result: JsonValue };
      };
      if (
        entry.method !== method ||
        entry.requestDigest !== requestDigest ||
        entry.inputDigest !== digestOf(input)
      )
        return undefined;
      if (
        !entry.proof?.presentation ||
        typeof entry.proof.presentation !== "object" ||
        Array.isArray(entry.proof.presentation) ||
        !Object.hasOwn(entry.proof, "result")
      )
        return undefined;
      return entry.proof;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return undefined;
      throw error;
    }
  }
  write(
    method: string,
    input: ProofInput,
    proof: { presentation: JsonObject; result: JsonValue },
  ): void {
    const requestDigest = proofRequestDigest(input),
      path = join(this.directory, `${requestDigest.slice(8)}.json`);
    mkdirSync(this.directory, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(
      tmp,
      `${JSON.stringify({ method, requestDigest, inputDigest: digestOf(input), proof }, null, 2)}\n`,
    );
    renameSync(tmp, path);
  }
}
