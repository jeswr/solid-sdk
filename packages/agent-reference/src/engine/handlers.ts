// AUTHORED-BY Codex GPT-6
/** Closed operation implementations installed from scenario data; all proposals still use gates. */
import { z } from "zod";
import type { JsonObject } from "../core/types.js";
import {
  ConsumerMortgageHandler,
  LenderPrequalHandler,
  LenderUnderwritingHandler,
  UnderwriterHandler,
  type WalletItem,
} from "../domains/mortgage.js";
import type { PurposeBoundStore } from "../domains/purpose-store.js";
import {
  BalanceRequestHandler,
  BalanceStatementHandler,
  ProductIndexHandler,
  ProductSearchHandler,
} from "../reference/main-fixtures.js";
import type { HandlerContext, HandlerReply, OperationHandler } from "../runtime/operations.js";
import type { Scenario } from "./schema.js";

const iri = z.string();
const models = z.array(z.strictObject({ id: iri, version: z.string() }));
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing handler implementation dependency");
  return value;
}
class LenderWithCounterPurpose extends LenderPrequalHandler {
  constructor(
    config: ConstructorParameters<typeof LenderPrequalHandler>[0],
    private readonly counterPurpose?: string,
  ) {
    super(config);
  }
  override onProposal(
    ctx: HandlerContext,
    body: Parameters<LenderPrequalHandler["onProposal"]>[1],
  ): HandlerReply {
    const reply = super.onProposal(ctx, body);
    if (reply.type !== "counter" || !this.counterPurpose) return reply;
    return {
      ...reply,
      terms: {
        ...reply.terms,
        purpose: this.counterPurpose,
        onward: (reply.terms.onward as JsonObject[]).map((onward) => ({
          ...onward,
          purpose: this.counterPurpose as string,
        })),
      },
    };
  }
}
export function installHandler(
  spec: Scenario["handlerImplementations"][string],
  statements: Readonly<Record<string, { jws: string; statement: JsonObject }>>,
  stores: ReadonlyMap<string, PurposeBoundStore>,
): OperationHandler {
  switch (spec.template) {
    case "mortgage-consumer": {
      const p = z
        .strictObject({
          wallet: z.array(z.string()),
          policy: z.strictObject({
            requireProhibited: z.array(iri),
            maxRetentionDays: z.number(),
            allowedOnward: z.array(iri),
          }),
        })
        .parse(spec.params);
      return new ConsumerMortgageHandler(
        p.wallet.map((id) => required(statements[id])) as unknown as WalletItem[],
        p.policy,
      );
    }
    case "mortgage-lender": {
      const p = z
        .strictObject({
          lender: iri,
          underwriter: iri,
          acceptedModels: models,
          retentionDays: z.number(),
          store: z.string(),
          derivationRule: iri.optional(),
          counterPurpose: iri.optional(),
        })
        .parse(spec.params);
      return new LenderWithCounterPurpose(
        { ...p, store: required(stores.get(p.store)) },
        p.counterPurpose,
      );
    }
    case "product-search":
      return new ProductSearchHandler();
    case "balance-request":
      return new BalanceRequestHandler();
    case "lender-underwriting":
      return new LenderUnderwritingHandler();
    case "underwriter":
      return new UnderwriterHandler();
    case "product-index": {
      const p = z.strictObject({ records: z.array(z.string()) }).parse(spec.params);
      return new ProductIndexHandler(
        p.records.map((id) => ({
          jws: required(statements[id]).jws,
          record: required(statements[id]).statement,
        })),
      );
    }
    case "balance-statement": {
      const p = z
        .strictObject({
          statement: z.string(),
          label: z.string(),
          terms: z.strictObject({ id: iri, text: z.string() }),
        })
        .parse(spec.params);
      const statement = required(statements[p.statement]);
      return new BalanceStatementHandler(
        { id: String(statement.statement.id), jws: statement.jws, label: p.label },
        p.terms,
        typeof statement.statement.subject === "string" ? statement.statement.subject : undefined,
      );
    }
  }
}
