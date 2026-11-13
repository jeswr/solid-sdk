// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/** Fixed provider routes. No credentials or provider-controlled URLs enter pod metadata. */
export const VESYNC_API = "https://smartapi.vesync.com";
export const LOGIN = "/cloud/v1/user/login";
export const DEVICES = "/cloud/v1/deviceManaged/devices";
export const BYPASS = "/cloud/v2/deviceManaged/bypassV2";
export const DETAIL = "/131airPurifier/v1/device/deviceDetail";
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_DEVICES = 50;
export const MAX_RUN_OBSERVATIONS = 200;
/** Per attempt: each source request (and each Pod request in the CLI). */
export const REQUEST_TIMEOUT_MS = 30_000;
/**
 * One adapter source call: a lazy login, bounded retries with backoff and one renewal, so a
 * slow first attempt still leaves time for retries (3 attempts x 30 s + delays, twice).
 */
export const SOURCE_CALL_TIMEOUT_MS = 3 * 60_000;
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function text(value: unknown, max = 256): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim().length > 0 &&
    !Array.from(value).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 || (char.length === 1 && code >= 0xd800 && code <= 0xdfff);
    })
    ? value
    : undefined;
}
