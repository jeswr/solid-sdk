// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { textContent } from "domutils";
import { parseDocument } from "htmlparser2";

const REDACTED = "[redacted]";
/** Shorter values are guessable and provide no confidentiality. Shared by every consumer. */
export const MIN_REDACTION_LENGTH = 4;
const eligible = (value: string): boolean =>
  Array.from(normaliseSecretText(value)).length >= MIN_REDACTION_LENGTH;

/** Register credentials through the same floor used by the redactor itself. */
export function registerSecret(secrets: Set<string>, value: string): void {
  if (eligible(value)) secrets.add(value);
}

/** Registered cookies include both their transport spelling and logical payload. */
export function cookieSecrets(value: string): string[] {
  const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  let decoded = unquoted;
  try {
    decoded = decodeURIComponent(unquoted);
  } catch {
    /* preserve malformed cookie payloads */
  }
  return [
    value,
    unquoted,
    decoded,
    decoded.startsWith('"') && decoded.endsWith('"') ? decoded.slice(1, -1) : decoded,
  ];
}

// Echoes can nest percent, JSON and HTML encodings. Decode them before matching,
// including mixed percent encodings and malformed triplets next to valid ones.
export function normaliseSecretText(text: string, form = false): string {
  let out = text;
  for (let i = 0; i < 32; i++) {
    // Form decoding replaces '+' BEFORE percent decoding, including mixed spellings.
    let next = (form ? out.replaceAll("+", " ") : out).replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run.replace(/%([0-7][0-9a-f])/gi, (_m, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      }
    });
    next = next.replace(/\\x([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    next = next.replace(/\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (encoded) =>
      JSON.parse(`"${encoded}"`),
    );
    if (/&(?:#|[a-z])/i.test(next)) {
      // Keep literal markup as text: only decode entities, never interpret tags.
      next = textContent(parseDocument(next.replaceAll("<", "&lt;"), { decodeEntities: true }));
    }
    if (next === out) return out;
    out = next;
  }
  // An excessively nested encoding is not safe to return to the planner.
  return REDACTED;
}

export function secretRedactor(secrets: ReadonlySet<string>): (text: string) => string {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (!eligible(secret)) continue;
    for (const value of [
      secret,
      secret.trim(),
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("base64url"),
    ]) {
      // Form echoes commonly use '+' for spaces. URLSearchParams also provides
      // the USVString spelling an echo may acquire when serializing Unicode.
      const encoded = new URLSearchParams([["", value]]).toString().slice(1);
      for (const form of [
        value,
        normaliseSecretText(value),
        normaliseSecretText(encoded),
        normaliseSecretText(encoded, true),
      ])
        if (eligible(form)) forms.add(form);
    }
  }
  // Compile once per credential union, rather than once per output value.
  const ordered = [...forms]
    .sort((a, b) => b.length - a.length)
    .map((secret) => ({
      secret,
      boundary:
        Array.from(secret).length >= 8
          ? undefined
          : new RegExp(
              `(?<![\\p{L}\\p{N}])${secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
              "gu",
            ),
    }));
  const replace = (text: string): string => {
    let out = text;
    for (const { secret, boundary } of ordered) {
      if (boundary) out = out.replace(boundary, REDACTED);
      else if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    return out;
  };
  return (text) => {
    if (!ordered.length) return text;
    const decoded = normaliseSecretText(text);
    const out = replace(decoded);
    const form = normaliseSecretText(out, true);
    const maskedForm = replace(form);
    return out !== decoded || maskedForm !== form || form === REDACTED ? maskedForm : replace(text);
  };
}
