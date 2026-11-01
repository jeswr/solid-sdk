// AUTHORED-BY Claude Opus 5.5
/**
 * Route references (00-sdk-assumptions A-18): base64url (no padding) of an
 * absolute http(s) URL. App-local until the SDK façade (SDK-APP-01) ships
 * `encodeRef`/`decodeRef`; the encoding is identical so links keep working.
 */

export class InvalidRefError extends Error {
  constructor(readonly ref: string) {
    super("Not a valid resource reference");
    this.name = "InvalidRefError";
  }
}

function assertHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new TypeError("http(s) only");
  return url;
}

export function encodeRef(url: string): string {
  const href = assertHttpUrl(url).href;
  const bytes = new TextEncoder().encode(href);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeRef(ref: string): string {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(ref)) throw new InvalidRefError(ref);
    const binary = atob(ref.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const href = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const url = assertHttpUrl(href);
    if (url.href !== href) throw new InvalidRefError(ref);
    return href;
  } catch {
    throw new InvalidRefError(ref);
  }
}
