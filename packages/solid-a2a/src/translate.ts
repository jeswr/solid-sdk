// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// NL → RDF intent translation. parseIntent first tries a DETERMINISTIC rule/
// template path (no model, no network — covers the common verbs); only if that
// cannot classify the input AND the consumer injected a `translate` fn does it
// fall back to that seam. The package itself NEVER calls a model and makes NO
// network call — the injected fn is the only translator. Ordinary "couldn't
// parse" returns an unresolved IntentResult (never a throw).

import { intentToRdf } from "./intent.js";
import type {
  Intent,
  IntentParameter,
  IntentResult,
  StructuredIntentDraft,
  TranslateFn,
} from "./types.js";
import {
  ACL_MODE_IRI,
  type AclMode,
  type IntentAction,
  VALID_ACL_MODE_IRIS,
  VALID_INTENT_ACTIONS,
} from "./vocab.js";

/** Options for {@link parseIntent}. */
export interface ParseIntentOptions {
  /**
   * The INJECTED translation seam — the consumer's own LLM. Called ONLY when the
   * deterministic path fails to classify the input. The package never calls a
   * model itself; this fn is the only translator. See {@link TranslateFn}.
   */
  readonly translate?: TranslateFn;
  /**
   * Base IRI under which to mint the intent node's IRI (e.g. the pod / agent
   * origin). Defaults to `urn:a2a:intent:` so an intent always has a stable id
   * even with no base supplied.
   */
  readonly baseIRI?: string;
  /**
   * A vocabulary hint passed through to the injected {@link TranslateFn} (the
   * package does not interpret it). Optional.
   */
  readonly vocabularyHint?: string;
  /**
   * The SHACL request shape (Turtle) passed through to the injected
   * {@link TranslateFn} so the model can target it. Optional.
   */
  readonly shape?: string;
}

/** The default base under which intent node IRIs are minted. */
const DEFAULT_BASE = "urn:a2a:intent:" as const;

/**
 * Parse a natural-language request into a structured RDF intent.
 *
 * 1. Try the deterministic rule/template path (the common verbs — no model).
 * 2. If it cannot classify AND `options.translate` is supplied, call that seam
 *    and LOWER its structured draft to RDF.
 * 3. Otherwise return an UNRESOLVED result (not a throw) — ordinary "couldn't
 *    parse" is a normal outcome.
 *
 * @param nl - the natural-language request.
 */
export async function parseIntent(
  nl: string,
  options: ParseIntentOptions = {},
): Promise<IntentResult> {
  if (typeof nl !== "string") {
    throw new TypeError("parseIntent: nl must be a string.");
  }
  const base = options.baseIRI ?? DEFAULT_BASE;

  // 1. Deterministic path.
  const draft = classifyDeterministic(nl);
  if (draft !== undefined) {
    const intent = lowerDraft(draft, base, nl);
    return {
      resolved: true,
      source: "deterministic",
      intent,
      quads: intentToRdf(intent),
      nl,
    };
  }

  // 2. Injected-translate fallback (only when deterministic failed).
  if (options.translate) {
    const translated = await options.translate({
      nl,
      ...(options.vocabularyHint !== undefined && { vocabularyHint: options.vocabularyHint }),
      ...(options.shape !== undefined && { shape: options.shape }),
    });
    if (translated && isValidDraft(translated)) {
      const intent = lowerDraft(translated, base, nl);
      return {
        resolved: true,
        source: "translated",
        intent,
        quads: intentToRdf(intent),
        nl,
      };
    }
    return {
      resolved: false,
      quads: [],
      nl,
      reason: translated
        ? "the injected translate function returned an invalid draft (unknown action or malformed fields)."
        : "the injected translate function could not resolve the input.",
    };
  }

  // 3. Unresolved (no model wired).
  return {
    resolved: false,
    quads: [],
    nl,
    reason: "no deterministic verb matched and no translate function was supplied.",
  };
}

