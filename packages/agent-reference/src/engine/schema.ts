// AUTHORED-BY Codex GPT-6.1-Sol
/** The executable data format. JSON Schemas are generated from these validators. */
import { z } from "zod";
import { LAYER_IDS } from "../suites/registry.js";
import { INBOUND_CHECKS, OUTBOUND_CHECKS } from "../trace/types.js";

const text = z.string().min(1);
const id = text.regex(/^[a-z0-9][a-z0-9-]*$/);
const object = z.record(z.string(), z.json());
const strings = z.array(text);
// biome-ignore lint/style/useNamingConvention: JSON Schema keyword
const comment = { $comment: z.string().optional() };
const configuration = z.strictObject({
  id: text,
  pilotConfiguration: text,
  layers: z.record(z.enum(LAYER_IDS), text),
});
const outline = z.array(
  z.strictObject({
    agent: text,
    part: z.enum([
      "principal",
      "transport",
      "inbound-gate",
      "core",
      "memory",
      "outbound-gate",
      "record",
      "policies",
    ]),
    kind: z.enum(["check", "decision", "message-in", "message-out", "ask-principal"]),
    check: z.enum([...INBOUND_CHECKS, ...OUTBOUND_CHECKS]).optional(),
    verdict: z
      .enum(["pass", "fail", "ask-more", "ask-principal", "indeterminate", "not-applicable"])
      .optional(),
    reason: text.optional(),
  }),
);
export const profileSchema = z.strictObject({
  ...comment,
  schema: z.literal("agent-profile/0.1"),
  id,
  claims: z
    .array(
      z.strictObject({
        kind: text,
        sources: strings.min(1),
        methods: strings.min(1),
        maxAgeDays: z.number().nonnegative(),
      }),
    )
    .min(1),
  purposes: z.array(
    z.strictObject({ id: text, claims: strings, partial: z.boolean().default(false) }),
  ),
  rules: z.array(
    z.strictObject({
      id: text,
      reads: strings.min(1),
      produces: text,
      query: text,
      complete: strings,
      assurances: z
        .array(z.enum(["by-source", "recomputed", "proved", "joint", "attested"]))
        .min(1),
    }),
  ),
  personDecisions: strings,
  readingSteps: strings,
  reliance: z.strictObject({
    id: text,
    rules: z
      .array(
        z.strictObject({
          id: text,
          claimType: text,
          methods: strings.min(1),
          maxAgeDays: z.number().nonnegative(),
          text,
        }),
      )
      .min(1),
  }),
});
const patch = z.strictObject({ path: text.regex(/^\//), value: z.json() });
const command = z.strictObject({
  id,
  by: text,
  method: z.enum([
    "showMandate",
    "instruct",
    "startNegotiation",
    "startInvocation",
    "admitStatements",
    "receive",
    "submitApproval",
    "sendReceipt",
    "runTask",
    "checkRecord",
  ]),
  at: z.iso.datetime(),
  step: z.number().int().nonnegative(),
  args: z.array(z.json()),
});
const hook = z.enum([
  "intentForProposal",
  "intentForInvoke",
  "onProposal",
  "onAgreement",
  "onInvoke",
  "onDeliver",
  "onReceipt",
  "onClosed",
  "vetDescription",
  "describeFor",
  "validateSelection",
]);
export const scenarioSchema = z.strictObject({
  ...comment,
  schema: z.literal("agent-scenario/0.1"),
  id,
  title: text,
  profile: id,
  start: z.iso.datetime(),
  ids: id,
  configuration,
  parties: z
    .array(
      z.strictObject({
        id: text,
        name: text,
        role: z.enum(["principal", "agent", "source", "register"]),
        runs: z.enum(["agent", "issuer-only"]),
        actsFor: text.optional(),
        key: text.optional(),
        identity: z
          .strictObject({ name: text, party: text, actor: text, operator: text.optional() })
          .optional(),
        representationOperations: strings.optional(),
      }),
    )
    .min(1),
  traceAgents: z.array(z.strictObject({ id: text, name: text, actsFor: text, role: text })),
  trust: z.record(
    text,
    z.strictObject({
      principal: text,
      data: object,
      ownList: z.array(object).optional(),
      root: object.optional(),
    }),
  ),
  mandates: z.record(text, object),
  settings: z.record(
    text,
    z.strictObject({
      agent: text,
      principalLimits: z
        .strictObject({ id: text, maxRetentionDays: z.number().nonnegative().optional() })
        .optional(),
      configuration,
      configurations: z.record(text, configuration).optional(),
      accepted: strings.optional(),
    }),
  ),
  statements: z.array(z.strictObject({ id: text, key: text, typ: text, value: object })),
  core: z.record(
    text,
    z.array(
      z.strictObject({
        description: object,
        requiresRepresentation: z.boolean(),
        agreementDelivery: z.enum(["offeror", "acceptor"]).optional(),
        requiredApproval: z.strictObject({ level: text, label: text, claimType: text }).optional(),
        hooks: z.partialRecord(
          hook,
          z.array(z.strictObject({ result: z.json(), records: z.array(object).optional() })),
        ),
      }),
    ),
  ),
  script: z.array(command).min(1),
  inject: z.array(
    z.strictObject({
      step: z.number().int().nonnegative(),
      by: text,
      patches: z.array(patch).min(1),
    }),
  ),
  branches: z.array(
    z.strictObject({
      id,
      title: text,
      changes: z.array(patch).min(1),
      expect: outline,
      outcome: z.enum(["admit", "ask-more", "refuse", "go", "ask-principal", "stop"]),
      check: z.enum([...INBOUND_CHECKS, ...OUTBOUND_CHECKS]),
      reason: text,
    }),
  ),
  expect: outline,
  steps: z.record(text, text),
  names: z.record(text, text),
  tasks: z.record(text, text),
  labels: z.record(
    text,
    z.strictObject({ claimLabel: text.optional(), tellPrincipal: text.optional() }),
  ),
  stepLabels: z
    .array(
      z.strictObject({ step: z.number().int(), agent: text, parts: strings, to: z.number().int() }),
    )
    .default([]),
});
export type DomainProfile = z.infer<typeof profileSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScriptCommand = Scenario["script"][number];

export function validateScenario(value: unknown): Scenario {
  const s = scenarioSchema.parse(value);
  const unique = (values: string[], kind: string) => {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${kind}`);
  };
  unique(
    s.parties.map((p) => p.id),
    "party",
  );
  unique(
    s.script.map((p) => p.id),
    "command",
  );
  unique(
    s.statements.map((p) => p.id),
    "statement",
  );
  unique(
    s.branches.map((p) => p.id),
    "branch",
  );
  for (const p of s.parties) {
    if (
      p.runs === "agent" &&
      (!p.identity || !s.mandates[p.id] || !s.trust[p.id] || !s.core[p.id] || !s.settings[p.id])
    )
      throw new Error(`incomplete agent ${p.id}`);
    if (p.role === "agent" && !s.parties.some((principal) => principal.id === p.actsFor))
      throw new Error(`unknown principal for ${p.id}`);
  }
  for (const c of s.script)
    if (!s.parties.some((p) => p.id === c.by && p.runs === "agent"))
      throw new Error(`unknown running party ${c.by}`);
  return s;
}
