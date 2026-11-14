// AUTHORED-BY Codex GPT-6.1-Sol
// Executor-local declarations until created-location/success evidence joins the shared contract.

import type { Operation } from "@jeswr/site-model";
import { type Extraction, responseIdentity, SCHEMA } from "@jeswr/site-model";
import { attribute, elementText, jsonPointer, parseHtml, selectElement } from "./dom.js";
import { extract } from "./extract.js";
import { guardUrl } from "./origin.js";
import {
  createdObjectType,
  landingItemValues,
  responsePageError,
  sentInputValue,
} from "./response-evidence.js";
import { BindingError } from "./values.js";

export interface EffectVerification {
  operation: string;
  bind: Record<string, { input: string } | { value: string }>;
  identityInput: string;
  identityPattern: string;
  identityAliases?: string[];
  /** Submitted values, or a demonstrated numeric delta (for example a vote count). */
  changes: {
    input: string;
    property: string;
    mode?: "delta";
    /** Exact numeric presentation witnessed after submitting this typed input. */
    format?: { prefix: string; suffix: string; scale: number };
  }[];
  /** A witnessed display slug immediately following the numeric resource identity. */
  displaySlug?: boolean;
}

export function requiresEffectVerification(operation: Operation): boolean {
  return (
    operation.effect !== "read" &&
    ![
      "CreateAction",
      "AddAction",
      "AddToCartAction",
      "ReviewAction",
      "CommentAction",
      "BuyAction",
      "OrderAction",
      "PayAction",
      "RegisterAction",
    ].some((type) => operation.actionType === `${SCHEMA}${type}`) &&
    operation.actionType !== "https://jeswr.org/ns/site-action#LoginAction"
  );
}

export interface WriteResponsePolicy {
  /** On-origin URL/path with whole-segment {variables}, e.g. /products/id/{id}. */
  createdLocationPattern: string;
  errorLocationPatterns?: string[];
  /** Non-creating writes can complete at a collection without promoting its URL. */
  completionOnly?: boolean;
  /** Exact submitted input and main-item field used as positive creation evidence. */
  inputEvidence?: { input: string; property: string };
  /** Exact redirect count and final status witnessed by the profiler. */
  redirectCount?: number;
  finalStatus?: number;
  /** Learned read of the landing resource, checked before admitting its identity. */
  extraction?: Extraction;
  /** A learned GET returning exactly one item by the created identity. */
  readBack?: {
    operation: string;
    bind: Record<string, { identity: true } | { input: string } | { value: string }>;
    /** Exact witnessed resource route; only the new identity occupies {id}. */
    identityPattern: string;
    /** Additional resource routes witnessed as aliases of the same read item. */
    identityAliases?: string[];
  };
  /** Ignored legacy artifact. Reprofile to learn runtime effect verification. */
  successFlash?: string[];
  /** A witnessed read of the existing target, run before and after the approved write. */
  verification?: EffectVerification;
  success?:
    | { format: "json"; path: string; value: string }
    | { format: "html"; selector: string; attribute?: string; value?: string };
}

