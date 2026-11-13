// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { textContent } from "domutils";
import { parseDocument } from "htmlparser2";

const REDACTED = "[redacted]";
const MIN_SECRET_LENGTH = 8;
const eligible = (value: string): boolean =>
  value.trim().length > 0 && Array.from(value).length >= MIN_SECRET_LENGTH;

// Echoes can nest percent, JSON and HTML encodings. Decode them before matching,
// including mixed percent encodings and malformed triplets next to valid ones.
function normalise(text: string): string {
  let out = text;
  for (let i = 0; i < 32; i++) {
    let next = out.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run.replace(/%([0-7][0-9a-f])/gi, (_m, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      }
    });
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
    for (const value of [secret, secret.trim()]) {
      // Form echoes commonly use '+' for spaces. URLSearchParams also provides
      // the USVString spelling an echo may acquire when serializing Unicode.
      const encoded = new URLSearchParams([["", value]]).toString().slice(1);
      for (const form of [value, normalise(value), normalise(encoded)])
        if (eligible(form)) forms.add(form);
    }
  }
  const ordered = [...forms].sort((a, b) => b.length - a.length);
  const replace = (text: string): string => {
    let out = text;
    for (const secret of ordered) {
      out = out.split(secret).join(REDACTED);
    }
    return out;
  };
  return (text) => {
    if (!ordered.length) return text;
    const decoded = normalise(text);
    const out = replace(decoded);
    // A long source spelling can decode to a short value, which is deliberately
    // ineligible. Still protect the original source without matching that short value.
    return out === decoded && decoded !== REDACTED ? replace(text) : out;
  };
}
