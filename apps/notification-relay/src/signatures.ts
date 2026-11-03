// AUTHORED-BY Codex GPT-6.1-Sol
import { constants, createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

const components = ["@method", "@scheme", "@authority", "@path", "content-type", "content-digest"];
const algorithms = {
  ed25519: { kty: "OKP", crv: "Ed25519", hash: null, jose: "EdDSA" },
  "ecdsa-p256-sha256": { kty: "EC", crv: "P-256", hash: "sha256", jose: "ES256" },
  "ecdsa-p384-sha384": { kty: "EC", crv: "P-384", hash: "sha384", jose: "ES384" },
  "rsa-pss-sha512": { kty: "RSA", crv: undefined, hash: "sha512", jose: "PS512" },
  "rsa-v1_5-sha256": { kty: "RSA", crv: undefined, hash: "sha256", jose: "RS256" },
} as const;

/** Credential-free HTTPS identifier; HTTP is restricted to explicit local fixtures. */
export function safeUrl(value: unknown, allowLoopback = false): URL {
  if (
    typeof value !== "string" ||
    !/^https?:\/\//u.test(value) ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject before URL normalization.
    /[\u0000-\u0020\\]/u.test(value) ||
    !URL.canParse(value)
  )
    throw new Error("Invalid URL");
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(allowLoopback && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/u.test(url.hostname)))
  )
    throw new Error("Invalid URL");
  return url;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected object");
  return value as Record<string, unknown>;
}

