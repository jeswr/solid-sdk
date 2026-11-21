// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { A2A_BINDING, a2aResponse } from "@jeswr/agent-reference/bindings/a2a";
import { envelopeBytes, envelopeJson } from "@jeswr/agent-reference/bindings/bytes";
import type { DOCUMENT_MEDIA_TYPE, LEGACY_MEDIA_TYPE } from "@jeswr/agent-reference/wire/carriage";
import type { A2aRequest, CloudReceiver } from "./cloud.js";
import { auditGateReason, type Gate, type GateVerdict } from "./gate.js";

type CarriageGate = Pick<Gate, "receiveCarriage">;
const gateReceivers = new WeakSet<CloudReceiver>();

function gateReceiver(receive: CloudReceiver) {
  gateReceivers.add(receive);
  return receive;
}

export function isGateReceiver(receive: CloudReceiver) {
  return gateReceivers.has(receive);
}

function receipt(verdict: GateVerdict) {
  return verdict.outcome === "admitted"
    ? { outcome: "admitted" }
    : { reason: auditGateReason(verdict.reason ?? "indeterminate") };
}

function requestId(body: Uint8Array): string | number | undefined {
  try {
    const envelope = envelopeJson(body) as {
      jsonrpc?: unknown;
      method?: unknown;
      id?: unknown;
      params?: { message?: { role?: unknown } };
      result?: unknown;
    } | null;
    if (
      envelope?.jsonrpc === "2.0" &&
      envelope.method === "SendMessage" &&
      envelope.params?.message?.role === "ROLE_USER" &&
      envelope.result === undefined &&
      (typeof envelope.id === "string" ||
        (typeof envelope.id === "number" && Number.isFinite(envelope.id)))
    )
      return envelope.id;
  } catch {
    // An unreadable envelope has no usable JSON-RPC correlation ID.
  }
}

function a2aHeaders(headers: A2aRequest["headers"]) {
  const frameHeaders: Record<string, string> = Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]],
    ),
  );
  // Node lowercases header names. The reference binding uses the canonical spellings.
  for (const name of ["A2A-Version", "A2A-Extensions"]) {
    const value = frameHeaders[name.toLowerCase()];
    if (value !== undefined) frameHeaders[name] = value;
  }
  return frameHeaders;
}

/** Accept A2A carriage through the daemon's existing, leased inbound gate. */
export function createGateReceiver(gate: CarriageGate): CloudReceiver {
  return gateReceiver(async ({ body, headers, signal }) => {
    signal.throwIfAborted();
    const id = requestId(body);
    if (id === undefined) return { status: 400, body: '{"reason":"malformed"}' };

    const verdict = await gate.receiveCarriage(
      {
        binding: A2A_BINDING,
        delivery: {
          carriage: "a2a-request",
          frame: { method: "POST", path: "/a2a", headers: a2aHeaders(headers), body },
        },
      },
      signal,
    );
    // The response is carriage feedback only. The gate never exposes runtime outbound here.
    const response = a2aResponse(
      { mediaType: "application/json", bytes: envelopeBytes(receipt(verdict)) },
      String(id),
      "/a2a",
    );
    const json = Buffer.from(response.body).toString("utf8");
    return {
      status: 200,
      headers: response.headers,
      body: typeof id === "string" ? json : JSON.stringify({ ...JSON.parse(json), id }),
    };
  });
}

export function createDirectHttpReceiver(
  gate: CarriageGate,
  mediaType: typeof DOCUMENT_MEDIA_TYPE | typeof LEGACY_MEDIA_TYPE,
): CloudReceiver {
  return gateReceiver(async ({ body, signal }) => {
    signal.throwIfAborted();
    const verdict = await gate.receiveCarriage(
      { binding: "direct-http", delivery: { bytes: body, mediaType } },
      signal,
    );
    // TR-8: either verdict uses the same successful transport status.
    return { status: 200, body: JSON.stringify(receipt(verdict)) };
  });
}
