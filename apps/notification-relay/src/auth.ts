// AUTHORED-BY Codex GPT-6.1-Sol
import { createRemoteJWKSet, customFetch, decodeJwt, jwtVerify } from "jose";
import { safeUrl } from "./signatures.js";

/** Verified ID-token identity and its absolute expiration time in milliseconds. */
export interface Identity {
  subject: string;
  expiresAt: number;
}

/** Verify session ID tokens against explicitly configured issuers and client audiences. */
export function createIdTokenVerifier(options: {
  audience: string | string[];
  issuers: { issuer: string; jwksUri: string }[];
  fetch: typeof fetch;
  now?: () => number;
}) {
  if (
    !options.issuers.length ||
    ![options.audience].flat().every((aud) => aud.length > 0) ||
    [options.audience].flat().length === 0
  )
    throw new Error("Configure ID token trust");
  const issuers = new Map(
    options.issuers.map(({ issuer, jwksUri }) => {
      safeUrl(issuer);
      const uri = safeUrl(jwksUri);
      if (uri.hash || uri.search) throw new Error("Invalid JWKS URL");
      return [issuer, createRemoteJWKSet(uri, { [customFetch]: options.fetch })] as const;
    }),
  );
  return async (token: string): Promise<Identity> => {
    const issuer = decodeJwt(token).iss;
    const keys = issuer === undefined ? undefined : issuers.get(issuer);
    if (!keys) throw new Error("Untrusted issuer");
    const now = options.now?.() ?? Date.now();
    const { payload, protectedHeader } = await jwtVerify(token, keys, {
      issuer,
      audience: options.audience,
      algorithms: ["RS256", "PS256", "ES256", "ES384", "EdDSA"],
      requiredClaims: ["sub", "iss", "aud", "exp", "iat"],
      currentDate: new Date(now),
    });
    if (
      (protectedHeader.typ !== undefined && !["JWT", "jwt"].includes(protectedHeader.typ)) ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.iat !== "number" ||
      payload.iat > now / 1000 ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        (typeof payload.azp !== "string" || ![options.audience].flat().includes(payload.azp)))
    )
      throw new Error("Invalid ID token");
    return { subject: payload.sub, expiresAt: (payload.exp as number) * 1000 };
  };
}
