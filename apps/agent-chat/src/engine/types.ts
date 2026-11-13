// AUTHORED-BY Claude Opus 5.5
import type {
  ApprovalRequest,
  CheckLine,
  Fact,
  Money,
  Outcome,
  SpendingRule,
} from "@jeswr/agent-consent";

export interface ProductView {
  readonly id: string;
  readonly name: string;
  readonly store: string;
  readonly storeId: string;
  readonly price: Money;
  readonly delivery: string;
  readonly returns: string;
  readonly variants: readonly string[];
  readonly color: string;
  readonly art: "sneaker" | "sock" | "jacket";
  readonly note?: string;
}

export type ProgressState = "pending" | "running" | "done" | "asked" | "stopped";

export type ChatMessage = { readonly id: string; readonly at: string } & (
  | {
      readonly type: "text";
      readonly role: "user" | "agent";
      readonly text: string;
      readonly streaming?: boolean;
    }
  | { readonly type: "products"; readonly items: readonly ProductView[]; readonly chosen?: string }
  | {
      readonly type: "comparison";
      readonly columns: readonly {
        readonly id: string;
        readonly title: string;
        readonly party: string;
        readonly best?: string;
      }[];
      readonly rows: readonly { readonly label: string; readonly values: readonly string[] }[];
      readonly footnote?: string;
    }
  | {
      readonly type: "offer";
      readonly party: string;
      readonly headline: string;
      readonly rows: readonly Fact[];
      readonly binding: boolean;
      readonly sourceLine: string;
      readonly recordId: string;
    }
  | {
      readonly type: "receipt";
      readonly store: string;
      readonly items: readonly { readonly name: string; readonly price: Money }[];
      readonly total: Money;
      readonly orderRef: string;
      readonly authority: string;
      readonly recordId: string;
    }
  | {
      readonly type: "limit-chip";
      readonly ruleId: string;
      readonly label: string;
      readonly used: Money;
      readonly limit: Money;
      readonly tone: "go" | "ask";
    }
  | {
      readonly type: "progress";
      readonly title: string;
      readonly steps: readonly {
        readonly id: string;
        readonly label: string;
        readonly party?: string;
        readonly state: ProgressState;
      }[];
    }
  | {
      readonly type: "approval";
      readonly requestId: string;
      readonly summary: string;
      readonly state:
        | "pending"
        | "approved-once"
        | "standing-set"
        | "denied"
        | "expired"
        | "cancelled";
      readonly resolvedAt?: string;
    }
  | {
      readonly type: "blocked";
      readonly title: string;
      readonly quoted?: string;
      readonly source: string;
      readonly notDone: string;
      readonly checks: readonly CheckLine[];
      readonly recordId: string;
    }
  | {
      readonly type: "rule-change";
      readonly rule: SpendingRule;
      readonly summary: string;
      readonly change: "created" | "raised" | "revoked";
      readonly undoUntil?: string;
    }
  | {
      readonly type: "sign-in";
      readonly site: string;
      readonly account: string;
      readonly method: string;
    }
  | { readonly type: "stopped" }
);

export interface Chat {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly ChatMessage[];
}

export interface ActivityEntry {
  readonly id: string;
  readonly at: string;
  readonly outcome: Outcome;
  readonly filter: "purchases" | "shared" | "asked" | "blocked" | "sign-ins";
  readonly summary: string;
  readonly detail?: string;
  readonly checks: readonly CheckLine[];
  readonly inbound?: readonly CheckLine[];
  readonly digest?: string;
  readonly authority?: string;
  /** Compact JWS of the principal's consent record behind it, when there is one. */
  readonly consentJws?: string;
}

export interface RuleView {
  readonly rule: SpendingRule;
  readonly jws: string;
  readonly label: string;
  readonly summary: string;
  readonly used: Money;
  readonly remaining: Money;
  readonly resetsAt?: string;
}

export interface PendingApproval {
  readonly chatId: string;
  readonly request: ApprovalRequest;
}

export interface EngineState {
  readonly chats: readonly Chat[];
  readonly activeChat: string;
  readonly pending?: PendingApproval;
  readonly rules: readonly RuleView[];
  readonly activity: readonly ActivityEntry[];
  readonly stopped: boolean;
  readonly working: boolean;
  readonly core: "scripted" | "live";
  readonly liveAvailable: boolean;
  readonly deviceKid?: string;
}

/** A message before the engine stamps its id and time (distributes over the union). */
export type NewMessage = ChatMessage extends infer M
  ? M extends unknown
    ? Omit<M, "id" | "at"> & { id?: string }
    : never
  : never;
