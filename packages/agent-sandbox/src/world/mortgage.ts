// AUTHORED-BY Claude Opus 5.5
// A mortgage application worked by three agents from two organisations, each in its own
// sandbox: Alex's PERSONAL agent (acting for Alex, holding Alex's pod), Northgate Building
// Society's CUSTOMER-FACING assistant, and Northgate's INTERNAL underwriting agent. Everyone and
// everything here is FICTIONAL. The policies are real ODRL and enforced for real: each agent
// answers to its own organisation's mandate, and Alex's own rules travel with Alex's data into
// Northgate, so Northgate's agents can use it for the mortgage but not pass it on.
import { AGENT, type Constraint, type Mandate, type Rule } from "@jeswr/agent-mandate";
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import type { Directory } from "../directory.js";
import { createSandbox, type Sandbox } from "../gate.js";
import type { Args, CallResult, DataItem, DataLabel, GateDecision, ToolSpec } from "../types.js";
import { DPV } from "./company.js";
import type { Expectation } from "./scenarios.js";

const POD = "https://alex-morgan.pod.example/";
const NG = "https://northgate.example/";

/** The people and agents. */
export const MORTGAGE_PARTY = {
  alex: `${POD}profile/card#me`,
  personal: `${POD}agents/personal#me`,
  northgate: `${NG}#org`,
  assistant: `${NG}agents/assistant#me`,
  underwriter: `${NG}agents/underwriting#me`,
  ruth: "mailto:ruth.okafor@northgate.example",
  homecover: "mailto:offers@homecover-insurance.example",
} as const;

/** The systems the agents act on (ODRL targets). */
export const MORTGAGE_SYSTEM = {
  pod: `${POD}`,
  portal: `${NG}systems/applications`,
  bureau: `${NG}systems/credit-bureau`,
  offers: `${NG}systems/offers`,
  partners: `${NG}systems/partners`,
} as const;

export const MORTGAGE_PURPOSE = {
  mortgage: `${NG}purposes/mortgage-application`,
  marketing: `${DPV}Marketing`,
  health: `${POD}purposes/health-care`,
} as const;

/** Which agent acts. */
export type MortgageAgent = "personal" | "assistant" | "underwriter";

export const MORTGAGE_AGENTS: Readonly<
  Record<MortgageAgent, { readonly name: string; readonly org: string; readonly role: string }>
> = {
  personal: { name: "Alex's agent", org: "Alex Morgan", role: "Personal agent" },
  assistant: { name: "Northgate assistant", org: "Northgate", role: "Customer-facing agent" },
  underwriter: { name: "Northgate underwriting", org: "Northgate", role: "Internal agent" },
};

const MORTGAGE_DIRECTORY: Directory = {
  names: {
    [MORTGAGE_PARTY.alex]: "Alex Morgan",
    [MORTGAGE_PARTY.personal]: "Alex's personal agent",
    [MORTGAGE_PARTY.northgate]: "Northgate Building Society",
    [MORTGAGE_PARTY.assistant]: "Northgate's customer assistant",
    [MORTGAGE_PARTY.underwriter]: "Northgate's underwriting agent",
    [MORTGAGE_PARTY.ruth]: "Ruth Okafor (senior underwriter)",
    [MORTGAGE_PARTY.homecover]: "Homecover Insurance (a Northgate partner)",
    [MORTGAGE_SYSTEM.pod]: "Alex's pod",
    [MORTGAGE_SYSTEM.portal]: "Northgate's application portal",
    [MORTGAGE_SYSTEM.bureau]: "the credit bureau",
    [MORTGAGE_SYSTEM.offers]: "Northgate's mortgage offers",
    [MORTGAGE_SYSTEM.partners]: "Northgate's partner channel",
    [MORTGAGE_PURPOSE.mortgage]: "a mortgage application",
    [MORTGAGE_PURPOSE.marketing]: "marketing",
    [MORTGAGE_PURPOSE.health]: "health care",
  },
  groups: {},
};

const c = (
  leftOperand: string,
  operator: Constraint["operator"],
  rightOperand: Constraint["rightOperand"],
): Constraint => ({ leftOperand, operator, rightOperand }) as Constraint;

const P = MORTGAGE_PARTY;
const S = MORTGAGE_SYSTEM;

