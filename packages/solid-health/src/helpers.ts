// AUTHORED-BY Codex GPT-6.1-Sol
import { CODE_SCHEMES } from "./vocab.js";
export function code(value: string, display?: string, scheme?: typeof CODE_SCHEMES.loinc) {
  if (scheme !== undefined && scheme !== CODE_SCHEMES.loinc)
    throw new TypeError("Unknown clinical code scheme");
  return { codeValue: value, display, scheme };
}
export function loincCode(value: string, display?: string) {
  return code(value, display, CODE_SCHEMES.loinc);
}
export function monthlyDocumentPath(metric: string, at: Date): string {
  if (
    !/^[a-z][a-z0-9-]{0,63}$/.test(metric) ||
    !Number.isFinite(at.getTime()) ||
    at.getUTCFullYear() < 1 ||
    at.getUTCFullYear() > 9999
  )
    throw new TypeError("Invalid health observation shard");
  return `health/observations/${metric}/${at.toISOString().slice(0, 7)}.ttl`;
}
