// AUTHORED-BY Codex GPT-6
/** Gate-side carriage checks. Readable text is derived only after signature verification. */

import { readA2a } from "../bindings/a2a.js";
import type { ByteMessage, HttpExchange } from "../bindings/bytes.js";
import { CarriageError } from "../bindings/bytes.js";
import { readEmail } from "../bindings/email.js";
import {
  type ChannelToken,
  type FictionalAuthorizationServer,
  readMcpRequest,
  readMcpResult,
} from "../bindings/mcp.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { validateMessage } from "../core/schema.js";
import type { AnyMessage } from "../core/types.js";
import type { InboundGate } from "../gates/inbound.js";
import { type SigningKey, verifyCompact } from "../mechanisms/jws.js";
import { peekWire } from "../trace/packet.js";
import { carriageWire } from "../wire/carriage.js";
import type { StepResult } from "./agent.js";

export interface CarriageDelivery {
  readonly carriage: "email" | "a2a-request" | "a2a-result" | "mcp-request" | "mcp-result";
  readonly frame: ByteMessage | HttpExchange;
  readonly server?: FictionalAuthorizationServer;
  readonly token?: ChannelToken;
  readonly notices?: readonly string[];
}
const isDelivery = (value: unknown): value is CarriageDelivery =>
  !!value && typeof value === "object" && "carriage" in value && "frame" in value;

function display(value: unknown, name: (id: string | undefined) => string): unknown {
  if (typeof value === "string")
    return value.replace(/(?:https?:\/\/|urn:)[^\s<>"{}|\\^`]+/g, (id) => {
      const label = name(id);
      return /(?:https?:\/\/|urn:)/.test(label) ? "a referenced item" : label;
    });
  if (Array.isArray(value)) return value.map((item) => display(item, name));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, display(item, name)]),
    );
  return value;
}
export function readableCopy(
  message: AnyMessage,
  name: (id: string | undefined) => string,
): string {
  return `Sent by ${name(message.from.actor)}, an automated agent, for ${name(message.from.onBehalfOf)}.\n${message.kind[0]?.toUpperCase()}${message.kind.slice(1)} message:\n${JSON.stringify(display(message.body, name), null, 2)}\n\nThe signed structured part is authoritative. An agent may request a structured reply using the advertised agent description.`;
}
export async function signedReadable(
  wire: unknown,
  key: SigningKey,
  name: (id: string | undefined) => string,
): Promise<string> {
  const value = wire as { jws?: string };
  if (typeof value?.jws !== "string")
    throw new CarriageError(
      "no-structured-content",
      "Signed structured content is required for agent mail.",
    );
  const verified = await verifyCompact(value.jws, {
    typ: "awp-message+jws",
    allowedAlgs: [key.alg],
    limits: DEFAULT_LIMITS,
    resolve: (kid) =>
      kid === key.kid ? { ...key, subject: peekWire(wire)?.from.actor ?? "" } : undefined,
  });
  if (verified.outcome !== "valid")
    throw new CarriageError("bad-signature", "The outbound message does not verify.");
  const checked = validateMessage(verified.payload);
  if (!checked.ok) throw new CarriageError("malformed", "The outbound message is malformed.");
  return readableCopy(checked.message, name);
}

/** Only the receive hand-off calls this; existing gates still decide all message semantics. */
export async function receiveCarriage(
  input: unknown,
  meta: { binding?: string },
  gate: InboundGate,
  name: (id: string | undefined) => string,
  answersOurs: (id: string) => boolean,
  accept: (wire: unknown) => Promise<StepResult>,
): Promise<StepResult> {
  if (
    !isDelivery(input) &&
    !(input && typeof input === "object" && "bytes" in input && "mediaType" in input)
  )
    return accept(input);
  let wire: unknown;
  let readable: string | undefined;
  try {
    const notices: string[] = [];
    if (!isDelivery(input)) wire = carriageWire(input as ByteMessage);
    else {
      notices.push(...(input.notices ?? []));
      switch (input.carriage) {
        case "email": {
          const recovered = readEmail(input.frame as ByteMessage);
          wire = carriageWire(recovered.message);
          readable = recovered.readable;
          break;
        }
        case "a2a-request":
        case "a2a-result": {
          const recovered = readA2a(input.frame as HttpExchange);
          wire = carriageWire(recovered.message);
          notices.push(...recovered.dropped);
          if (recovered.taskState)
            notices.push(
              "The A2A task state is a carriage hint; the signed message determines the outcome.",
            );
          break;
        }
        case "mcp-request": {
          if (!input.server) throw new CarriageError("malformed", "The tool server is missing.");
          const recovered = readMcpRequest(input.frame as HttpExchange, input.server);
          if (!recovered.message)
            throw new CarriageError(
              "no-structured-content",
              "This tool call contains no signed message.",
            );
          wire = carriageWire(recovered.message);
          break;
        }
        case "mcp-result": {
          const recovered = readMcpResult(input.frame as HttpExchange, input.token);
          wire = carriageWire(recovered.message);
          break;
        }
      }
    }
    if (readable !== undefined) {
      const checked = await gate.verifyIntegrity(wire, meta, answersOurs);
      // A failed signature is handled by the ordinary gate, with its original reason.
      if (!checked.ok) return accept(wire);
      if (readable !== readableCopy(checked.message, name))
        throw new CarriageError(
          "human-parity-mismatch",
          "The readable email says something different from the signed message.",
        );
    }
    for (const caption of notices) gate.emit({ part: "transport", kind: "record", caption });
  } catch (error) {
    const reason = error instanceof CarriageError ? error.reason : "malformed";
    const admission = gate.arrive(wire, meta.binding, peekWire(wire));
    admission.failIntegrity(reason, "The carriage was refused before reaching the core.");
    admission.refuse(reason, "The carriage was refused before reaching the core.");
    return {
      disposition: "rejected",
      reason,
      detail: error instanceof Error ? error.message : "Invalid carriage",
      outbound: [],
      decisions: [],
    };
  }
  return accept(wire);
}