/** Who may receive Alex's application data: Alex, Alex's agent and Northgate's two agents. */
const APPLICATION_PARTIES = [P.alex, P.personal, P.assistant, P.underwriter];

/** Alex's rule for financial records: for this mortgage application, and only with Northgate. */
function alexFinancialPolicy(id: string): OdrlPolicy {
  return {
    id: `${id}#policy`,
    assigner: P.alex,
    permissions: [
      {
        type: "permission",
        action: "read",
        constraints: [
          { leftOperand: "purpose", operator: "eq", rightOperand: MORTGAGE_PURPOSE.mortgage },
        ],
      },
      {
        type: "permission",
        action: "distribute",
        constraints: [
          { leftOperand: "purpose", operator: "eq", rightOperand: MORTGAGE_PURPOSE.mortgage },
          { leftOperand: "recipient", operator: "isAnyOf", rightOperand: APPLICATION_PARTIES },
        ],
        duties: [{ action: "inform", target: P.alex }],
      },
    ],
  };
}

/** Alex's rule for health records: for health care only, never shared. */
function alexHealthPolicy(id: string): OdrlPolicy {
  return {
    id: `${id}#policy`,
    assigner: P.alex,
    permissions: [
      {
        type: "permission",
        action: "read",
        constraints: [
          { leftOperand: "purpose", operator: "eq", rightOperand: MORTGAGE_PURPOSE.health },
        ],
      },
    ],
  };
}

/** The bureau's rule for a credit report: for lending decisions; shared only with the applicant. */
function bureauPolicy(id: string): OdrlPolicy {
  return {
    id: `${id}#policy`,
    assigner: S.bureau,
    permissions: [
      {
        type: "permission",
        action: "read",
        constraints: [
          { leftOperand: "purpose", operator: "eq", rightOperand: MORTGAGE_PURPOSE.mortgage },
        ],
      },
      {
        type: "permission",
        action: "distribute",
        constraints: [
          { leftOperand: "recipient", operator: "isAnyOf", rightOperand: APPLICATION_PARTIES },
        ],
      },
    ],
  };
}

const permit = (action: string, target: string, constraints?: Constraint[]): Rule => ({
  type: "permission",
  action,
  target,
  ...(constraints && { constraints }),
});

function mandate(
  id: string,
  issuer: string,
  subject: string,
  rules: { own: Rule[]; ask: Rule[]; never: Rule[] },
): Mandate {
  return {
    id,
    issuer,
    subject,
    validFrom: "2026-11-01T00:00:00.000Z",
    validUntil: "2027-11-01T00:00:00.000Z",
    autonomous: { id: `${id}#autonomous`, permissions: rules.own },
    withApproval: { id: `${id}#with-approval`, permissions: rules.ask },
    prohibitions: rules.never,
    limits: [
      {
        leftOperand: `${AGENT}sendsPerDay`,
        operator: "lteq",
        rightOperand: 20,
        enforcement: "hard",
      },
    ],
  };
}

/** Each agent's mandate, from the person or organisation it acts for. */
export const MORTGAGE_MANDATES: Readonly<Record<MortgageAgent, Mandate>> = {
  // Alex: read my pod; send my application to Northgate's assistant; I accept any offer myself.
  personal: mandate(`${POD}mandates/personal-agent`, P.alex, P.personal, {
    own: [
      permit("read", S.pod),
      permit(`${AGENT}SendMessage`, S.portal, [
        c("recipient", "isAnyOf", [P.assistant]),
        c("purpose", "eq", MORTGAGE_PURPOSE.mortgage),
      ]),
    ],
    ask: [permit(`${AGENT}Sign`, S.portal)],
    never: [{ type: "prohibition", action: `${AGENT}Transfer` }],
  }),
  // Northgate: the assistant talks to applicants and refers to underwriting; it may offer a
  // partner's products with a manager's approval, and never makes offers or moves money.
  assistant: mandate(`${NG}mandates/assistant`, P.northgate, P.assistant, {
    own: [
      permit("read", S.portal),
      permit(`${AGENT}SendMessage`, S.portal, [
        c("recipient", "isAnyOf", [P.personal, P.alex, P.underwriter]),
      ]),
    ],
    ask: [permit(`${AGENT}SendMessage`, S.partners)],
    never: [
      { type: "prohibition", action: `${AGENT}Sign` },
      { type: "prohibition", action: `${AGENT}Transfer` },
    ],
  }),
  // Northgate: underwriting reads applications and credit files; every offer is signed off by a
  // senior underwriter.
  underwriter: mandate(`${NG}mandates/underwriting`, P.northgate, P.underwriter, {
    own: [permit("read", S.portal), permit("read", S.bureau)],
    ask: [permit(`${AGENT}Sign`, S.offers)],
    never: [
      { type: "prohibition", action: `${AGENT}Transfer` },
      { type: "prohibition", action: `${AGENT}SendMessage`, target: S.partners },
    ],
  }),
};

