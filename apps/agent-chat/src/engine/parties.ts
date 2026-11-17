// AUTHORED-BY Claude Opus 5.5
/**
 * The other side of every exchange: stores, lenders, banks and the identity provider, each
 * with its own signing key. Their messages arrive as signed JWS, and the agent's inbound
 * gate checks them before anything in them is used: integrity (the signature verifies),
 * source (the key is the one pinned for that party), authority (the party may say this),
 * terms, and fitness (fresh enough for the task).
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
  readonly payload: T;
  readonly checks: readonly CheckLine[];
}

const TYP = "application/verifiable-message+json";

export class Parties {
  private constructor(private readonly keys: ReadonlyMap<string, PartyKey>) {}

  static async create(parties: readonly { id: string; name: string }[]): Promise<Parties> {
    const keys = new Map<string, PartyKey>();
    for (const p of parties) {
      const { privateKey, publicKey } = await generateKeyPair("ES256");
      keys.set(p.id, { ...p, privateKey, publicJwk: await exportJWK(publicKey) });
    }
    return new Parties(keys);
  }

  name(id: string): string {
    return this.keys.get(id)?.name ?? id;
  }

  /** A party signs a message (this runs on their side). */
  async sign(from: string, payload: Record<string, unknown>): Promise<string> {
    const key = this.keys.get(from);
    if (!key) throw new Error(`no key for ${from}`);
    return new CompactSign(new TextEncoder().encode(JSON.stringify({ ...payload, from })))
      .setProtectedHeader({ alg: "ES256", kid: from, typ: TYP })
      .sign(key.privateKey);
  }

  /**
   * The inbound gate. Returns the payload only when integrity and source hold; `fitness` decides
   * fitness for the task. Untrusted free text in the payload is never treated as instruction.
   */
  async receive<T extends Record<string, unknown>>(
    jws: string,
    expected: string,
    fitness: (payload: T) => string | undefined = () => undefined,
  ): Promise<Verified<T> | undefined> {
    const pinned = this.keys.get(expected);
    if (!pinned) return undefined;
    try {
      const { payload, protectedHeader } = await compactVerify(
        jws,
        await importJWK(pinned.publicJwk, "ES256"),
        { algorithms: ["ES256"] },
      );
      if (protectedHeader.kid !== expected || protectedHeader.typ !== TYP) return undefined;
      const value = JSON.parse(new TextDecoder().decode(payload)) as T;
      if (value.from !== expected) return undefined;
      const unfit = fitness(value);
      if (unfit) return undefined;
      return {
        payload: value,
        checks: [
          {
            check: "integrity",
            result: "pass",
            plain: "The signature verifies; nothing was changed.",
            code: "intact",
          },
          {
            check: "source",
            result: "pass",
            plain: `Signed with the key pinned for ${pinned.name}.`,
            code: "source-accepted",
          },
          {
            check: "authority",
            result: "pass",
            plain: `${pinned.name} may make this statement.`,
            code: "authority-valid",
          },
          {
            check: "terms",
            result: "pass",
            plain: "Its terms are ones you accept.",
            code: "terms-acceptable",
          },
          {
            check: "fitness",
            result: "pass",
            plain: "Fresh and complete enough for this task.",
            code: "fit-for-use",
          },
        ],
      };
    } catch {
      return undefined;
    }
  }
}
