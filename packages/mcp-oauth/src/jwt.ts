// AUTHORED-BY Codex GPT-6.1-Sol
import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { ACCESS_TTL, OAuthError, object, opaque } from "./protocol.js";
import type { Grant, SigningKey } from "./types.js";

/** Generate an ES256 key for a single process; production callers persist and inject it. */
export function generateSigningKey(): SigningKey {
  return {
    privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey,
    kid: opaque(),
  };
}

export class JwtService {
  readonly jwk: Record<string, unknown>;
  private readonly publicKey;

  constructor(
    private readonly key: SigningKey,
    private readonly issuer: string,
    private readonly now: () => number,
  ) {
    if (
      key.privateKey.type !== "private" ||
      key.privateKey.asymmetricKeyType !== "ec" ||
      key.privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
      !key.kid
    ) {
      throw new Error("An ES256 private key and nonempty kid are required");
    }
    this.publicKey = createPublicKey(key.privateKey);
    this.jwk = {
      ...this.publicKey.export({ format: "jwk" }),
      kid: key.kid,
      alg: "ES256",
      use: "sig",
    };
  }

  issue(grant: Grant): string {
    const now = this.now();
    const header = encode({ alg: "ES256", typ: "at+jwt", kid: this.key.kid });
    const payload = encode({
      iss: this.issuer,
      sub: grant.session.webId,
      aud: grant.resource,
      client_id: grant.clientId,
      scope: grant.scope,
      sid: grant.id,
      iat: now,
      exp: Math.min(now + ACCESS_TTL, grant.expiresAt),
      jti: opaque(),
    });
    const input = `${header}.${payload}`;
    return `${input}.${sign("sha256", Buffer.from(input), {
      key: this.key.privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url")}`;
  }

  verify(token: string, resource: string): Record<string, unknown> {
    try {
      if (token.length > 16_384) throw new Error();
      const parts = token.split(".");
      if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/u.test(part)))
        throw new Error();
      const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
      const header = object(JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")));
      const claims = object(JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")));
      const signature = Buffer.from(signaturePart, "base64url");
      if (
        header.alg !== "ES256" ||
        header.typ !== "at+jwt" ||
        header.kid !== this.key.kid ||
        header.crit !== undefined ||
        signature.length !== 64 ||
        !verify(
          "sha256",
          Buffer.from(`${headerPart}.${payloadPart}`),
          {
            key: this.publicKey,
            dsaEncoding: "ieee-p1363",
          },
          signature,
        )
      )
        throw new Error();
      const now = this.now();
      if (
        claims.iss !== this.issuer ||
        claims.aud !== resource ||
        !Number.isSafeInteger(claims.exp) ||
        (claims.exp as number) <= now ||
        !Number.isSafeInteger(claims.iat) ||
        (claims.iat as number) > now ||
        (claims.exp as number) <= (claims.iat as number) ||
        (claims.exp as number) - (claims.iat as number) > ACCESS_TTL ||
        (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now)) ||
        [claims.sub, claims.client_id, claims.sid, claims.jti].some(
          (value) => typeof value !== "string" || !value,
        ) ||
        typeof claims.scope !== "string"
      )
        throw new Error();
      return claims;
    } catch {
      throw new OAuthError("invalid_token", 401);
    }
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