/** A record in Alex's pod. */
interface PodRecord {
  readonly key: "income" | "identity" | "transactions" | "health";
  readonly title: string;
  readonly category: string;
  readonly content: Record<string, string | number>;
}

const POD_RECORDS: readonly PodRecord[] = [
  {
    key: "income",
    title: "payslips, Aug to Oct 2026",
    category: "Financial record",
    content: { employer: "Brightwater Studios", monthlyNet: 5200, months: 3 },
  },
  {
    key: "identity",
    title: "passport",
    category: "Identity document",
    content: { name: "Alex Morgan", number: "FAKE-PASSPORT-0001", expires: "2031-04-30" },
  },
  {
    key: "transactions",
    title: "bank statements, Aug to Oct 2026",
    category: "Financial record",
    content: { averageMonthlyOutgoings: 1900, overdraftDays: 0 },
  },
  {
    key: "health",
    title: "GP record",
    category: "Health record",
    content: { note: "Fictional health record. Should never leave Alex's pod." },
  },
];

const podLabel = (r: PodRecord): DataLabel => {
  const id = `${POD}records/${r.key}`;
  return {
    id,
    title: `Alex's ${r.title}`,
    source: S.pod,
    category: r.category,
    policy: r.key === "health" ? alexHealthPolicy(id) : alexFinancialPolicy(id),
  };
};

/** What happened between the two organisations. */
export interface MortgageState {
  /** Records Northgate has received from Alex's agent. */
  readonly received: PodRecord["key"][];
  readonly messages: { from: MortgageAgent; to: string; text: string }[];
  readonly partnerShares: string[];
  readonly offers: { amount: number; rate: number; years: number; accepted: boolean }[];
  readonly creditChecks: number;
}

const str = (args: Args, key: string): string => {
  const v = args[key];
  if (typeof v !== "string" || !v) throw new Error(`"${key}" is required`);
  return v;
};
const keys = (args: Args): PodRecord["key"][] => {
  const v = args.documents;
  if (!Array.isArray(v) || v.length === 0) throw new Error(`"documents" is required`);
  return v.map((k) => {
    const r = POD_RECORDS.find((x) => x.key === k);
    if (!r) throw new Error(`no document "${String(k)}"`);
    return r.key;
  });
};
const record = (key: PodRecord["key"]): PodRecord =>
  POD_RECORDS.find((x) => x.key === key) as PodRecord;

