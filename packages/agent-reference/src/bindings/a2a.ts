// AUTHORED-BY Codex GPT-6
/** A2A 1.0 JSON-RPC subset, solely from the supplied research snapshot. */
import { CompactSign, compactVerify, importJWK } from "jose";
import { z } from "zod";
import { canonicalJson } from "../core/canonical.js";
import type { PublicKeyRecord, SigningKey } from "../mechanisms/jws.js";
import { AWP } from "../profile/vocabulary.js";
import {
  type ByteMessage,
  bytesOf,
  CarriageError,
  copyOf,
  envelopeBytes,
  envelopeJson,
  type HttpExchange,
  oneCopy,
} from "./bytes.js";
export const ANSWERABLE_EXTENSION = `${AWP}message-format/v1`;
export const A2A_BINDING = "a2a-data-part/1.0";
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";
const headers = {
  "Content-Type": "application/json",
  "A2A-Version": "1.0",
  "A2A-Extensions": ANSWERABLE_EXTENSION,
};
export class A2aProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
const cardSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.literal("1.0"),
  supportedInterfaces: z
    .array(
      z.strictObject({
        url: z.url(),
        protocolBinding: z.literal("JSONRPC"),
        protocolVersion: z.literal("1.0"),
      }),
    )
    .length(1),
  capabilities: z.object({
    extensions: z
      .array(
        z.object({
          uri: z.literal(ANSWERABLE_EXTENSION),
          required: z.literal(true),
          params: z.object({ agentDescription: z.url(), encoding: z.literal("base64") }),
        }),
      )
      .length(1),
  }),
  defaultInputModes: z.array(z.string()),
  defaultOutputModes: z.array(z.string()),
  skills: z.array(z.unknown()),
  signatures: z.array(z.object({ protected: z.string(), signature: z.string() })).length(1),
});
export type AgentCard = z.infer<typeof cardSchema>;
export async function agentCard(
  key: SigningKey,
  name: string,
  endpoint: string,
  description: string,
): Promise<AgentCard> {
  const card = {
    name,
    description:
      "An automated agent carrying signed Answerable messages; this description grants no authority.",
    version: "1.0" as const,
    supportedInterfaces: [
      { url: endpoint, protocolBinding: "JSONRPC" as const, protocolVersion: "1.0" as const },
    ],
    capabilities: {
      extensions: [
        {
          uri: ANSWERABLE_EXTENSION,
          required: true as const,
          params: { agentDescription: description, encoding: "base64" as const },
        },
      ],
    },
    defaultInputModes: ["application/vnd.answerable.signed+json"],
    defaultOutputModes: ["application/vnd.answerable.signed+json"],
    skills: [],
  };
  const signed = await new CompactSign(new TextEncoder().encode(canonicalJson(card)))
    .setProtectedHeader({ alg: key.alg, kid: key.kid })
    .sign(key.privateKey);
  const [protectedHeader, , signature] = signed.split(".");
  return cardSchema.parse({ ...card, signatures: [{ protected: protectedHeader, signature }] });
}
/** Pinned material only. Card URLs and claims are never installed as trust or permission. */
export async function checkAgentCard(input: unknown, pinned: PublicKeyRecord): Promise<AgentCard> {
  const card = cardSchema.parse(input);
  const { signatures, ...unsigned } = card;
  const proof = signatures[0];
  if (!proof) throw new CarriageError("bad-signature", "The agent card is unsigned.");
  const jws = `${proof.protected}.${Buffer.from(canonicalJson(unsigned)).toString("base64url")}.${proof.signature}`;
  try {
    const verified = await compactVerify(jws, await importJWK(pinned.publicJwk, pinned.alg), {
      algorithms: [pinned.alg],
    });
    if (
      verified.protectedHeader.kid !== pinned.kid ||
      Object.keys(verified.protectedHeader).some((key) => !["alg", "kid"].includes(key))
    )
      throw new Error("untrusted header");
  } catch {
    throw new CarriageError(
      "bad-signature",
      "The agent card does not verify against the pinned agent key.",
    );
  }
  return card;
}
export function cardResponse(card: AgentCard): HttpExchange {
  return {
    method: "GET",
    path: AGENT_CARD_PATH,
    headers: { "Content-Type": "application/json" },
    body: envelopeBytes(card),
  };
}
export function a2aRequest(
  message: ByteMessage,
  id: string,
  path: string,
  text?: string,
): HttpExchange {
  return {
    method: "POST",
    path,
    headers,
    body: envelopeBytes({
      jsonrpc: "2.0",
      id,
      method: "SendMessage",
      params: {
        message: {
          messageId: id,
          role: "ROLE_USER",
          parts: [
            { data: copyOf(message), mediaType: message.mediaType },
            ...(text ? [{ text }] : []),
          ],
          extensions: [ANSWERABLE_EXTENSION],
        },
      },
    }),
  };
}
export function a2aResponse(
  message: ByteMessage,
  id: string,
  path: string,
  state?: string,
): HttpExchange {
  const part = {
    messageId: id,
    role: "ROLE_AGENT",
    parts: [{ data: copyOf(message), mediaType: message.mediaType }],
    extensions: [ANSWERABLE_EXTENSION],
  };
  return {
    method: "POST",
    path,
    headers,
    body: envelopeBytes({
      jsonrpc: "2.0",
      id,
      result: state ? { task: { id, status: { state, message: part } } } : { message: part },
    }),
  };
}
const partSchema = z.object({
  data: z.unknown().optional(),
  text: z.string().optional(),
  mediaType: z.string().optional(),
});
const messageSchema = z.object({
  messageId: z.string(),
  role: z.enum(["ROLE_USER", "ROLE_AGENT"]),
  parts: z.array(partSchema).max(16),
});
const envelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.literal("SendMessage").optional(),
  params: z.object({ message: messageSchema }).optional(),
  result: z
    .object({
      message: messageSchema.optional(),
      task: z
        .object({ status: z.object({ state: z.string(), message: messageSchema }) })
        .optional(),
    })
    .optional(),
});
export function readA2a(http: HttpExchange): {
  message: ByteMessage;
  dropped: string[];
  taskState?: string;
} {
  if (http.method !== "POST") throw new A2aProtocolError(-32600, "A2A messages require POST.");
  if (http.headers["A2A-Version"] !== "1.0")
    throw new A2aProtocolError(-32009, "Unsupported A2A version.");
  if (
    !http.headers["A2A-Extensions"]
      ?.split(",")
      .map((value) => value.trim())
      .includes(ANSWERABLE_EXTENSION)
  )
    throw new A2aProtocolError(-32008, "The required Answerable extension was not declared.");
  const envelope = envelopeSchema.parse(envelopeJson(http.body));
  const messages = [
    envelope.params?.message,
    envelope.result?.message,
    envelope.result?.task?.status.message,
  ].filter((message) => message !== undefined);
  const parts = messages.flatMap((message) => message.parts);
  if (!messages.length)
    throw new CarriageError("no-structured-content", "No A2A message was returned.");
  if (parts.some((part) => part.data !== undefined && part.text !== undefined))
    throw new CarriageError("malformed", "An A2A part cannot contain both data and text.");
  const copies = parts
    .filter((part) => part.data !== undefined)
    .map((part) => {
      const copy = bytesOf(part.data);
      if (part.mediaType !== copy.mediaType)
        throw new CarriageError("malformed", "A2A part media types differ.");
      return copy;
    });
  const message = oneCopy(copies);
  if (messages.length !== 1 || (envelope.params && envelope.method !== "SendMessage"))
    throw new CarriageError("malformed", "A2A must contain one request or one reply variant.");
  return {
    message,
    dropped: parts
      .filter((part) => part.data === undefined)
      .map(() => "An untrusted A2A text or file part was dropped before the core."),
    ...(envelope.result?.task ? { taskState: envelope.result.task.status.state } : {}),
  };
}
