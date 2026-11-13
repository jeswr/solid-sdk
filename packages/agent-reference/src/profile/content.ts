// AUTHORED-BY Codex GPT-6
/** A vocabulary types values, not field names guessed to contain prose (UNS-8..13). */

import type { z } from "zod";
import { isIri } from "../core/canonical.js";
import { REASON_CODES } from "../core/types.js";

export interface ContentType {
  readonly type: "identifier" | "code" | "number" | "date" | "term";
  /** Closed values for codes and defined terms. */
  readonly values?: readonly (string | number | boolean)[];
  readonly claimType?: string;
}
export type ContentVocabulary = Readonly<Record<string, ContentType>>;

/** Trusted domain configuration, installed with a handler rather than supplied by a proposal. */
export interface ContentProfile {
  readonly vocabulary: ContentVocabulary;
  readonly purposes?: Readonly<Record<string, readonly string[]>>;
  readonly identifiers?: readonly string[];
  readonly reliance?: import("../gates/common.js").RelianceProfile;
  /** A compound defined term: verified JWS, strict schema, and vocabulary for its claims. */
  readonly protectedTerms?: Readonly<
    Record<
      string,
      {
        readonly typ: string;
        readonly role: import("../mechanisms/trust.js").KeyRole;
        readonly schema: z.ZodType;
        readonly vocabulary: ContentVocabulary;
      }
    >
  >;
}

export interface KnownContent {
  readonly identifiers: ReadonlySet<string>;
  readonly terms?: ReadonlySet<string>;
}

/** Collect values already received/installed; never call on a proposed outgoing body. */
export function identifiersIn(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string" && isIri(item)) found.add(item);
    else if (item && typeof item === "object")
      for (const [key, child] of Object.entries(item)) {
        if (isIri(key)) found.add(key);
        visit(child);
      }
  };
  visit(value);
  return [...found];
}

function declarationAt(vocabulary: ContentVocabulary, path: string): ContentType | undefined {
  if (Object.hasOwn(vocabulary, path)) return vocabulary[path];
  return Object.entries(vocabulary)
    .filter(([pattern]) => {
      const a = pattern.split(".");
      const b = path.split(".");
      return a.length === b.length && a.every((p, i) => p === "*" || p === b[i]);
    })
    .sort(([a], [b]) => a.split("*").length - b.split("*").length)[0]?.[1];
}
function typed(
  value: unknown,
  declaration: ContentType | undefined,
  known?: KnownContent,
): boolean {
  if (!declaration) return false;
  if (typeof value === "number") return declaration.type === "number" && Number.isFinite(value);
  if (
    (declaration.type === "code" || declaration.type === "term") &&
    (typeof value === "string" || typeof value === "boolean")
  )
    return (
      declaration.values?.includes(value) === true ||
      (declaration.type === "term" &&
        declaration.values === undefined &&
        typeof value === "string" &&
        known?.terms?.has(value) === true)
    );
  if (typeof value !== "string") return false;
  if (declaration.type === "identifier")
    return isIri(value) && known?.identifiers.has(value) === true;
  if (declaration.type === "date") {
    const day = value.slice(0, 10);
    const dayTime = Date.parse(`${day}T00:00:00Z`);
    return (
      /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      Number.isFinite(dayTime) &&
      new Date(dayTime).toISOString().slice(0, 10) === day
    );
  }
  return false;
}
const segment = (key: string) =>
  key.replaceAll("~", "~0").replaceAll(".", "~1").replaceAll("*", "~2");

/** Paths are relative to the body; * matches one member/index. Literal dots use ~1. */
export function freeStrings(
  value: unknown,
  vocabulary: ContentVocabulary = {},
  known?: KnownContent,
): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const visit = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (!typed(v, declarationAt(vocabulary, path), known)) out.push({ path, text: v });
    } else if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v))
        visit(child, path ? `${path}.${segment(k)}` : segment(k));
    }
  };
  visit(value, "");
  return out;
}

/** Public parameter names are fixed too: unknown keys and open scalars can encode task data. */
export function hasOpenPublicData(value: unknown, vocabulary: ContentVocabulary): boolean {
  const paths = Object.keys(vocabulary).map((path) => path.split("."));
  const visit = (item: unknown, parts: string[], arrays: boolean[]): boolean => {
    const declaration = declarationAt(vocabulary, parts.join("."));
    if (typeof item === "number" || (typeof item === "string" && declaration?.type === "date"))
      return declaration?.values?.includes(item) !== true;
    if (!item || typeof item !== "object") return false;
    return Object.entries(item).some(([key, child]) => {
      const next = [...parts, segment(key)];
      const flags = [...arrays, Array.isArray(item)];
      const named = paths.some(
        (pattern) =>
          pattern.length >= next.length &&
          next.every((part, i) => pattern[i] === part || (pattern[i] === "*" && flags[i])),
      );
      const emptyInput =
        next.length === 1 &&
        key === "input" &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child) &&
        Object.keys(child).length === 0;
      return (!named && !emptyInput) || visit(child, next, flags);
    });
  };
  return visit(value, [], []);
}

export const CORE_CONTENT_VOCABULARY: ContentVocabulary = {
  "operation.id": { type: "identifier" },
  "operation.version": { type: "code", values: ["0.1", "0.2", "1"] },
  reason: { type: "code", values: REASON_CODES },
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
  known?: KnownContent,
): { claims: string[]; unknown: boolean } {
  const claims = new Set<string>();
  let unknown = false;
  const visit = (v: unknown, path: string) => {
    if (v && typeof v === "object") {
      for (const [key, child] of Object.entries(v))
        visit(child, path ? `${path}.${segment(key)}` : segment(key));
      return;
    }
    if (v === null) return;
    const declaration = declarationAt(vocabulary, path);
    if (!typed(v, declaration, known)) {
      unknown = true;
      return;
    }
    if (declaration?.claimType) claims.add(declaration.claimType);
  };
  visit(value, prefix);
  return { claims: [...claims], unknown };
}

/** Model-authored readings remain free text even when transported inside a signed credential. */
export function freeMessageStrings(
  message: import("../core/types.js").AnyMessage,
  vocabulary: ContentVocabulary = {},
  known?: KnownContent,
): { path: string; text: string }[] {
  const found = freeStrings(message.body, { ...CORE_CONTENT_VOCABULARY, ...vocabulary }, known);
  for (const [index, evidence] of (message.evidence ?? []).entries()) {
    if (evidence.role !== "credential" || evidence.format !== "jws-compact") continue;
    try {
      const claim = JSON.parse(
        Buffer.from(evidence.value.split(".")[1] ?? "", "base64url").toString(),
      );
      if (claim.issuer !== message.from.actor || claim.method !== "model-output") continue;
      const readingVocabulary = Object.fromEntries(
        Object.entries(vocabulary)
          .filter(([path]) => path.startsWith("reading."))
          .map(([path, type]) => [path.slice(8), type]),
      );
      found.push(
        ...freeStrings(claim.value, readingVocabulary, known).map((item) => ({
          path: `evidence.${index}.value${item.path ? `.${item.path}` : ""}`,
          text: item.text,
        })),
      );
    } catch {
      /* Integrity checks reject unreadable credentials before release. */
    }
  }
  return found;
}
