// AUTHORED-BY Codex GPT-6
/** Original full-document proofs carried inside payment contracts and record disclosures. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { gunzipSync, gzipSync } from "zlib";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { validateMessage } from "../core/schema.js";
import { TYP } from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { MessageNode } from "../model/message-nodes.js";
import { configurationById } from "../profile/configurations.js";
import { verifyCompact } from "./jws-compact.js";
import {
  documentConfiguration,
  isMessagePacket,
  type MessagePacket,
  verifyMessagePacket,
} from "./message-packet.js";
import { strictJson } from "./strict-json.js";

const PREFIX = "awp-jsonld-gzip:";
const CAP = 12 * 1024 * 1024;
/** Compression changes no signed byte. The full original packet is retained losslessly. */
export function encodeMessageProof(packet: MessagePacket): string {
  const bytes = Buffer.from(JSON.stringify(packet), "utf8");
  if (bytes.byteLength > CAP) throw new TypeError("Recorded packet too large");
  return PREFIX + gzipSync(bytes).toString("base64");
}
export async function verifyRecordedMessage(proof: string, trust: TrustStore) {
  if (proof.startsWith(PREFIX)) {
    try {
      if (proof.length > CAP) return undefined;
      const bytes = gunzipSync(Buffer.from(proof.slice(PREFIX.length), "base64"), {
        maxOutputLength: CAP,
      });
      const packet = strictJson(bytes, CAP);
      if (!isMessagePacket(packet)) return undefined;
      const declared = documentConfiguration(packet);
      if (!declared.signed) return undefined;
      const cfg = configurationById(declared.configuration);
      const suite =
        cfg?.integrity.status === "selected" && cfg.integrity.mechanism === "data-integrity"
          ? "data-integrity"
          : "jws";
      const resolve = (id: string) => trust.resolver("actor")(id.replace(/^urn:awp:key:/, ""));
      const checked = await verifyMessagePacket(packet, { suite, resolve });
      const pinned = checked.ok && checked.kid ? resolve(checked.kid) : undefined;
      return checked.ok && pinned
        ? { message: new MessageNode(checked.root, checked.dataset).live, pinned }
        : undefined;
    } catch {
      return undefined;
    }
  }
  const checked = await verifyCompact(proof, {
    resolve: trust.resolver("actor"),
    typ: TYP.message,
    allowedAlgs: ["EdDSA", "ES256"],
    limits: DEFAULT_LIMITS,
  });
  if (checked.outcome !== "valid") return undefined;
  const parsed = validateMessage(checked.payload);
  return parsed.ok
    ? { message: MessageNode.toNode(parsed.message).live, pinned: checked.pinned }
    : undefined;
}
