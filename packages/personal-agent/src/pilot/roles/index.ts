/** Registry of agent roles a persistent agent directory can host (see `roles/types.ts`). */
import { ENERGY_COMPARATOR_ROLE, ENERGY_RETAILER_ROLE } from "./energy.js";
import { HEALTH_AUTHORIZATION_ROLE, HEALTH_PATIENT_ROLE, HEALTH_RESOURCE_ROLE } from "./health.js";
import {
  INDUSTRIAL_AUTHORITY_ROLE,
  INDUSTRIAL_CONTRACTING_ROLE,
  INDUSTRIAL_DIAGNOSTIC_ROLE,
  INDUSTRIAL_PLANNER_ROLE,
  INDUSTRIAL_PROVIDER_ROLE,
} from "./industrial.js";
import {
  MORTGAGE_CONSUMER_ROLE,
  MORTGAGE_LENDER_ROLE,
  MORTGAGE_UNDERWRITER_ROLE,
} from "./mortgage.js";
import { PERSONAL_ROLE } from "./personal.js";
import type { RoleDefinition } from "./types.js";

export const ROLES: Readonly<Record<string, RoleDefinition>> = {
  [PERSONAL_ROLE.id]: PERSONAL_ROLE,
  [MORTGAGE_CONSUMER_ROLE.id]: MORTGAGE_CONSUMER_ROLE,
  [MORTGAGE_LENDER_ROLE.id]: MORTGAGE_LENDER_ROLE,
  [MORTGAGE_UNDERWRITER_ROLE.id]: MORTGAGE_UNDERWRITER_ROLE,
  [ENERGY_RETAILER_ROLE.id]: ENERGY_RETAILER_ROLE,
  [ENERGY_COMPARATOR_ROLE.id]: ENERGY_COMPARATOR_ROLE,
  [HEALTH_PATIENT_ROLE.id]: HEALTH_PATIENT_ROLE,
  [HEALTH_AUTHORIZATION_ROLE.id]: HEALTH_AUTHORIZATION_ROLE,
  [HEALTH_RESOURCE_ROLE.id]: HEALTH_RESOURCE_ROLE,
  [INDUSTRIAL_PLANNER_ROLE.id]: INDUSTRIAL_PLANNER_ROLE,
  [INDUSTRIAL_AUTHORITY_ROLE.id]: INDUSTRIAL_AUTHORITY_ROLE,
  [INDUSTRIAL_PROVIDER_ROLE.id]: INDUSTRIAL_PROVIDER_ROLE,
  [INDUSTRIAL_CONTRACTING_ROLE.id]: INDUSTRIAL_CONTRACTING_ROLE,
  [INDUSTRIAL_DIAGNOSTIC_ROLE.id]: INDUSTRIAL_DIAGNOSTIC_ROLE,
};

export function roleById(id: string | undefined): RoleDefinition {
  const role = ROLES[id ?? "personal"];
  if (!role)
    throw new Error(`unknown role ${JSON.stringify(id)} (${Object.keys(ROLES).join(", ")})`);
  return role;
}

export type { OperationContext, OperatorOperation, RoleDefinition, RoleInstance } from "./types.js";