function bytes(value: string): Buffer {
  const result = Buffer.from(value, "base64");
  if (!value || result.toString("base64") !== value) throw new Error("Invalid base64");
  return result;
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Strict single-signature RFC 9421 webhook profile; canonicalize Structured Field values. */
export function signatureInput(input: string) {
  const match = /^([a-z*][a-z0-9_.*-]*)=\(([^)]*)\)(.*)$/u.exec(input);
  if (!match) throw new Error("Invalid signature input");
  const covered = (match[2] as string)
    .trim()
    .split(/ +/u)
    .map((part) => {
      if (!/^"[^"\\]+"$/u.test(part)) throw new Error("Invalid component");
      return part.slice(1, -1);
    });
  if (
    new Set(covered).size !== covered.length ||
    components.some((component) => !covered.includes(component))
  )
    throw new Error("Missing components");
  const params = new Map<string, string | number>();
  let remaining = match[3] as string;
  let canonical = `(${covered.map(quote).join(" ")})`;
  while (remaining) {
    const part =
      /^; *([a-z][a-z0-9_-]*)=("(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\["\\])*"|-?\d{1,15})(?=;|$)/u.exec(
        remaining,
      );
    if (!part) throw new Error("Invalid signature parameters");
    const name = part[1] as string;
    const literal = part[2] as string;
    if (!["created", "expires", "keyid", "alg", "nonce", "tag"].includes(name) || params.has(name))
      throw new Error("Invalid signature parameters");
    const value = literal.startsWith('"')
      ? literal.slice(1, -1).replace(/\\(["\\])/gu, "$1")
      : Number(literal);
    params.set(name, value);
    canonical += `;${name}=${typeof value === "string" ? quote(value) : value}`;
    remaining = remaining.slice(part[0].length);
  }
  if (typeof params.get("created") !== "number" || typeof params.get("keyid") !== "string")
    throw new Error("Missing signature parameters");
  return { label: match[1], covered, params, canonical };
}

/** Storage descriptions are fetched without credentials, redirects or remote context expansion. */
export function createWebhookVerifier(options: {
  fetch: typeof fetch;
  now: () => number;
  allowLoopback?: boolean;
}) {
  const cache = new Map<string, { expires: number; document: Record<string, unknown> }>();
  return async (request: {
    url: URL;
    method: string;
    headers: Record<string, string>;
    body: Buffer;
    storage: string;
  }): Promise<{ fingerprint: string; expires: number }> => {
    const { headers, body, storage, url } = request;
    const input = signatureInput(headers["signature-input"] ?? "");
    const created = input.params.get("created") as number;
    const expires = input.params.get("expires");
    const now = options.now() / 1000;
    if (
      Math.abs(now - created) > 300 ||
      (expires !== undefined && (typeof expires !== "number" || expires < now || expires < created))
    )
      throw new Error("Stale signature");
    const keyid = input.params.get("keyid") as string;
    const keyUrl = safeUrl(keyid, options.allowLoopback);
    if (!keyUrl.hash) throw new Error("Missing key fragment");
    const fragment = keyUrl.hash;
    keyUrl.hash = "";
    if (keyUrl.href !== storage) throw new Error("Unregistered storage");
    const digest = /^sha-256=:([A-Za-z0-9+/]+={0,2}):$/u.exec(headers["content-digest"] ?? "");
    if (!digest) throw new Error("Missing digest");
    const actual = createHash("sha256").update(body).digest();
    const expected = bytes(digest[1] as string);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error("Digest mismatch");
    if (
      !/^application\/(lws\+json|ld\+json|json)(?:\s*;.*)?$/iu.test(headers["content-type"] ?? "")
    )
      throw new Error("Invalid content type");
    let cached = cache.get(storage);
    if (!cached || cached.expires <= options.now()) {
      const response = await options.fetch(storage, {
        headers: { accept: "application/lws+cid" },
        redirect: "error",
        credentials: "omit",
      });
      if (!response.ok || response.redirected) throw new Error("Description unavailable");
      const document = record(await response.json());
      if (document.id !== storage || ![document.type].flat().includes("Storage"))
        throw new Error("Invalid storage description");
      cached = { document, expires: options.now() + 3_600_000 };
      if (cache.size >= 1000) cache.delete(cache.keys().next().value as string);
      cache.set(storage, cached);
    }
    const methods = cached.document.verificationMethod;
    if (!Array.isArray(methods)) throw new Error("Missing verification methods");
    const method = methods
      .map(record)
      .filter((method) => method.id === keyid || method.id === fragment);
    if (method.length !== 1) throw new Error("Unknown verification method");
    const selected = method[0] as Record<string, unknown>;
    const authentication = cached.document.authentication;
    if (
      !Array.isArray(authentication) ||
      !authentication.some((id) => id === keyid || id === fragment)
    )
      throw new Error("Unauthenticated verification method");
    if (
      selected.revoked !== undefined ||
      (selected.controller !== undefined && selected.controller !== storage) ||
      (selected.expires !== undefined &&
        (typeof selected.expires !== "string" ||
          !Number.isFinite(Date.parse(selected.expires)) ||
          Date.parse(selected.expires) <= options.now()))
    )
      throw new Error("Inactive verification method");
    const jwk = record(selected.publicKeyJwk);
    if (
      ["d", "p", "q", "dp", "dq", "qi", "oth", "k", "priv"].some((field) => field in jwk) ||
      (jwk.use !== undefined && jwk.use !== "sig") ||
      (jwk.key_ops !== undefined &&
        (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes("verify")))
    )
      throw new Error("Invalid public key");
    const alg =
      input.params.get("alg") ??
      (jwk.alg !== undefined
        ? Object.entries(algorithms).find(([, value]) => value.jose === jwk.alg)?.[0]
        : jwk.kty === "OKP"
          ? "ed25519"
          : jwk.kty === "EC"
            ? jwk.crv === "P-256"
              ? "ecdsa-p256-sha256"
              : "ecdsa-p384-sha384"
            : "rsa-pss-sha512");
    if (typeof alg !== "string" || !Object.hasOwn(algorithms, alg))
      throw new Error("Unsupported algorithm");
    const spec = algorithms[alg as keyof typeof algorithms];
    if (
      (jwk.alg !== undefined && jwk.alg !== spec.jose) ||
      jwk.kty !== spec.kty ||
      jwk.crv !== spec.crv
    )
      throw new Error("Algorithm/key mismatch");
    const key = createPublicKey({ key: jwk, format: "jwk" });
    if (
      spec.kty === "RSA" &&
      (key.asymmetricKeyDetails as { modulusLength: number }).modulusLength < 2048
    )
      throw new Error("Weak RSA key");
    const values: Record<string, string> = {
      "@method": request.method,
      "@scheme": url.protocol.slice(0, -1),
      "@authority": url.host,
      "@path": url.pathname,
      "@target-uri": url.href,
      "@query": url.search || "?",
    };
    const base = [
      ...input.covered.map((name) => {
        const derived = name.startsWith("@");
        const source = derived ? values : headers;
        if (
          !Object.hasOwn(source, name) ||
          (!derived && !/^[a-z0-9!#$%&'*+.^_\x60|~-]+$/u.test(name))
        )
          throw new Error("Unsupported or missing signature component");
        return `${quote(name)}: ${source[name]}`;
      }),
      `"@signature-params": ${input.canonical}`,
    ].join("\n");
    const signature = new RegExp(
      `^${(input.label as string).replaceAll("*", "\\*").replaceAll(".", "\\.")}=:([A-Za-z0-9+/]+={0,2}):$`,
      "u",
    ).exec(headers.signature ?? "");
    if (
      !signature ||
      !verify(
        spec.hash,
        Buffer.from(base),
        {
          key,
          dsaEncoding: "ieee-p1363",
          ...(alg === "rsa-pss-sha512"
            ? { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 }
            : {}),
        },
        bytes(signature[1] as string),
      )
    )
      throw new Error("Invalid signature");
    return {
      fingerprint: createHash("sha256")
        .update(base)
        .update(signature[1] as string)
        .digest("hex"),
      expires: (created + 300) * 1000,
    };
  };
}
