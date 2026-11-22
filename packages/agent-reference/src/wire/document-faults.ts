// AUTHORED-BY Codex GPT-6
/** Scenario-only carriage mutations. Never signs or changes a gate's verdict. */
import { isMessagePacket, type MessagePacket } from "./message-packet.js";
export function alterDocumentForTest(
  wire: unknown,
  kind: "graph-reordered" | "triple-changed",
): MessagePacket {
  if (!isMessagePacket(wire)) throw new Error("document fault requires native document carriage");
  const document = JSON.parse(wire.jsonld);
  if (kind === "triple-changed") {
    if (typeof document.createdAt !== "string") throw new Error("missing protected timestamp");
    document.createdAt = new Date(Date.parse(document.createdAt) + 1).toISOString();
  }
  const reorder = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, child]) => [
                key,
                key === "@included" && Array.isArray(child)
                  ? child.map(reorder).reverse()
                  : reorder(child),
              ]),
          )
        : value;
  return { ...wire, jsonld: JSON.stringify(reorder(document), null, 1) };
}
/** A hostile holder changes the disclosure, then signs its own outer message normally. */
export function changeSelectiveSalt(value: string): string {
  const presentation = JSON.parse(value);
  if (!presentation.disclosure || typeof presentation.disclosure.salt !== "string")
    throw new TypeError("Expected a selective disclosure");
  presentation.disclosure.salt = "x".repeat(43);
  return JSON.stringify(presentation);
}
