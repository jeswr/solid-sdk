// AUTHORED-BY Codex GPT-6
/** Complete document carriage. No compatibility envelope is emitted here. */

import { DEFAULT_LIMITS, type PilotLimits } from "../core/limits.js";
import type { AnyMessage } from "../core/types.js";
import { materializeAttachments } from "../model/attachments.js";
import { type MessageNode, requireMessageNode } from "../model/message-nodes.js";
import {
  type AttachmentDocument,
  admitAttachments,
  checkCarriageSize,
  type DocumentAttachment,
  readAttachmentDocument,
  writeAttachmentDocument,
} from "./attachments.js";
import { type Authenticity, digest, type SignOptions, sign, verify } from "./authenticity.js";
import { DocumentError } from "./contexts.js";
import { outerProof } from "./data-integrity-proof.js";
import { type ReadResult, readJson, refusal, toTrig, toTurtle, validateRoot } from "./document.js";
import { type PublicKeyRecord, peekHeader } from "./jws-compact.js";

export interface MessagePacket {
  readonly format: "awp-jsonld/0.1";
  /** Exact UTF-8 document bytes, including the pinned context and authenticity proof. */
  readonly jsonld: string;
  readonly attachments: readonly DocumentAttachment[];
}

/** Shared native carriage for explicitly signed or signature-stripped test senders. */
export async function writeMessagePacket(
  node: MessageNode,
  options: SignOptions | { readonly unsigned: true; readonly limits?: PilotLimits },
): Promise<MessagePacket> {
  const prepared = await writeAttachmentDocument(node, options);
  const document =
    "unsigned" in options ? prepared.document : await sign(prepared.document, options);
  return {
    format: "awp-jsonld/0.1",
    jsonld: JSON.stringify(document),
    attachments: prepared.attachments,
  };
}

/** Restore the exact unsigned graph and carriage retained while principal review is pending. */
export async function readHeldMessagePacket(
  packet: MessagePacket,
  limits: PilotLimits,
): Promise<AttachmentDocument> {
  const read = await readAttachmentDocument(packet.jsonld, packet.attachments, { limits });
  if (!read.ok)
    throw new DocumentError(
      read.detail,
      read.reason === "bounds-exceeded" ? "bounds-exceeded" : "malformed",
    );
  requireMessageNode(read.root, read.dataset);
  return {
    document: readJson(packet.jsonld, limits),
    attachments: packet.attachments,
    dataset: read.dataset,
  };
}
export interface PacketDocumentView {
  readonly jsonld: string;
  readonly context: string | readonly string[];
  readonly rdf: string;
  readonly attachments: readonly {
    readonly digest: string;
    readonly mediaType: string;
    readonly byteLength: number;
  }[];
}
const cache = new WeakMap<object, { node: MessageNode; view: PacketDocumentView }>();
export function isMessagePacket(value: unknown): value is MessagePacket {
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).every((key) => ["format", "jsonld", "attachments"].includes(key)) &&
    (value as MessagePacket).format === "awp-jsonld/0.1" &&
    typeof (value as MessagePacket).jsonld === "string" &&
    Array.isArray((value as MessagePacket).attachments)
  );
}
export async function rememberMessagePacket(
  packet: MessagePacket,
  node: MessageNode,
): Promise<void> {
  const document = readJson(packet.jsonld);
  const named = node.dataset.getGraphs(null, null, null).some((g) => g.termType !== "DefaultGraph");
  cache.set(packet, {
    node,
    view: {
      jsonld: packet.jsonld,
      context: document["@context"] as string | string[],
      rdf: await (named ? toTrig(node.dataset) : toTurtle(node.dataset)),
      attachments: packet.attachments.map(({ digest, mediaType, byteLength }) => ({
        digest,
        mediaType,
        byteLength,
      })),
    },
  });
}
export function packetDocumentView(wire: unknown): PacketDocumentView | undefined {
  return wire && typeof wire === "object" ? cache.get(wire)?.view : undefined;
}
export function cachedMessage(wire: unknown): AnyMessage | undefined {
  return wire && typeof wire === "object" ? cache.get(wire)?.node.live : undefined;
}
/** Display only. The actual integrity boundary always verifies again with pinned material. */
export async function inspectMessagePacket(wire: unknown): Promise<AnyMessage | undefined> {
  if (!isMessagePacket(wire)) return undefined;
  const read = await readAttachmentDocument(wire.jsonld, wire.attachments);
  if (!read.ok) return undefined;
  try {
    await validateRoot(materializeAttachments(read.dataset), read.root);
    const node = requireMessageNode(read.root, read.dataset);
    await rememberMessagePacket(wire, node);
    return node.live;
  } catch {
    return undefined;
  }
}
export async function verifyMessagePacket(
  packet: MessagePacket,
  options: {
    suite: Authenticity;
    resolve: (id: string) => PublicKeyRecord | undefined;
    unsigned?: boolean;
    limits?: PilotLimits;
  },
): Promise<ReadResult & { readonly kid?: string }> {
  try {
    checkCarriageSize(packet.jsonld, packet.attachments);
    const read = options.unsigned
      ? await readAttachmentDocument(packet.jsonld, packet.attachments, { limits: options.limits })
      : await verify(packet.jsonld, "application/ld+json", options);
    if (!read.ok) return read;
    if (!options.unsigned)
      await admitAttachments(read.dataset, packet.jsonld, packet.attachments, read.root);
    await validateRoot(materializeAttachments(read.dataset), read.root);
    const node = requireMessageNode(read.root, read.dataset);
    await rememberMessagePacket(packet, node);
    const document = readJson(packet.jsonld);
    const kid = options.unsigned
      ? undefined
      : options.suite === "data-integrity"
        ? outerProof(read.dataset, read.root).proof.verificationMethod
        : peekHeader(String((document.proof as Record<string, unknown>).jws)).kid;
    return { ...read, ...(kid ? { kid } : {}) };
  } catch (error) {
    return refusal(error);
  }
}
export function documentConfiguration(packet: MessagePacket): {
  configuration: string;
  signed: boolean;
} {
  const document = readJson(packet.jsonld);
  return {
    configuration: String(document.configuration ?? ""),
    signed: document.proof !== undefined || document.proofGraph !== undefined,
  };
}

