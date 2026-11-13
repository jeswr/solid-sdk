// AUTHORED-BY Codex GPT-6.1-Sol
import { normaliseSecretText, registerSecret, secretRedactor } from "@jeswr/site-executor";

/** Render page-controlled formatting as text, including bidi and zero-width controls. */
export function escapeControls(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\u2028\u2029\u2060-\u2069]/gu, (c) =>
    c.length === 1
      ? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
      : `\\u{${c.codePointAt(0)?.toString(16)}}`,
  );
}

/** Match the session header spelling actually sent, while retaining source spellings too. */
export function normaliseSessionHeader(value: string): string {
  return value
    .trim()
    .replace(
      /^(bearer|basic|dpop)\s+/i,
      (_match, scheme: string) =>
        `${({ bearer: "Bearer", basic: "Basic", dpop: "DPoP" } as Record<string, string>)[scheme.toLowerCase()]} `,
    );
}

export function rememberSessionHeader(secrets: Set<string>, value: string): string {
  const normalised = normaliseSessionHeader(value);
  registerSecret(secrets, value);
  registerSecret(secrets, value.trim());
  registerSecret(secrets, normalised);
  const credential = normalised.replace(/^[a-z][a-z0-9+.-]*\s+/i, "");
  if (credential) registerSecret(secrets, credential);
  return normalised;
}

/** Shared executor normalization and short-secret boundary rules. */
export const fallbackRedactor = secretRedactor;

/** URL credentials are sensitive even before their values are known to the session. */
export function redactSnapshot(
  text: string,
  redact: (value: string) => string,
  secrets: ReadonlySet<string> = new Set(),
): string {
  const original = redact(text);
  const decoded = normaliseSecretText(original);
  const scrubbed = decoded.replace(
    /https?:\/\/[^\s<>"']+|\/\/[^\s<>"']+|\/[^\s<>"']+|[?#][^\s<>"']+/gi,
    (value) => {
      try {
        const url = new URL(value, "https://snapshot.invalid");
        let changed = false;
        const sensitiveKey = /token|key|code|session|sig|auth|password|secret|state|nonce/i;
        const decode = (part: string) => {
          try {
            return decodeURIComponent(part);
          } catch {
            return part;
          }
        };
        if (url.username || url.password) {
          url.username = "[redacted]";
          url.password = "";
          changed = true;
        }
        for (const key of [...url.searchParams.keys()])
          if (sensitiveKey.test(key) || secrets.has(url.searchParams.get(key) ?? "")) {
            url.searchParams.set(key, "[redacted]");
            changed = true;
          }
        url.pathname = url.pathname
          .split("/")
          .map((part) => {
            if (!secrets.has(decode(part))) return part;
            changed = true;
            return "[redacted]";
          })
          .join("/");
        if (url.hash.includes("=")) {
          const params = new URLSearchParams(url.hash.slice(1));
          for (const [key, item] of params)
            if (sensitiveKey.test(key) || secrets.has(item)) {
              params.set(key, "[redacted]");
              changed = true;
            }
          url.hash = params.toString();
        } else if (
          url.hash &&
          (secrets.has(decode(url.hash.slice(1))) ||
            /^[A-Za-z0-9_.~+/-]{16,}={0,2}$/.test(decode(url.hash.slice(1))))
        ) {
          url.hash = "[redacted]";
          changed = true;
        }
        if (!changed) return value;
        if (value.startsWith("?")) return url.search;
        if (value.startsWith("#")) return url.hash;
        if (value.startsWith("/") && !value.startsWith("//"))
          return `${url.pathname}${url.search}${url.hash}`;
        return url.href;
      } catch {
        return "[redacted URL]";
      }
    },
  );
  return scrubbed !== decoded ? scrubbed : original;
}
