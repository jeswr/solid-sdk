// AUTHORED-BY Codex GPT-6.1-Sol
import { compileOperation, requestFingerprint } from "@jeswr/site-executor";
import { SCHEMA } from "@jeswr/site-model";
import {
  buildOperation,
  type FormInfo,
  matchRequest,
  type RecordedRequest,
  type SessionTokens,
} from "@jeswr/site-profiler";
import { wireCandidates } from "./wire.js";

/** Compile without sending, using exactly the same canonicalisation as learned executor writes. */
export function browserWriteFingerprint(
  request: RecordedRequest,
  origin: string,
  forms: FormInfo[],
  tokens: SessionTokens,
): string {
  const candidate = wireCandidates([request], origin, forms, tokens)[0];
  if (!candidate) throw new Error("Unsupported browser write.");
  const operation = buildOperation(
    candidate,
    {
      actionType: `${SCHEMA}UpdateAction`,
      label: "Browser write",
      effect: "irreversible-write",
      confidence: 0.3,
    },
    {
      modelId: "urn:sab:fallback",
      learnedAt: "2026-11-13T00:00:00.000Z",
      derivedFrom: [],
      method: "fallback",
      usedIds: new Set(),
      sessionCookies: [],
    },
  );
  const values = matchRequest(candidate, request);
  if (!values) throw new Error("Unsupported browser write.");
  return requestFingerprint(compileOperation(operation, values, origin));
}
