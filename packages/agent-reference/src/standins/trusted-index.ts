// AUTHORED-BY Codex GPT-6
/** A fictional index appends actual source-signed bytes and signs its independently checked heads. */
import { digestBytes } from "../core/canonical.js";
import type { EvidenceItem } from "../core/types.js";
import type { SigningKey } from "../mechanisms/jws.js";
import { consistencyProof, inclusionProof, treeHash } from "../mechanisms/merkle-log.js";
import { signStatement } from "../mechanisms/statements.js";
import type { OperationHandler } from "../runtime/operations.js";
import type { IndexPolicy } from "../suites/trust-index.js";
export async function buildIndexLog(input: {
  key: SigningKey;
  source: string;
  records: readonly string[];
  sources: readonly string[];
  register: string;
  at: string;
  fork?: boolean;
}) {
  if (!input.records.length) throw new Error("An index log needs source-signed records");
  const previous = [input.records[0]!];
  const head = (records: readonly string[]) =>
    signStatement(input.key, "awp-index-head+jws", {
      type: "SignedTreeHead",
      issuer: input.source,
      treeSize: records.length,
      rootHash: treeHash(records),
      at: input.at,
    });
  const checkpoint = await head(previous);
  const records = input.fork ? [input.records.at(-1)!, ...input.records] : [...input.records];
  const current = await head(records);
  const receipts = new Map<string, EvidenceItem>();
  for (const [i, record] of input.records.entries())
    receipts.set(digestBytes(record), {
      role: "membership",
      format: "index-receipt+jws",
      value: await signStatement(input.key, "awp-index-receipt+jws", {
        type: "IndexReceipt",
        issuer: input.source,
        recordDigest: digestBytes(record),
        leafIndex: i + (input.fork ? 1 : 0),
        head: current,
        previousHead: checkpoint,
        inclusion: inclusionProof(records, i + (input.fork ? 1 : 0)),
        consistency: consistencyProof(records, previous.length),
        coverage: {
          sources: input.sources,
          register: input.register,
          order: "source-submission-order",
        },
      }),
    });
  const policy: IndexPolicy = {
    source: input.source,
    checkpoint,
    sources: input.sources,
    register: input.register,
  };
  return { policy, receipts };
}
export function withIndexReceipts(
  handler: OperationHandler,
  receipts: ReadonlyMap<string, EvidenceItem>,
): OperationHandler {
  if (!handler.onInvoke) return handler;
  return new Proxy(handler, {
    get(target, key, receiver) {
      if (key === "onInvoke")
        return async (...args: Parameters<NonNullable<OperationHandler["onInvoke"]>>) => {
          const reply = await target.onInvoke!(...args);
          if (reply.type !== "deliver") return reply;
          const evidence = reply.evidence ?? [];
          return {
            ...reply,
            evidence: [
              ...evidence,
              ...evidence.flatMap((e) => {
                const receipt = receipts.get(digestBytes(e.value));
                return receipt ? [receipt] : [];
              }),
            ],
          };
        };
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