/**
 * The deterministic verb classifier. Maps the common intent verbs (+ synonyms,
 * case-insensitive) to a structured draft, extracting an IRI target, grant
 * recipient/modes and simple `key=value` parameters from the text. Returns
 * `undefined` when no verb matches (→ the injected-translate fallback).
 */
export function classifyDeterministic(nl: string): StructuredIntentDraft | undefined {
  const text = nl.trim();
  if (text.length === 0) {
    return undefined;
  }
  const action = matchVerb(text);
  if (action === undefined) {
    return undefined;
  }

  const target = extractIri(text);
  const parameters = extractParameters(text);
  const draft: {
    action: IntentAction;
    target?: string;
    parameters?: IntentParameter[];
    recipient?: string;
    modes?: AclMode[];
  } = { action };
  if (target !== undefined) {
    draft.target = target;
  }
  if (parameters.length > 0) {
    draft.parameters = parameters;
  }

  if (action === "grant") {
    const recipient = extractRecipient(text, target);
    if (recipient !== undefined) {
      draft.recipient = recipient;
    }
    const modes = extractModes(text);
    if (modes.length > 0) {
      draft.modes = modes;
    }
  }

  return draft;
}

/**
 * The verb → action synonym table. Order matters only for documentation; the
 * matcher checks each action's synonyms and returns the first whose word appears.
 */
const VERB_SYNONYMS: Readonly<Record<IntentAction, readonly string[]>> = {
  // `grant`/`share`/`list`/`subscribe`/`query` are checked BEFORE the generic
  // read/write verbs by the ordering in matchVerb (a "share read access" phrase
  // is a grant, not a read).
  grant: [
    "grant",
    "share",
    "give access",
    "give-access",
    "give access to",
    "authorize",
    "authorise",
  ],
  subscribe: ["subscribe", "watch", "notify me", "notify", "listen for"],
  list: ["list", "enumerate", "show all", "show contents", "browse"],
  query: ["query", "search", "find", "look up", "lookup"],
  append: ["append", "add to", "log", "post to"],
  update: ["update", "modify", "change", "edit", "patch", "replace"],
  delete: ["delete", "remove", "erase", "destroy"],
  create: ["create", "write", "put", "add", "upload", "store", "save"],
  read: ["read", "get", "fetch", "retrieve", "view", "open", "download"],
};

/**
 * The order verbs are tested in. More specific intents (grant/subscribe/list/
 * query/append) come BEFORE the generic read/create/update/delete so a compound
 * phrase ("share read access", "add to the log") classifies as the specific
 * intent rather than the generic verb it contains.
 */
const VERB_ORDER: readonly IntentAction[] = [
  "grant",
  "subscribe",
  "list",
  "query",
  "append",
  "update",
  "delete",
  "create",
  "read",
];

/** Match the first verb (in priority order) whose synonym appears in the text. */
function matchVerb(text: string): IntentAction | undefined {
  const lower = ` ${text.toLowerCase()} `;
  for (const action of VERB_ORDER) {
    for (const syn of VERB_SYNONYMS[action]) {
      // Word-ish boundary match: the synonym must be surrounded by a non-letter
      // (so "read" does not match inside "ready"). Multi-word synonyms match as a
      // substring with surrounding boundaries.
      const needle = ` ${syn} `;
      if (lower.includes(needle)) {
        return action;
      }
      // Also allow the verb at the very start ("Read the file") / followed by
      // punctuation — covered by the leading/trailing spaces we padded with, plus
      // a check for "<verb> " at string start and " <verb>" at string end.
      if (lower.startsWith(` ${syn} `) || boundaryHit(lower, syn)) {
        return action;
      }
    }
  }
  return undefined;
}