/** The three agents' tools over one shared state. */
function mortgageTools(state: MortgageState): Record<MortgageAgent, ToolSpec[]> {
  const applicationRead: ToolSpec = {
    name: "application_read",
    title: "Open the application",
    description: "Read the documents Alex's agent has sent with the application.",
    system: S.portal,
    action: "read",
    kind: "read",
    inputSchema: { type: "object", properties: {} },
    run: () => ({
      items: state.received.map(
        (k): DataItem => ({ label: podLabel(record(k)), content: { ...record(k).content } }),
      ),
    }),
  };
  return {
    personal: [
      {
        name: "pod_read",
        title: "Open a record in Alex's pod",
        description: "Read one record from Alex's pod: income, identity, transactions or health.",
        system: S.pod,
        action: "read",
        kind: "read",
        inputSchema: {
          type: "object",
          properties: { record: { type: "string", enum: POD_RECORDS.map((r) => r.key) } },
          required: ["record"],
        },
        run: (args) => {
          const r = POD_RECORDS.find((x) => x.key === args.record);
          if (!r) throw new Error(`no record "${String(args.record)}"`);
          return { items: [{ label: podLabel(r), content: { ...r.content } }] };
        },
      },
      {
        name: "lender_send",
        title: "Send documents to Northgate",
        description: "Send records from Alex's pod to Northgate's assistant, with a message.",
        system: S.portal,
        action: `${AGENT}SendMessage`,
        kind: "send",
        inputSchema: {
          type: "object",
          properties: {
            documents: { type: "array", items: { type: "string" } },
            message: { type: "string" },
          },
          required: ["documents", "message"],
        },
        context: (args) => ({
          recipients: [P.assistant],
          content: str(args, "message"),
          uses: keys(args).map((k) => podLabel(record(k))),
        }),
        run: (args) => {
          for (const k of keys(args)) if (!state.received.includes(k)) state.received.push(k);
          state.messages.push({ from: "personal", to: P.assistant, text: str(args, "message") });
          return { content: "Sent to Northgate." };
        },
      },
      {
        name: "offer_accept",
        title: "Accept a mortgage offer",
        description: "Accept Northgate's mortgage offer on Alex's behalf (a binding agreement).",
        system: S.portal,
        action: `${AGENT}Sign`,
        kind: "send",
        inputSchema: { type: "object", properties: { offer: { type: "number" } } },
        // The offer is fixed when the call is decided, so an approval accepts exactly the offer
        // the person saw (a later, different offer changes the effects and is re-checked).
        context: () => {
          const index = state.offers.length - 1;
          const offer = state.offers[index];
          if (!offer) throw new Error("there is no offer to accept");
          const { amount, rate, years } = offer;
          return {
            recipients: [P.assistant],
            content: JSON.stringify({ index, amount, rate, years }),
          };
        },
        run: (_args, effects) => {
          const want = JSON.parse(effects.content ?? "{}") as {
            index: number;
            amount: number;
            rate: number;
            years: number;
          };
          const offer = state.offers[want.index];
          if (
            !offer ||
            offer.amount !== want.amount ||
            offer.rate !== want.rate ||
            offer.years !== want.years
          )
            throw new Error("the offer is not the one that was approved");
          offer.accepted = true;
          return { content: "Offer accepted." };
        },
      },
    ],
    assistant: [
      applicationRead,
      {
        name: "request_documents",
        title: "Ask Alex's agent for documents",
        description: "Ask the applicant's agent for more documents.",
        system: S.portal,
        action: `${AGENT}SendMessage`,
        kind: "send",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
        context: (args) => ({ recipients: [P.personal], content: str(args, "message") }),
        run: (args) => {
          state.messages.push({ from: "assistant", to: P.personal, text: str(args, "message") });
          return { content: "Request sent." };
        },
      },
      {
        name: "underwriting_refer",
        title: "Refer to underwriting",
        description: "Pass the application to Northgate's underwriting agent.",
        system: S.portal,
        action: `${AGENT}SendMessage`,
        kind: "send",
        inputSchema: {
          type: "object",
          properties: { note: { type: "string" } },
          required: ["note"],
        },
        context: (args) => ({ recipients: [P.underwriter], content: str(args, "note") }),
        run: (args) => {
          state.messages.push({ from: "assistant", to: P.underwriter, text: str(args, "note") });
          return { content: "Referred to underwriting." };
        },
      },
      {
        name: "partner_share",
        title: "Pass details to a partner",
        description: "Share an applicant's details with Homecover Insurance for a quote.",
        system: S.partners,
        action: `${AGENT}SendMessage`,
        kind: "send",
        inputSchema: {
          type: "object",
          properties: { note: { type: "string" } },
          required: ["note"],
        },
        // The note may quote anything Northgate holds, so everything Alex sent travels with it.
        context: (args) => ({
          recipients: [P.homecover],
          purpose: MORTGAGE_PURPOSE.marketing,
          content: str(args, "note"),
          uses: state.received.map((k) => podLabel(record(k))),
        }),
        run: (args) => {
          state.partnerShares.push(str(args, "note"));
          return { content: "Shared with Homecover." };
        },
      },
    ],
    underwriter: [
      applicationRead,
      {
        name: "credit_check",
        title: "Run a credit check",
        description: "Fetch the applicant's credit file from the credit bureau.",
        system: S.bureau,
        action: "read",
        kind: "read",
        inputSchema: { type: "object", properties: {} },
        run: () => {
          (state as { creditChecks: number }).creditChecks++;
          const id = `${S.bureau}/reports/alex-morgan`;
          return {
            items: [
              {
                label: {
                  id,
                  title: "Alex's credit report",
                  source: S.bureau,
                  category: "Credit file",
                  policy: bureauPolicy(id),
                },
                content: { score: 912, missedPayments: 0 },
              },
            ],
          };
        },
      },
      {
        name: "offer_issue",
        title: "Issue a mortgage offer",
        description: "Make a binding mortgage offer to the applicant.",
        system: S.offers,
        action: `${AGENT}Sign`,
        kind: "send",
        inputSchema: {
          type: "object",
          properties: {
            amount: { type: "number" },
            rate: { type: "number" },
            years: { type: "number" },
          },
          required: ["amount", "rate", "years"],
        },
        context: () => ({ recipients: [P.personal] }),
        run: (args) => {
          const n = (k: string) => (typeof args[k] === "number" ? (args[k] as number) : 0);
          state.offers.push({
            amount: n("amount"),
            rate: n("rate"),
            years: n("years"),
            accepted: false,
          });
          return { content: "Offer issued." };
        },
      },
    ],
  };
}

