// AUTHORED-BY Codex GPT-6
/** The on-disk contract. Runtime validation and published JSON Schemas share this source. */
import { z } from "zod";
import { CORE_REASON_CODES } from "../core/types.js";
import { ruleSchema } from "../derive/rules.js";
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
const baseDomainProfileSchema = z.strictObject({
  "x-authored-by": z.string(),
  schema: z.literal("agent-profile/0.1"),
  id: slug,
  parties: z.record(slug, z.string()).default({}),
  sources: z.record(z.string(), iri).default({}),
  claims: z.array(
    z.strictObject({
      kind: z.string(),
      sources: z.array(iri),
      methods: strings,
      maxAgeDays: z.number().nonnegative(),
      completeness: z.string().optional(),
      corroboration: z
        .strictObject({ sources: z.number().int().min(2), independent: z.boolean() })
        .optional(),
    }),
  ),
  purposes: z.array(z.strictObject({ id: iri, claims: strings })),
  rules: z.array(
    z.union([
      ruleSchema,
      z.strictObject({
        id: iri,
        version: z.string(),
        inputs: strings,
        result: z.string(),
        assurances: z.array(z.enum(["by-source", "by-agent", "attested", "proved", "joint"])),
      }),
    ]),
  ),
  storeAssessments: z
    .array(
      z.strictObject({
        id: iri,
        template: z.literal("loan-ratio-and-equity"),
        annualRule: iri,
        maxLoanIncomeRatio: z.number().positive(),
        purpose: iri,
      }),
    )
    .default([]),
  assessments: z
    .array(
      z.strictObject({
        id: iri,
        rule: iri,
        purpose: iri,
        keep: z.array(z.literal("output")),
        discardInputsAfter: z.literal("evaluation"),
      }),
    )
    .default([]),
  standIns: z.array(z.strictObject({ what: z.string(), replacedBy: z.string() })).default([]),
  trust: z
    .strictObject({
      levels: z.tuple([z.literal("own-list")]),
      onUnknown: z.literal("ask-principal"),
    })
    .optional(),
  personDecisions: z
    .array(
      z.strictObject({
        action: z.string(),
        decider: z.union([z.literal("principal"), z.strictObject({ role: z.string() })]),
      }),
    )
    .default([]),
  decisionsForPerson: strings,
  modelReadings: strings,
  referenceAction: z.string().optional(),
  organizations: z
    .strictObject({
      registrar: iri,
      maxStatusAgeSeconds: z.number().positive(),
      requiredRoles: z.record(iri, strings),
      actionKinds: z.record(iri, z.string()).optional(),
      statusClaims: strings.optional(),
    })
    .optional(),
  notificationRecipients: z
    .record(z.string(), z.strictObject({ actor: iri, party: iri }))
    .default({}),
  readings: z
    .array(
      z.strictObject({
        claimType: z.string(),
        type: z.enum(["code", "number", "date", "term"]),
        values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
      }),
    )
    .default([]),
  personMayRelyOn: strings.default([]),
  termsAcceptance: z.record(iri, z.strictObject({ purposes: z.array(iri) })).default({}),
  actionClaims: z.array(z.strictObject({ action: z.string(), claims: strings })).default([]),
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
export const domainProfileSchema = baseDomainProfileSchema.superRefine((profile, ctx) => {
  for (const rule of profile.actionClaims) {
    if (
      rule.claims.some((claim) => profile.personMayRelyOn.includes(claim)) &&
      ["pay", "distribute"].includes(rule.action)
    )
      ctx.addIssue({
        code: "custom",
        path: ["personMayRelyOn"],
        message: "personMayRelyOn cannot support payment or unrestricted personal-data disclosure",
      });
  }
});
const expectation = z.strictObject({
  outcome: z.enum(["go", "stop", "ask-more", "ask-principal", "admit", "refuse"]),
  check: check,
  reason,
});
const catalogueExpectation = expectation.omit({ check: true });
const party = z.strictObject({
  id: slug,
  identity: iri,
  actor: iri.optional(),
  operator: iri.optional(),
  traceId: z.string().optional(),
  handlers: strings.default([]),
  configurations: z.array(z.enum(["baseline", "public-read"])).default(["baseline"]),
  representationOperations: z.array(iri).optional(),
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
  purposes: z.array(iri).optional(),
  expiresAt: z.iso.datetime().optional(),
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
const base = { id: slug, agent: slug, atStep: z.number().int().positive().optional() };
const step = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("instruct"), text: z.string() }),
  z.strictObject({
    ...base,
    type: z.literal("admit"),
    operation: iri.optional(),
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
    configuration: z.enum(["baseline", "public-read"]).optional(),
    basis: object.optional(),
    evidence: strings.default([]),
    content: z
      .array(
        z.strictObject({
          id: iri,
          mediaType: z.string(),
          bytes: z.union([z.string(), z.array(z.number().int().min(0).max(255)).max(32768)]),
        }),
      )
      .default([]),
  }),
  z.strictObject({
    ...base,
    type: z.literal("receive"),
    from: slug.optional(),
    stripSignature: z.boolean().optional(),
    reply: object.optional(),
    outboundAtStep: z.number().int().positive().optional(),
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
    adapter: z.string().optional(),
    taskId: iri.optional(),
    origin: object.optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("reading"),
    originalDigest: json,
    claimType: z.string(),
    subject: iri,
    value: json,
  }),
  z.strictObject({
    ...base,
    type: z.literal("derive"),
    rule: iri,
    subject: iri,
    purpose: iri,
    assurance: z.enum(["recomputed", "by-source"]).default("recomputed"),
  }),
  z.strictObject({
    ...base,
    type: z.literal("assess"),
    assessment: iri,
    agreement: json,
    subject: iri,
  }),
  z.strictObject({ ...base, type: z.literal("organisation-approve"), signer: slug }),
  z.strictObject({
    ...base,
    type: z.literal("trust-decision"),
    decision: z.enum(["approve", "deny"]),
  }),
  z.strictObject({
    ...base,
    type: z.literal("assert"),
    operator: z.enum(["equals", "includes"]).default("equals"),
    actual: json,
    expected: json,
  }),
  z.strictObject({ ...base, type: z.literal("request-structured"), claimType: z.string() }),
  z.strictObject({
    ...base,
    type: z.literal("read-content"),
    part: iri,
    subject: iri,
    output: object,
  }),
  z.strictObject({
    ...base,
    type: z.literal("read-reference"),
    reference: json,
    item: iri,
    purpose: iri,
  }),
  z.strictObject({ ...base, type: z.literal("notifications") }),
  z.strictObject({ ...base, type: z.literal("duties") }),
  z.strictObject({ ...base, type: z.literal("show-mandate") }),
  z.strictObject({ ...base, type: z.literal("revoke-mandate") }),
  z.strictObject({ ...base, type: z.literal("mint") }),
  z.strictObject({ ...base, type: z.literal("pending") }),
  z.strictObject({ ...base, type: z.literal("conversation"), conversation: json }),
  z.strictObject({ ...base, type: z.literal("retry-challenge"), conversation: json }),
  z.strictObject({
    ...base,
    type: z.literal("invoke-agreement"),
    conversation: json,
    operation: iri,
    input: object,
    purpose: iri,
  }),
  z.strictObject({
    ...base,
    type: z.literal("receipt"),
    conversation: json,
    activity: json,
    outcome: z.enum(["completed", "not-executed", "uncertain"]),
    observed: object,
    final: z.boolean(),
  }),
  z.strictObject({ ...base, type: z.literal("issue"), issuer: slug, value: object }),
  z.strictObject({
    ...base,
    type: z.literal("underwriting-handover"),
    store: slug,
    conversation: json,
    peer: slug,
    operation: iri,
    items: z.array(iri),
    purpose: iri,
  }),
  z.strictObject({ ...base, type: z.literal("store-request"), store: slug, request: object }),
  z.strictObject({
    ...base,
    type: z.literal("store-assess"),
    store: slug,
    assessor: iri,
    conversation: json,
    items: z.array(iri),
    purpose: iri,
    assessment: iri,
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
  useCase: slug.optional(),
  cataloguePath: z
    .strictObject({ index: z.number().int().positive(), what: z.string() })
    .optional(),
  title: z.string(),
  result: expectation.optional(),
  catalogueExpected: catalogueExpectation.optional(),
  profile: slug,
  parties: z.array(party),
  trust: z.strictObject({
    introductions: z.array(z.tuple([slug, slug])),
    pins: z.array(z.tuple([slug, slug])).default([]),
    ownLists: z.record(slug, z.array(ownEntry)),
    sources: z.record(slug, z.array(sourceRule)),
    root: root.optional(),
    controllers: z.record(z.string(), z.string()).default({}),
  }),
  statements: z.array(
    z.strictObject({
      id: slug,
      issuer: slug,
      subject: iri.optional(),
      kind: z.string(),
      identifier: iri.optional(),
      value: object,
      method: z.string(),
      asOf: z.string().optional(),
      terms: object.optional(),
    }),
  ),
  selectiveCredentials: z
    .array(z.strictObject({ id: slug, issuer: slug, subject: iri, statements: strings }))
    .default([]),
  documents: z
    .array(
      z.strictObject({
        id: iri,
        issuer: slug,
        typ: z.enum(["awp-organization-identifier+jws", "awp-status-list+jws"]),
        value: object,
      }),
    )
    .default([]),
  organizationCredentials: z
    .array(
      z.strictObject({
        agent: slug,
        issuer: slug,
        entity: iri,
        roles: strings,
        actions: strings,
        validFrom: z.iso.datetime(),
        validUntil: z.iso.datetime(),
        status: z.strictObject({ ref: iri, id: z.string() }),
      }),
    )
    .default([]),
  resources: z.array(z.strictObject({ ref: iri, holder: slug, statements: strings })).default([]),
  grants: z
    .array(
      z.strictObject({
        id: slug,
        holder: slug,
        ref: iri,
        reader: slug,
        statements: strings,
        purpose: iri,
        validUntil: z.iso.datetime(),
      }),
    )
    .default([]),
  handlerImplementations: z
    .record(
      slug,
      z.strictObject({
        template: z.enum([
          "mortgage-consumer",
          "mortgage-lender",
          "product-search",
          "product-index",
          "balance-request",
          "balance-statement",
          "lender-underwriting",
          "underwriter",
        ]),
        params: object,
      }),
    )
    .default({}),
  stores: z
    .array(
      z.strictObject({
        id: slug,
        organization: iri,
        roles: z.array(
          z.strictObject({
            agent: iri,
            label: z.string(),
            purposes: z.array(iri),
            actions: strings,
          }),
        ),
      }),
    )
    .default([]),
  traceSteps: z.record(z.string(), z.string()).optional(),
  standIns: z.array(z.strictObject({ what: z.string(), replacedBy: z.string() })).default([]),
  requester: z.record(slug, iri).default({}),
  mandates: z.array(
    z.strictObject({
      agent: slug,
      autonomous: z.array(object),
      withApproval: z.array(object),
      prohibitions: z.array(object).default([]),
      limits: z
        .strictObject({
          maxRetentionDays: z.number().nonnegative().optional(),
          commitments: z
            .record(
              iri,
              z.strictObject({
                maxAmount: z.number().nonnegative(),
                currency: z.string().regex(/^[A-Z]{3}$/),
              }),
            )
            .optional(),
        })
        .optional(),
      standingRules: z.array(object).default([]),
    }),
  ),
  script: z.array(step),
  inject: z.array(
    z.strictObject({
      step: slug,
      target: z.enum(["wire", "body", "message"]),
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
      profileChange: object.optional(),
      expect: expectation,
      catalogueExpected: catalogueExpectation.optional(),
      outline: outlineSchema,
      blocked: z.string().optional(),
    }),
  ),
  expect: outlineSchema,
  stress: z.array(check),
  suites: z.record(z.string(), z.string()),
  assurance: z.enum(["proved", "joint", "attested"]).nullable().default(null),
  blocked: blocked.default([]),
});
export type DomainProfile = z.infer<typeof domainProfileSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScriptStep = z.infer<typeof step>;