/** True if `syn` appears bounded by non-letter chars anywhere in `lower`. */
function boundaryHit(lower: string, syn: string): boolean {
  let from = 0;
  while (true) {
    const idx = lower.indexOf(syn, from);
    if (idx === -1) {
      return false;
    }
    const before = lower[idx - 1];
    const after = lower[idx + syn.length];
    const beforeOk = before === undefined || !/[a-z]/.test(before);
    const afterOk = after === undefined || !/[a-z]/.test(after);
    if (beforeOk && afterOk) {
      return true;
    }
    from = idx + 1;
  }
}

/** The first http(s) IRI in the text, or `undefined`. The intent target. */
function extractIri(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s<>"'`]+/);
  if (!match) {
    return undefined;
  }
  // Trim a single trailing sentence-punctuation char a URL rarely ends on.
  return match[0].replace(/[.,;:!?)]+$/, "");
}

/** All http(s) IRIs in the text (in order). */
function allIris(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s<>"'`]+/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    out.push(m[0].replace(/[.,;:!?)]+$/, ""));
    m = re.exec(text);
  }
  return out;
}

/**
 * The grant recipient — the agent being granted access (distinct from the target
 * resource). Resolution order:
 *   1. An explicit recipient marker (`with` / `recipient:` / `recipient=`), whose
 *      captured IRI is the recipient (a "share X with Y" phrase).
 *   2. A `to <iri>` whose IRI is NOT the target (covers "grant access to Y").
 *   3. The first IRI in the text that is distinct from the target (first IRI is
 *      the resource, the next is the recipient).
 * Returns `undefined` if no IRI distinguishable from the target is present.
 */
