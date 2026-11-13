// AUTHORED-BY Codex GPT-6
/** A vocabulary types values, not field names guessed to contain prose (UNS-8..13). */
import { isIri } from "../core/canonical.js";

export interface ContentType {
  readonly type: "identifier" | "code" | "number" | "date" | "term";
  /** Closed values for codes and defined terms. */
  readonly values?: readonly (string | number | boolean)[];
  readonly claimType?: string;
}
export type ContentVocabulary = Readonly<Record<string, ContentType>>;

/** Paths are relative to the body; * matches exactly one object member or array index. */
export function freeStrings(
  value: unknown,
  vocabulary: ContentVocabulary = {},
): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const visit = (v: unknown, path: string) => {
    if (typeof v === "string") {
      const declaration = Object.entries(vocabulary).find(([pattern]) => {
        const a = pattern.split(".");
        const b = path.split(".");
        return a.length === b.length && a.every((p, i) => p === "*" || p === b[i]);
      })?.[1];
      const structured =
        declaration &&
        ((declaration.type === "identifier" && isIri(v)) ||
          (declaration.type === "date" &&
            /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) &&
            Number.isFinite(Date.parse(v))) ||
          ((declaration.type === "code" || declaration.type === "term") &&
            declaration.values?.includes(v)));
      // A string that looks numeric is still text. A number is a JSON number.
      if (!structured && v.length > 0) out.push({ path, text: v });
    } else if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) visit(child, path ? `${path}.${k}` : k);
    }
  };
  visit(value, "");
  return out;
}

export const CORE_CONTENT_VOCABULARY: ContentVocabulary = {
  "operation.id": { type: "identifier" },
  "operation.version": { type: "code", values: ["0.1", "0.2", "1"] },
  termsDigest: { type: "identifier" },
  purpose: { type: "identifier" },
  ref: { type: "identifier" },
  activity: { type: "identifier" },
  proposal: { type: "identifier" },
  agreement: { type: "identifier" },
  counters: { type: "identifier" },
  "challenge.id": { type: "identifier" },
  "challenge.nonce": { type: "identifier" },
  "needs.id": { type: "identifier" },
  "needs.nonce": { type: "identifier" },
  "needs.expiresAt": { type: "date" },
  "needs.approval": { type: "identifier" },
  "basis.kind": {
    type: "code",
    values: ["public", "represented", "agreement", "grant", "invocation"],
  },
  "basis.agreement": { type: "identifier" },
  "basis.grant": { type: "identifier" },
  "basis.invocation": { type: "identifier" },
  outcome: { type: "code", values: ["completed", "not-executed", "uncertain"] },
};

/** Classify the data-bearing portion of a message from declared vocabulary, not core flags. */
export function dataClaims(
  value: unknown,
  vocabulary: ContentVocabulary,
  prefix = "",
): { claims: string[]; unknown: boolean } {
  const claims = new Set<string>();
  let unknown = false;
  const visit = (v: unknown, path: string) => {
    if (v && typeof v === "object") {
      for (const [key, child] of Object.entries(v)) visit(child, path ? `${path}.${key}` : key);
      return;
    }
    if (v === null) return;
    const declaration = Object.entries(vocabulary).find(([pattern]) => {
      const a = pattern.split(".");
      const b = path.split(".");
      return a.length === b.length && a.every((p, i) => p === "*" || p === b[i]);
    })?.[1];
    if (!declaration) {
      unknown = true;
      return;
    }
    if (declaration.claimType) claims.add(declaration.claimType);
  };
  visit(value, prefix);
  return { claims: [...claims], unknown };
}
