// AUTHORED-BY Codex GPT-6
/** A closed did:web resolver. Host control locates keys; signed commitments bind their lifetime. */
import type { createGuardedFetch } from "@jeswr/guarded-fetch";
import { decodeMultikey, encodeMultikey } from "@jeswr/solid-vc";
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  importJWK,
} from "jose";
import { z } from "zod";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { type SigningKey, signCompact, verifyCompact } from "../mechanisms/jws.js";
import type { PinnedKey } from "../mechanisms/trust.js";
import { alternativeWireId } from "../profile/configurations.js";
import { readDidDocument } from "../wire/did.js";
import type { WebIdParty } from "./webid.js";

const wire = alternativeWireId("identity-did");
const commitmentSchema = z.strictObject({
  issuer: z.string(),
  actor: z.string(),
  party: z.string(),
  actorKid: z.string(),
  partyKid: z.string(),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export function didWebUrl(did: string): string {
  if (!/^did:web:[a-z0-9.-]+(?::[A-Za-z0-9._~-]+)*$/.test(did))
    throw new Error("Unsupported did:web identifier");
  const [, , host, ...path] = did.split(":");
  if (!host?.endsWith(".example")) throw new Error("No fictional DID host");
  return path.length
    ? `https://${host}/${path.join("/")}/did.json`
    : `https://${host}/.well-known/did.json`;
}
export type DidResolution =
  | { ok: true; key: PinnedKey }
  | { ok: false; reason: "sender-key-mismatch" | "lookup-failed" | "unknown-key" | "expired" };
export class FictionalDidDirectory {
  readonly configuration = wire;
  private readonly documents = new Map<string, string>();
  private readonly commitments = new Map<string, string>();
  private readonly actors = new Map<string, string>();
  readonly requests: { method: string; url: string }[] = [];
  constructor(
    readonly resolver: { identity: string; key: SigningKey },
    readonly register: { identity: string; key: SigningKey },
    readonly parties: readonly WebIdParty[],
    readonly now: () => string,
    readonly validity: { from: string; until: string },
  ) {}
  private async publish(id: string, key: SigningKey) {
    this.documents.set(
      didWebUrl(id),
      JSON.stringify({
        "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
        id,
        verificationMethod: [
          {
            id: `${id}#key-1`,
            type: "Multikey",
            controller: id,
            publicKeyMultibase: await encodeMultikey(
              (await importJWK(key.publicJwk, "EdDSA")) as CryptoKey,
            ),
          },
        ],
        assertionMethod: [`${id}#key-1`],
      }),
    );
  }
  async setup() {
    for (const p of this.parties) {
      await this.publish(p.actor, p.actorKey);
      await this.publish(p.party, p.partyKey);
      this.actors.set(p.actor, p.actorKey.kid);
      this.commitments.set(
        p.actorKey.kid,
        await signCompact(this.register.key, "awp-did-commitment+jws", {
          issuer: this.register.identity,
          actor: p.actor,
          party: p.party,
          actorKid: p.actorKey.kid,
          partyKid: p.partyKey.kid,
          validFrom: this.validity.from,
          validUntil: this.validity.until,
        }),
      );
    }
  }
  readonly fetch: ReturnType<typeof createGuardedFetch> = async (input, init) => {
    const request = new Request(input, init);
    this.requests.push({ method: request.method, url: request.url });
    const body = request.method === "GET" ? this.documents.get(request.url) : undefined;
    return new Response(body ?? "Missing fictional DID document", {
      status: body ? 200 : 404,
      headers: { "content-type": "application/did+ld+json" },
    });
  };
  private async key(id: string) {
    const response = await this.fetch(didWebUrl(id));
    if (!response.ok || response.redirected) return undefined;
    const bytes = await response.text();
    if (Buffer.byteLength(bytes) > 16384) return undefined;
    const doc = readDidDocument(bytes);
    if (!doc.success || doc.data.id !== id) return undefined;
    const vm = doc.data.verificationMethod[0]!;
    if (vm.controller !== id || vm.id !== `${id}#key-1` || doc.data.assertionMethod[0] !== vm.id)
      return undefined;
    const decoded = await decodeMultikey(vm.publicKeyMultibase);
    return decoded?.keyType === "Ed25519" ? exportJWK(decoded.publicKey) : undefined;
  }
  async resolveKid(kid: string): Promise<DidResolution> {
    try {
      const answer = this.commitments.get(kid);
      if (!answer) return { ok: false, reason: "unknown-key" };
      const checked = await verifyCompact(answer, {
        typ: "awp-did-commitment+jws",
        allowedAlgs: ["EdDSA"],
        limits: DEFAULT_LIMITS,
        resolve: (k) => (k === this.register.key.kid ? this.register.key : undefined),
      });
      if (checked.outcome !== "valid") return { ok: false, reason: "lookup-failed" };
      const claim = commitmentSchema.safeParse(checked.payload);
      if (
        !claim.success ||
        claim.data.issuer !== this.register.identity ||
        claim.data.actorKid !== kid
      )
        return { ok: false, reason: "lookup-failed" };
      const c = claim.data;
      if (
        Date.parse(c.validFrom) > Date.parse(this.now()) ||
        Date.parse(c.validUntil) <= Date.parse(this.now())
      )
        return { ok: false, reason: "expired" };
      const actor = await this.key(c.actor),
        party = await this.key(c.party);
      if (!actor || !party) return { ok: false, reason: "lookup-failed" };
      if (
        (await calculateJwkThumbprint(actor)) !== kid ||
        (await calculateJwkThumbprint(party)) !== c.partyKid
      )
        return { ok: false, reason: "sender-key-mismatch" };
      return {
        ok: true,
        key: {
          subject: c.actor,
          party: c.party,
          kid,
          alg: "EdDSA",
          publicJwk: actor,
          role: "actor",
          note: "Resolved did:web keys bound to signed key commitments",
        },
      };
    } catch {
      return { ok: false, reason: "lookup-failed" };
    }
  }
  async resolve(jws: string): Promise<DidResolution | undefined> {
    if (Buffer.byteLength(jws) > DEFAULT_LIMITS.maxEnvelopeBytes) return undefined;
    try {
      if (decodeJwt(jws).configuration !== wire) return undefined;
      const kid = decodeProtectedHeader(jws).kid;
      return typeof kid === "string" ? this.resolveKid(kid) : { ok: false, reason: "unknown-key" };
    } catch {
      return undefined;
    }
  }
  async resolveDeclared(configuration: string, kid: string): Promise<DidResolution | undefined> {
    return configuration === wire ? this.resolveKid(kid) : undefined;
  }
  async recipient(actor: string | undefined, configuration: string) {
    if (configuration !== wire) return undefined;
    const kid = actor ? this.actors.get(actor) : undefined;
    if (!kid) return "lookup-failed";
    const checked = await this.resolveKid(kid);
    return checked.ok ? undefined : checked.reason;
  }
  async swap(id: string, key: SigningKey) {
    await this.publish(id, key);
  }
}

/** Identity aliases are exact world names, including names used in profile constraints. */
export function renameIdentities<T>(input: T, names: Readonly<Record<string, string>>): T {
  if (typeof input === "string") return (names[input] ?? input) as T;
  if (Array.isArray(input)) return input.map((x) => renameIdentities(x, names)) as T;
  if (input && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input).map(([k, v]) => [names[k] ?? k, renameIdentities(v, names)]),
    ) as T;
  return input;
}