function patternPath(pattern: string, origin: string): RegExp {
  const marked = pattern.replace(/\{[A-Za-z][\w]*\}/g, "sab_pattern_slot");
  const url = guardUrl(marked, origin);
  if (url.search || url.hash || /[{}]/.test(marked))
    throw new BindingError("invalid created-location pattern");
  const parts = url.pathname.split("/").map((part) => {
    if (part === "sab_pattern_slot") return "[^/]+";
    if (part.includes("sab_pattern_slot"))
      throw new BindingError("created-location slots must occupy whole segments");
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp(`^${parts.join("/")}$`);
}

export function validateWriteResponsePolicy(policy: WriteResponsePolicy, origin: string): void {
  patternPath(policy.createdLocationPattern, origin);
  if (
    policy.redirectCount !== undefined &&
    (!Number.isSafeInteger(policy.redirectCount) || policy.redirectCount < 1)
  )
    throw new BindingError("invalid write-response redirect count");
  if (
    policy.finalStatus !== undefined &&
    (!Number.isSafeInteger(policy.finalStatus) ||
      policy.finalStatus < 200 ||
      policy.finalStatus >= 300)
  )
    throw new BindingError("invalid write-response final status");
  if (policy.readBack) {
    const declaration = policy.readBack;
    for (const pattern of [declaration.identityPattern, ...(declaration.identityAliases ?? [])])
      readBackIdentityUrl(pattern, "1", origin);
  }
  if (policy.verification) {
    for (const pattern of [
      policy.verification.identityPattern,
      ...(policy.verification.identityAliases ?? []),
    ]) {
      patternPath(pattern, origin);
      if (pattern.split("{id}").length !== 2)
        throw new BindingError("verification needs an identity slot");
    }
  }
  for (const error of policy.errorLocationPatterns ?? []) patternPath(error, origin);
}

function readBackIdentityUrl(pattern: string, identity: string, origin: string): string {
  if (
    typeof pattern !== "string" ||
    pattern.split("{id}").length !== 2 ||
    /[{}]/.test(pattern.replace("{id}", ""))
  )
    throw new BindingError("read-back needs a witnessed identity pattern");
  patternPath(pattern, origin);
  const url = guardUrl(pattern.replace("{id}", encodeURIComponent(identity)), origin);
  if (url.search || url.hash) throw new BindingError("invalid read-back identity pattern");
  return url.href;
}

/** A permalink alias must retain the learned resource route and its on-origin identity. */
export function matchesCreatedIdentity(
  pattern: string,
  location: string,
  candidate: string,
  origin: string,
): boolean {
  try {
    const created = guardUrl(location, origin);
    const item = guardUrl(candidate, origin);
    const identity = responseIdentity(created.href);
    if (item.search || !identity || responseIdentity(item.href)?.identifier !== identity.identifier)
      return false;
    return (
      patternPath(pattern, origin).test(item.pathname) ||
      created.pathname.slice(0, created.pathname.lastIndexOf("/")) === item.pathname
    );
  } catch {
    return false;
  }
}

export async function verifiedCreatedLocation(
  policy: WriteResponsePolicy | undefined,
  hops: string[],
  finalUrl: URL,
  body: string,
  origin: string,
  finalStatus?: number,
  operation?: Operation,
  inputs: Record<string, string> = {},
  readBack?: (identity: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (!policy || !hops.length) return undefined;
  if (
    (policy.redirectCount !== undefined && hops.length !== policy.redirectCount) ||
    (policy.finalStatus !== undefined && finalStatus !== policy.finalStatus)
  )
    return undefined;
  const pattern = patternPath(policy.createdLocationPattern, origin);
  const first = guardUrl(hops[0] as string, origin);
  const destinations = [...hops.map((hop) => guardUrl(hop, origin)), finalUrl];
  if (
    destinations.some(
      (url) =>
        !pattern.test(url.pathname) ||
        url.pathname !== first.pathname ||
        (policy.errorLocationPatterns ?? []).some((p) => patternPath(p, origin).test(url.pathname)),
    )
  )
    return undefined;
  const success = policy.success;
  if (success?.format === "json") {
    try {
      const value = jsonPointer(JSON.parse(body), success.path);
      if (
        !["string", "number", "boolean"].includes(typeof value) ||
        String(value) !== success.value
      )
        return undefined;
    } catch {
      return undefined;
    }
  } else if (success?.format === "html") {
    const el = selectElement(success.selector, parseHtml(body));
    if (!el) return undefined;
    const value = success.attribute ? attribute(el, success.attribute) : elementText(el);
    if (success.value !== undefined && value !== success.value) return undefined;
  }
  const ex = policy.extraction;
  const contentType =
    ex?.format === "json" || /^\s*[[{]/.test(body) ? "application/json" : "text/html";
  // Existing-item writes can complete only through runtime before/after reads.
  // Neither a learned flash nor a completion-only route is success evidence.
  if (policy.completionOnly || (operation && requiresEffectVerification(operation)))
    return undefined;
  if (responsePageError(body, contentType)) return undefined;
  const identity = responseIdentity(first.href);
  const templateParts = new URL(
    policy.createdLocationPattern.replaceAll("{", "%7B").replaceAll("}", "%7D"),
    origin,
  ).pathname.split("/");
  const identitySlot = templateParts.indexOf("%7Bid%7D");
  const slotValue =
    identitySlot >= 0
      ? decodeURIComponent(first.pathname.split("/")[identitySlot] ?? "")
      : undefined;
  const evidence = policy.inputEvidence;
  if (
    !operation ||
    !identity ||
    identity.identifier !== slotValue ||
    (!policy.readBack && (!ex || ex.itemType !== createdObjectType(operation))) ||
    !evidence
  )
    return undefined;
  if (policy.readBack) return (await readBack?.(identity.identifier)) ? first.href : undefined;
  if (!ex) return undefined;
  const main = landingItemValues(ex, body);
  const submitted = sentInputValue(operation, inputs, evidence.input, origin);
  // Equality is allowed for untrusted prose only as this narrow success check; it
  // does not make that field trusted or available for later flow bindings.
  if (
    !main ||
    !submitted ||
    main.get(evidence.property)?.length !== 1 ||
    main.get(evidence.property)?.[0] !== submitted
  )
    return undefined;
  try {
    const out = await extract(ex, body, { baseUrl: finalUrl.href, redact: (value) => value });
    const item = out.items[0];
    if (out.truncation.items || out.truncation.values || out.items.length !== 1 || !item)
      return undefined;
    const ids = item.values.get(`${SCHEMA}identifier`) ?? [];
    const urls = [...(item.values.get(`${SCHEMA}url`) ?? []), ...(item.iri ? [item.iri] : [])];
    if (
      !(ids.length || urls.length) ||
      !ids.every((id) => id === identity.identifier) ||
      !urls.every((url) =>
        matchesCreatedIdentity(policy.createdLocationPattern, first.href, url, origin),
      )
    )
      return undefined;
  } catch {
    return undefined;
  }
  return first.href;
}

/** Trusted identity claims from a detail or filtered-list read must agree. */
export function readBackIdentityMatches(
  ids: readonly string[],
  urls: readonly string[],
  identity: string,
  origin: string,
  patterns: readonly string[],
): boolean {
  if (!urls.length || !patterns.length || !ids.every((id) => id === identity)) return false;
  return urls.every((value) => {
    try {
      const url = guardUrl(value, origin);
      return (
        !url.search &&
        !url.hash &&
        patterns.some((pattern) => readBackIdentityUrl(pattern, identity, origin) === url.href)
      );
    } catch {
      return false;
    }
  });
}

/** Creation read-back equality is bounded and never upgrades untrusted fields into flow facts. */
export async function verifiedReadBackItem(
  extraction: Extraction,
  body: string,
  baseUrl: string,
  identity: string,
  property: string,
  submitted: string,
  redact: (value: string) => string,
  resource: Pick<
    NonNullable<WriteResponsePolicy["readBack"]>,
    "identityPattern" | "identityAliases"
  >,
): Promise<boolean> {
  if (responsePageError(body, extraction.format === "json" ? "application/json" : "text/html"))
    return false;
  try {
    const out = await extract(extraction, body, { baseUrl, redact });
    const item = out.items[0];
    if (out.truncation.items || out.truncation.values || out.items.length !== 1 || !item)
      return false;
    const ids = item.values.get(`${SCHEMA}identifier`) ?? [];
    const urls = [...(item.values.get(`${SCHEMA}url`) ?? []), ...(item.iri ? [item.iri] : [])];
    if (
      !readBackIdentityMatches(ids, urls, identity, new URL(baseUrl).origin, [
        resource.identityPattern,
        ...(resource.identityAliases ?? []),
      ]) ||
      redact(identity) !== identity
    )
      return false;
    const equality = await extract(
      {
        ...extraction,
        fields: extraction.fields
          .filter((f) => f.property === property)
          .map((f) => ({ ...f, untrusted: false })),
      },
      body,
      { baseUrl, redact },
    );
    const values = equality.items[0]?.values.get(property);
    return (
      !equality.truncation.items &&
      !equality.truncation.values &&
      equality.items.length === 1 &&
      values?.length === 1 &&
      values[0] === submitted &&
      redact(submitted) === submitted
    );
  } catch {
    return false;
  }
}