/** A mortgage world: the shared state and one sandbox per agent. */
export interface MortgageWorld {
  readonly state: MortgageState;
  readonly sandboxes: Readonly<Record<MortgageAgent, Sandbox>>;
  readonly directory: Directory;
}

export function createMortgageWorld(
  clock: () => number = () => Date.parse("2026-11-04T09:00:00Z"),
): MortgageWorld {
  const state: MortgageState = {
    received: [],
    messages: [],
    partnerShares: [],
    offers: [],
    creditChecks: 0,
  };
  const tools = mortgageTools(state);
  const agentIri: Record<MortgageAgent, string> = {
    personal: P.personal,
    assistant: P.assistant,
    underwriter: P.underwriter,
  };
  const make = (who: MortgageAgent) =>
    createSandbox({
      tools: tools[who],
      rules: () => ({ mandate: MORTGAGE_MANDATES[who], currency: "GBP" }),
      directory: MORTGAGE_DIRECTORY,
      agent: agentIri[who],
      purpose: MORTGAGE_PURPOSE.mortgage,
      purposes: {
        [MORTGAGE_PURPOSE.mortgage]: "a mortgage application",
        [MORTGAGE_PURPOSE.marketing]: "marketing",
      },
      clock,
    });
  return {
    state,
    directory: MORTGAGE_DIRECTORY,
    sandboxes: {
      personal: make("personal"),
      assistant: make("assistant"),
      underwriter: make("underwriter"),
    },
  };
}

/** One step of the mortgage story. */
export type MortgageStep =
  | {
      readonly kind: "call";
      readonly agent: MortgageAgent;
      /** What the agent is thinking before it acts. */
      readonly thought: string;
      readonly call: { readonly tool: string; readonly args: Args };
      readonly expect: Expectation;
      readonly why: string;
    }
  | {
      /** A person answers the agent's last held call. */
      readonly kind: "approve";
      readonly agent: MortgageAgent;
      readonly by: string;
      readonly why: string;
    };

const call = (
  agent: MortgageAgent,
  thought: string,
  tool: string,
  args: Args,
  expect: Expectation,
  why: string,
): MortgageStep => ({ kind: "call", agent, thought, call: { tool, args }, expect, why });