/**
 * Routing hint only: the kid a JWS document's outer proof names. The caller must still verify
 * the exact document with whatever key this selects. Undefined when absent or unreadable.
 */
export function declaredJwsKid(packet: MessagePacket): string | undefined {
  try {
    const proof = readJson(packet.jsonld).proof as Record<string, unknown> | undefined;
    if (!proof || typeof proof.jws !== "string") return undefined;
    const kid = peekHeader(proof.jws).kid;
    return typeof kid === "string" ? kid : undefined;
  } catch {
    return undefined;
  }
}

/** Inspector metadata only; the gate independently verifies the indicated proof. */
export function packetProofInfo(
  packet: MessagePacket,
): { summary: string; raw: Record<string, unknown> } | undefined {
  const document = readJson(packet.jsonld);
  const proof = document.proof as Record<string, unknown> | undefined;
  if (!proof) {
    const node = cache.get(packet)?.node;
    if (node) {
      try {
        return {
          summary: "signed (eddsa-rdfc-2022, pinned actor key)",
          raw: { ...outerProof(node.dataset, node.id).proof },
        };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  if (proof.type === "JwsProof" && typeof proof.jws === "string") {
    const raw = peekHeader(proof.jws);
    return { summary: `signed (JWS ${raw.alg ?? "unknown"}, pinned actor key)`, raw };
  }
  return { summary: "signed (eddsa-rdfc-2022, pinned actor key)", raw: { ...proof } };
}

export async function packetDocumentDigest(
  packet: MessagePacket,
  suite: Authenticity,
): Promise<string> {
  return digest(readJson(packet.jsonld), suite);
}

/** Native documents always fit the default document bounds; hosts may tighten them. */
export function nativeDocumentLimits(limits: PilotLimits): PilotLimits {
  return {
    ...limits,
    maxEnvelopeBytes: Math.min(limits.maxEnvelopeBytes, DEFAULT_LIMITS.maxEnvelopeBytes),
    maxStringLength: Math.min(limits.maxStringLength, DEFAULT_LIMITS.maxStringLength),
    maxJsonDepth: Math.min(limits.maxJsonDepth, DEFAULT_LIMITS.maxJsonDepth),
    maxJsonNodes: Math.min(limits.maxJsonNodes, DEFAULT_LIMITS.maxJsonNodes),
    maxArrayLength: Math.min(limits.maxArrayLength, DEFAULT_LIMITS.maxArrayLength),
  };
}
