// AUTHORED-BY Codex GPT-6
/** The on-disk contract. Runtime validation and published JSON Schemas share this source. */
import { z } from "zod";
import { CORE_REASON_CODES } from "../core/types.js";
import { INBOUND_CHECKS, OUTBOUND_CHECKS } from "../trace/types.js";

const iri = z.string().regex(/^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]+$/i);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const json = z.json();
const object = z.record(z.string(), json);
const strings = z.array(z.string());
const reason = z.enum(CORE_REASON_CODES);
const check = z.enum([...INBOUND_CHECKS, ...OUTBOUND_CHECKS]);
const ref = z.strictObject({ id: iri, version: z.string() });
const contentType = z.strictObject({
  type: z.enum(["identifier", "code", "number", "date", "term"]),
  values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  claimType: z.string().optional(),
});
const outlineEntry = z.strictObject({
  agent: z.string(),
  part: z.enum([
    "principal",
    "transport",
    "inbound-gate",
    "core",
    "memory",
    "outbound-gate",
    "record",
  ]),
  kind: z.enum(["check", "decision", "message-in", "message-out", "ask-principal"]),
  check: check.optional(),
  verdict: z
    .enum(["pass", "fail", "ask-more", "ask-principal", "indeterminate", "not-applicable"])
    .optional(),
  reason: reason.optional(),
});
export const outlineSchema = z.array(outlineEntry);
export const domainProfileSchema = z.strictObject({
  "x-authored-by": z.string(),
  schema: z.literal("agent-profile/0.1"),
  id: slug,
  claims: z.array(
    z.strictObject({
      kind: z.string(),
      sources: z.array(iri),
      methods: strings,
      maxAgeDays: z.number().nonnegative(),
    }),
  ),
  purposes: z.array(z.strictObject({ id: iri, claims: strings })),
  rules: z.array(
    z.strictObject({
      id: iri,
      version: z.string(),
      inputs: strings,
      result: z.string(),
      assurances: z.array(z.enum(["by-source", "by-agent", "attested", "proved", "joint"])),
    }),
  ),
  decisionsForPerson: strings,
  modelReadings: strings,
  vocabulary: z.record(z.string(), contentType),
  identifiers: z.array(iri).default([]),
  operations: z.array(
    z.strictObject({
      ...ref.shape,
      label: z.string(),
      pattern: z.enum(["negotiate", "invoke"]),
      access: z.enum(["public", "represented"]),
      models: z.array(ref).default([]),
      purposes: z.array(iri).default([]),
      requiresRepresentation: z.boolean(),
      agreementDelivery: z.enum(["offeror", "acceptor"]).optional(),
      requiredApproval: z
        .strictObject({ level: iri, label: z.string(), claimType: z.string() })
        .optional(),
    }),
  ),
});
const expectation = z.strictObject({
  outcome: z.enum(["go", "stop", "ask-more", "ask-principal", "admit", "refuse"]),
  check: check,
  reason,
});
const party = z.strictObject({
  id: slug,
  identity: iri,
  actor: iri.optional(),
  name: z.string(),
  role: z.enum(["principal", "agent", "source", "register"]),
  runs: z.enum(["agent", "issuer-only"]),
  actsFor: slug.optional(),
});
const ownEntry = z.strictObject({
  party: iri,
  tasks: z.array(iri),
  block: z.boolean().optional(),
  note: z.string().optional(),
});
const sourceRule = z.strictObject({
  id: iri,
  version: z.string(),
  source: iri,
  claimTypes: strings,
  subjects: z.union([z.literal("any"), z.array(iri)]),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  framework: z.string().optional(),
});
const registerEntry = z.strictObject({
  party: iri,
  authorizedFor: z.array(iri),
  claimTypes: strings.optional(),
  status: z.enum(["authorized", "suspended", "withdrawn"]),
  id: iri,
});
const root = z.strictObject({
  id: iri,
  name: z.string(),
  delegates: z.array(
    z.strictObject({
      id: iri,
      name: z.string(),
      answersFor: z.string(),
      entries: z.array(registerEntry),
      answerTtlMs: z.number().positive(),
    }),
  ),
});
const base = { id: slug, agent: slug };
const step = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("instruct"), text: z.string() }),
  z.strictObject({
    ...base,
    type: z.literal("admit"),
    statements: strings,
    purpose: iri,
    subject: iri.optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("start"),
    peer: slug,
    kind: z.enum(["propose", "invoke"]),
    operation: iri,
    contents: object,
    intent: object,
    purpose: iri.optional(),
    discover: z.boolean().default(false),
  }),
  z.strictObject({
    ...base,
    type: z.literal("receive"),
    from: slug.optional(),
    reply: object.optional(),
    agreementPlan: object.optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("approve"),
    decision: z.enum(["approve", "deny"]),
    note: z.string(),
    evidence: strings.default([]),
  }),
  z.strictObject({
    ...base,
    type: z.literal("message"),
    conversation: json,
    kind: z.enum(["invoke", "deliver", "receipt"]),
    body: object,
    intent: object.optional(),
    evidence: strings.default([]),
  }),
  z.strictObject({
    ...base,
    type: z.literal("effect"),
    intent: object,
    params: object,
    activityType: iri,
  }),
  z.strictObject({
    ...base,
    type: z.literal("reading"),
    originalDigest: json,
    claimType: z.string(),
    subject: iri,
    value: json,
  }),
  z.strictObject({ ...base, type: z.literal("record") }),
  z.strictObject({
    ...base,
    type: z.literal("advance"),
    milliseconds: z.number().int().nonnegative(),
  }),
]);
const blocked = z.array(z.strictObject({ path: z.string(), reason: z.string() }));
export const scenarioSchema = z.strictObject({
  "x-authored-by": z.string(),
  schema: z.literal("agent-scenario/0.1"),
  id: slug,
  title: z.string(),
  profile: slug,
  parties: z.array(party),
  trust: z.strictObject({
    introductions: z.array(z.tuple([slug, slug])),
    ownLists: z.record(slug, z.array(ownEntry)),
    sources: z.record(slug, z.array(sourceRule)),
    root: root.optional(),
  }),
  statements: z.array(
    z.strictObject({
      id: slug,
      issuer: slug,
      subject: iri,
      kind: z.string(),
      value: object,
      method: z.string(),
      asOf: z.string(),
      terms: object.optional(),
    }),
  ),
  mandates: z.array(
    z.strictObject({
      agent: slug,
      autonomous: z.array(object),
      withApproval: z.array(object),
      prohibitions: z.array(object).default([]),
      limits: z.strictObject({ maxRetentionDays: z.number().nonnegative().optional() }).optional(),
      standingRules: z.array(object).default([]),
    }),
  ),
  script: z.array(step),
  inject: z.array(
    z.strictObject({
      step: slug,
      target: z.enum(["wire", "body"]),
      path: strings,
      value: json,
      resign: z.boolean().default(false),
    }),
  ),
  branches: z.array(
    z.strictObject({
      id: slug,
      what: z.string(),
      change: object,
      expect: expectation,
      outline: outlineSchema,
      blocked: z.string().optional(),
    }),
  ),
  expect: outlineSchema,
  stress: z.array(check),
  suites: z.record(z.string(), z.string()),
  assurance: z.enum(["proved", "joint"]).nullable().default(null),
  blocked: blocked.default([]),
});
export type DomainProfile = z.infer<typeof domainProfileSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScriptStep = z.infer<typeof step>;
