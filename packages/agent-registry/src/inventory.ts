// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseDocument } from "yaml";
import { type Account, type BindingState, DENY_ALL, type Settings } from "./model.js";
import { accountId, hashHandle, normaliseHandle } from "./privacy.js";

/** Maximum local registry size, including ignored prose. */
export const MAX_REGISTRY_BYTES = 1_048_576;
type Row = Record<string, unknown>;
const invalid = (): never => {
  throw new Error("Invalid registry schema");
};
function object(value: unknown): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Row;
}
function keys(value: Row, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function string(value: unknown, max = 200): string {
  if (typeof value !== "string" || value.length > max || /[\p{Cc}]/u.test(value)) return invalid();
  return value;
}
function strings(value: unknown, max = 20): string[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value.map((item) => string(item, 500));
}
function token(value: unknown): string {
  const text = string(value, 80);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(text)) return invalid();
  return text;
}
function date(value: unknown): string {
  const text = string(value, 64);
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(text) ||
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString().slice(0, 10) !== text.slice(0, 10)
  )
    return invalid();
  return text;
}
/** Placeholder identifiers are not identities and must not become handle hashes. */
export function isPlaceholder(value: string): boolean {
  return value.trim() === "" || value.startsWith("to_");
}
interface RegistryAccount {
  id: string;
  channel: string;
  provider: string;
  organisation: string;
  handles: string[];
  refs: string[];
  setupStatus: string;
  lastTested?: string;
}
/** Validated daemon-local input. Raw identifiers never belong in pod settings. */
export interface RegistrySnapshot {
  accounts: RegistryAccount[];
  notes: string[];
  observedAt?: string;
  evidence: {
    channel: string;
    provider: string;
    identifier: string;
    method: string;
    observedOn: string;
  }[];
  workflowPolicy: Settings["workflowPolicy"];
}
function credentialReference(value: unknown): string {
  const ref = string(value, 500);
  // Opaque strings may be tokens. Accept only explicit, unresolved references.
  if (
    !/^op:\/\/[^\s/?#]+\/[^\s/?#]+\/[^\s?#]+$/.test(ref) &&
    !/^profile:[a-z0-9][a-z0-9_-]{0,63}$/.test(ref)
  )
    invalid();
  try {
    // Inspect decoded components without resolving or rewriting the emitted reference.
    return ref
      .split("/")
      .map((component) => string(decodeURIComponent(component), 500))
      .join("/");
  } catch {
    return invalid();
  }
}
function account(value: unknown): RegistryAccount {
  const a = object(value);
  keys(a, [
    "id",
    "channel",
    "provider",
    "label",
    "identifiers",
    "organization",
    "connector",
    "credential_ref",
  ]);
  const id = string(a.id, 64);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return invalid();
  if (a.label !== undefined) string(a.label, 120); // Private prose is validated, never copied.
  const ids = object(a.identifiers);
  if (Object.keys(ids).length > 10) return invalid();
  const handles = Object.values(ids)
    .flatMap((v) => (Array.isArray(v) ? strings(v, 10) : [string(v)]))
    .filter((v) => !isPlaceholder(v));
  if (handles.length > 20) return invalid();
  const c = object(a.connector);
  keys(c, [
    "target",
    "setup_status",
    "last_tested",
    "last_test_result",
    "available_in_mcp",
    "credential_ref",
  ]);
  string(c.target, 80);
  if (c.last_test_result !== undefined) string(c.last_test_result, 120);
  if (c.available_in_mcp !== undefined && typeof c.available_in_mcp !== "boolean") return invalid();
  const refs = [a.credential_ref, c.credential_ref]
    .filter((v) => v !== undefined)
    .flatMap((v) => (Array.isArray(v) ? strings(v, 10) : [string(v, 500)]));
  for (const ref of refs) credentialReference(ref);
  return {
    id,
    channel: token(a.channel),
    provider: token(a.provider),
    organisation: string(a.organization, 120),
    handles,
    refs,
    setupStatus: token(c.setup_status),
    ...(c.last_tested === undefined ? {} : { lastTested: date(c.last_tested) }),
  };
}
/** Parse bounded YAML 1.2 without aliases, custom tags, duplicate keys, or leaked parser errors. */
export function parseRegistryYaml(text: string): RegistrySnapshot {
  try {
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_REGISTRY_BYTES)
      invalid();
    const doc = parseDocument(text, { uniqueKeys: true, schema: "core" });
    if (doc.errors.length || doc.warnings.length) invalid();
    return parseSnapshot(doc.toJS({ maxAliasCount: 0 }));
  } catch {
    throw new Error("Invalid registry YAML or schema");
  }
}
/** Validate the registry schema inferred from the pilot's sanitised inventory export. */
export function parseSnapshot(value: unknown): RegistrySnapshot {
  const root = object(value);
  keys(root, [
    "version",
    "source",
    "observedAt",
    "registryUpdated",
    "last_updated",
    "accounts",
    "notes",
    "evidence",
    "communicationRules",
  ]);
  if (root.version !== 1 || !Array.isArray(root.accounts) || root.accounts.length > 199)
    return invalid();
  if (root.source !== undefined) string(root.source, 500);
  if (root.registryUpdated !== undefined) date(root.registryUpdated);
  if (root.last_updated !== undefined) date(root.last_updated);
  const accounts = root.accounts.map(account);
  if (new Set(accounts.map((a) => a.id)).size !== accounts.length) return invalid();
  if (accounts.some((a) => a.id === "telegram-control" && a.channel !== "telegram"))
    return invalid();
  const evidence = root.evidence === undefined ? [] : root.evidence;
  if (!Array.isArray(evidence) || evidence.length > 50) return invalid();
  let workflowPolicy: Settings["workflowPolicy"] = null;
  if (root.communicationRules !== undefined) {
    const rules = object(root.communicationRules);
    keys(rules, ["last_updated", "decision_policy", "capability_policy", "triage_taxonomy"]);
    if (rules.last_updated !== undefined) date(rules.last_updated);
    const decision = object(rules.decision_policy);
    keys(decision, ["ask_when_uncertain_about"]);
    strings(decision.ask_when_uncertain_about);
    const taxonomy = object(rules.triage_taxonomy);
    if (Object.keys(taxonomy).length > 40) invalid();
    for (const entry of Object.values(taxonomy)) string(entry, 300);
    const p = object(rules.capability_policy);
    keys(p, [
      "default_allowed",
      "requires_current_instruction_or_narrow_active_authorization_rule",
      "always_requires_fresh_explicit_instruction",
    ]);
    const actions = (v: unknown) => strings(v).map(token);
    workflowPolicy = {
      askWhenUncertain: strings(decision.ask_when_uncertain_about).map(token),
      defaultAllowed: actions(p.default_allowed),
      requiresCurrentInstruction: actions(
        p.requires_current_instruction_or_narrow_active_authorization_rule,
      ),
      requiresFreshExplicitInstruction: actions(p.always_requires_fresh_explicit_instruction),
      taxonomy: Object.fromEntries(
        Object.entries(taxonomy).map(([key, value]) => [token(key), string(value, 300)]),
      ),
    };
  }
  return {
    accounts,
    notes: root.notes === undefined ? [] : strings(root.notes),
    ...(root.observedAt === undefined ? {} : { observedAt: date(root.observedAt) }),
    evidence: evidence.map((value) => {
      const e = object(value);
      keys(e, ["channel", "provider", "identifier", "method", "source", "observedOn"]);
      string(e.method, 80);
      string(e.source);
      date(e.observedOn);
      return {
        channel: token(e.channel),
        provider: token(e.provider),
        identifier: isPlaceholder(string(e.identifier)) ? invalid() : string(e.identifier),
        method: token(e.method),
        observedOn: date(e.observedOn),
      };
    }),
    workflowPolicy,
  };
}
/** Map setup claims without turning historical inventory access into a live grant. */
export function bindingStateFromSetup(status: string): BindingState {
  if (status === "disabled") return "disabled";
  if (["error", "failed", "auth_error", "identity_conflict"].includes(status)) return "error";
  if (["none", "not_applicable"].includes(status)) return "none";
  return "setup-required";
}
const NOTE_IDENTIFIER_CHARS = "[\\p{L}\\p{M}\\p{N}._@%+:/#=~!$&'*?^`{|}-]";
const NOTE_IDENTIFIERS = new RegExp(
  // Keep phone formatting and any adjacent suffix, so a longer identity cannot match a prefix.
  `['\`]?\\+\\d[\\d ().-]{5,}\\d${NOTE_IDENTIFIER_CHARS}*|${NOTE_IDENTIFIER_CHARS}+`,
  "gu",
);
/** Keep complete phone/handle/URI tokens; strip prose punctuation after a mention. */
function noteIdentifiers(note: string): string[] {
  return (note.normalize("NFC").match(NOTE_IDENTIFIERS) ?? []).map((handle) =>
    handle.replace(/[.:]+$/u, "").replace(/^(['`])(.*)\1$/u, "$2"),
  );
}
/** Discover explicit identities only; Matrix bot MXIDs use the same case-preserving rules. */
function noteIdentityChannel(handle: string): string | undefined {
  if (/^[\p{L}\p{M}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}$/u.test(handle))
    return "email";
  if (/^@[^@\s:]+:[\p{L}\p{N}.-]+(?::\d+)?$/u.test(handle)) return "matrix";
  if (/^\+\d[\d ().-]{5,}\d$/u.test(handle)) return "phone_messages";
  return undefined;
}
/** Build privacy-safe settings, applying only the documented ODI correction and Telegram addition. */
export function inventorySettings(snapshot: RegistrySnapshot, salt: Uint8Array): Settings {
  const accounts = [...snapshot.accounts];
  if (!accounts.some((a) => a.channel === "telegram"))
    accounts.push({
      id: "telegram-control",
      channel: "telegram",
      provider: "telegram_bot",
      organisation: "personal",
      handles: [],
      refs: [],
      setupStatus: "not_configured",
    });
  const notes = snapshot.notes.map((note) => ({ note, identifiers: noteIdentifiers(note) }));
  const identities = [
    ...accounts.flatMap((a) => a.handles.map((handle) => ({ handle, channel: a.channel }))),
    ...snapshot.evidence.map((e) => ({ handle: e.identifier, channel: e.channel })),
    ...notes.flatMap(({ identifiers }) =>
      identifiers.flatMap((handle) => {
        const channel = noteIdentityChannel(handle);
        return channel ? [{ handle, channel }] : [];
      }),
    ),
  ].map(({ handle, channel }) => ({ handle: normaliseHandle(handle, channel), channel }));
  // Redaction deliberately checks case-insensitively, independently of identity matching.
  const rawHandles = [...new Set(identities.map(({ handle }) => normaliseHandle(handle)))];
  const safe = (value: string) =>
    rawHandles.some((h) => normaliseHandle(value).includes(h)) || /@|op:\/\//i.test(value)
      ? "redacted"
      : value;
  const evidenceFor = (e: RegistrySnapshot["evidence"][number]) => ({
    channel: safe(e.channel),
    provider: safe(e.provider),
    handleHash: hashHandle(e.identifier, salt, e.channel),
    method: safe(e.method),
    observedOn: e.observedOn,
  });
  const matches = (a: RegistryAccount, e: RegistrySnapshot["evidence"][number]) =>
    a.channel === e.channel &&
    a.handles.some(
      (h) => normaliseHandle(h, a.channel) === normaliseHandle(e.identifier, e.channel),
    );
  const settings: Settings = {
    version: 1,
    connections: accounts.map((a): Account => {
      const hashes = [...new Set(a.handles.map((h) => hashHandle(h, salt, a.channel)))].sort();
      const conflicts: Account["identityConflicts"] = [];
      const provider =
        a.channel === "email" && /^(odi|open[ _-]data[ _-]institute)$/i.test(a.organisation)
          ? "google_workspace"
          : a.provider;
      for (const { note, identifiers } of notes) {
        if (!/versus|contradict|conflict/i.test(note)) continue;
        const mentioned = identities.filter(({ handle, channel }) =>
          identifiers.some((identifier) => normaliseHandle(identifier, channel) === handle),
        );
        if (
          mentioned.some(
            ({ handle, channel }) =>
              a.channel === channel &&
              a.handles.some((own) => normaliseHandle(own, channel) === handle),
          )
        )
          conflicts.push({
            kind: "identity-mismatch",
            handleHashes: [
              ...new Set(mentioned.map(({ handle, channel }) => hashHandle(handle, salt, channel))),
            ].sort(),
          });
      }
      for (const e of snapshot.evidence) {
        if (matches(a, e) && e.provider !== provider)
          conflicts.push({
            kind: "provider-mismatch",
            handleHashes: [hashHandle(e.identifier, salt, e.channel)],
          });
      }
      for (const ref of a.refs) {
        const decoded = credentialReference(ref);
        // Email, MXID/social handles, identity URIs and international phone numbers
        // are private even when no account, evidence or note has supplied that identity.
        if (
          /@|(?:https?|mailto|tel|did):|\+\d[\d ().-]{5,}\d/i.test(decoded) ||
          rawHandles.some((h) => normaliseHandle(decoded).includes(h))
        )
          throw new Error("Credential reference contains a private identifier");
      }
      return {
        id: accountId(a.id, salt),
        channel: safe(a.channel),
        provider: safe(provider),
        organisation: safe(a.organisation),
        channelHandles: hashes,
        credentialRefs: [...new Set(a.refs)].sort(),
        bindingState: conflicts.length ? "error" : bindingStateFromSetup(a.setupStatus),
        restrictions: { ...DENY_ALL },
        identityConflicts: [...new Map(conflicts.map((c) => [JSON.stringify(c), c])).values()],
        evidence: snapshot.evidence.filter((e) => matches(a, e)).map(evidenceFor),
        inventory: {
          setupStatus: safe(a.setupStatus),
          ...(snapshot.observedAt ? { observedAt: snapshot.observedAt } : {}),
          ...(a.lastTested ? { lastTested: a.lastTested } : {}),
        },
      };
    }),
    unmatchedEvidence: snapshot.evidence
      .filter((e) => !accounts.some((a) => matches(a, e)))
      .map(evidenceFor),
    workflowPolicy: snapshot.workflowPolicy
      ? {
          askWhenUncertain: snapshot.workflowPolicy.askWhenUncertain.map(safe),
          taxonomy: Object.fromEntries(
            Object.entries(snapshot.workflowPolicy.taxonomy).map(([key, value]) => [
              safe(key),
              safe(value),
            ]),
          ),
          defaultAllowed: snapshot.workflowPolicy.defaultAllowed.map(safe),
          requiresCurrentInstruction: snapshot.workflowPolicy.requiresCurrentInstruction.map(safe),
          requiresFreshExplicitInstruction:
            snapshot.workflowPolicy.requiresFreshExplicitInstruction.map(safe),
        }
      : null,
  };
  return settings;
}
