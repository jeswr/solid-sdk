// AUTHORED-BY Codex GPT-6
/** A local observation of origin. It grants no transferable signature on the product. */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { EvidenceItem } from "../core/types.js";
import { verifyStatement } from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { SuiteValuesNode } from "../model/suite-values.js";
import type { TraceSink } from "../trace/recorder.js";
import { originLocator, unsignedOriginRecord } from "../wire/origin-hosted.js";

const addressSchema = z.strictObject({
  type: z.literal("SourceAddress"),
  issuer: z.string().url(),
  subject: z.string().url(),
  recordId: z.string(),
  address: z.string().url(),
  issuedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export class OriginHostedVerifier {
  private readonly observed = new Map<string, SuiteValuesNode>();
  constructor(
    readonly register: string,
    private readonly guardedFetch: (input: string) => Promise<Response>,
    private readonly sink?: TraceSink,
  ) {}
  claim(value: string): SuiteValuesNode | undefined {
    const locator = originLocator(value);
    return this.observed.get(locator.string("recordId")!);
  }
  nonTransferable(id: string): boolean {
    return this.observed.has(id);
  }
  async verify(
    item: EvidenceItem,
    trust: TrustStore,
    at: string,
    verifier: string,
    record: <T extends { type: string }>(entry: T) => void,
  ): Promise<SuiteValuesNode | undefined> {
    try {
      const locator = originLocator(item.value),
        source = locator.string("source")!,
        id = locator.string("recordId")!;
      const options = {
        trust,
        typ: "awp-source-address+jws",
        schema: addressSchema,
        limits: DEFAULT_LIMITS,
        at,
        verifier,
        algs: ["EdDSA"] as const,
      };
      const checked = await verifyStatement(locator.string("anchor")!, {
        ...options,
        role: "issuer",
      });
      record(checked.verification);
      if (
        !checked.payload ||
        checked.verification.outcome !== "valid" ||
        checked.signer?.subject !== this.register
      )
        return undefined;
      const anchor = SuiteValuesNode.fromSignedPayload(checked.payload);
      if (
        anchor.string("issuer") !== this.register ||
        anchor.string("subject") !== source ||
        anchor.string("recordId") !== id ||
        Date.parse(anchor.string("issuedAt")!) > Date.parse(at) ||
        Date.parse(anchor.string("validUntil")!) <= Date.parse(at)
      )
        return undefined;
      const authority = trust.assessSource({
        evaluator: verifier,
        source: this.register,
        claimType: "source.address",
        subject: source,
        at,
      });
      if (authority.outcome !== "accepted") return undefined;
      const address = anchor.string("address")!;
      if (new URL(address).protocol !== "https:") return undefined;
      // The index's pointer is never a fetch operand, even when it looks plausible.
      const response = await this.guardedFetch(address);
      if (!response.ok || response.headers.get("content-type") !== "application/json")
        return undefined;
      const node = unsignedOriginRecord(await response.text());
      if (node.string("issuer") !== source || node.string("id") !== id) return undefined;
      this.observed.set(id, node);
      this.sink?.emit({
        part: "transport",
        kind: "record",
        caption:
          locator.string("pointer") !== address
            ? "The pointer in the message is ignored; the verifier fetched the unsigned product only from the register’s address. It cannot forward this observation as evidence."
            : "The verifier fetched the unsigned product from the register’s address and records only its own observation of origin.",
      });
      record({
        type: "origin-fetch",
        source,
        address,
        ignoredPointer:
          locator.string("pointer") !== address ? locator.string("pointer") : undefined,
        record: id,
        digest: digestOf(node.toObject()),
        transferable: false,
        at,
      });
      return node;
    } catch {
      return undefined;
    }
  }
}
