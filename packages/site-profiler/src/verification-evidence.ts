// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import {
  cookieHeader,
  createApprovalGate,
  createdObjectType,
  type Gate,
  guardUrl,
  jsonEnvelope,
  notFoundSignature,
  parseSetCookie,
  requiresEffectVerification,
  responsePageError,
  staleVerificationResponse,
  VERIFICATION_EVIDENCE_LIMIT,
} from "@jeswr/site-executor";
import type { Extraction, Operation } from "@jeswr/site-model";
import type { BrowserContext } from "playwright";
import { applyExtraction, proposeHtmlExtraction, proposeJsonExtraction } from "./extraction.js";
import { isCsrfFieldName, parseForms } from "./forms.js";
import type { Recorder } from "./recorder.js";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";
import { isDangerousLink, jsonPointer } from "./util.js";

/** Store bounded field evidence, never the body used to obtain it. */
export function captureVerificationEvidence(
  r: RecordedRequest,
  body: string,
  extraction?: Extraction,
): void {
  if (Buffer.byteLength(body) <= VERIFICATION_EVIDENCE_LIMIT && !r.responsePageFailure) {
    const signature = notFoundSignature(r.status ?? 0, r.contentType, body);
    if (signature) r.notFoundEvidence = signature;
  }
  if (
    Buffer.byteLength(body) > VERIFICATION_EVIDENCE_LIMIT ||
    r.method !== "GET" ||
    r.responsePageFailure ||
    responsePageError(body, r.contentType, false)
  )
    return;
  let ex =
    extraction ??
    (/json/i.test(r.contentType ?? "")
      ? proposeJsonExtraction(body, r.url)
      : /html/i.test(r.contentType ?? "")
        ? proposeHtmlExtraction(body, r.url)
        : undefined);
  if (ex) {
    if (!extraction) {
      const proposed = applyExtraction(ex, body, r.url);
      ex = {
        ...ex,
        fields: ex.fields.filter((f) =>
          proposed.every((item) => (item[f.property] ?? []).every((value) => value.length <= 4000)),
        ),
      };
    }
    const items = applyExtraction(ex, body, r.url);
    if (
      items.length <= 200 &&
      ex.fields.length <= 100 &&
      items.every((item) =>
        Object.values(item).every((vs) => vs.length <= 100 && vs.every((v) => v.length <= 4000)),
      )
    ) {
      const total =
        ex.format === "json" && ex.totalPath !== undefined
          ? jsonPointer(JSON.parse(body), ex.totalPath)
          : undefined;
      const collection = collectionEvidence(body, ex);
      r.verificationEvidence = {
        extraction: ex,
        items,
        trustedItems: applyExtraction(
          { ...ex, fields: ex.fields.filter((f) => !f.untrusted) },
          body,
          r.url,
        ),
        ...(typeof total === "number" ? { total } : {}),
        ...(collection !== undefined ? { collection } : {}),
      };
    }
  }
  if (/html/i.test(r.contentType ?? "")) {
    r.formState = parseForms(body, r.url).map((form) => ({
      action: form.action,
      method: form.method,
      fields: form.fields
        .filter(
          (f) =>
            !isCsrfFieldName(f.name) &&
            f.type !== "password" &&
            (f.value ?? f.selected)?.length !== undefined &&
            (f.value ?? f.selected ?? "").length <= 4000,
        )
        .slice(0, 2000)
        .map((f) => ({ name: f.name, value: f.value ?? f.selected ?? "" })),
    }));
  }
}

function collectionEvidence(body: string, ex: Extraction) {
  if (ex.format !== "json" || responsePageError(body, "application/json", false)) return;
  try {
    const doc: unknown = JSON.parse(body);
    const rows = jsonPointer(doc, ex.itemPath ?? "");
    const envelope = jsonEnvelope(doc, ex.itemPath);
    if (
      envelope.failed ||
      !envelope.keys ||
      envelope.keys.length > 100 ||
      envelope.keys.flat().length > 1000 ||
      envelope.keys.flat().some((key) => key.length > 4000) ||
      Buffer.byteLength(JSON.stringify(envelope.keys)) > 64 * 1024
    )
      return;
    if (!Array.isArray(rows)) return rows && typeof rows === "object" ? null : undefined;
    return { count: rows.length, envelope: envelope.keys };
  } catch {
    return;
  }
}

/** Complete collection shape evidence survives the recorder's ordinary body sample cap. */
export function verificationCollection(r: RecordedRequest, ex: Extraction) {
  if (r.responsePageFailure || r.redirectedTo) return;
  if (
    r.verificationEvidence &&
    JSON.stringify(r.verificationEvidence.extraction) === JSON.stringify(ex) &&
    r.verificationEvidence.collection !== undefined
  )
    return r.verificationEvidence.collection;
  return !r.bodyTruncated && r.bodySample ? collectionEvidence(r.bodySample, ex) : undefined;
}

