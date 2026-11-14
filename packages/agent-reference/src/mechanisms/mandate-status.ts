// AUTHORED-BY Codex GPT-6
/** Principal-signed Bitstring Status Lists. No network and no unsigned status assertions. */
import {
  bitstringStatusListEntry,
  buildBitstringStatusListCredential,
  type Credential,
  issue,
  resolveBitstringStatus,
  type VerifiableCredential,
  withStatusBit,
} from "@jeswr/solid-vc";
import { importJWK } from "jose";
import { canonicalJson } from "../core/canonical.js";
import type { SigningKey } from "./jws.js";

export type MandateStatusFailure = "mandate-withdrawn" | "lookup-failed" | "representation-invalid";
export class MandateStatusLists {
  readonly entries: {
    type: "BitstringStatusListEntry";
    statusPurpose: "suspension" | "revocation";
    statusListIndex: string;
    statusListCredential: string;
  }[];
  private readonly lists = new Map<string, VerifiableCredential>();
  private checkedAt = -Infinity;
  private revoked = false;
  private failure: MandateStatusFailure | undefined = "lookup-failed";
  available = true;
  readonly checks: { at: string; status: string }[] = [];
  constructor(
    readonly owner: string,
    readonly key: SigningKey,
    readonly now: () => string,
  ) {
    this.entries = (["suspension", "revocation"] as const)
      .map((statusPurpose) =>
        bitstringStatusListEntry({
          statusPurpose,
          statusListIndex: 42,
          statusListCredential: `https://mandate-status.example/${key.kid}/${statusPurpose}`,
        }),
      )
      .map((entry) => ({
        ...entry,
        statusPurpose: entry.statusPurpose as "suspension" | "revocation",
      }));
  }
  private async sign(credential: Credential): Promise<VerifiableCredential> {
    return issue({
      credential,
      key: {
        verificationMethod: `${this.owner.split("#")[0]}#mandate-status-key`,
        privateKey: this.key.privateKey,
        publicKey: await importJWK(this.key.publicJwk, "EdDSA"),
      },
      options: { created: new Date(this.now()) },
    });
  }
  async setup(): Promise<void> {
    for (const entry of this.entries)
      this.lists.set(
        entry.statusListCredential,
        await this.sign(
          await buildBitstringStatusListCredential({
            id: entry.statusListCredential,
            issuer: this.owner,
            statusPurpose: entry.statusPurpose,
            validFrom: this.now(),
            validUntil: new Date(Date.parse(this.now()) + 86400000).toISOString(),
          }),
        ),
      );
    await this.refresh();
  }
  async set(purpose: "suspension" | "revocation", value: boolean): Promise<void> {
    if (purpose === "revocation" && this.revoked && !value)
      throw new Error("Revocation is permanent");
    if (purpose === "revocation" && value) this.revoked = true;
    const entry = this.entries.find((e) => e.statusPurpose === purpose)!;
    const current = this.lists.get(entry.statusListCredential)!;
    this.lists.set(
      entry.statusListCredential,
      await this.sign(await withStatusBit(current, 42, value)),
    );
    await this.refresh();
  }
  async check(
    entries: Credential["credentialStatus"] = this.entries,
  ): Promise<MandateStatusFailure | undefined> {
    if (canonicalJson(entries) !== canonicalJson(this.entries)) return "representation-invalid";
    const result = await resolveBitstringStatus(
      { issuer: this.owner, credentialSubject: {}, credentialStatus: entries },
      {
        now: new Date(this.now()),
        maxBodyBytes: 65536,
        maxDecodedBytes: 16384,
        resolveKey: async (method) =>
          method === `${this.owner.split("#")[0]}#mandate-status-key`
            ? ((await importJWK(this.key.publicJwk, "EdDSA")) as CryptoKey)
            : undefined,
        isControlledBy: async (method, issuer) =>
          issuer === this.owner && method === `${this.owner.split("#")[0]}#mandate-status-key`,
        fetch: async (input) => {
          const list = this.available ? this.lists.get(String(input)) : undefined;
          return new Response(list ? JSON.stringify(list) : "unavailable", {
            status: list ? 200 : 503,
            headers: { "content-type": "application/vc+ld+json" },
          });
        },
      },
    );
    this.checks.push({ at: this.now(), status: result.status });
    return result.status === "valid"
      ? undefined
      : ["revoked", "suspended"].includes(result.status)
        ? "mandate-withdrawn"
        : "lookup-failed";
  }
  async refresh(): Promise<void> {
    this.failure = await this.check();
    this.checkedAt = Date.parse(this.now());
  }
  /** Synchronous gate operand, verified afresh at each host turn, never valid beyond a minute. */
  current(): MandateStatusFailure | undefined {
    return Date.parse(this.now()) - this.checkedAt < 60000 ? this.failure : "lookup-failed";
  }
}
