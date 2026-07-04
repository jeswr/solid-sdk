// src/errors.ts
var PHASE_A_CODES = /* @__PURE__ */ new Set([
  "MALFORMED",
  "NO_PROOF",
  "UNKNOWN_CRYPTOSUITE",
  "INVALID_SIGNATURE",
  "EXPIRED",
  "NOT_YET_VALID",
  "ISSUER_MISMATCH",
  "PROOF_PURPOSE_MISMATCH",
  "UNTRUSTED_ISSUER"
]);
var RELATED_RESOURCE_CODES = /* @__PURE__ */ new Set([
  "RELATED_RESOURCE_MISSING",
  "RELATED_RESOURCE_MISMATCH"
]);
var STATUS_GATE_CODES = /* @__PURE__ */ new Set([
  "STATUS_REVOKED",
  "STATUS_SUSPENDED",
  "STATUS_UNREACHABLE"
]);

// node_modules/@jeswr/rdf-serialize/dist/serialize.js
import { Writer } from "n3";

// node_modules/@jeswr/solid-odrl/dist/index.js
import {
  BlankNodeFrom,
  DatasetWrapper,
  LiteralFrom,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import contentType from "content-type";
import { Store as Store2, StreamParser } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";
var ODRL = "http://www.w3.org/ns/odrl/2/";
var ACL = "http://www.w3.org/ns/auth/acl#";
var XSD = "http://www.w3.org/2001/XMLSchema#";
var PROV = "http://www.w3.org/ns/prov#";
var ODRLD = "https://w3id.org/jeswr/odrl-delegation#";
var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDF_TYPE = `${RDF}type`;
var ODRL_POLICY = `${ODRL}Policy`;
var ODRL_SET = `${ODRL}Set`;
var ODRL_OFFER = `${ODRL}Offer`;
var ODRL_AGREEMENT = `${ODRL}Agreement`;
var ODRL_PERMISSION_CLASS = `${ODRL}Permission`;
var ODRL_PROHIBITION_CLASS = `${ODRL}Prohibition`;
var ODRL_DUTY_CLASS = `${ODRL}Duty`;
var ODRL_CONSTRAINT_CLASS = `${ODRL}Constraint`;
var ODRL_ACTION_CLASS = `${ODRL}Action`;
var ODRL_UID = `${ODRL}uid`;
var ODRL_PROFILE = `${ODRL}profile`;
var ODRL_PERMISSION = `${ODRL}permission`;
var ODRL_PROHIBITION = `${ODRL}prohibition`;
var ODRL_OBLIGATION = `${ODRL}obligation`;
var ODRL_DUTY = `${ODRL}duty`;
var ODRL_ACTION = `${ODRL}action`;
var ODRL_TARGET = `${ODRL}target`;
var ODRL_ASSIGNER = `${ODRL}assigner`;
var ODRL_ASSIGNEE = `${ODRL}assignee`;
var ODRL_CONSTRAINT = `${ODRL}constraint`;
var ODRL_CONFLICT = `${ODRL}conflict`;
var ODRL_LEFT_OPERAND = `${ODRL}leftOperand`;
var ODRL_OPERATOR = `${ODRL}operator`;
var ODRL_RIGHT_OPERAND = `${ODRL}rightOperand`;
var ODRL_PERM = `${ODRL}perm`;
var ODRL_PROHIBIT = `${ODRL}prohibit`;
var ODRL_INVALID = `${ODRL}invalid`;
var CONFLICT_IRI = {
  perm: ODRL_PERM,
  prohibit: ODRL_PROHIBIT,
  invalid: ODRL_INVALID
};
var IRI_TO_CONFLICT = Object.fromEntries(
  Object.entries(CONFLICT_IRI).map(([k, v]) => [v, k])
);
var ODRL_USE = `${ODRL}use`;
var ODRL_READ = `${ODRL}read`;
var ODRL_WRITE = `${ODRL}write`;
var ODRL_MODIFY = `${ODRL}modify`;
var ODRL_DELETE = `${ODRL}delete`;
var ODRL_DISTRIBUTE = `${ODRL}distribute`;
var ODRL_AGGREGATE = `${ODRL}aggregate`;
var ODRL_INDEX = `${ODRL}index`;
var ODRL_ARCHIVE = `${ODRL}archive`;
var ODRL_ATTRIBUTE = `${ODRL}attribute`;
var ODRL_COMPENSATE = `${ODRL}compensate`;
var ODRL_INFORM = `${ODRL}inform`;
var ODRL_ANONYMIZE = `${ODRL}anonymize`;
var ODRL_GRANT_USE = `${ODRL}grantUse`;
var ODRL_NEXT_POLICY = `${ODRL}nextPolicy`;
var ODRL_TRANSFER = `${ODRL}transfer`;
var ACTION_APPEND_IRI = `${ACL}Append`;
var ACTION_CONTROL_IRI = `${ACL}Control`;
var ODRL_ACTIONS = [
  "use",
  "read",
  "write",
  "modify",
  "delete",
  "distribute",
  "aggregate",
  "index",
  "archive",
  "attribute",
  "compensate",
  "inform",
  "anonymize",
  "append",
  "control",
  "grantUse",
  "nextPolicy",
  "transfer"
];
var ACTION_IRI = {
  use: ODRL_USE,
  read: ODRL_READ,
  write: ODRL_WRITE,
  modify: ODRL_MODIFY,
  delete: ODRL_DELETE,
  distribute: ODRL_DISTRIBUTE,
  aggregate: ODRL_AGGREGATE,
  index: ODRL_INDEX,
  archive: ODRL_ARCHIVE,
  attribute: ODRL_ATTRIBUTE,
  compensate: ODRL_COMPENSATE,
  inform: ODRL_INFORM,
  anonymize: ODRL_ANONYMIZE,
  // Solid-resource access concepts — backed by the standard acl: mode IRIs (OAC
  // practice), NOT minted, and deliberately distinct from the ODRL data-use actions.
  append: ACTION_APPEND_IRI,
  control: ACTION_CONTROL_IRI,
  // Delegation concepts — standard ODRL 2.2 IRIs (see the constants above).
  grantUse: ODRL_GRANT_USE,
  nextPolicy: ODRL_NEXT_POLICY,
  transfer: ODRL_TRANSFER
};
var IRI_TO_ACTION = Object.fromEntries(
  Object.entries(ACTION_IRI).map(([k, v]) => [v, k])
);
var VALID_ACTION_IRIS = new Set(Object.values(ACTION_IRI));
var NOT_UNDER_USE = /* @__PURE__ */ new Set([
  "control",
  "grantUse",
  "nextPolicy",
  "transfer"
]);
var EXTRA_IMPLIED_BY = {
  append: ["write"]
};
var ACTION_IMPLIED_BY = Object.fromEntries(
  ODRL_ACTIONS.map((a) => {
    const implied = /* @__PURE__ */ new Set([a]);
    if (a !== "use" && !NOT_UNDER_USE.has(a)) {
      implied.add("use");
    }
    for (const stronger of EXTRA_IMPLIED_BY[a] ?? []) {
      implied.add(stronger);
    }
    return [a, implied];
  })
);
var ACL_READ = `${ACL}Read`;
var ACL_WRITE = `${ACL}Write`;
var ACL_APPEND = `${ACL}Append`;
var ACL_CONTROL = `${ACL}Control`;
var ODRL_DATETIME = `${ODRL}dateTime`;
var ODRL_PURPOSE = `${ODRL}purpose`;
var ODRL_RECIPIENT = `${ODRL}recipient`;
var ODRL_COUNT = `${ODRL}count`;
var ODRL_SPATIAL = `${ODRL}spatial`;
var ODRL_ELAPSED_TIME = `${ODRL}elapsedTime`;
var ODRL_SYSTEM_DEVICE = `${ODRL}systemDevice`;
var ODRLD_DELEGATION_DEPTH = `${ODRLD}delegationDepth`;
var LEFT_OPERAND_IRI = {
  dateTime: ODRL_DATETIME,
  purpose: ODRL_PURPOSE,
  recipient: ODRL_RECIPIENT,
  count: ODRL_COUNT,
  spatial: ODRL_SPATIAL,
  elapsedTime: ODRL_ELAPSED_TIME,
  systemDevice: ODRL_SYSTEM_DEVICE,
  delegationDepth: ODRLD_DELEGATION_DEPTH
};
var IRI_TO_LEFT_OPERAND = Object.fromEntries(
  Object.entries(LEFT_OPERAND_IRI).map(([k, v]) => [v, k])
);
var ODRL_EQ = `${ODRL}eq`;
var ODRL_NEQ = `${ODRL}neq`;
var ODRL_GT = `${ODRL}gt`;
var ODRL_GTEQ = `${ODRL}gteq`;
var ODRL_LT = `${ODRL}lt`;
var ODRL_LTEQ = `${ODRL}lteq`;
var ODRL_IS_ANY_OF = `${ODRL}isAnyOf`;
var ODRL_IS_ALL_OF = `${ODRL}isAllOf`;
var ODRL_IS_NONE_OF = `${ODRL}isNoneOf`;
var OPERATOR_IRI = {
  eq: ODRL_EQ,
  neq: ODRL_NEQ,
  gt: ODRL_GT,
  gteq: ODRL_GTEQ,
  lt: ODRL_LT,
  lteq: ODRL_LTEQ,
  isAnyOf: ODRL_IS_ANY_OF,
  isAllOf: ODRL_IS_ALL_OF,
  isNoneOf: ODRL_IS_NONE_OF
};
var IRI_TO_OPERATOR = Object.fromEntries(
  Object.entries(OPERATOR_IRI).map(([k, v]) => [v, k])
);
var ODRLD_DELEGATED_UNDER = `${ODRLD}delegatedUnder`;
var ODRLD_REVOCATION_CLASS = `${ODRLD}Revocation`;
var ODRLD_REVOKED_POLICY = `${ODRLD}revokedPolicy`;
var PROV_WAS_ATTRIBUTED_TO = `${PROV}wasAttributedTo`;
var PROV_ACTED_ON_BEHALF_OF = `${PROV}actedOnBehalfOf`;
var PROV_WAS_DERIVED_FROM = `${PROV}wasDerivedFrom`;
var PROV_ACTIVITY = `${PROV}Activity`;
var PROV_ASSOCIATION = `${PROV}Association`;
var PROV_WAS_ASSOCIATED_WITH = `${PROV}wasAssociatedWith`;
var PROV_USED = `${PROV}used`;
var PROV_GENERATED = `${PROV}generated`;
var PROV_STARTED_AT_TIME = `${PROV}startedAtTime`;
var PROV_ENDED_AT_TIME = `${PROV}endedAtTime`;
var PROV_QUALIFIED_ASSOCIATION = `${PROV}qualifiedAssociation`;
var PROV_AGENT = `${PROV}agent`;
var PROV_HAD_PLAN = `${PROV}hadPlan`;
var PROV_WAS_GENERATED_BY = `${PROV}wasGeneratedBy`;
var XSD_DATETIME = `${XSD}dateTime`;
function evaluate(policy, request, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const effectiveProhibitions = (policy.prohibitions ?? []).map((r) => effectiveRule(r, policy));
  const matchedPermissionRules = matchingPermissions(policy, request, { now });
  const matchedProhibitionRules = effectiveProhibitions.filter((r) => ruleMatches(r, request, now));
  const matchedPermissions = matchedPermissionRules.map((r) => toDecisionRule(r, "permission"));
  const matchedProhibitions = matchedProhibitionRules.map((r) => toDecisionRule(r, "prohibition"));
  const hasPermit = matchedPermissions.length > 0;
  const hasProhibit = matchedProhibitions.length > 0;
  const conflict = hasPermit && hasProhibit;
  const duties = collectDuties(policy, matchedPermissionRules, request, now);
  if (!hasPermit && !hasProhibit) {
    return result(
      "notApplicable",
      "No permission or prohibition matches the request.",
      matchedPermissions,
      matchedProhibitions,
      [],
      false
    );
  }
  if (conflict) {
    const strategy = policy.conflict ?? "prohibit";
    if (strategy === "perm") {
      return decidePermit(
        matchedPermissions,
        matchedProhibitions,
        duties,
        options,
        "Conflict resolved by odrl:perm \u2014 permission overrides prohibition.",
        true
      );
    }
    if (strategy === "invalid") {
      return result(
        "deny",
        "Conflict resolved by odrl:invalid \u2014 the policy is void; denying (fail-closed).",
        matchedPermissions,
        matchedProhibitions,
        [],
        true
      );
    }
    return result(
      "deny",
      "Conflict resolved by odrl:prohibit \u2014 prohibition overrides permission.",
      matchedPermissions,
      matchedProhibitions,
      [],
      true
    );
  }
  if (hasProhibit) {
    return result(
      "deny",
      "A prohibition matches the request.",
      matchedPermissions,
      matchedProhibitions,
      [],
      false
    );
  }
  return decidePermit(
    matchedPermissions,
    matchedProhibitions,
    duties,
    options,
    "A permission matches the request.",
    false
  );
}
function matchingPermissions(policy, request, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  return (policy.permissions ?? []).map((r) => effectiveRule(r, policy)).filter((r) => ruleMatches(r, request, now));
}
function decidePermit(perms, prohibits, duties, options, reason, conflict) {
  if (options.requireDuties) {
    const outstanding = duties.filter((d) => !d.fulfilled);
    if (outstanding.length > 0) {
      const names = outstanding.map((d) => d.action).join(", ");
      return result(
        "deny",
        `${reason} But requireDuties is set and these duties are unfulfilled: ${names}.`,
        perms,
        prohibits,
        duties,
        conflict
      );
    }
  }
  return result("permit", reason, perms, prohibits, duties, conflict);
}
function result(decision, reason, matchedPermissions, matchedProhibitions, duties, conflict) {
  return { decision, reason, matchedPermissions, matchedProhibitions, duties, conflict };
}
function effectiveRule(rule, policy) {
  const assignee = rule.assignee ?? policy.assignee;
  const assigner = rule.assigner ?? policy.assigner;
  if (assignee === rule.assignee && assigner === rule.assigner) {
    return rule;
  }
  return {
    ...rule,
    ...assignee !== void 0 && { assignee },
    ...assigner !== void 0 && { assigner }
  };
}
function toDecisionRule(rule, type) {
  return {
    type,
    action: rule.action,
    ...rule.target !== void 0 && { target: rule.target },
    ...rule.assignee !== void 0 && { assignee: rule.assignee },
    ...rule.id !== void 0 && { id: rule.id }
  };
}
function ruleMatches(rule, request, now) {
  if (!actionApplies(rule.action, request.action)) {
    return false;
  }
  if (rule.target !== void 0 && rule.target !== request.target) {
    return false;
  }
  if (rule.assignee !== void 0 && rule.assignee !== request.agent) {
    return false;
  }
  for (const c of rule.constraints ?? []) {
    if (!constraintSatisfied(c, request, now)) {
      return false;
    }
  }
  return true;
}
function actionApplies(ruleAction, requested) {
  return ACTION_IMPLIED_BY[requested].has(ruleAction);
}
function collectDuties(policy, matchedPermissionRules, request, now) {
  const out = [];
  for (const rule of matchedPermissionRules) {
    for (const duty of rule.duties ?? []) {
      out.push(toActiveDuty(duty, request, now));
    }
  }
  for (const duty of policy.obligations ?? []) {
    out.push(toActiveDuty(duty, request, now));
  }
  return out;
}
function toActiveDuty(duty, request, now) {
  const constraintsOk = (duty.constraints ?? []).every((c) => constraintSatisfied(c, request, now));
  const key = `fulfilled:${duty.action}`;
  const asserted = request.attributes?.[key];
  const dischargedAsserted = asserted === true || asserted === "true" || asserted === 1;
  return {
    action: duty.action,
    ...duty.target !== void 0 && { target: duty.target },
    ...duty.id !== void 0 && { id: duty.id },
    fulfilled: constraintsOk && dischargedAsserted
  };
}
function constraintSatisfied(c, request, now) {
  const supplied = requestValueFor(c, request, now);
  if (supplied === void 0) {
    return false;
  }
  return compare(supplied, c, c.operator);
}
function requestValueFor(c, request, now) {
  const fromAttrs = request.attributes?.[c.leftOperand];
  if (fromAttrs !== void 0) {
    if (typeof fromAttrs === "boolean") {
      return void 0;
    }
    return fromAttrs;
  }
  if (c.leftOperand === "dateTime") {
    return now.toISOString();
  }
  return void 0;
}
function compare(requestValue, c, operator) {
  const rights = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  const scalar = Array.isArray(requestValue) ? requestValue[0] : requestValue;
  const right0 = rights[0];
  switch (operator) {
    case "eq":
      return scalarsEqual(scalar, right0, c);
    case "neq":
      return !scalarsEqual(scalar, right0, c);
    case "gt":
      return numericOrTemporalCompare(scalar, right0, c) > 0;
    case "gteq":
      return numericOrTemporalCompare(scalar, right0, c) >= 0;
    case "lt":
      return numericOrTemporalCompare(scalar, right0, c) < 0;
    case "lteq":
      return numericOrTemporalCompare(scalar, right0, c) <= 0;
    case "isAnyOf":
      return asArray2(requestValue).some((rv) => rights.some((r) => scalarsEqual(rv, r, c)));
    case "isNoneOf":
      return asArray2(requestValue).every((rv) => rights.every((r) => !scalarsEqual(rv, r, c)));
    case "isAllOf": {
      const rvSet = asArray2(requestValue);
      return rights.every((r) => rvSet.some((rv) => scalarsEqual(rv, r, c)));
    }
    default:
      return false;
  }
}
function asArray2(v) {
  return Array.isArray(v) ? v : [v];
}
function scalarsEqual(a, b, c) {
  const cmp = tryNumericOrTemporal(a, b, c);
  if (cmp !== void 0) {
    return cmp === 0;
  }
  return String(a) === String(b);
}
function cmp3(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function numericOrTemporalCompare(a, b, c) {
  const typed = tryNumericOrTemporal(a, b, c);
  if (typed !== void 0) {
    return typed;
  }
  return cmp3(String(a), String(b));
}
function tryNumericOrTemporal(a, b, c) {
  const isTemporal = c.leftOperand === "dateTime" || c.datatype === `${XSD}dateTime` || c.datatype === `${XSD}date`;
  if (isTemporal) {
    const ta = Date.parse(String(a));
    const tb = Date.parse(String(b));
    return Number.isNaN(ta) || Number.isNaN(tb) ? void 0 : cmp3(ta, tb);
  }
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) {
    return void 0;
  }
  return cmp3(Number(a), Number(b));
}
function isFiniteNumber(v) {
  if (typeof v === "number") {
    return Number.isFinite(v);
  }
  const s = v.trim();
  if (s === "") {
    return false;
  }
  return Number.isFinite(Number(s));
}
var DEFAULT_MAX_CHAIN_LENGTH = 8;
function evaluateDelegated(chain, request, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const maxLen = options.maxChainLength ?? DEFAULT_MAX_CHAIN_LENGTH;
  const hops = [];
  if (chain.length === 0) {
    return denied("Empty delegation chain \u2014 nothing grants the request.", hops);
  }
  if (!Number.isInteger(maxLen) || maxLen < 1) {
    return denied(`Invalid maxChainLength ${String(maxLen)} \u2014 must be a positive integer.`, hops);
  }
  if (chain.length > maxLen) {
    return denied(
      `Chain length ${chain.length} exceeds the maximum ${maxLen} (maxChainLength).`,
      hops
    );
  }
  const req = stripDelegationDepth(request);
  const seen = /* @__PURE__ */ new Set();
  for (const [i, policy] of chain.entries()) {
    if (policy.id === void 0 || policy.id === "") {
      return denied(`Hop ${i} has no policy id \u2014 the chain edge cannot be verified.`, hops);
    }
    if (seen.has(policy.id)) {
      return denied(`Cyclic chain: policy <${policy.id}> appears more than once.`, hops);
    }
    seen.add(policy.id);
  }
  const revoked = new Set(
    typeof options.revoked === "string" ? [options.revoked] : options.revoked ?? []
  );
  for (const [i, policy] of chain.entries()) {
    if (revoked.has(policy.id)) {
      return denied(`Hop ${i} (<${policy.id}>) has been revoked.`, hops);
    }
  }
  const strictProhibitions = chain.length > 1;
  const aggregateDuties = [];
  for (let i = 1; i < chain.length; i++) {
    const parent = chain[i - 1];
    const child = chain[i];
    const remainingDepth = chain.length - i;
    const edge = checkDelegationEdge(parent, child, remainingDepth, req, now);
    if (!edge.ok) {
      hops.push({ index: i, policyId: child.id, ok: false, reason: edge.reason });
      return denied(`Hop ${i} (<${child.id}>): ${edge.reason}`, hops);
    }
    hops.push({ index: i, policyId: child.id, ok: true, reason: "ok" });
    aggregateDuties.push(...edge.duties);
  }
  for (let i = 0; i < chain.length - 1; i++) {
    const ancestor = chain[i];
    const delegator = chain[i + 1].assigner;
    const scope = evaluate(ancestor, { ...req, agent: delegator }, { now });
    if (scope.decision !== "permit" || scope.matchedProhibitions.length > 0) {
      return denied(
        `Hop ${i} (<${ancestor.id}>) does not cleanly grant the requested capability to its delegate <${delegator}> (${scope.decision}${scope.matchedProhibitions.length > 0 ? ", with a matched prohibition" : ""}: ${scope.reason}) \u2014 a delegate cannot receive more than the delegator holds.`,
        hops
      );
    }
    const direct = evaluate(ancestor, req, { now });
    if (direct.decision === "deny" || direct.matchedProhibitions.length > 0) {
      return denied(
        `Hop ${i} (<${ancestor.id}>) prohibits the request directly (${direct.reason}).`,
        hops
      );
    }
    aggregateDuties.push(...scope.duties);
  }
  const leafPolicy = chain[chain.length - 1];
  const leaf = evaluate(leafPolicy, req, { now });
  if (leaf.decision !== "permit" || strictProhibitions && leaf.matchedProhibitions.length > 0) {
    return {
      ...denied(
        leaf.decision !== "permit" ? `Leaf policy <${leafPolicy.id}> does not permit: ${leaf.reason}` : `Leaf policy <${leafPolicy.id}> permits only via its odrl:perm conflict strategy over a matched prohibition \u2014 prohibitions are strict in a delegation chain.`,
        hops
      ),
      leaf
    };
  }
  if (chain.length > 1 && req.agent !== leafPolicy.assignee) {
    return {
      ...denied(
        `Leaf policy <${leafPolicy.id}> permits the request, but its actual actor <${req.agent ?? "(none)"}> is not the hop's declared delegate <${leafPolicy.assignee ?? "(none)"}> \u2014 a delegated hop must not grant to a party other than its odrl:assignee (identity-composition guard).`,
        hops
      ),
      leaf
    };
  }
  aggregateDuties.push(...leaf.duties);
  const duties = dedupeDuties(aggregateDuties);
  if (options.requireDuties) {
    const outstanding = duties.filter((d) => !d.fulfilled);
    if (outstanding.length > 0) {
      const names = outstanding.map((d) => d.action).join(", ");
      return {
        ...denied(
          `Chain permits, but requireDuties is set and these chain duties are unfulfilled: ${names}.`,
          hops
        ),
        leaf,
        duties
      };
    }
  }
  return {
    decision: "permit",
    reason: chain.length === 1 ? "The policy permits the request (single-policy chain)." : `Every hop of the ${chain.length - 1}-hop delegation chain is valid and the request is within the chain intersection.`,
    hops,
    leaf,
    duties
  };
}
function edgeFailure(reason) {
  return { ok: false, reason };
}
function checkDelegationEdge(parent, child, remainingDepth, req, now) {
  if (child.type !== "Agreement") {
    return edgeFailure(`a delegated hop must be an odrl:Agreement (got ${child.type ?? "Set"}).`);
  }
  if (child.assigner === void 0 || child.assignee === void 0) {
    return edgeFailure(
      "a delegated hop must name both assigner (the delegator) and assignee (the delegate)."
    );
  }
  if (child.delegatedUnder !== parent.id) {
    return edgeFailure(
      `the hop must declare odrld:delegatedUnder <${parent.id}> (got ${child.delegatedUnder === void 0 ? "none" : `<${child.delegatedUnder}>`}).`
    );
  }
  const authRequest = {
    agent: child.assigner,
    action: "grantUse",
    ...req.target !== void 0 && { target: req.target },
    attributes: { ...req.attributes ?? {}, delegationDepth: remainingDepth }
  };
  const auth = evaluate(parent, authRequest, { now });
  if (auth.decision !== "permit" || auth.matchedProhibitions.length > 0) {
    return edgeFailure(
      `the parent policy does not cleanly authorise delegation by <${child.assigner}> (${auth.decision}${auth.matchedProhibitions.length > 0 ? ", with a matched prohibition" : ""}: ${auth.reason}).`
    );
  }
  const candidates = matchingPermissions(parent, authRequest, { now }).filter(
    (r) => r.action === "grantUse" && r.assignee === child.assigner
  );
  if (candidates.length === 0) {
    return edgeFailure(
      `the parent policy has no grantUse permission explicitly naming <${child.assigner}> as assignee (an assignee-free grantUse does not authorise delegation).`
    );
  }
  const authorizing = [];
  const failures = [];
  for (const rule of candidates) {
    const failure = checkGrantUseRule(rule, child, remainingDepth);
    if (failure === void 0) {
      authorizing.push(rule);
    } else {
      failures.push(failure);
    }
  }
  if (authorizing.length === 0) {
    return edgeFailure(failures.join(" / "));
  }
  const dutySource = {
    id: parent.id,
    permissions: authorizing,
    ...parent.obligations !== void 0 && { obligations: parent.obligations }
  };
  const edgeDuties = evaluate(dutySource, authRequest, { now }).duties;
  return {
    ok: true,
    duties: edgeDuties.filter((d) => d.action !== "nextPolicy")
  };
}
function checkGrantUseRule(rule, child, remainingDepth) {
  const hasDepthConstraint = (rule.constraints ?? []).some(
    (c) => c.leftOperand === "delegationDepth"
  );
  if (!hasDepthConstraint && remainingDepth > 1) {
    return `grantUse permission carries no delegationDepth constraint, so its budget is the profile default of 1 hop \u2014 ${remainingDepth} remaining hops exceed it`;
  }
  for (const duty of rule.duties ?? []) {
    if (duty.action !== "nextPolicy") {
      continue;
    }
    if (duty.target === void 0) {
      return "grantUse permission carries a nextPolicy duty with no target policy (malformed)";
    }
    if (duty.target !== child.id) {
      return `grantUse permission mandates nextPolicy <${duty.target}> but the delegated hop is <${child.id}>`;
    }
  }
  return void 0;
}
function denied(reason, hops) {
  return { decision: "deny", reason, hops, duties: [] };
}
function stripDelegationDepth(request) {
  if (request.attributes === void 0 || !("delegationDepth" in request.attributes)) {
    return request;
  }
  const { delegationDepth: _reserved, ...rest } = request.attributes;
  const { attributes: _dropped, ...requestWithout } = request;
  return Object.keys(rest).length > 0 ? { ...requestWithout, attributes: rest } : requestWithout;
}
function dedupeDuties(duties) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const d of duties) {
    const key = `${d.action}\0${d.target ?? ""}\0${d.id ?? ""}\0${d.fulfilled}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

// node_modules/@jeswr/solid-vc/dist/index.js
import { createHash } from "node:crypto";
import { canonize } from "rdf-canonize";
import { randomUUID } from "node:crypto";
import contentType2 from "content-type";
import { Store as Store3, StreamParser as StreamParser2 } from "n3";
import { JsonLdParser as JsonLdParser2 } from "jsonld-streaming-parser";
import { createHash as createHash2 } from "node:crypto";
import { base58btc } from "multiformats/bases/base58";
import { Writer as Writer2 } from "n3";
import {
  BlankNodeFrom as BlankNodeFrom2,
  DatasetWrapper as DatasetWrapper2,
  LiteralFrom as LiteralFrom2,
  NamedNodeFrom as NamedNodeFrom2,
  SetFrom as SetFrom2,
  TermAs as TermAs2,
  TermFrom as TermFrom2,
  TermWrapper as TermWrapper2
} from "@rdfjs/wrapper";
import { DataFactory as DataFactory2, Store as Store22 } from "n3";
import { exportJWK, generateKeyPair, importJWK } from "jose";
import { SetFrom as SetFrom22, TermAs as TermAs22, TermFrom as TermFrom22, TermWrapper as TermWrapper22 } from "@rdfjs/wrapper";
import { base64url, exportJWK as exportJWK2 } from "jose";
import { DataFactory as DataFactory22 } from "n3";
var DEFAULT_MAX_DECODED_BYTES = 16 * 1024 * 1024;
async function canonicalNQuads(quads) {
  return await canonize(quads, {
    algorithm: "RDFC-1.0",
    format: "application/n-quads"
  });
}
function sha256(input) {
  return new Uint8Array(createHash("sha256").update(input, "utf8").digest());
}
async function dataIntegrityHash(documentQuads, proofOptionsQuads2) {
  const docCanon = await canonicalNQuads(documentQuads);
  const proofCanon = await canonicalNQuads(proofOptionsQuads2);
  const proofHash = sha256(proofCanon);
  const docHash = sha256(docCanon);
  const out = new Uint8Array(proofHash.length + docHash.length);
  out.set(proofHash, 0);
  out.set(docHash, proofHash.length);
  return out;
}
var RdfFetchError = class extends Error {
  /** The original cause, if any (e.g. a network error or parser exception). */
  cause;
  /** HTTP status code from a non-2xx response, if applicable. */
  status;
  /** The final request URL (after redirects), if known. */
  url;
  /** Raw `Content-Type` header from the response, if known. */
  contentType;
  constructor(message, options = {}) {
    super(message);
    this.name = "RdfFetchError";
    if (options.cause !== void 0)
      this.cause = options.cause;
    if (options.status !== void 0)
      this.status = options.status;
    if (options.url !== void 0)
      this.url = options.url;
    if (options.contentType !== void 0)
      this.contentType = options.contentType;
  }
};
var SUPPORTED_RDF_MEDIA_TYPES = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/ld+json"
];
var N3_FAMILY = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
var JSON_LD_FAMILY = /* @__PURE__ */ new Set([
  "application/ld+json"
]);
async function parseRdf(body, contentTypeHeader, options = {}) {
  const rawHeader = contentTypeHeader ?? "text/turtle";
  let mediaType;
  try {
    mediaType = contentType2.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError(`Invalid Content-Type header: "${rawHeader}".`, { cause, contentType: rawHeader });
  }
  const baseIRI = options.baseIRI;
  let parser;
  if (N3_FAMILY.has(mediaType)) {
    parser = new StreamParser2({
      format: mediaType,
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else if (JSON_LD_FAMILY.has(mediaType)) {
    parser = new JsonLdParser2({
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else {
    throw new RdfFetchError(`Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(", ")}.`, { contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
  const storePromise = collectIntoStore(parser);
  try {
    await pumpBody(parser, body);
    return await storePromise;
  } catch (cause) {
    if (cause instanceof RdfFetchError)
      throw cause;
    throw new RdfFetchError(`Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`, { cause, contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
}
function collectIntoStore(parser) {
  return new Promise((resolve, reject) => {
    const store = new Store3();
    parser.on("data", (quad) => {
      store.addQuad(quad);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(store);
    });
  });
}
async function pumpBody(parser, body) {
  if (typeof body === "string") {
    parser.end(body);
    return;
  }
  let parserError = null;
  const onParserError = (err) => {
    parserError = err;
  };
  parser.on("error", onParserError);
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    for (; ; ) {
      if (parserError)
        throw parserError;
      const { done, value } = await reader.read();
      if (done)
        break;
      if (value === void 0)
        continue;
      const text = decoder.decode(value, { stream: true });
      if (text.length === 0)
        continue;
      if (!parser.write(text))
        await waitForDrain(parser);
    }
    if (parserError)
      throw parserError;
    const tail = decoder.decode();
    if (tail.length > 0)
      parser.write(tail);
    parser.end();
  } catch (err) {
    parser.destroy(err instanceof Error ? err : new Error(String(err)));
    try {
      await reader.cancel();
    } catch {
    }
    throw err;
  } finally {
    parser.off("error", onParserError);
    reader.releaseLock();
  }
}
function waitForDrain(parser) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      parser.off("drain", onDrain);
      parser.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    parser.once("drain", onDrain);
    parser.once("error", onError);
  });
}
function base58btcEncode(bytes) {
  return base58btc.encode(bytes);
}
function base58btcDecode(value) {
  return base58btc.decode(value);
}
var MULTIHASH_SHA2_256_PREFIX = Uint8Array.from([18, 32]);
function sha256Multihash(digest) {
  const out = new Uint8Array(MULTIHASH_SHA2_256_PREFIX.length + digest.length);
  out.set(MULTIHASH_SHA2_256_PREFIX, 0);
  out.set(digest, MULTIHASH_SHA2_256_PREFIX.length);
  return base58btcEncode(out);
}
async function digestQuads(quads) {
  const canonical = await canonicalNQuads(quads);
  const digest = new Uint8Array(createHash2("sha256").update(canonical, "utf8").digest());
  return sha256Multihash(digest);
}
async function digestRdfContent(content, contentType22 = "text/turtle") {
  const dataset = await parseRdf(content, contentType22);
  const quads = [...dataset.match()];
  if (quads.length === 0) {
    throw new Error(
      "@jeswr/solid-vc: refusing to digest an EMPTY RDF graph \u2014 the content parsed to zero quads (wrong contentType, or an empty policy document). A digest over nothing binds nothing."
    );
  }
  return digestQuads(quads);
}
var IRI_FORBIDDEN = /[\u0000-\u0020<>"{}|^`\\]/g;
function percentEncode(ch) {
  return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
}
function escapeIri2(value) {
  return value.replace(IRI_FORBIDDEN, percentEncode);
}
function safeHttpIri2(value) {
  if (typeof value !== "string") return void 0;
  let u;
  try {
    u = new URL(value);
  } catch {
    return void 0;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return void 0;
  return u.href.replace(/\|/g, "%7C").replace(/\^/g, "%5E").replace(/`/g, "%60");
}
function isAbsoluteIri(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}
function safeObjectIri(value) {
  if (typeof value !== "string") return void 0;
  const http = safeHttpIri2(value);
  if (http !== void 0) return http;
  return isAbsoluteIri(value) ? escapeIri2(value) : void 0;
}
function requireObjectIri(value, field) {
  const iri = safeObjectIri(value);
  if (iri === void 0) {
    throw new Error(
      `@jeswr/solid-vc: ${field} must be an absolute http(s)/did:/urn: IRI, got ${JSON.stringify(
        value
      )} \u2014 refusing to build a credential with an invalid ${field}`
    );
  }
  return iri;
}
var VC = "https://www.w3.org/2018/credentials#";
var SEC = "https://w3id.org/security#";
var XSD2 = "http://www.w3.org/2001/XMLSchema#";
var RDF2 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDFS = "http://www.w3.org/2000/01/rdf-schema#";
var ACL2 = "http://www.w3.org/ns/auth/acl#";
var ODRL2 = "http://www.w3.org/ns/odrl/2/";
var SCHEMA = "https://schema.org/";
var SVC = "https://w3id.org/jeswr/solid-vc#";
var RDF_TYPE2 = `${RDF2}type`;
var VC_CREDENTIAL = `${VC}VerifiableCredential`;
var VC_PRESENTATION = `${VC}VerifiablePresentation`;
var VC_ISSUER = `${VC}issuer`;
var VC_CREDENTIAL_SUBJECT = `${VC}credentialSubject`;
var VC_VALID_FROM = `${VC}validFrom`;
var VC_VALID_UNTIL = `${VC}validUntil`;
var VC_CREDENTIAL_STATUS = `${VC}credentialStatus`;
var VC_RELATED_RESOURCE = `${VC}relatedResource`;
var SEC_DIGEST_MULTIBASE = `${SEC}digestMultibase`;
var SEC_MULTIBASE = `${SEC}multibase`;
var SCHEMA_ENCODING_FORMAT = `${SCHEMA}encodingFormat`;
var VC_VERIFIABLE_CREDENTIAL = `${VC}verifiableCredential`;
var STATUS = "https://www.w3.org/ns/credentials/status#";
var STATUS_BITSTRING_ENTRY = `${STATUS}BitstringStatusListEntry`;
var STATUS_BITSTRING_LIST = `${STATUS}BitstringStatusList`;
var STATUS_BITSTRING_CREDENTIAL = `${STATUS}BitstringStatusListCredential`;
var STATUS_PURPOSE = `${STATUS}statusPurpose`;
var STATUS_LIST_INDEX = `${STATUS}statusListIndex`;
var STATUS_LIST_CREDENTIAL = `${STATUS}statusListCredential`;
var STATUS_ENCODED_LIST = `${STATUS}encodedList`;
var VC_HOLDER = `${VC}holder`;
var SEC_PROOF = `${SEC}proof`;
var SEC_DATA_INTEGRITY_PROOF = `${SEC}DataIntegrityProof`;
var SEC_CRYPTOSUITE = `${SEC}cryptosuite`;
var SEC_PROOF_VALUE = `${SEC}proofValue`;
var SEC_VERIFICATION_METHOD = `${SEC}verificationMethod`;
var SEC_PROOF_PURPOSE = `${SEC}proofPurpose`;
var DC_CREATED = "http://purl.org/dc/terms/created";
var SEC_MULTIKEY = `${SEC}Multikey`;
var SEC_CONTROLLER = `${SEC}controller`;
var SEC_PUBLIC_KEY_MULTIBASE = `${SEC}publicKeyMultibase`;
var SEC_ASSERTION_METHOD = `${SEC}assertionMethod`;
var SVC_AGENT_AUTHORIZATION = `${SVC}AgentAuthorizationCredential`;
var SVC_AUTHORIZES = `${SVC}authorizes`;
var SVC_ACTION = `${SVC}action`;
var SVC_TARGET = `${SVC}target`;
var SVC_POLICY = `${SVC}policy`;
var PREFIXES = {
  cred: VC,
  sec: SEC,
  svc: SVC,
  acl: ACL2,
  odrl: ODRL2,
  schema: SCHEMA,
  xsd: XSD2,
  rdf: RDF2,
  rdfs: RDFS,
  dcterms: DC_CREATED.replace("created", "")
};
function iriRef(iri) {
  return { kind: "iri", value: iri };
}
function normalize(subject) {
  return typeof subject === "string" ? { kind: "iri", value: subject } : subject;
}
var GraphBuilder = class {
  store = new Store22();
  factory = DataFactory2;
  /**
   * Materialise a {@link NodeRef} to its RDF/JS term. An IRI subject is passed
   * through {@link escapeIri} FIRST so an untrusted subject id cannot break out of
   * the `<…>` when the graph is serialised (n3.Writer does not escape IRIs). This
   * is scheme-agnostic, so a `urn:uuid:` / `did:` subject is preserved unchanged.
   */
  subjectTerm(ref) {
    return ref.kind === "iri" ? NamedNodeFrom2.string(escapeIri2(ref.value), this.factory) : BlankNodeFrom2.string(ref.value, this.factory);
  }
  /** Add `(subject, rdf:type, classIri)`. */
  addType(subject, classIri) {
    this.addIri(subject, RDF_TYPE2, classIri);
  }
  /**
   * Add `(subject, predicate, object-IRI)`. The predicate and object IRIs are
   * passed through {@link escapeIri} so neither an untrusted claim-key predicate
   * nor an untrusted object IRI can break out of the serialised `<…>` — the
   * low-level chokepoint that closes the injection for EVERY object-IRI write.
   */
  addIri(subject, predicate, objectIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom2.string(escapeIri2(predicate), this.factory);
    const o = NamedNodeFrom2.string(escapeIri2(objectIri), this.factory);
    this.store.add(this.factory.quad(s, p, o));
  }
  /** Add `(subject, predicate, literal)` with an optional datatype IRI. */
  addLiteral(subject, predicate, value, datatypeIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom2.string(escapeIri2(predicate), this.factory);
    const o = datatypeIri === void 0 ? LiteralFrom2.string(value, this.factory) : this.factory.literal(
      value,
      NamedNodeFrom2.string(escapeIri2(datatypeIri), this.factory)
    );
    this.store.add(this.factory.quad(s, p, o));
  }
  /**
   * Mint a fresh blank node, link it `(subject, predicate, _:b)`, and return a
   * {@link NodeRef} to the new blank node (so subsequent writes target it
   * unambiguously as a blank, never as an IRI).
   */
  linkBlankNode(subject, predicate) {
    const s = this.subjectTerm(normalize(subject));
    const blank = BlankNodeFrom2.string(void 0, this.factory);
    const p = NamedNodeFrom2.string(escapeIri2(predicate), this.factory);
    this.store.add(this.factory.quad(s, p, blank));
    return { kind: "blank", value: blank.value };
  }
  /** The underlying store (a DatasetCore). */
  dataset() {
    return this.store;
  }
  /** The accumulated quads. */
  quads() {
    return [...this.store];
  }
};
function looksLikeIri(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}
function typeIri(type) {
  if (type === "VerifiableCredential") return VC_CREDENTIAL;
  if (type === "AgentAuthorizationCredential") return SVC_AGENT_AUTHORIZATION;
  if (type === "BitstringStatusListCredential") return STATUS_BITSTRING_CREDENTIAL;
  if (type === "BitstringStatusList") return STATUS_BITSTRING_LIST;
  if (type === "BitstringStatusListEntry") return STATUS_BITSTRING_ENTRY;
  if (looksLikeIri(type)) return type;
  return `https://w3id.org/jeswr/solid-vc#${type}`;
}
function normalizeSubjectId(id) {
  if (typeof id !== "string" || id.trim().length === 0) return void 0;
  if (!isAbsoluteIri(id)) {
    throw new Error(
      `@jeswr/solid-vc: credentialSubject.id must be an absolute IRI, got ${JSON.stringify(
        id
      )} \u2014 refusing to emit a credential subject with a relative/invalid id`
    );
  }
  return id;
}
function writeSubject(b, credential, subject) {
  const idIri = normalizeSubjectId(subject.id);
  let node;
  if (idIri !== void 0) {
    node = iriRef(idIri);
    b.addIri(credential, VC_CREDENTIAL_SUBJECT, idIri);
  } else {
    node = b.linkBlankNode(credential, VC_CREDENTIAL_SUBJECT);
  }
  for (const [claim, value] of Object.entries(subject)) {
    if (claim === "id" || value === void 0) continue;
    if (claim === "type") {
      const types = Array.isArray(value) ? value : [value];
      for (const t of types) {
        if (typeof t !== "string" || t.length === 0) {
          throw new Error(
            "@jeswr/solid-vc: a credentialSubject `type` must be a non-empty string (or an array of them)"
          );
        }
        b.addType(node, typeIri(t));
      }
      continue;
    }
    writeClaim(b, node, claim, value);
  }
}
var STATUS_CLAIM_TERMS = {
  statusPurpose: STATUS_PURPOSE,
  encodedList: STATUS_ENCODED_LIST,
  statusListIndex: STATUS_LIST_INDEX,
  statusListCredential: STATUS_LIST_CREDENTIAL
};
function claimPredicate(claim) {
  if (looksLikeIri(claim)) return claim;
  const status = STATUS_CLAIM_TERMS[claim];
  if (status !== void 0) return status;
  return `https://w3id.org/jeswr/solid-vc#${claim}`;
}
function writeClaim(b, subject, claim, value) {
  const predicate = claimPredicate(claim);
  if (Array.isArray(value)) {
    for (const item of value) {
      writeClaim(b, subject, claim, item);
    }
    return;
  }
  if (value === null) {
    return;
  }
  if (typeof value === "string") {
    if (predicate === STATUS_ENCODED_LIST) {
      b.addLiteral(subject, predicate, value, SEC_MULTIBASE);
      return;
    }
    if (looksLikeIri(value)) {
      b.addIri(subject, predicate, value);
    } else {
      b.addLiteral(subject, predicate, value);
    }
    return;
  }
  if (typeof value === "boolean") {
    b.addLiteral(subject, predicate, String(value), `${XSD2}boolean`);
    return;
  }
  if (typeof value === "number") {
    const dt = Number.isInteger(value) ? `${XSD2}integer` : `${XSD2}double`;
    b.addLiteral(subject, predicate, String(value), dt);
    return;
  }
  const child = b.linkBlankNode(subject, predicate);
  for (const [k, v] of Object.entries(value)) {
    if (v === void 0) continue;
    writeClaim(b, child, k, v);
  }
}
function writeRelatedResource(b, credential, related) {
  const idIri = requireObjectIri(related.id, "relatedResource.id");
  b.addIri(credential, VC_RELATED_RESOURCE, idIri);
  const node = iriRef(idIri);
  if (related.digestMultibase !== void 0) {
    b.addLiteral(node, SEC_DIGEST_MULTIBASE, related.digestMultibase, SEC_MULTIBASE);
  }
  if (related.mediaType !== void 0) {
    b.addLiteral(node, SCHEMA_ENCODING_FORMAT, related.mediaType);
  }
}
function credentialStatusesOf(credentialStatus) {
  if (credentialStatus === void 0) return [];
  return Array.isArray(credentialStatus) ? credentialStatus : [credentialStatus];
}
function writeCredentialStatus(b, credential, status) {
  if (status === null || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("@jeswr/solid-vc: credentialStatus entry must be an object");
  }
  if (status.type !== "BitstringStatusListEntry") {
    throw new Error(
      `@jeswr/solid-vc: unsupported credentialStatus type ${JSON.stringify(
        status.type
      )} \u2014 only "BitstringStatusListEntry" (W3C Bitstring Status List v1.0) can be lowered`
    );
  }
  if (typeof status.statusPurpose !== "string" || status.statusPurpose.length === 0) {
    throw new Error("@jeswr/solid-vc: credentialStatus.statusPurpose must be a non-empty string");
  }
  if (typeof status.statusListIndex !== "string" || !/^(0|[1-9][0-9]*)$/.test(status.statusListIndex)) {
    throw new Error(
      "@jeswr/solid-vc: credentialStatus.statusListIndex must be a string non-negative integer"
    );
  }
  const listIri = requireObjectIri(
    status.statusListCredential,
    "credentialStatus.statusListCredential"
  );
  let node;
  if (status.id !== void 0) {
    const idIri = requireObjectIri(status.id, "credentialStatus.id");
    b.addIri(credential, VC_CREDENTIAL_STATUS, idIri);
    node = iriRef(idIri);
  } else {
    node = b.linkBlankNode(credential, VC_CREDENTIAL_STATUS);
  }
  b.addType(node, STATUS_BITSTRING_ENTRY);
  b.addLiteral(node, STATUS_PURPOSE, status.statusPurpose);
  b.addLiteral(node, STATUS_LIST_INDEX, status.statusListIndex);
  b.addIri(node, STATUS_LIST_CREDENTIAL, listIri);
}
function credentialToRdf(credential) {
  const id = credential.id ?? `urn:uuid:${randomUUID()}`;
  const subject = iriRef(id);
  const b = new GraphBuilder();
  b.addType(subject, VC_CREDENTIAL);
  for (const t of credential.type ?? []) {
    const iri = typeIri(t);
    if (iri === VC_CREDENTIAL) continue;
    const safe = safeObjectIri(iri);
    if (safe !== void 0) b.addType(subject, safe);
  }
  const issuerIri = requireObjectIri(credential.issuer, "issuer");
  b.addIri(subject, VC_ISSUER, issuerIri);
  if (credential.validFrom !== void 0) {
    b.addLiteral(subject, VC_VALID_FROM, credential.validFrom, `${XSD2}dateTime`);
  }
  if (credential.validUntil !== void 0) {
    b.addLiteral(subject, VC_VALID_UNTIL, credential.validUntil, `${XSD2}dateTime`);
  }
  for (const related of credential.relatedResource ?? []) {
    writeRelatedResource(b, subject, related);
  }
  for (const status of credentialStatusesOf(credential.credentialStatus)) {
    writeCredentialStatus(b, subject, status);
  }
  const subjects = Array.isArray(credential.credentialSubject) ? credential.credentialSubject : [credential.credentialSubject];
  for (const s of subjects) {
    writeSubject(b, subject, s);
  }
  return b.quads();
}
var SuiteRegistry = class {
  suites = /* @__PURE__ */ new Map();
  /** Register a suite (overwrites any prior suite with the same cryptosuite id). */
  register(suite) {
    this.suites.set(suite.cryptosuite, suite);
    return this;
  }
  /** The suite for a cryptosuite id, or `undefined` if none is registered. */
  get(cryptosuite) {
    return this.suites.get(cryptosuite);
  }
  /** Every registered cryptosuite id. */
  list() {
    return [...this.suites.keys()];
  }
};
function proofOptionsQuads(proof) {
  const b = new GraphBuilder();
  const node = { kind: "blank", value: "_:proof" };
  b.addType(node, "https://w3id.org/security#DataIntegrityProof");
  b.addLiteral(node, SEC_CRYPTOSUITE, proof.cryptosuite);
  b.addIri(node, SEC_VERIFICATION_METHOD, proof.verificationMethod);
  b.addIri(node, SEC_PROOF_PURPOSE, purposeIri(proof.proofPurpose));
  if (proof.created !== void 0) {
    b.addLiteral(node, DC_CREATED, proof.created, "http://www.w3.org/2001/XMLSchema#dateTime");
  }
  return b.quads();
}
function purposeIri(purpose) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(purpose) ? purpose : `https://w3id.org/security#${purpose}`;
}
function algorithmFor(cryptosuite) {
  switch (cryptosuite) {
    case "eddsa-rdfc-2022":
      return "Ed25519";
    case "ecdsa-rdfc-2019":
      return { name: "ECDSA", hash: "SHA-256" };
    default:
      throw new Error(`DataIntegritySuite: unsupported cryptosuite "${cryptosuite}"`);
  }
}
var DataIntegritySuite = class {
  cryptosuite;
  constructor(cryptosuite = "eddsa-rdfc-2022") {
    this.cryptosuite = cryptosuite;
    algorithmFor(cryptosuite);
  }
  async sign(documentQuads, options) {
    const key = options.key;
    if (key?.privateKey === void 0 || key.verificationMethod === void 0) {
      throw new Error("DataIntegritySuite.sign: options.key must be a KeyPair");
    }
    const created = options.created.toISOString();
    const optionsNoValue = {
      type: "DataIntegrityProof",
      cryptosuite: this.cryptosuite,
      verificationMethod: key.verificationMethod,
      proofPurpose: options.proofPurpose,
      created
    };
    const hash = await dataIntegrityHash(documentQuads, proofOptionsQuads(optionsNoValue));
    const algorithm = algorithmFor(this.cryptosuite);
    const signature = new Uint8Array(
      await crypto.subtle.sign(algorithm, key.privateKey, hash)
    );
    return { ...optionsNoValue, proofValue: base58btcEncode(signature) };
  }
  async verify(documentQuads, proof, options) {
    if (proof.type !== "DataIntegrityProof") return false;
    if (proof.cryptosuite !== this.cryptosuite) return false;
    const publicKey = await options.resolveKey(proof.verificationMethod);
    if (publicKey === void 0) return false;
    let signature;
    try {
      signature = base58btcDecode(proof.proofValue);
    } catch {
      return false;
    }
    const optionsNoValue = {
      type: "DataIntegrityProof",
      cryptosuite: proof.cryptosuite,
      verificationMethod: proof.verificationMethod,
      proofPurpose: proof.proofPurpose,
      ...proof.created !== void 0 ? { created: proof.created } : {}
    };
    const hash = await dataIntegrityHash(documentQuads, proofOptionsQuads(optionsNoValue));
    const algorithm = algorithmFor(this.cryptosuite);
    try {
      return await crypto.subtle.verify(
        algorithm,
        publicKey,
        signature,
        hash
      );
    } catch {
      return false;
    }
  }
};
function defaultSuiteRegistry() {
  return new SuiteRegistry().register(new DataIntegritySuite("eddsa-rdfc-2022")).register(new DataIntegritySuite("ecdsa-rdfc-2019"));
}
function defaultControlledBy(verificationMethod, issuer) {
  if (verificationMethod === issuer) return true;
  return verificationMethod.startsWith(`${issuer}#`) || verificationMethod.startsWith(`${issuer}/`);
}
function proofsOf(vc) {
  const proof = vc.proof;
  return Array.isArray(proof) ? [...proof] : [proof];
}
function unsigned(vc) {
  const { proof: _proof, ...rest } = vc;
  return rest;
}
function normalizeRelatedResources(value) {
  if (value === void 0) return { entries: [] };
  if (!Array.isArray(value)) {
    return {
      error: { code: "MALFORMED", message: "relatedResource must be an array when present" }
    };
  }
  const entries = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        error: { code: "MALFORMED", message: "relatedResource entry must be an object" }
      };
    }
    const entry = raw;
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      return {
        error: {
          code: "MALFORMED",
          message: "relatedResource entry must carry a non-empty string id"
        }
      };
    }
    entries.push({
      id: entry.id,
      ...typeof entry.digestMultibase === "string" ? { digestMultibase: entry.digestMultibase } : {},
      ...typeof entry.mediaType === "string" ? { mediaType: entry.mediaType } : {}
    });
  }
  return { entries };
}
async function checkPresentedResource(related, iri, presented) {
  const entries = related.filter((r) => r.id === iri);
  if (entries.length === 0) {
    return [
      {
        code: "RELATED_RESOURCE_MISSING",
        message: `credential carries no relatedResource digest binding for presented resource ${iri}`
      }
    ];
  }
  if (entries.some((r) => typeof r.digestMultibase !== "string" || r.digestMultibase.length === 0)) {
    return [
      {
        code: "RELATED_RESOURCE_MISSING",
        message: `relatedResource entry for ${iri} carries no digestMultibase \u2014 an undigested entry binds nothing`
      }
    ];
  }
  let recomputed;
  try {
    recomputed = await digestRdfContent(presented.content, presented.contentType ?? "text/turtle");
  } catch (e) {
    return [
      {
        code: "RELATED_RESOURCE_MISMATCH",
        message: `presented content for ${iri} could not be canonically digested: ${e.message}`
      }
    ];
  }
  const mismatched = entries.filter((r) => r.digestMultibase !== recomputed);
  if (mismatched.length > 0) {
    return [
      {
        code: "RELATED_RESOURCE_MISMATCH",
        message: `digest of presented content for ${iri} (${recomputed}) does not match the signed digestMultibase \u2014 the presented resource is not the content the issuer bound`
      }
    ];
  }
  return [];
}
async function verifyCredential(vc, options) {
  const errors = [];
  const registry = options.registry ?? defaultSuiteRegistry();
  const now = options.now ?? /* @__PURE__ */ new Date();
  const expectedPurpose = options.expectedProofPurpose ?? "assertionMethod";
  const controlledBy = options.isControlledBy ?? defaultControlledBy;
  if (vc === null || typeof vc !== "object" || typeof vc.issuer !== "string" || vc.issuer.length === 0 || vc.credentialSubject === void 0) {
    return {
      verified: false,
      errors: [{ code: "MALFORMED", message: "not a well-formed credential" }]
    };
  }
  const issuer = vc.issuer;
  const proofs = vc.proof === void 0 ? [] : proofsOf(vc);
  if (proofs.length === 0) {
    errors.push({ code: "NO_PROOF", message: "credential carries no proof" });
  }
  if (vc.validUntil !== void 0) {
    const until = Date.parse(vc.validUntil);
    if (!Number.isNaN(until) && now.getTime() > until) {
      errors.push({ code: "EXPIRED", message: `credential expired at ${vc.validUntil}` });
    }
  }
  if (vc.validFrom !== void 0) {
    const from = Date.parse(vc.validFrom);
    if (!Number.isNaN(from) && now.getTime() < from) {
      errors.push({
        code: "NOT_YET_VALID",
        message: `credential not valid before ${vc.validFrom}`
      });
    }
  }
  if (options.trustedIssuers !== void 0 && !options.trustedIssuers.includes(issuer)) {
    errors.push({ code: "UNTRUSTED_ISSUER", message: `issuer ${issuer} is not trusted` });
  }
  if (options.presentedResources !== void 0) {
    const normalized = normalizeRelatedResources(vc.relatedResource);
    if ("error" in normalized) {
      errors.push(normalized.error);
    } else {
      for (const [iri, presented] of Object.entries(options.presentedResources)) {
        errors.push(...await checkPresentedResource(normalized.entries, iri, presented));
      }
    }
  }
  if (options.resolveStatus !== void 0) {
    errors.push(...await statusGate(options.resolveStatus, vc));
  }
  let documentQuads;
  try {
    documentQuads = credentialToRdf(unsigned(vc));
  } catch (e) {
    errors.push({
      code: "MALFORMED",
      message: `credential could not be lowered to its signed RDF: ${e.message}`
    });
  }
  if (documentQuads !== void 0) {
    for (const proof of proofs) {
      const suite = registry.get(proof.cryptosuite);
      if (suite === void 0) {
        errors.push({
          code: "UNKNOWN_CRYPTOSUITE",
          message: `no registered suite for cryptosuite "${proof.cryptosuite}"`
        });
        continue;
      }
      if (normalizePurpose(proof.proofPurpose) !== normalizePurpose(expectedPurpose)) {
        errors.push({
          code: "PROOF_PURPOSE_MISMATCH",
          message: `proofPurpose "${proof.proofPurpose}" != expected "${expectedPurpose}"`
        });
      }
      if (!await controlledByFailClosed(controlledBy, proof.verificationMethod, issuer)) {
        errors.push({
          code: "ISSUER_MISMATCH",
          message: `verificationMethod ${proof.verificationMethod} is not controlled by issuer ${issuer}`
        });
      }
      const ok = await verifyOneProof(suite, documentQuads, proof, options.resolveKey);
      if (!ok) {
        errors.push({
          code: "INVALID_SIGNATURE",
          message: `signature did not verify for proof (${proof.cryptosuite})`
        });
      }
    }
  }
  return errors.length === 0 ? { verified: true, errors: [], issuer } : { verified: false, errors, issuer };
}
async function statusGate(resolveStatus, vc) {
  let check;
  try {
    check = await resolveStatus(vc);
  } catch (e) {
    return [
      {
        code: "STATUS_UNREACHABLE",
        message: `credential status could not be resolved: ${e.message}`
      }
    ];
  }
  switch (check?.status) {
    case "absent":
    case "valid":
      return [];
    case "revoked":
      return [{ code: "STATUS_REVOKED", message: `credential is revoked: ${check.reason}` }];
    case "suspended":
      return [{ code: "STATUS_SUSPENDED", message: `credential is suspended: ${check.reason}` }];
    case "unreachable":
      return [
        {
          code: "STATUS_UNREACHABLE",
          message: `credential status could not be confirmed: ${check.reason}`
        }
      ];
    default:
      return [
        {
          code: "STATUS_UNREACHABLE",
          message: "credential status resolver returned an unrecognised outcome \u2014 failing closed"
        }
      ];
  }
}
async function controlledByFailClosed(controlledBy, verificationMethod, issuer) {
  try {
    return await controlledBy(verificationMethod, issuer);
  } catch {
    return false;
  }
}
async function verifyOneProof(suite, documentQuads, proof, resolveKey) {
  try {
    return await suite.verify(documentQuads, proof, { resolveKey });
  } catch {
    return false;
  }
}
function normalizePurpose(purpose) {
  const hash = purpose.lastIndexOf("#");
  return hash === -1 ? purpose : purpose.slice(hash + 1);
}
var ED25519_PUB_PREFIX = Uint8Array.from([237, 1]);
var P256_PUB_PREFIX = Uint8Array.from([128, 36]);
var DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;

