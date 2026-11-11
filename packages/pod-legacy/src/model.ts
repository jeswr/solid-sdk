// AUTHORED-BY Codex GPT-6.1-Sol

import { policyToRdf } from "@jeswr/solid-odrl";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import type { Store } from "n3";
import { entities } from "./generated/model.js";
import { type LegacyContact, type LegacyPlan, planPolicy, validPlan } from "./plan.js";

export { entities };
/** Build both entities through generated accessors, then append the SDK's ODRL graph. */
export function buildPlan(url: string, plan: LegacyPlan): Store {
  if (!validPlan(plan)) throw new TypeError("The legacy plan is incomplete or invalid");
  const contactUrls = plan.contacts.map((_, index) => `${url}#contact-${index}`);
  const { contacts, ...data } = plan;
  const store = entities.LegacyPlan.build(url, { ...data, contactUrls });
  contacts.forEach((contact, index) => {
    store.addQuads([
      ...entities.LegacyContact.build(contactUrls[index] as string, {
        ...contact,
        mode: `${NS.ODRL}read`,
      }),
    ]);
  });
  store.addQuads([...policyToRdf(planPolicy(plan, `${url}#policy`))]);
  return store;
}
/** Any invalid linked contact rejects the entire plan; remote contact nodes are never fetched. */
export function parsePlan(url: string, dataset: DatasetCore): LegacyPlan | undefined {
  const data = entities.LegacyPlan.parse(url, dataset);
  if (!data || data.contactUrls.some((id) => !id.startsWith(`${url}#contact-`))) return undefined;
  const contacts: LegacyContact[] = [];
  for (const id of data.contactUrls) {
    const contact = entities.LegacyContact.parse(id, dataset);
    if (
      !contact ||
      contact.mode !== `${NS.ODRL}read` ||
      (contact.scope !== "whole-pod" && contact.scope !== "containers")
    )
      return undefined;
    contacts.push({ ...contact, scope: contact.scope, mode: "read" });
  }
  const { contactUrls: _, ...fields } = data;
  const plan = { ...fields, contacts };
  return validPlan(plan) ? plan : undefined;
}
export function serializePlan(url: string, plan: LegacyPlan): Promise<string> {
  return entities.LegacyPlan.storeToTurtle(buildPlan(url, plan));
}
