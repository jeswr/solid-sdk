// AUTHORED-BY Codex GPT-6
/** Fictional WebID hosting and issuer-only key commitments. Discovery never conveys authority. */
import { publishVerificationMethod, resolveWebIdKey } from "@jeswr/solid-vc";
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
import { FictionalSolidStorage, type StorageFetch } from "./storage.js";

const WIRE_ID = alternativeWireId("identity-webid");
const commitmentSchema = z.strictObject({
  type: z.literal("WebIdKeyCommitment"),
  issuer: z.string().url(),
  subject: z.string().url(),
  party: z.string().url(),
  actorThumbprint: z.string().min(1),
  partyThumbprint: z.string().min(1),
  actorMethod: z.string().url(),
  partyMethod: z.string().url(),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export interface WebIdParty {
  actor: string;
  party: string;
  actorKey: SigningKey;
  partyKey: SigningKey;
}
export type WebIdResolution =
  | { ok: true; key: PinnedKey }
  | { ok: false; reason: "sender-key-mismatch" | "lookup-failed" | "unknown-key" | "expired" };
export class FictionalWebIdDirectory {
  private readonly stores = new Map<string, FictionalSolidStorage>();
  private readonly answers = new Map<string, string>();
  private readonly actors = new Map<string, string>();
  readonly fetch: StorageFetch = async (input, init) => {
    const request = new Request(input, init);
    const store = this.stores.get(new URL(request.url).origin);
    if (!store) throw new Error("No fictional profile host exists for this origin");
    return store.client(undefined, undefined, 65536)(request);
  };
  constructor(
    readonly provider: { identity: string; key: SigningKey },
    readonly register: { identity: string; key: SigningKey },
    private readonly parties: readonly WebIdParty[],
    private readonly now: () => string,
    readonly validity: { from: string; until: string },
  ) {}
  private async publish(webId: string, key: SigningKey): Promise<string> {
    const document = webId.split("#")[0] as string;
    const method = `${document}#key-2026-11-13`;
    let store = this.stores.get(new URL(document).origin);
    if (!store) {
      store = new FictionalSolidStorage(
        new URL(document).origin,
        this.provider.identity,
        this.provider.key,
        this.now,
      );
      this.stores.set(store.origin, store);
    }
    store.introduce(webId, key);
    const published = await publishVerificationMethod({
      controller: webId,
      key: (await importJWK(key.publicJwk, key.alg)) as CryptoKey,
      verificationMethod: method,
    });
    await store.provision(document, webId, {
      container: false,
      body: published.turtle,
      rules: [{ resource: document, public: true, modes: ["Read"] }],
    });
    return method;
  }
  async setup(): Promise<void> {
    for (const party of this.parties) {
      const actorMethod = await this.publish(party.actor, party.actorKey);
      const partyMethod = await this.publish(party.party, party.partyKey);
      const answer = await signCompact(this.register.key, "awp-webid-register+jws", {
        type: "WebIdKeyCommitment",
        issuer: this.register.identity,
        subject: party.actor,
        party: party.party,
        actorThumbprint: party.actorKey.kid,
        partyThumbprint: party.partyKey.kid,
        actorMethod,
        partyMethod,
        validFrom: this.validity.from,
        validUntil: this.validity.until,
      });
      this.answers.set(party.actorKey.kid, answer);
      this.actors.set(party.actor, party.actorKey.kid);
    }
  }
  /** Raw register bytes are inspectable; they carry no public JWK or private key. */
  answer(kid: string): string | undefined {
    return this.answers.get(kid);
  }
  async resolveKid(kid: string): Promise<WebIdResolution> {
    const answer = this.answers.get(kid);
    if (!answer) return { ok: false, reason: "unknown-key" };
    const verified = await verifyCompact(answer, {
      typ: "awp-webid-register+jws",
      allowedAlgs: ["EdDSA"],
      limits: DEFAULT_LIMITS,
      resolve: (id) => (id === this.register.key.kid ? this.register.key : undefined),
    });
    if (verified.outcome !== "valid") return { ok: false, reason: "lookup-failed" };
    const parsed = commitmentSchema.safeParse(verified.payload);
    if (
      !parsed.success ||
      parsed.data.issuer !== this.register.identity ||
      parsed.data.actorThumbprint !== kid
    )
      return { ok: false, reason: "lookup-failed" };
    const claim = parsed.data;
    if (
      Date.parse(claim.validFrom) > Date.parse(this.now()) ||
      Date.parse(claim.validUntil) <= Date.parse(this.now())
    )
      return { ok: false, reason: "expired" };
    const actor = await resolveWebIdKey(claim.subject, claim.actorMethod, { fetch: this.fetch });
    const principal = await resolveWebIdKey(claim.party, claim.partyMethod, { fetch: this.fetch });
    if (!actor || !principal) return { ok: false, reason: "lookup-failed" };
    const publicJwk = await exportJWK(actor.publicKey);
    const partyJwk = await exportJWK(principal.publicKey);
    if (
      (await calculateJwkThumbprint(publicJwk)) !== kid ||
      (await calculateJwkThumbprint(partyJwk)) !== claim.partyThumbprint
    )
      return { ok: false, reason: "sender-key-mismatch" };
    return {
      ok: true,
      key: {
        kid,
        publicJwk,
        alg: "EdDSA",
        role: "actor",
        subject: claim.subject,
        party: claim.party,
        note: "Fetched Controlled Identifier keys, bound to a signed register commitment",
      },
    };
  }
  /** Configuration selection is untrusted until the resulting key verifies these exact bytes. */
  async resolve(jws: string): Promise<WebIdResolution | undefined> {
    // Inspect only a bounded routing hint. The integrity gate still verifies the exact JWS
    // with the fetched key, including its header, schema, identity and configuration.
    if (Buffer.byteLength(jws) > DEFAULT_LIMITS.maxEnvelopeBytes) return undefined;
    let kid: unknown;
    try {
      if (decodeJwt(jws).configuration !== WIRE_ID) return undefined;
      kid = decodeProtectedHeader(jws).kid;
    } catch {
      return undefined;
    }
    return typeof kid === "string" ? this.resolveKid(kid) : { ok: false, reason: "unknown-key" };
  }
  /** Document carriage: the declared configuration and kid are routing hints only. */
  async resolveDeclared(configuration: string, kid: string): Promise<WebIdResolution | undefined> {
    if (configuration !== WIRE_ID) return undefined;
    return this.resolveKid(kid);
  }
  async recipient(actor: string | undefined, configuration: string): Promise<string | undefined> {
    if (configuration !== WIRE_ID) return undefined;
    const kid = actor ? this.actors.get(actor) : undefined;
    if (!kid) return "lookup-failed";
    const result = await this.resolveKid(kid);
    return result.ok ? undefined : result.reason;
  }
  async swapProfile(actor: string, replacement: SigningKey): Promise<void> {
    const document = actor.split("#")[0] as string;
    const body = await publishVerificationMethod({
      controller: actor,
      key: (await importJWK(replacement.publicJwk, replacement.alg)) as CryptoKey,
      verificationMethod: `${document}#key-2026-11-13`,
    });
    const store = this.stores.get(new URL(document).origin);
    if (!store) throw new Error("Missing fictional profile host");
    store.alterAtRest(document, () => body.turtle);
  }
  get accessLog() {
    return [...this.stores.values()].flatMap((store) => store.accessLog);
  }
}