// src/verifier.ts
var SVC_AUTHORIZES2 = `${SVC}authorizes`;
var SVC_ACTION2 = `${SVC}action`;
var SVC_TARGET2 = `${SVC}target`;
var SVC_POLICY2 = `${SVC}policy`;
function subjectRecord(vc) {
  const subject = Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject;
  return subject && typeof subject === "object" ? subject : void 0;
}
function claimString(value) {
  return typeof value === "string" ? value : void 0;
}
function claimStrings(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string");
  }
  return [];
}
function readBoundAuthorization(vc) {
  const types = vc.type ?? [];
  if (!types.includes("AgentAuthorizationCredential")) {
    return void 0;
  }
  const subject = subjectRecord(vc);
  const authorizes = claimString(subject?.[SVC_AUTHORIZES2]);
  if (subject === void 0 || authorizes === void 0 || typeof vc.issuer !== "string") {
    return void 0;
  }
  const principal = vc.issuer;
  const action = claimStrings(subject[SVC_ACTION2]);
  const target = claimString(subject[SVC_TARGET2]);
  const policy = claimString(subject[SVC_POLICY2]);
  return {
    principal,
    authorizes,
    action,
    ...target !== void 0 && { target },
    ...policy !== void 0 && { policy }
  };
}
function assembleChain(policies) {
  if (policies.length === 0) {
    return { error: "no policies presented \u2014 nothing to assemble." };
  }
  const byId = /* @__PURE__ */ new Map();
  for (const p of policies) {
    if (p.id === void 0 || p.id === "") {
      return { error: "a presented policy has no id." };
    }
    if (byId.has(p.id)) {
      return { error: `duplicate policy id <${p.id}>.` };
    }
    byId.set(p.id, p);
  }
  const roots = policies.filter((p) => p.delegatedUnder === void 0);
  for (const p of policies) {
    if (p.delegatedUnder !== void 0 && !byId.has(p.delegatedUnder)) {
      return {
        error: `policy <${p.id}> is delegatedUnder <${p.delegatedUnder}>, which is not present (gap).`
      };
    }
  }
  if (roots.length !== 1) {
    return {
      error: `expected exactly one root (a policy with no delegatedUnder); found ${roots.length}.`
    };
  }
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const p of policies) {
    if (p.delegatedUnder !== void 0) {
      const list = childrenByParent.get(p.delegatedUnder) ?? [];
      list.push(p);
      childrenByParent.set(p.delegatedUnder, list);
    }
  }
  for (const [parent, children] of childrenByParent) {
    if (children.length > 1) {
      return {
        error: `policy <${parent}> is delegated-under by ${children.length} children (a branch, not a linear chain).`
      };
    }
  }
  const ordered = [];
  const visited = /* @__PURE__ */ new Set();
  let cursor = roots[0].id;
  while (cursor !== void 0) {
    if (visited.has(cursor)) {
      return { error: `cycle detected at <${cursor}>.` };
    }
    visited.add(cursor);
    const policy = byId.get(cursor);
    if (policy === void 0) {
      break;
    }
    ordered.push(policy);
    const kids = childrenByParent.get(cursor) ?? [];
    const next = kids[0];
    cursor = next?.id;
  }
  if (ordered.length !== policies.length) {
    return {
      error: `chain is disconnected: walked ${ordered.length} of ${policies.length} policies (gap or branch).`
    };
  }
  return { ordered };
}
function deny(phase, code, reason, chainPolicyIds = [], extra = {}) {
  return {
    authorized: false,
    phase,
    code,
    reason,
    chainPolicyIds,
    duties: [],
    policyIntegrityProvisional: false,
    ...extra
  };
}
async function verifyAgentAuthority(chain, options) {
  const { request, rootPrincipal, now, resolveKey } = options;
  const assembled = assembleChain(chain.policies);
  if ("error" in assembled) {
    return deny("assembly", "CHAIN_MALFORMED", `Chain assembly failed: ${assembled.error}`);
  }
  const ordered = assembled.ordered;
  const chainIds = ordered.map((p) => p.id);
  const bound = /* @__PURE__ */ new Map();
  for (const vc of chain.credentials) {
    const auth = readBoundAuthorization(vc);
    if (auth === void 0) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        "A presented credential is not a well-formed AgentAuthorizationCredential.",
        chainIds
      );
    }
    const assertedSubjectId = claimString(subjectRecord(vc)?.id);
    if (assertedSubjectId !== void 0 && assertedSubjectId !== vc.issuer) {
      return deny(
        "B",
        "SUBJECT_ISSUER_MISMATCH",
        `Credential subject <${assertedSubjectId}> \u2260 its proof-verified issuer <${vc.issuer}> \u2014 refusing a subject-spoofed authorization.`,
        chainIds
      );
    }
    if (auth.policy === void 0) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        `Credential from <${auth.principal}> binds no svc:policy \u2014 nothing to place in the chain.`,
        chainIds
      );
    }
    if (bound.has(auth.policy)) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        `More than one credential binds policy <${auth.policy}>.`,
        chainIds
      );
    }
    bound.set(auth.policy, { vc, auth });
  }
  if (bound.size !== ordered.length) {
    return deny(
      "B",
      "BINDING_MISMATCH",
      `Credential/policy count mismatch: ${bound.size} bound credential(s) for ${ordered.length} chain hop(s).`,
      chainIds
    );
  }
  for (const p of ordered) {
    if (!bound.has(p.id)) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        `Chain hop <${p.id}> has no binding credential.`,
        chainIds
      );
    }
  }
  const contents = chain.policyContents ?? {};
  for (const hop of ordered) {
    const b = bound.get(hop.id);
    const presented = contents[hop.id];
    if (options.resolveStatus === void 0 && b.vc.credentialStatus !== void 0) {
      return deny(
        "C",
        "STATUS_RETRIEVAL_ERROR",
        `Credential for hop <${hop.id}> carries a credentialStatus entry but no status resolver was supplied \u2014 denying (fail-closed).`,
        chainIds
      );
    }
    const res = await verifyCredential(b.vc, {
      resolveKey,
      ...options.isControlledBy !== void 0 && { isControlledBy: options.isControlledBy },
      ...options.resolveStatus !== void 0 && { resolveStatus: options.resolveStatus },
      expectedProofPurpose: "assertionMethod",
      now,
      ...presented !== void 0 && { presentedResources: { [hop.id]: presented } }
    });
    if (!res.verified) {
      const detail = res.errors.map((e) => e.message).join("; ");
      const phaseAError = res.errors.find((e) => PHASE_A_CODES.has(e.code));
      if (phaseAError === void 0 && res.errors.some((e) => RELATED_RESOURCE_CODES.has(e.code))) {
        return deny(
          "B",
          "POLICY_INTEGRITY",
          `Policy-content binding failed for <${hop.id}>: ${detail}`,
          chainIds
        );
      }
      const statusError = res.errors.find((e) => STATUS_GATE_CODES.has(e.code));
      if (phaseAError === void 0 && statusError !== void 0) {
        const statusCode = statusError.code === "STATUS_REVOKED" ? "REVOKED" : statusError.code === "STATUS_SUSPENDED" ? "SUSPENDED" : "STATUS_RETRIEVAL_ERROR";
        return deny(
          "C",
          statusCode,
          `Credential status gate failed for hop <${hop.id}>: ${detail}`,
          chainIds
        );
      }
      const code = phaseAError !== void 0 ? phaseAError.code : "INVALID_SIGNATURE";
      return deny("A", code, `Phase A (credential verification) failed: ${detail}`, chainIds);
    }
  }
  const allContentBound = ordered.every((p) => contents[p.id] !== void 0);
  const rootHop = ordered[0];
  const rootBound = bound.get(rootHop.id);
  if (rootBound.auth.principal !== rootPrincipal) {
    return deny(
      "B",
      "BINDING_MISMATCH",
      `Root credential issuer <${rootBound.auth.principal}> is not the trusted root principal <${rootPrincipal}> for this target.`,
      chainIds
    );
  }
  for (let i = 0; i < ordered.length; i++) {
    const hop = ordered[i];
    const b = bound.get(hop.id);
    if (hop.assigner !== void 0 && b.auth.principal !== hop.assigner) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        `Hop <${hop.id}> assigner <${hop.assigner}> \u2260 its credential's issuer/subject <${b.auth.principal}>.`,
        chainIds
      );
    }
    if (i + 1 < ordered.length) {
      const nextHop = ordered[i + 1];
      if (nextHop.assigner === void 0) {
        return deny(
          "B",
          "BINDING_MISMATCH",
          `Hop <${nextHop.id}> has no assigner to bind to its parent's authorized delegate.`,
          chainIds
        );
      }
      if (b.auth.authorizes !== nextHop.assigner) {
        return deny(
          "B",
          "BINDING_MISMATCH",
          `Hop <${hop.id}> authorizes <${b.auth.authorizes}> but the next hop's assigner is <${nextHop.assigner}> \u2014 broken delegation linkage.`,
          chainIds
        );
      }
    }
  }
  const leafHop = ordered[ordered.length - 1];
  const leafBound = bound.get(leafHop.id);
  const leafAssignee = leafBound.auth.authorizes;
  if (leafHop.assignee !== void 0 && leafHop.assignee !== leafAssignee) {
    return deny(
      "B",
      "BINDING_MISMATCH",
      `Leaf policy <${leafHop.id}> assignee <${leafHop.assignee}> \u2260 the party its credential authorizes <${leafAssignee}>.`,
      chainIds
    );
  }
  if (options.requireLeafAssignee !== void 0 && leafAssignee !== options.requireLeafAssignee) {
    return deny(
      "B",
      "BINDING_MISMATCH",
      `Chain leaf assignee <${leafAssignee}> \u2260 the required party <${options.requireLeafAssignee}>.`,
      chainIds
    );
  }
  if (options.statusUnreachable === true) {
    return deny(
      "C",
      "STATUS_RETRIEVAL_ERROR",
      "A revocation/status source could not be retrieved \u2014 denying (fail-closed).",
      chainIds
    );
  }
  const revoked = new Set(options.revoked ?? []);
  for (const p of ordered) {
    if (revoked.has(p.id)) {
      return deny("C", "REVOKED", `Chain policy <${p.id}> has been revoked.`, chainIds);
    }
  }
  const primaryRequest = { ...request, agent: leafAssignee };
  const decision = evaluateDelegated(ordered, primaryRequest, {
    now,
    revoked: [...revoked],
    ...options.requireDuties !== void 0 && { requireDuties: options.requireDuties },
    ...options.maxChainLength !== void 0 && { maxChainLength: options.maxChainLength }
  });
  if (decision.decision !== "permit") {
    return deny("D", "POLICY_DENIED", `Phase D denied: ${decision.reason}`, chainIds, {
      decision,
      duties: decision.duties
    });
  }
  let actorResult;
  if (options.actor !== void 0 && options.actor !== leafAssignee) {
    if (options.actorChain === void 0) {
      return deny(
        "composition",
        "IDENTITY_COMPOSITION_FAILED",
        `Acting WebID <${options.actor}> is not the leaf assignee <${leafAssignee}>, and no second chain rooted at <${leafAssignee}> was presented to authorize it.`,
        chainIds,
        {
          decision
        }
      );
    }
    actorResult = await verifyAgentAuthority(options.actorChain, {
      request: { ...request, agent: options.actor },
      rootPrincipal: leafAssignee,
      // composition rule: chain₂.root ≡ chain₁.leaf
      // PIN chain₂'s leaf assignee to the actor — chain₂ must prove authority for
      // `actor` itself, not for some other party it happens to be rooted to name.
      requireLeafAssignee: options.actor,
      now,
      resolveKey,
      ...options.isControlledBy !== void 0 && { isControlledBy: options.isControlledBy },
      ...options.resolveStatus !== void 0 && { resolveStatus: options.resolveStatus },
      ...options.revoked !== void 0 && { revoked: options.revoked },
      ...options.statusUnreachable !== void 0 && {
        statusUnreachable: options.statusUnreachable
      },
      ...options.requireDuties !== void 0 && { requireDuties: options.requireDuties },
      ...options.maxChainLength !== void 0 && { maxChainLength: options.maxChainLength }
      // the actor of chain₂ is its own leaf assignee (w authenticates as itself)
    });
    if (!actorResult.authorized) {
      return deny(
        "composition",
        "IDENTITY_COMPOSITION_FAILED",
        `The second (identity-composition) chain for actor <${options.actor}> did not verify: ${actorResult.reason}`,
        chainIds,
        {
          decision,
          actorResult
        }
      );
    }
    if (actorResult.decision === void 0) {
      return deny(
        "composition",
        "IDENTITY_COMPOSITION_FAILED",
        "The second chain produced no Phase-D decision.",
        chainIds,
        { decision }
      );
    }
  }
  return {
    authorized: true,
    phase: "complete",
    reason: actorResult !== void 0 ? `Authorized: the ${ordered.length}-hop chain permits the leaf assignee <${leafAssignee}>, and a second chain rooted at <${leafAssignee}> authorizes the acting agent <${options.actor}>.` : `Authorized: the ${ordered.length}-hop chain permits the request for <${leafAssignee}>.`,
    chainPolicyIds: chainIds,
    decision,
    ...actorResult !== void 0 && { actorResult },
    duties: decision.duties,
    // G1 — `false` only when every hop of THIS chain and of the identity-
    // composition chain (when one ran) was content-digest-verified above; any hop
    // presented without raw content keeps the honest provisional marker.
    policyIntegrityProvisional: !allContentBound || (actorResult?.policyIntegrityProvisional ?? false)
  };
}
export {
  PHASE_A_CODES,
  RELATED_RESOURCE_CODES,
  STATUS_GATE_CODES,
  readBoundAuthorization,
  verifyAgentAuthority
};
//# sourceMappingURL=index.js.map
