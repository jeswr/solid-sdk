import { classifyReliability, isWithinBase, vocab } from "@jeswr/agentic-legacy-bridge";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { deriveProposals } from "../actor/derive.js";
import { readInboundContext, readInterpretations } from "../actor/interpretations.js";
import { isSafeContainer, type PodFetch } from "../config.js";
import { proposalContentDigest } from "../pod/digest.js";
import { type ActionProposal, parseProposal, serializeProposal, utcIso } from "../pod/proposals.js";
import { objectsOf, subjectsOf } from "../pod/rdf-query.js";
import { listContainer, readGraph } from "../pod/read.js";

const { namedNode } = DataFactory;

/** Reject ambiguous or unlinked Reader records rather than selecting a convenient value. */
function verifiableRecords(store: DatasetCore, anchor: string): boolean {
  if (subjectsOf(store, vocab.RDF_TYPE, namedNode(vocab.AGENTIC_RAW_INBOUND_MESSAGE)).length !== 1)
    return false;
  const records = readInterpretations(store);
  if (records.length === 0) return false;
  return records.every(({ node }) => {
    const source = objectsOf(store, node, vocab.PROV_WAS_DERIVED_FROM);
    if (source.length !== 1 || source[0]?.termType !== "NamedNode" || source[0].value !== anchor)
      return false;
    for (const predicate of [
      vocab.AGENTIC_CONFIDENCE,
      vocab.AGENTIC_CALIBRATION,
      vocab.AGENTIC_INTERPRETATION_METHOD,
      vocab.AGENTIC_ASSERTS_SUBJECT,
      vocab.AGENTIC_ASSERTS_PREDICATE,
    ]) {
      if (objectsOf(store, node, predicate).length !== 1) return false;
    }
    if (
      objectsOf(store, node, vocab.AGENTIC_ASSERTS_OBJECT).length +
        objectsOf(store, node, vocab.AGENTIC_ASSERTS_OBJECT_IRI).length !==
      1
    )
      return false;
    return objectsOf(store, node, vocab.AGENTIC_SECURITY_BEARING).length <= 1;
  });
}

/**
 * Reconstruct the pilot's deterministic reply from Reader-owned records at execution time.
 * Only exact, calibrated, non-security replies can be autonomous. Residual LLM drafts and
 * unavailable/ambiguous provenance require confirmation, even under a broad signed permit.
 */
export async function provenanceRequiresConfirmation(
  proposal: ActionProposal,
  config: { readFetch: PodFetch; inbox?: string; proposals: string },
): Promise<boolean> {
  if (proposal.confirmationRequired) return true;
  const inbox = config.inbox;
  if (
    !isSafeContainer(inbox) ||
    inbox === config.proposals ||
    isWithinBase(inbox, config.proposals) ||
    isWithinBase(config.proposals, inbox)
  )
    return true;
  if (!proposal.derivedFrom || proposal.derivedFrom !== proposal.inReplyTo) return true;
  // Neither the proposal's provenance pointer nor RDF redirects/contexts may choose a
  // credentialed fetch target. Only the configured Reader container is trusted.
  const readFetch: PodFetch = async (input, init) => {
    const url = String(input);
    if (url !== inbox && !isWithinBase(url, inbox))
      throw new Error("provenance outside Reader inbox");
    const response = await config.readFetch(input, {
      ...init,
      redirect: "manual",
      headers: { Accept: "text/turtle" },
    });
    if (
      response.redirected ||
      (response.url && response.url !== url) ||
      (response.status >= 300 && response.status < 400) ||
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "text/turtle"
    )
      throw new Error("unverifiable provenance response");
    return response;
  };
  try {
    let matched = 0;
    let requiresConfirmation = true;
    for (const url of await listContainer(readFetch, inbox)) {
      const child = url.slice(inbox.length);
      if (
        !child.endsWith(".ttl") ||
        child.endsWith(".chat.ttl") ||
        child.includes("/") ||
        new URL(url).search ||
        new URL(url).hash
      )
        continue;
      const { store } = await readGraph(readFetch, url);
      const inbound = readInboundContext(store);
      if (inbound.rawAnchor !== proposal.derivedFrom) continue;
      matched += 1;
      if (!verifiableRecords(store, inbound.rawAnchor)) continue;
      const derived = deriveProposals(readInterpretations(store), {
        inbound,
        idPrefix: child.slice(0, -4),
        now: new Date(proposal.proposedAt),
      });
      const expected = derived[0];
      if (!expected || expected.confirmationRequired) continue;
      // A second assessment of the same offered datum may impose a stricter gate.
      // Never let first-record selection or deduplication hide that assessment.
      const times = new Set(
        expected.offeredTimes?.flatMap((time) => {
          const start = utcIso(time.startTime);
          return start ? [start] : [];
        }),
      );
      if (
        readInterpretations(store).some(
          (record) =>
            record.assertsPredicate === vocab.SCHEMA_START_TIME &&
            times.has(utcIso(record.assertsObjectLiteral) ?? "") &&
            classifyReliability({
              confidence: record.confidence,
              securityBearing: record.securityBearing,
              calibration:
                record.calibration === vocab.AGENTIC_CALIBRATED
                  ? "Calibrated"
                  : record.calibration === vocab.AGENTIC_VERIFIED
                    ? "Verified"
                    : "SelfReported",
            }) !== "auto",
        )
      )
        continue;
      // Normalize through the persistence format (notably UTC timestamps) before
      // comparing all send-affecting fields. An unrelated calibrated record cannot
      // bless Actor-invented content, purpose, spend, recipient, or reply linkage.
      const normalized = parseProposal(
        await parseRdf(await serializeProposal(expected, { resourceUrl: url }), "text/turtle", {
          baseIRI: url,
        }),
      );
      if (normalized && proposalContentDigest(normalized) === proposalContentDigest(proposal))
        requiresConfirmation = false;
    }
    return matched !== 1 || requiresConfirmation;
  } catch {
    return true;
  }
}
