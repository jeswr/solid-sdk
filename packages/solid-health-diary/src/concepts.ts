// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Coded-value CODECS — the bijection between a friendly TypeScript token and the
 * canonical `diet:` **concept IRI** it is stored as.
 *
 * The landed `diet:` vocab (`solid-federation-vocab` @ Brief 1B) models the
 * enum-valued properties (`context`, `exposureLevel`, `phase`, `verdict`,
 * `confidence`, `sourceConfidence`, `portion`, `symptomType`, `trigger`) as
 * **object properties over SKOS concept IRIs**, not string literals. Each concept
 * also carries a `skos:notation` — the plain token the app UI uses. So this
 * package exposes the friendly token (the ergonomic DX) on its typed accessors
 * while STORING the concept IRI on the wire (the federation contract). This module
 * is the single reviewed home for that mapping, kept in lock-step with the vocab.
 *
 * Where the token and the concept's IRI local name differ, it is noted inline:
 * the multi-word tokens (`possible-undeclared`, `dose-dependent`, the kebab
 * symptom types) are the vocab's `skos:notation`, while the IRI local name is the
 * camelCase concept id (`possibleUndeclared`, `doseDependent`, `abdominalPain`, …).
 *
 * Pure, no platform, no RDF — client-safe.
 */

import { DIET } from "./vocab.js";

/** A friendly-token ⇄ concept-IRI codec for one coded-value scheme. */
export interface Codec<T extends string> {
  /** The concept IRI (`diet:{localName}`) for a friendly token. */
  toIri(token: T): string;
  /** The friendly token for a concept IRI, or `undefined` if it is not in the scheme. */
  fromIri(iri: string | undefined): T | undefined;
  /** Narrowing guard: is `s` one of the scheme's friendly tokens? */
  isToken(s: string): s is T;
  /** The friendly tokens, in declaration order. */
  readonly tokens: readonly T[];
}

/**
 * Build a codec from `[token, iriLocalName]` pairs. When the token equals the IRI
 * local name (the common case), pass a bare string — it is used for both.
 */
function makeCodec<T extends string>(pairs: readonly (readonly [T, string])[]): Codec<T> {
  const tokenToLocal = new Map<string, string>(pairs.map(([t, l]) => [t, l]));
  const localToToken = new Map<string, T>(pairs.map(([t, l]) => [l, t]));
  const tokens = pairs.map(([t]) => t) as readonly T[];
  return {
    toIri(token) {
      const local = tokenToLocal.get(token);
      if (local === undefined) {
        throw new Error(`unknown coded-value token: ${token}`);
      }
      return `${DIET}${local}`;
    },
    fromIri(iri) {
      if (!iri?.startsWith(DIET)) return undefined;
      return localToToken.get(iri.slice(DIET.length));
    },
    isToken(s): s is T {
      return tokenToLocal.has(s);
    },
    tokens,
  };
}

/** `token === IRI local name` pairs. */
function ident<T extends string>(...tokens: readonly T[]): readonly (readonly [T, string])[] {
  return tokens.map((t) => [t, t] as const);
}

// --- The nine coded schemes (mirrors diet.ttl §4/§5/§6) ----------------------

/** `diet:MealContext` — home/restaurant/work/travel/other. */
export const contextCodec = makeCodec(ident("home", "restaurant", "work", "travel", "other"));

/** `diet:ExposureLevel` — token `possible-undeclared` ⇄ IRI `diet:possibleUndeclared`. */
export const exposureLevelCodec = makeCodec([
  ["present", "present"],
  ["trace", "trace"],
  ["possible-undeclared", "possibleUndeclared"],
  ["absent", "absent"],
] as const);

/** `diet:ProtocolPhase`. */
export const phaseCodec = makeCodec(
  ident("baseline", "eliminate", "washout", "reintroduce", "observe", "concluded"),
);

/** `diet:Verdict` — token `dose-dependent` ⇄ IRI `diet:doseDependent`. */
export const verdictCodec = makeCodec([
  ["tolerated", "tolerated"],
  ["reacts", "reacts"],
  ["dose-dependent", "doseDependent"],
  ["inconclusive", "inconclusive"],
] as const);

/** `diet:Confidence` — token `confirmed` ⇄ IRI `diet:confirmedByOwnTest` (§4.2 ordinal). */
export const confidenceCodec = makeCodec([
  ["emerging", "emerging"],
  ["suspected", "suspected"],
  ["likely", "likely"],
  ["confirmed", "confirmedByOwnTest"],
] as const);

/** `diet:SourceConfidence` — manual/off/ocr/voice. */
export const sourceConfidenceCodec = makeCodec(ident("manual", "off", "ocr", "voice"));

/** `diet:Portion` — small/normal/large. */
export const portionCodec = makeCodec(ident("small", "normal", "large"));

/**
 * `diet:SymptomType` — the friendly token is the vocab's `skos:notation` (kebab),
 * the IRI local name is the camelCase concept id.
 */
export const symptomTypeCodec = makeCodec([
  ["bloating", "bloating"],
  ["diarrhoea", "diarrhoea"],
  ["constipation", "constipation"],
  ["abdominal-pain", "abdominalPain"],
  ["brain-fog", "brainFog"],
  ["headache", "headache"],
  ["fatigue", "fatigue"],
  ["skin-rash", "skinRash"],
  ["wheeze-breathing", "wheezeBreathing"],
  ["anaphylaxis", "anaphylaxis"],
  ["nausea", "nausea"],
  ["reflux", "reflux"],
  ["joint-pain", "jointPain"],
  ["mood", "mood"],
] as const);
