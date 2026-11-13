// AUTHORED-BY Codex GPT-6.1-Sol
import { compileOperation, requestFingerprint } from "@jeswr/site-executor";
import { SCHEMA } from "@jeswr/site-model";
import {
  buildOperation,
  candidateFromForm,
  clusterRequests,
  type FormInfo,
  matchRequest,
  mergeCandidates,
  type RecordedRequest,
  type SessionTokens,
} from "@jeswr/site-profiler";

/** Compile without sending, using exactly the same canonicalisation as learned executor writes. */
export function browserWriteFingerprint(
  request: RecordedRequest,
  origin: string,
  forms: FormInfo[],
  tokens: SessionTokens,
): string {
  const clustered = clusterRequests([request], origin, new Set(), tokens);
  const form = forms.find(
    (f) =>
      f.method === request.method &&
      (f.action === request.url ||
        (f.method === "GET" && new URL(f.action).pathname === new URL(request.url).pathname)),
  );
  const candidate = mergeCandidates([
    ...clustered,
    ...(form
      ? [
          {
            ...candidateFromForm(form, form.pageUrl),
            key: clustered[0]?.key ?? "",
            urlTemplate: clustered[0]?.urlTemplate ?? form.action,
          },
        ]
      : []),
  ])[0];
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
