// AUTHORED-BY Codex GPT-6.1-Sol
import { secretRedactor } from "@jeswr/site-executor";
import { parseHtml } from "@jeswr/site-profiler";

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
    const decoded = displayText(text);
    const clean = redact(decoded);
    return clean !== decoded || decoded === "[redacted]" ? clean : redact(text);
  };
}

/** URL credentials are sensitive even before their values are known to the session. */
export function redactSnapshot(text: string, redact: (value: string) => string): string {
  const original = redact(text);
  const decoded = displayText(original);
  const scrubbed = decoded.replace(
    /https?:\/\/[^\s<>"']+|\/\/[^\s<>"']+|\/(?:[^\s<>"']*\?)[^\s<>"']+|\?[^\s<>"']+/gi,
    (value) => {
      try {
        const url = new URL(value, "https://snapshot.invalid");
        let changed = false;
        if (url.username || url.password) {
          url.username = "[redacted]";
          url.password = "";
          changed = true;
        }
        for (const key of [...url.searchParams.keys()])
          if (/token|key|code|session|sig|auth|password|secret|state|nonce/i.test(key)) {
            url.searchParams.set(key, "[redacted]");
            changed = true;
          }
        if (!changed) return value;
        if (value.startsWith("?")) return url.search;
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
