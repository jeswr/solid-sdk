/** The personal-agent action catalogue (deterministic; no model, classifier or hosted call). */
import {
  availabilityAction,
  checkSlotAction,
  proposalAction,
  proposeAction,
} from "./calendar/actions.js";
import { capabilityMatrixAction } from "./capabilities.js";
import { contactLookupAction } from "./contacts.js";
import type { ActionsEnv } from "./env.js";
import { inboxNormaliseAction } from "./inbox.js";
import { messagePrepareAction } from "./messages.js";
import { ActionRegistry, type PreparationStore } from "./registry.js";

export function createActionRegistry(preparations?: PreparationStore): ActionRegistry<ActionsEnv> {
  return new ActionRegistry<ActionsEnv>(preparations)
    .register(availabilityAction)
    .register(proposalAction)
    .register(checkSlotAction)
    .register(proposeAction)
    .register(contactLookupAction)
    .register(messagePrepareAction)
    .register(inboxNormaliseAction)
    .register(capabilityMatrixAction);
}

export type { ActionsEnv } from "./env.js";
export { ActionRegistry, FilePreparationStore, MemoryPreparationStore } from "./registry.js";
export type * from "./types.js";
