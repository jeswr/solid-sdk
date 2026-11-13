// AUTHORED-BY Codex GPT-6.1-Sol
import { secretRedactor } from "@jeswr/site-executor";
import { parseHtml } from "@jeswr/site-profiler";

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
  secrets.add(value);
  secrets.add(value.trim());
  secrets.add(normalised);
  const credential = normalised.replace(/^[a-z][a-z0-9+.-]*\s+/i, "");
  if (credential) secrets.add(credential);
  return normalised;
}

/** Normalize combinations of display encodings without interpreting any markup. */
function displayText(text: string): string {
  let out = text;
  for (let i = 0; i < 32; i++) {
    const json = out.replace(
      /\\u([\da-f]{4})|\\x([\da-f]{2})|\\(["\\/bfnrt])/gi,
      (_match, unicode: string, hex: string, escaped: string) =>
        unicode || hex
          ? String.fromCharCode(Number.parseInt(unicode || hex, 16))
          : (({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[escaped] ??
            escaped),
    );
    // Escaping '<' makes every parsed node text, including strings that look like HTML.
    const html = parseHtml(json.replaceAll("<", "&lt;"))
      .children.map((node) => ("data" in node ? node.data : ""))
      .join("");
    const decoded = html.replace(/(?:%[\da-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
    if (decoded === out) return out;
    out = decoded;
  }
  return "[redacted]";
}

/** Apply the executor's redactor after normalizing mixed/nested display encodings. */
export function fallbackRedactor(secrets: ReadonlySet<string>): (text: string) => string {
  return (text) => {
    const variants = new Set(secrets);
    for (const value of secrets) {
      if (!value) continue;
      variants.add(displayText(value));
      variants.add(JSON.stringify(value).slice(1, -1));
      variants.add(Buffer.from(value).toString("base64url"));
      variants.add(Buffer.from(value).toString("base64"));
    }
    const redact = secretRedactor(variants);
    // Explicit browser credentials also cover short tokens. The executor's general redactor
    // deliberately ignores these; here the source already established that they are secrets.
    const short = [
      ...new Set([...secrets].flatMap((value) => [value, value.trim(), displayText(value)])),
    ]
      .filter((value) => value.trim() && Array.from(value).length < 8)
      .sort((a, b) => b.length - a.length);
    const complete = (value: string) => {
      let out = redact(value);
      for (const secret of short)
        out = out
          .split("[redacted]")
          .map((part) => part.split(secret).join("[redacted]"))
          .join("[redacted]");
      return out;
    };
    const decoded = displayText(text);
    const clean = complete(decoded);
    return clean !== decoded || decoded === "[redacted]" ? clean : complete(text);
  };
}

/** URL credentials are sensitive even before their values are known to the session. */
export function redactSnapshot(
  text: string,
  redact: (value: string) => string,
  secrets: ReadonlySet<string> = new Set(),
): string {
  const original = redact(text);
  const decoded = displayText(original);
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
