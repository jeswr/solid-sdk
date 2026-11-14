// AUTHORED-BY Claude Opus 5.5
// Learn one session liveness read from the demonstration: never a guessed or unwitnessed URL.
import {
  compileOperation,
  type EffectVerification,
  type LivenessRead,
  livenessSignature,
  sentInputValue,
} from "@jeswr/site-executor";
import { type Operation, SCHEMA, selectionWitnesses } from "@jeswr/site-model";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";
import { isDangerousLink } from "./util.js";

const identityProperties = ["object", "identifier", "sku", "productID", "orderNumber"].map(
  (key) => `${SCHEMA}${key}`,
);

/** Identities removed by any demonstrated deletion; a liveness read must not address them. */
function deletedIdentities(
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): Set<string> {
  const out = new Set<string>();
  for (const op of operations) {
    if (op.actionType !== `${SCHEMA}DeleteAction`) continue;
    const identities = [
      ...selectionWitnesses(op),
      ...op.inputs.filter(
        (p) => p.path[0] === `${SCHEMA}object` && identityProperties.includes(p.path.at(-1) ?? ""),
      ),
    ];
    for (const write of trace) {
      if (write.phase !== "demonstration" || write.blocked) continue;
      const values = matchRequest(op.request, write);
      if (!values) continue;
      for (const p of identities) {
        const value = values[p.name] ?? sentInputValue(op, values, p.name, origin);
        if (value) out.add(value);
      }
    }
  }
  return out;
}

function sameUrl(a: URL, b: URL): boolean {
  const query = (url: URL) => JSON.stringify([...url.searchParams].sort());
  return a.origin === b.origin && a.pathname === b.pathname && query(a) === query(b);
}

/**
 * The liveness read for a not-found deletion: a signed-in, read-gated GET witnessed in the
 * deletion's authentication context, returning success with at least one item-level field and
 * no failure or authentication marker. Collection reads are preferred, then reads with fewer
 * inputs, then the earliest witness. Its inputs are the witnessed constants only, and it never
 * addresses an identity deleted by the demonstration.
 */
export function learnLivenessRead(
  operation: Operation,
  verification: EffectVerification,
  operations: readonly Operation[],
  learnedOperations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): LivenessRead | undefined {
  const writes = trace.filter(
    (r) => r.phase === "demonstration" && !r.blocked && matchRequest(operation.request, r),
  );
  const context = writes[0]?.authenticationContext;
  if (!context || writes.some((w) => w.authenticationContext !== context)) return;
  const deleted = deletedIdentities(operations, trace, origin);
  for (const write of writes) {
    const value = sentInputValue(
      operation,
      matchRequest(operation.request, write) ?? {},
      verification.identityInput,
      origin,
    );
    if (value) deleted.add(value);
  }
  const candidates: { read: LivenessRead; rank: number[] }[] = [];
  for (const read of learnedOperations) {
    const extraction = read.extraction;
    if (
      read.effect !== "read" ||
      read.request.method !== "GET" ||
      read.session !== "signed-in" ||
      !extraction
    )
      continue;
    for (const sample of trace) {
      if (
        sample.phase !== "demonstration" ||
        sample.blocked ||
        sample.method !== "GET" ||
        sample.authenticationContext !== context ||
        sample.status === undefined ||
        sample.status < 200 ||
        sample.status >= 300 ||
        sample.redirectedTo ||
        sample.responsePageFailure === true ||
        sample.bodyTruncated ||
        !sample.bodySample
      )
        continue;
      const values = matchRequest(read.request, sample);
      if (!values) continue;
      let url: URL;
      try {
        url = new URL(sample.url);
        if (url.origin !== origin || isDangerousLink(url.href)) continue;
        const defaults = Object.fromEntries(
          read.inputs.flatMap((p) => (p.default === undefined ? [] : [[p.name, p.default]])),
        );
        if (!sameUrl(compileOperation(read, { ...defaults, ...values }, origin).url, url)) continue;
      } catch {
        continue;
      }
      if (read.inputs.some((p) => p.required && values[p.name] === undefined && !p.default))
        continue;
      const addressed = [
        ...url.pathname.split("/").map((part) => {
          try {
            return decodeURIComponent(part);
          } catch {
            return part;
          }
        }),
        ...url.searchParams.values(),
        ...Object.values(values),
      ];
      if (addressed.some((part) => deleted.has(part))) continue;
      const signature = livenessSignature(
        sample.status,
        sample.contentType,
        sample.bodySample,
        extraction,
      );
      if (!signature) continue;
      const bind: LivenessRead["bind"] = {};
      for (const p of read.inputs)
        if (values[p.name] !== undefined) bind[p.name] = { value: values[p.name] as string };
      candidates.push({
        read: { operation: read.id, bind, signature },
        rank: [extraction.itemPath !== undefined ? 0 : 1, Object.keys(bind).length, sample.seq],
      });
    }
  }
  candidates.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) {
      const diff = (a.rank[i] ?? 0) - (b.rank[i] ?? 0);
      if (diff) return diff;
    }
    return 0;
  });
  return candidates[0]?.read;
}
