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
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(text) || !Number.isFinite(Date.parse(text)))
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
  evidence: { channel: string; provider: string; identifier: string }[];
  workflowPolicy: Settings["workflowPolicy"];
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
  for (const ref of refs) {
    // Only explicit references; an opaque string can be a token, not an unambiguous profile name.
    if (
      !/^op:\/\/[^\s/?#]+\/[^\s/?#]+\/[^\s?#]+$/.test(ref) &&
      !/^profile:[a-z0-9][a-z0-9_-]{0,63}$/.test(ref)
    )
      invalid();
  }
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
      defaultAllowed: actions(p.default_allowed),
      requiresCurrentInstruction: actions(
        p.requires_current_instruction_or_narrow_active_authorization_rule,
      ),
      requiresFreshExplicitInstruction: actions(p.always_requires_fresh_explicit_instruction),
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
        identifier: string(e.identifier),
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
  const rawHandles = [
    ...new Set(
      [
        ...accounts.flatMap((a) => a.handles),
        ...snapshot.evidence.map((e) => e.identifier),
        ...snapshot.notes.flatMap(
          (note) => note.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [],
        ),
      ].map(normaliseHandle),
    ),
  ];
  const safe = (value: string) =>
    rawHandles.some((h) => value.toLowerCase().includes(h)) || /@|op:\/\//i.test(value)
      ? "redacted"
      : value;
  const settings: Settings = {
    version: 1,
    connections: accounts.map((a): Account => {
      const hashes = [...new Set(a.handles.map((h) => hashHandle(h, salt)))].sort();
      const conflicts: Account["identityConflicts"] = [];
      const provider =
        a.channel === "email" && /^(odi|open[ _-]data[ _-]institute)$/i.test(a.organisation)
          ? "google_workspace"
          : a.provider;
      for (const note of snapshot.notes) {
        if (!/versus|contradict|conflict/i.test(note)) continue;
        const mentioned = rawHandles.filter((h) => note.toLowerCase().includes(h));
        if (mentioned.some((h) => a.handles.some((own) => normaliseHandle(own) === h)))
          conflicts.push({
            kind: "identity-mismatch",
            handleHashes: mentioned.map((h) => hashHandle(h, salt)).sort(),
          });
      }
      for (const e of snapshot.evidence) {
        if (
          e.channel === a.channel &&
          a.handles.some((h) => normaliseHandle(h) === normaliseHandle(e.identifier)) &&
          e.provider !== provider
        )
          conflicts.push({
            kind: "provider-mismatch",
            handleHashes: [hashHandle(e.identifier, salt)],
          });
      }
      for (const ref of a.refs)
        if (rawHandles.some((h) => ref.toLowerCase().includes(h)))
          throw new Error("Credential reference contains a private identifier");
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
        inventory: {
          setupStatus: safe(a.setupStatus),
          ...(snapshot.observedAt ? { observedAt: snapshot.observedAt } : {}),
          ...(a.lastTested ? { lastTested: a.lastTested } : {}),
        },
      };
    }),
    workflowPolicy: snapshot.workflowPolicy
      ? {
          defaultAllowed: snapshot.workflowPolicy.defaultAllowed.map(safe),
          requiresCurrentInstruction: snapshot.workflowPolicy.requiresCurrentInstruction.map(safe),
          requiresFreshExplicitInstruction:
            snapshot.workflowPolicy.requiresFreshExplicitInstruction.map(safe),
        }
      : null,
  };
  return settings;
}
