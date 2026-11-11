// AUTHORED-BY Codex GPT-6
/** Internal validation shared by the native seam and relay registrar. Errors contain no input. */
export function requirePush(value: unknown): asserts value {
  if (!value) throw new TypeError("Invalid push data");
}
export function pushObject(value: unknown, fields: readonly string[]) {
  requirePush(value !== null && typeof value === "object" && !Array.isArray(value));
  requirePush(Object.keys(value).every((field) => fields.includes(field)));
  return value as Record<string, unknown>;
}
export function pushString(value: unknown, max = 4096): asserts value is string {
  requirePush(typeof value === "string" && value.length > 0 && value.length <= max);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject controls before they reach a URL or native notification.
  requirePush(!/[\u0000-\u001f\u007f-\u009f]/u.test(value));
}
export function pushId(value: unknown): asserts value is string {
  requirePush(typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value));
}
export function pushUrl(value: unknown, fragment = false): string {
  pushString(value);
  const url = new URL(value);
  requirePush(url.protocol === "https:" && !url.username && !url.password);
  requirePush(fragment || !url.hash);
  requirePush(!/\s|\\/u.test(value));
  return url.href;
}
export function relayOrigin(value: unknown): string {
  const normalized = pushUrl(value);
  const url = new URL(normalized);
  requirePush(url.pathname === "/" && !url.search);
  return url.origin;
}
export function pushBytes(value: unknown, length: number): Uint8Array {
  requirePush(typeof value === "string" && /^[A-Za-z0-9_-]+$/u.test(value));
  const decoded = atob(value.replace(/-/gu, "+").replace(/_/gu, "/"));
  requirePush(decoded.length === length);
  requirePush(
    btoa(decoded).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "") === value,
  );
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
export function pushInteger(value: unknown): asserts value is number {
  requirePush(Number.isSafeInteger(value) && (value as number) >= 0);
}
export function isPushRoute(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 512 &&
    (value === "/notifications" || /^\/chat\/[A-Za-z0-9_-]+$/u.test(value))
  );
}
