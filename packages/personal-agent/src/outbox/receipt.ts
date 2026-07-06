// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The PROV SEND RECEIPT — the audit record the executor writes after a send. Every autonomous
 * action references BOTH the signed mandate that governs it AND the specific ODRL permit that
 * authorized it (§7 point 4); a human-confirmed action records the owner's confirmation as the
 * authorizing basis instead. Built with `n3.Writer` + typed quads (never hand-concatenated).
 */
import { safeHttpIri } from "@jeswr/agentic-legacy-bridge";
import { DataFactory, Writer } from "n3";
import {
  AGENTIC_AUTHORIZED_BY_CONFIRMATION,
  AGENTIC_AUTHORIZED_BY_PERMIT,
  AGENTIC_CHANNEL,
  AGENTIC_CHANNEL_MESSAGE_ID,
  AGENTIC_EXECUTED_PROPOSAL,
  AGENTIC_NOTE,
  AGENTIC_OUTCOME,
  AGENTIC_SEND_RECEIPT,
  AGENTIC_UNDER_MANDATE,
  PROV_ENTITY,
  PROV_GENERATED_AT_TIME,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_DERIVED_FROM,
  RDF_TYPE,
  SCHEMA_RECIPIENT,
  XSD_BOOLEAN,
  XSD_DATE_TIME,
} from "../vocab.js";

const { namedNode, literal, quad } = DataFactory;

/** The outcome a receipt records — the unforgeable, Actor-unwritable "already handled" marker. */
export type ReceiptOutcome = "sent" | "rejected" | "failed";

/** The authorizing basis a send was performed under. */
export interface SendReceiptInput {
  /** The receipt resource URL (its `#receipt` subject base). */
  readonly resourceUrl: string;
  /** The executed proposal resource URL. */
  readonly proposalUrl: string;
  /** The outcome (`sent` / `rejected` / `failed`). */
  readonly outcome: ReceiptOutcome;
  /** The send channel. */
  readonly channel: string;
  /** The recipient handle. */
  readonly recipient: string;
  /** When the action happened (ISO-8601). */
  readonly executedAt: string;
  /** A control-stripped human note (e.g. a prohibition reason or a send-failure reason). */
  readonly note?: string;
  /** The acting agent's WebID (`prov:wasAttributedTo`), when known. */
  readonly agentWebId?: string;
  /** The raw-message anchor the action derived from (`prov:wasDerivedFrom`). */
  readonly derivedFrom?: string;
  /** The signed mandate credential IRI that governs the action. */
  readonly mandateId?: string;
  /** The ODRL permit rule IRI that authorized an AUTONOMOUS action (when it had one). */
  readonly permitId?: string;
  /** A human-readable permit label (the ODRL action) when the permit had no IRI. */
  readonly permitLabel?: string;
  /** True when the authorizing basis was an explicit owner confirmation (not autonomous). */
  readonly authorizedByConfirmation?: boolean;
  /** The channel's id for the sent message, when returned. */
  readonly channelMessageId?: string;
}

/** Serialise a send receipt to Turtle. */
export function serializeSendReceipt(input: SendReceiptInput): Promise<string> {
  const subject = namedNode(`${input.resourceUrl}#receipt`);
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuad(quad(subject, namedNode(RDF_TYPE), namedNode(AGENTIC_SEND_RECEIPT)));
  writer.addQuad(quad(subject, namedNode(RDF_TYPE), namedNode(PROV_ENTITY)));
  writer.addQuad(quad(subject, namedNode(AGENTIC_EXECUTED_PROPOSAL), namedNode(input.proposalUrl)));
  writer.addQuad(quad(subject, namedNode(AGENTIC_OUTCOME), literal(input.outcome)));
  writer.addQuad(quad(subject, namedNode(AGENTIC_CHANNEL), literal(input.channel)));
  writer.addQuad(quad(subject, namedNode(SCHEMA_RECIPIENT), literal(input.recipient)));
  writer.addQuad(
    quad(
      subject,
      namedNode(PROV_GENERATED_AT_TIME),
      literal(input.executedAt, namedNode(XSD_DATE_TIME)),
    ),
  );
  const agent = safeHttpIri(input.agentWebId);
  if (agent) writer.addQuad(quad(subject, namedNode(PROV_WAS_ATTRIBUTED_TO), namedNode(agent)));
  const derivedFrom = safeHttpIri(input.derivedFrom) ?? asSafeUrn(input.derivedFrom);
  if (derivedFrom) {
    writer.addQuad(quad(subject, namedNode(PROV_WAS_DERIVED_FROM), namedNode(derivedFrom)));
  }
  const mandate = safeHttpIri(input.mandateId) ?? asSafeUrn(input.mandateId);
  if (mandate) writer.addQuad(quad(subject, namedNode(AGENTIC_UNDER_MANDATE), namedNode(mandate)));

  if (input.authorizedByConfirmation) {
    writer.addQuad(
      quad(
        subject,
        namedNode(AGENTIC_AUTHORIZED_BY_CONFIRMATION),
        literal("true", namedNode(XSD_BOOLEAN)),
      ),
    );
  } else {
    const permit = safeHttpIri(input.permitId);
    if (permit) {
      writer.addQuad(quad(subject, namedNode(AGENTIC_AUTHORIZED_BY_PERMIT), namedNode(permit)));
    } else if (input.permitLabel) {
      writer.addQuad(
        quad(subject, namedNode(AGENTIC_AUTHORIZED_BY_PERMIT), literal(input.permitLabel)),
      );
    }
  }
  if (input.channelMessageId) {
    writer.addQuad(
      quad(subject, namedNode(AGENTIC_CHANNEL_MESSAGE_ID), literal(input.channelMessageId)),
    );
  }
  if (input.note) {
    writer.addQuad(quad(subject, namedNode(AGENTIC_NOTE), literal(input.note.slice(0, 500))));
  }

  return new Promise((resolve, reject) => {
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

/** Accept a `urn:` value only if it is a safe URN shape (no injection chars). */
function asSafeUrn(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^urn:[a-z0-9][a-z0-9-]{0,31}:[^\s<>"{}|\\^`]+$/i.test(value) ? value : undefined;
}