export function verificationItems(r: RecordedRequest, ex: Extraction, trusted = false) {
  if (
    r.verificationEvidence &&
    JSON.stringify(r.verificationEvidence.extraction) === JSON.stringify(ex)
  )
    return trusted ? r.verificationEvidence.trustedItems : r.verificationEvidence.items;
  return !r.bodyTruncated && r.bodySample
    ? applyExtraction(
        trusted ? { ...ex, fields: ex.fields.filter((f) => !f.untrusted) } : ex,
        r.bodySample,
        r.url,
      )
    : [];
}

/** Fetch every witnessed candidate tuple in the profiling session, after demonstrations.
 * No redirects, writes or stored bodies; gate denial precedes cookies and network access. */
export async function fetchVerificationEvidence(
  operations: readonly Operation[],
  context: BrowserContext,
  recorder: Recorder,
  gate: Gate = createApprovalGate(),
): Promise<void> {
  const trace = recorder.trace.slice();
  const seen = new Set<string>();
  for (const read of operations) {
    if (read.effect !== "read" || read.request.method !== "GET") continue;
    if (
      !operations.some(
        (op) =>
          requiresEffectVerification(op) &&
          (!read.extraction?.itemType ||
            !createdObjectType(op) ||
            createdObjectType(op) === read.extraction.itemType),
      )
    )
      continue;
    for (const sample of trace) {
      if (
        sample.phase !== "demonstration" ||
        sample.method !== "GET" ||
        !matchRequest(read.request, sample) ||
        sample.blocked ||
        !sample.demonstration
      )
        continue;
      const key = JSON.stringify([sample.url, read.extraction, sample.requestHeaders]);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const url = guardUrl(sample.url, recorder.siteOrigin);
        if (isDangerousLink(url.href)) continue;
        if (
          (
            await gate.authorize({
              site: recorder.siteOrigin,
              target: {
                kind: "operation",
                id: read.id,
                label: read.label,
                actionType: read.actionType,
              },
              effect: "read",
              inputs: matchRequest(read.request, sample) ?? {},
              summary: `Verify demonstrated item on ${url.host}`,
              digest: key,
            })
          ).kind !== "allow"
        )
          continue;
        const cookies = await context.cookies(url.href);
        recorder.rememberCookies(cookies);
        const authenticationContext = recorder.authenticationContext(
          sample.requestHeaders,
          cookies,
        );
        if (!sample.authenticationContext || authenticationContext !== sample.authenticationContext)
          continue;
        const headers = new Headers(sample.requestHeaders);
        // Recorded credentials cannot be replayed as redacted literals.
        if ([...headers.values()].some((v) => v.includes("[redacted]"))) continue;
        headers.set("cookie", cookieHeader(cookies));
        headers.set("cache-control", "no-cache");
        headers.set("pragma", "no-cache");
        const res = await fetch(url, {
          method: "GET",
          headers,
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        const lines = res.headers.getSetCookie();
        recorder.rememberSetCookies(lines, url.href);
        const parsed = lines.flatMap((line) => {
          const c = parseSetCookie(line, url, new Date());
          return c
            ? [
                {
                  ...c,
                  expires: c.expires ?? -1,
                  httpOnly: c.httpOnly ?? false,
                  secure: c.secure ?? false,
                  sameSite: "Lax" as const,
                },
              ]
            : [];
        });
        if (parsed.length) await context.addCookies(parsed);
        const body = await recorder.readResponseBody(res, {
          url: url.href,
          contentType: res.headers.get("content-type") ?? undefined,
          resourceType: "verification-evidence",
        });
        const entry: Omit<RecordedRequest, "seq" | "phase"> = {
          method: "GET",
          url: url.href,
          resourceType: "verification-evidence",
          demonstration: sample.demonstration,
          authenticationContext,
          requestHeaders: Object.fromEntries(headers),
          cookieNames: cookies.map((c) => c.name),
          status: res.status,
          contentType: res.headers.get("content-type") ?? "",
          responsePageFailure:
            staleVerificationResponse(res.headers) ||
            res.headers.has("www-authenticate") ||
            res.headers.has("proxy-authenticate") ||
            recorder.authenticationContext(
              sample.requestHeaders,
              await context.cookies(url.href),
            ) !== authenticationContext,
        };
        if (res.headers.has("location"))
          entry.redirectedTo = new URL(res.headers.get("location") ?? "", url).href;
        const recorded = recorder.recordReplay(entry);
        captureVerificationEvidence(recorded, body, read.extraction);
      } catch {
        // Missing, oversized, incomplete and denied evidence cannot teach verification.
      }
    }
  }
}