export const MORTGAGE_STORY = {
  id: "mortgage",
  title: "A mortgage, three agents",
  task: "Apply for a mortgage with Northgate for 14 Mill Lane: £310,000 over 25 years. Share what they need and nothing more.",
  askedBy: "Alex Morgan",
  lesson:
    "Three agents for two organisations, each held to its own rules: Alex's agent by Alex, Northgate's by Northgate. Alex's rules also travelled with Alex's data, so Northgate could use it for the mortgage but not pass it to an insurer, and the health record never left the pod. The binding steps, making and accepting an offer, waited for a person on each side.",
  steps: [
    call(
      "personal",
      "Northgate will need proof of income and ID. I'll get them from Alex's pod.",
      "pod_read",
      { record: "income" },
      "permit",
      "Alex lets the agent read the pod for this application.",
    ),
    call(
      "personal",
      "And Alex's passport.",
      "pod_read",
      { record: "identity" },
      "permit",
      "The same rule covers ID.",
    ),
    call(
      "personal",
      "I'll send both to Northgate with the application.",
      "lender_send",
      {
        documents: ["income", "identity"],
        message:
          "Mortgage application for 14 Mill Lane: £310,000 over 25 years. Payslips and passport attached.",
      },
      "permit",
      "Alex's records may go to Northgate for this application, and Alex is told.",
    ),
    call(
      "assistant",
      "A new application from Alex's agent. Let me open it.",
      "application_read",
      {},
      "permit",
      "The records' own rules allow Northgate to use them for the mortgage.",
    ),
    call(
      "assistant",
      "Underwriting will want three months of bank statements.",
      "request_documents",
      { message: "Thanks. Please send three months of bank statements." },
      "permit",
      "Writing back to the applicant's agent is allowed.",
    ),
    call(
      "personal",
      "Northgate asks for bank statements. That's reasonable for a mortgage.",
      "pod_read",
      { record: "transactions" },
      "permit",
      "Reading statements for the application is allowed.",
    ),
    call(
      "personal",
      "Sending the statements.",
      "lender_send",
      { documents: ["transactions"], message: "Bank statements for August to October attached." },
      "permit",
      "Allowed by Alex's rules, and Alex is told.",
    ),
    call(
      "personal",
      "Northgate's form also asks about health for life cover. I'll check Alex's GP record.",
      "pod_read",
      { record: "health" },
      "stop",
      "Alex's health record is for health care only; it never leaves the pod for a mortgage.",
    ),
    call(
      "assistant",
      "Alex is buying a home. Homecover, our partner, could quote for insurance. I'll pass on the details.",
      "partner_share",
      {
        note: "Alex Morgan, buying 14 Mill Lane, income £5,200 a month. Please quote home insurance.",
      },
      "stop",
      "Northgate allows partner offers with approval, but Alex's own rules say this data is only for the mortgage, so it cannot go to an insurer.",
    ),
    call(
      "assistant",
      "Then I'll just pass the application to underwriting.",
      "underwriting_refer",
      {
        note: "Application from Alex Morgan, £310,000 over 25 years. Payslips, passport and statements on file.",
      },
      "permit",
      "Inside Northgate, for the mortgage: allowed.",
    ),
    call(
      "underwriter",
      "A new referral. I'll open the application.",
      "application_read",
      {},
      "permit",
      "Underwriting may read applications.",
    ),
    call(
      "underwriter",
      "Now the credit file.",
      "credit_check",
      {},
      "permit",
      "Credit checks for a mortgage are allowed.",
    ),
    call(
      "underwriter",
      "Income £5,200 a month, outgoings £1,900, no missed payments. £310,000 is within our limits, so I'll offer it.",
      "offer_issue",
      { amount: 310000, rate: 4.1, years: 25 },
      "review",
      "Every offer is signed off by a senior underwriter.",
    ),
    {
      kind: "approve",
      agent: "underwriter",
      by: "Ruth Okafor (senior underwriter)",
      why: "A person at Northgate signs off the offer.",
    },
    call(
      "personal",
      "Northgate has made an offer: £310,000 at 4.1% over 25 years. It's binding, so Alex decides.",
      "offer_accept",
      {},
      "review",
      "Alex accepts binding agreements personally.",
    ),
    { kind: "approve", agent: "personal", by: "Alex Morgan", why: "Alex accepts the offer." },
  ] as readonly MortgageStep[],
};

/** What one step did: the result, and the gate's decision on it. */
export interface MortgageStepResult {
  readonly result: CallResult;
  readonly decision?: GateDecision;
}

/**
 * Play one step: a call through that agent's own sandbox, or a person approving the agent's
 * oldest held call (which is re-checked before it runs).
 */
export async function runMortgageStep(
  world: MortgageWorld,
  step: MortgageStep,
): Promise<MortgageStepResult> {
  const sandbox = world.sandboxes[step.agent];
  let result: CallResult;
  if (step.kind === "approve") {
    const held = sandbox.held()[0];
    if (!held) throw new Error(`${step.agent} has nothing waiting for approval`);
    result = await sandbox.approve(held.id, step.by);
  } else {
    result = await sandbox.call(step.call);
  }
  const decision = result.entry >= 0 ? sandbox.record.entries()[result.entry]?.decision : undefined;
  return { result, ...(decision && { decision }) };
}