function extractRecipient(text: string, target: string | undefined): string | undefined {
  // 1. `with` / `recipient` markers are unambiguous recipient markers.
  const withMarker = text.match(/\b(?:with|recipient[:=])\s*(https?:\/\/[^\s<>"'`]+)/i);
  if (withMarker?.[1]) {
    const iri = withMarker[1].replace(/[.,;:!?)]+$/, "");
    if (iri !== target) {
      return iri;
    }
  }
  // 2. A `to <iri>` marker, only when it points at something other than the target
  //    (in "share access to <resource> with <recipient>" the `to` points at the
  //    resource, so we skip it; in "grant access to <recipient>" it is the
  //    recipient).
  const toMarker = text.match(/\bto\s*(https?:\/\/[^\s<>"'`]+)/i);
  if (toMarker?.[1]) {
    const iri = toMarker[1].replace(/[.,;:!?)]+$/, "");
    if (iri !== target) {
      return iri;
    }
  }
  // 3. The first IRI distinct from the target.
  return allIris(text).find((i) => i !== target);
}

/** The ACL modes mentioned in a grant phrase (`read`, `write`, `append`, `control`). */
function extractModes(text: string): AclMode[] {
  const lower = text.toLowerCase();
  const out: AclMode[] = [];
  const tests: Array<[AclMode, RegExp]> = [
    ["Read", /\bread\b/],
    ["Write", /\bwrite\b/],
    ["Append", /\bappend\b/],
    ["Control", /\bcontrol\b/],
  ];
  for (const [mode, re] of tests) {
    if (re.test(lower) && VALID_ACL_MODE_IRIS.has(ACL_MODE_IRI[mode])) {
      out.push(mode);
    }
  }
  return out;
}

/** Extract simple `key=value` / `key: value` parameters from the text. */
function extractParameters(text: string): IntentParameter[] {
  const out: IntentParameter[] = [];
  const seen = new Set<string>();
  // Match key=value or key:value where value is a non-space token (and not the
  // scheme of a URL — guard against `https://`). Keys are word chars.
  const re = /\b([a-zA-Z][\w-]*)\s*[:=]\s*("[^"]*"|[^\s,]+)/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const key = m[1];
    let value = m[2] ?? "";
    // Skip a URL scheme captured as key:value (e.g. `https`:`//…`).
    const isScheme = value.startsWith("//");
    if (key !== undefined && !isScheme && !seen.has(key)) {
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      seen.add(key);
      out.push({ key, value });
    }
    m = re.exec(text);
  }
  return out;
}

/** Lower a {@link StructuredIntentDraft} to a full {@link Intent} with a minted id. */
function lowerDraft(draft: StructuredIntentDraft, base: string, nl: string): Intent {
  return {
    id: mintIntentId(base, nl),
    action: draft.action,
    ...(draft.target !== undefined && { target: draft.target }),
    ...(draft.parameters && draft.parameters.length > 0 && { parameters: [...draft.parameters] }),
    ...(draft.recipient !== undefined && { recipient: draft.recipient }),
    ...(draft.modes && draft.modes.length > 0 && { modes: [...draft.modes] }),
    ...(draft.agent !== undefined && { agent: draft.agent }),
  };
}

/**
 * Mint a stable, deterministic intent node IRI under `base` from the NL. Uses a
 * short, URL-safe digest of the NL so the same request maps to the same id
 * (deterministic round-trip), without baking the raw text into the IRI. A `urn:`
 * base yields `urn:a2a:intent:<digest>`; an http base yields `<base>#<digest>`.
 */
function mintIntentId(base: string, nl: string): string {
  const digest = shortHash(nl);
  if (base.startsWith("urn:")) {
    return `${base}${digest}`;
  }
  // For an http(s)/path base, append as a fragment (idempotent if base ends with
  // a slash or a fragment marker already).
  if (base.includes("#")) {
    return `${base}${digest}`;
  }
  return `${base}#intent-${digest}`;
}

/**
 * A short, deterministic, URL-safe digest of a string (FNV-1a 32-bit → base36).
 * Not cryptographic — it only needs to be stable + collision-rare for minting an
 * intent node id. (Content-addressing of a Protocol Document uses sha256; see
 * protocol.ts. This is a cheap node-id mint, not a security primitive.)
 */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * An OPTIONAL string field on a draft is valid iff it is absent OR a non-empty
 * string. A present-but-non-string (or empty) value is malformed model output and
 * must be rejected (→ an unresolved result), never lowered to invalid RDF. Used
 * for EVERY optional string field on the draft (`target`, `recipient`, `agent`).
 */
function optionalStringOk(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

/**
 * Validate a draft from the injected translate fn before lowering it. Defensive:
 * the draft is untrusted model output, so EVERY field is type-checked — every
 * optional string field (`target`/`recipient`/`agent`) must be a non-empty string
 * when present, and modes are checked against an OWN-KEY allowlist (NOT the `in`
 * operator, which walks the prototype chain and would accept inherited keys like
 * `toString`/`constructor`). Any malformed field → `false` (the caller returns the
 * unresolved result the API promises; it never throws or builds invalid RDF).
 */
function isValidDraft(draft: StructuredIntentDraft): boolean {
  if (typeof draft !== "object" || draft === null) {
    return false;
  }
  if (typeof draft.action !== "string" || !VALID_INTENT_ACTIONS.has(draft.action)) {
    return false;
  }
  // Every optional string field must be a non-empty string when present.
  if (!optionalStringOk(draft.target)) {
    return false;
  }
  if (!optionalStringOk(draft.recipient)) {
    return false;
  }
  if (!optionalStringOk(draft.agent)) {
    return false;
  }
  if (draft.parameters !== undefined) {
    if (!Array.isArray(draft.parameters)) {
      return false;
    }
    for (const p of draft.parameters) {
      if (typeof p?.key !== "string" || typeof p?.value !== "string") {
        return false;
      }
    }
  }
  if (draft.modes !== undefined) {
    if (!Array.isArray(draft.modes)) {
      return false;
    }
    for (const m of draft.modes) {
      // OWN-KEY allowlist via Object.hasOwn — NOT `m in ACL_MODE_IRI`, which would
      // accept inherited prototype keys (`toString`, `constructor`, …). A mode must
      // be a string that is an own key of the closed ACL_MODE_IRI map.
      if (typeof m !== "string" || !Object.hasOwn(ACL_MODE_IRI, m)) {
        return false;
      }
    }
  }
  return true;
}
