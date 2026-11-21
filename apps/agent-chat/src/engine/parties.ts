// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
/**
 * The other side of every exchange: stores, lenders, banks and the identity provider, each
 * with its own signing key. The inbound gate checks each message against the sender's pinned
 * key, the receiver's identity and clock, and the ids already seen in this session.
 */
import type { CheckLine } from "@jeswr/agent-consent";
import { CompactSign, compactVerify, exportJWK, generateKeyPair, importJWK, type JWK } from "jose";

export interface PartyKey {
  readonly id: string;
  readonly name: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
}

export interface Verified<T> {
  readonly ok: true;
  readonly payload: T;
  readonly checks: readonly CheckLine[];
}

type RefusalReason =
  | "unknown-key"
  | "bad-signature"
  | "malformed"
  | "sender-key-mismatch"
  | "wrong-audience"
  | "not-yet-valid"
  | "expired"
  | "replay-conflict"
  | "fitness-failed";

type Received<T> = Verified<T> | { readonly ok: false; readonly reason: RefusalReason };

const TYP = "application/verifiable-message+json";
const AUDIENCE = "agent:errand";
const MESSAGE_LIFETIME_MS = 15 * 60_000;

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i.exec(
    value,
  );
  const [, calendarTime, fraction = "", offset] = match ?? [];
  if (!calendarTime || !offset || match?.[0] !== value) return NaN;
  const dateTime = `${calendarTime.toUpperCase()}.${fraction.slice(0, 3).padEnd(3, "0")}`;
  // Validate the written calendar date and time before applying the offset.
  const localAsUtc = `${dateTime}Z`;
  const local = Date.parse(localAsUtc);
  if (!Number.isFinite(local) || new Date(local).toISOString() !== localAsUtc) return NaN;
  const instant = Date.parse(`${dateTime}${offset.toUpperCase()}`);
  // A fractional remainder falls after this tick of the millisecond engine clock.
  return instant + Number(/[1-9]/.test(fraction.slice(3)));
}

export class Parties {
  private readonly seenIds = new Set<string>();

  private constructor(
    private readonly keys: ReadonlyMap<string, PartyKey>,
    private readonly now: () => Date,
  ) {}

  static async create(
    parties: readonly { id: string; name: string }[],
    now: () => Date = () => new Date(),
  ): Promise<Parties> {
    const keys = new Map<string, PartyKey>();
    for (const p of parties) {
      const { privateKey, publicKey } = await generateKeyPair("ES256");
      keys.set(p.id, { ...p, privateKey, publicJwk: await exportJWK(publicKey) });
    }
    return new Parties(keys, now);
  }

  name(id: string): string {
    return this.keys.get(id)?.name ?? id;
  }

  /** A party signs a message (this runs on their side). */
  async sign(from: string, payload: Record<string, unknown>): Promise<string> {
    const key = this.keys.get(from);
    if (!key) throw new Error(`no key for ${from}`);
    const now = this.now();
    const message = {
      ...payload,
      from,
      id: crypto.randomUUID(),
      audience: AUDIENCE,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MESSAGE_LIFETIME_MS).toISOString(),
    };
    return new CompactSign(new TextEncoder().encode(JSON.stringify(message)))
      .setProtectedHeader({ alg: "ES256", kid: from, typ: TYP })
      .sign(key.privateKey);
  }

  /**
   * Return the payload only after integrity, source and any supplied fitness rule pass.
   */
  async receive<T extends Record<string, unknown>>(
    jws: string,
    expected: string,
    fitness?: (payload: T) => string | undefined,
  ): Promise<Received<T>> {
    const pinned = this.keys.get(expected);
    if (!pinned) return { ok: false, reason: "unknown-key" };
    let verified: Awaited<ReturnType<typeof compactVerify>>;
    try {
      verified = await compactVerify(jws, await importJWK(pinned.publicJwk, "ES256"), {
        algorithms: ["ES256"],
      });
    } catch {
      return { ok: false, reason: "bad-signature" };
    }
    const { payload, protectedHeader } = verified;
    if (protectedHeader.typ !== TYP) return { ok: false, reason: "malformed" };
    if (protectedHeader.kid !== expected) return { ok: false, reason: "sender-key-mismatch" };

    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { ok: false, reason: "malformed" };
    const { from, id, audience, createdAt, expiresAt } = value as Record<string, unknown>;
    if (from !== expected) return { ok: false, reason: "sender-key-mismatch" };
    if (audience !== AUDIENCE) return { ok: false, reason: "wrong-audience" };
    if (typeof id !== "string" || !id.trim()) return { ok: false, reason: "malformed" };
    const created = parseTimestamp(createdAt);
    const expires = parseTimestamp(expiresAt);
    const now = this.now().getTime();
    if (!Number.isFinite(created) || !Number.isFinite(expires) || !Number.isFinite(now))
      return { ok: false, reason: "malformed" };
    if (created > now) return { ok: false, reason: "not-yet-valid" };
    if (expires <= now) return { ok: false, reason: "expired" };
    const seenKey = JSON.stringify([from, id]);
    if (this.seenIds.has(seenKey)) return { ok: false, reason: "replay-conflict" };

    const checks: CheckLine[] = [
      {
        check: "integrity",
        result: "pass",
        plain:
          "The signature verifies. The message is current, addressed to this agent and new to this session.",
        code: "intact",
      },
      {
        check: "source",
        result: "pass",
        plain: `Signed with the key pinned for ${pinned.name}.`,
        code: "source-accepted",
      },
    ];
    const message = value as T;
    if (fitness) {
      try {
        if (fitness(message)) return { ok: false, reason: "fitness-failed" };
      } catch {
        return { ok: false, reason: "fitness-failed" };
      }
      checks.push({
        check: "fitness",
        result: "pass",
        plain: "The message passed the check for this task.",
        code: "fit-for-use",
      });
    }
    this.seenIds.add(seenKey);
    return { ok: true, payload: message, checks };
  }
}
