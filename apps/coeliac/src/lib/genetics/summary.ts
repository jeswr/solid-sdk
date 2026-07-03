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
import { geneticsSummaryUrl } from "../pod/layout.js";
import { ensureDiaryReady, putResource } from "../pod/pod-fs.js";

/** The authed context a genetics write/read needs (the suite auth seam). */
export interface GeneticsContext {
  authedFetch: typeof globalThis.fetch;
  webId: string;
  storageRoot: string;
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
  // Serialise FIRST — if a guardrail (consent / coverage / framing) rejects, we
  // throw before touching the network, and nothing (not even the container ACL) is
  // written for this un-consented/invalid summary.
  const body = await serializeGeneticSummary(url, {
    ...input,
    patient: input.patient ?? ctx.webId,
  });
  // Owner-only ACL on the diary root FIRST (fail-closed) — never a briefly-public write.
  await ensureDiaryReady(ctx.authedFetch, ctx.storageRoot, ctx.webId);
  await putResource(ctx.authedFetch, url, body);
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
