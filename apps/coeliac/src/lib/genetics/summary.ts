// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The pod I/O for the single genetic summary (Phase 3c §5.5). PRIVACY-CRITICAL.
 * The most sensitive record in the diary gets the SAME fail-closed treatment as the
 * rest: the owner-only ACL on the diary root is written FIRST (via
 * `ensureDiaryReady`) before the summary is ever PUT, and the summary body is
 * produced ONLY through `@jeswr/solid-health-diary`'s reviewed builder — which
 * refuses to serialise without `consentGiven: true` (the fail-closed consent
 * guardrail is enforced in the model, not re-implemented here) and a non-empty
 * negative-predictive framing.
 *
 * By construction the summary written here contains ONLY interpreted marker rows +
 * the framing — there is no field, in the model or in this module, for raw genotype
 * bytes. The raw file is parsed on-device (`parse.ts`) and discarded; only the
 * derived summary reaches this module and the pod.
 */

import { fetchRdf } from "@jeswr/fetch-rdf";
import {
  type GeneticSummaryData,
  type GeneticSummaryInput,
  parseGeneticSummary,
  serializeGeneticSummary,
} from "@jeswr/solid-health-diary";
import { geneticsSummaryUrl } from "../pod/layout";
import { ensureDiaryReady, putResource } from "../pod/pod-fs";

/** The authed context a genetics write/read needs (the suite auth seam). */
export interface GeneticsContext {
  authedFetch: typeof globalThis.fetch;
  webId: string;
  storageRoot: string;
}

/**
 * Per-resource write serialization. The genetic summary is a SINGLE fixed-URL
 * resource, so two concurrent writers (a rapid double-save, or a reconcile racing a
 * save) could otherwise have their PUTs land OUT OF ORDER — an older in-flight write
 * completing last and overwriting the pod with stale data. Chaining every write to a
 * given URL through one promise guarantees they land in enqueue order, so the LAST
 * write enqueued (the newest save) is the last to hit the pod. Keyed by URL; a
 * failed write does not break the chain (the next write still runs).
 */
const writeChains = new Map<string, Promise<unknown>>();
function serializeWrite<T>(url: string, run: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(url) ?? Promise.resolve();
  const next = prev.then(run, run); // run regardless of the previous write's outcome
  // Keep the chain alive even if this write rejects (swallow only for the chain tail).
  writeChains.set(
    url,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * Serialise + PUT the genetic summary to the pod, owner-only ACL ensured FIRST.
 *
 * `input` is a {@link GeneticSummaryInput}, so `consentGiven: true` is required at
 * COMPILE time — a caller cannot even build a write without explicit consent. The
 * model's builder re-checks at runtime (defence against an unsafe cast) and also
 * enforces the NPV-coverage gate (a `risk-haplotype-absent` rollup needs
 * `coverageComplete: true`). Any guardrail violation throws BEFORE any network write.
 */
export async function writeGeneticSummary(
  ctx: GeneticsContext,
  input: GeneticSummaryInput,
): Promise<{ url: string }> {
  const url = geneticsSummaryUrl(ctx.storageRoot);
  // Enqueue SYNCHRONOUSLY (before any await) so the chain order == the call order —
  // otherwise a newer save whose serialisation finishes faster could enqueue/write
  // first and an older slower serialisation could then write LAST, leaving stale
  // data on the pod. The Turtle serialisation (which runs the consent / coverage /
  // framing guardrails) happens INSIDE the chain: a guardrail rejection throws here
  // and rejects this write WITHOUT any ACL/PUT (nothing is written for an
  // un-consented/invalid summary), and the chain continues for later writes.
  await serializeWrite(url, async () => {
    const body = await serializeGeneticSummary(url, {
      ...input,
      patient: input.patient ?? ctx.webId,
    });
    // Owner-only ACL on the diary root FIRST (fail-closed) — never a briefly-public write.
    await ensureDiaryReady(ctx.authedFetch, ctx.storageRoot, ctx.webId);
    await putResource(ctx.authedFetch, url, body);
  });
  return { url };
}

/**
 * Read + parse the genetic summary from the pod, or `undefined` if none exists /
 * it does not parse as a valid, consented summary (the model's read-side guardrails
 * reject an un-consented or overstated-negative stored record). Never throws on a
 * 404 or a network error — returns `undefined` so the UI shows the empty state.
 */
export async function readGeneticSummary(
  ctx: GeneticsContext,
): Promise<GeneticSummaryData | undefined> {
  const url = geneticsSummaryUrl(ctx.storageRoot);
  try {
    const { dataset } = await fetchRdf(url, { fetch: ctx.authedFetch });
    return parseGeneticSummary(url, dataset);
  } catch {
    return undefined;
  }
}
