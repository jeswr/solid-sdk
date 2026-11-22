/**
 * Mandate templates for the pilot's personal agents. Each is a bounded owner mandate in
 * the pilot ODRL subset: specific targets, purposes and recipients; no untargeted grants.
 */
import { scopedUrn } from "./core/canonical.js";
import type { Iri } from "./core/types.js";
import { CONVENTIONAL_BOOK_OP } from "./domains/conventional/registry.js";
import { PAYMENT_OP, SCHEDULE_OP } from "./domains/scheduling.js";
import type { OwnerMandate } from "./mechanisms/mandate.js";
import { AWP, PURPOSE } from "./profile/vocabulary.js";

type Ids = { owner: Iri; actor: Iri; validFrom: string; validUntil: string };

/**
 * Personal scheduling mandate: autonomous meeting negotiation with listed counterparties
 * for the scheduling purpose; meetings with anyone else need a per-action owner approval;
 * no grant at all for payments (`compensate`) — so any fee is denied, not approved.
 */
export function schedulingMandate(knownCounterparties: readonly Iri[]) {
  return (ids: Ids): OwnerMandate => ({
    type: "OwnerMandate",
    id: scopedUrn("mandate", ids.actor, "scheduling"),
    version: 1,
    issuer: ids.owner,
    subject: ids.actor,
    validFrom: ids.validFrom,
    validUntil: ids.validUntil,
    autonomous: {
      id: scopedUrn("policy", ids.actor, "scheduling/autonomous"),
      type: "Set",
      assigner: ids.owner,
      assignee: ids.actor,
      conflict: "prohibit",
      permissions: [
        {
          id: scopedUrn("rule", ids.actor, "schedule-known"),
          type: "permission",
          action: "use",
          target: SCHEDULE_OP.id,
          constraints: [
            { leftOperand: "purpose", operator: "isAnyOf", rightOperand: [PURPOSE.scheduling] },
            {
              leftOperand: "recipient",
              operator: "isAnyOf",
              rightOperand: [...knownCounterparties],
            },
          ],
        },
      ],
      prohibitions: [
        {
          id: scopedUrn("rule", ids.actor, "no-payment"),
          type: "prohibition",
          action: "compensate",
          target: PAYMENT_OP,
        },
      ],
    },
    withApproval: {
      id: scopedUrn("policy", ids.actor, "scheduling/with-approval"),
      type: "Set",
      assigner: ids.owner,
      assignee: ids.actor,
      conflict: "prohibit",
      permissions: [
        {
          id: scopedUrn("rule", ids.actor, "schedule-other"),
          type: "permission",
          action: "use",
          target: SCHEDULE_OP.id,
          constraints: [
            { leftOperand: "purpose", operator: "isAnyOf", rightOperand: [PURPOSE.scheduling] },
          ],
        },
      ],
    },
    note: "Synthetic pilot mandate. Scheduling only; no payments; no other operations.",
  });
}

/**
 * Personal mandate: the scheduling mandate plus bookings through REMEMBERED conventional
 * services (UC-02) — autonomous for listed contacts (`mailto:` IRIs), per-action approval
 * for anyone else, and still no payment grant of any kind.
 */
export function personalMandate(input: {
  knownParties: readonly Iri[];
  knownContacts: readonly string[];
}) {
  return (ids: Ids): OwnerMandate => {
    const base = schedulingMandate(input.knownParties)(ids);
    const purpose = {
      leftOperand: "purpose" as const,
      operator: "isAnyOf" as const,
      rightOperand: [PURPOSE.scheduling],
    };
    return {
      ...base,
      id: scopedUrn("mandate", ids.actor, "personal"),
      autonomous: {
        ...base.autonomous,
        permissions: [
          ...(base.autonomous.permissions ?? []),
          {
            id: scopedUrn("rule", ids.actor, "remembered-service-known"),
            type: "permission",
            action: "use",
            target: CONVENTIONAL_BOOK_OP.id,
            constraints: [
              purpose,
              {
                leftOperand: "recipient",
                operator: "isAnyOf",
                rightOperand: input.knownContacts.map((c) => `mailto:${c.toLowerCase()}`),
              },
            ],
          },
        ],
      },
      withApproval: {
        ...base.withApproval,
        permissions: [
          ...(base.withApproval.permissions ?? []),
          {
            id: scopedUrn("rule", ids.actor, "remembered-service-other"),
            type: "permission",
            action: "use",
            target: CONVENTIONAL_BOOK_OP.id,
            constraints: [purpose],
          },
        ],
      },
      note: "Synthetic pilot mandate. Scheduling (agents and remembered services); no payments.",
    };
  };
}

/** A mandate that includes an operand outside the pilot subset (used to test indeterminate). */
export function mandateWithUnsupportedTerm(ids: Ids): OwnerMandate {
  const base = schedulingMandate([])(ids);
  return {
    ...base,
    id: scopedUrn("mandate", ids.actor, "unsupported"),
    autonomous: {
      ...base.autonomous,
      permissions: [
        {
          type: "permission",
          action: "use",
          target: SCHEDULE_OP.id,
          constraints: [
            { leftOperand: "spatial", operator: "eq", rightOperand: `${AWP}place/home` },
          ],
        },
      ],
    },
  };
}
