// AUTHORED-BY Codex GPT-6.1-Sol
import { constants, createHash, KeyObject, sign } from "node:crypto";
import { exportJWK, generateKeyPair } from "jose";
import { vi } from "vitest";
import { createRelay } from "../src/relay.js";

export const epoch = Date.parse("2026-10-31T12:00:00Z");
export const storage = "https://storage.example/description";
export const keyid = `${storage}#key`;
export const inbox = `https://relay.example/inbox/${"a".repeat(32)}`;
export const covered = [
  "@method",
  "@scheme",
  "@authority",
  "@path",
  "content-type",
  "content-digest",
];
export const event = {
  type: "Notification",
  storage,
  activity: [{ id: "one", type: "Update", object: "https://storage.example/pod/note" }],
};
export async function vector(alg = "ed25519") {
  const joseAlg = (
    {
      ed25519: "EdDSA",
      "ecdsa-p256-sha256": "ES256",
      "ecdsa-p384-sha384": "ES384",
      "rsa-pss-sha512": "PS512",
      "rsa-v1_5-sha256": "RS256",
    } as Record<string, string>
  )[alg] as string;
  const keys = await generateKeyPair(joseAlg, { extractable: true });
  const jwk = await exportJWK(keys.publicKey);
  const document = {
    id: storage,
    type: "Storage",
    verificationMethod: [{ id: keyid, publicKeyJwk: jwk }],
  };
  function signed(
    json: unknown = event,
    options: {
      created?: number;
      url?: string;
      components?: string[];
      params?: string;
      contentType?: string;
      body?: string;
      privateKey?: Parameters<typeof sign>[2];
    } = {},
  ) {
    const body = Buffer.from(options.body ?? JSON.stringify(json));
    const url = new URL(options.url ?? inbox);
    const components = options.components ?? covered;
    const params =
      options.params ?? `;created=${options.created ?? epoch / 1000};keyid="${keyid}";alg="${alg}"`;
    const input = `(${components.map((c) => `"${c}"`).join(" ")})${params}`;
    const headers = {
      "content-type": options.contentType ?? "application/lws+json",
      "content-digest": `sha-256=:${createHash("sha256").update(body).digest("base64")}:`,
      "signature-input": `sig1=${input}`,
      signature: "",
    };
    const values: Record<string, string> = {
      "@method": "POST",
      "@scheme": url.protocol.slice(0, -1),
      "@authority": url.host,
      "@path": url.pathname,
      "content-type": headers["content-type"],
      "content-digest": headers["content-digest"],
    };
    const base = [
      ...components.map((c) => `"${c}": ${values[c]}`),
      `"@signature-params": ${input}`,
    ].join("\n");
    const hash =
      alg === "ed25519"
        ? null
        : alg.endsWith("sha384")
          ? "sha384"
          : alg.endsWith("sha512")
            ? "sha512"
            : "sha256";
    const signature = sign(
      hash,
      Buffer.from(base),
      options.privateKey ?? {
        key: KeyObject.from(keys.privateKey),
        dsaEncoding: "ieee-p1363",
        ...(alg === "rsa-pss-sha512"
          ? { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 }
          : {}),
      },
    );
    headers.signature = `sig1=:${signature.toString("base64")}:`;
    return { url, method: "POST", storage, body, headers };
  }
  return { keys, jwk, document, signed };
}

export async function fixture() {
  const v = await vector();
  let clock = epoch;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(v.document));
  const identity = vi.fn(async () => ({ subject: "user", expiresAt: epoch + 86_400_000 }));
  const relay = createRelay({
    publicUrl: "https://relay.example",
    fetch,
    verifyIdToken: identity,
    now: () => clock,
    allowedOrigins: ["https://app.example"],
  });
  async function register(storageId: unknown = storage, headers: Record<string, string> = {}) {
    return relay.handle(
      new Request("https://relay.example/register", {
        method: "POST",
        headers: {
          authorization: "Bearer id-token",
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ storage: storageId }),
      }),
    );
  }
  const registration = (await (await register()).json()) as {
    id: string;
    inbox: string;
    streamToken: string;
  };
  function deliver(json: unknown = event, options: Parameters<typeof v.signed>[1] = {}) {
    const signed = v.signed(json, { url: registration.inbox, ...options });
    return relay.handle(
      new Request(signed.url, {
        method: "POST",
        headers: signed.headers,
        body: new Uint8Array(signed.body),
      }),
    );
  }
  function stream(last?: string, token = registration.streamToken, signal?: AbortSignal) {
    return relay.handle(
      new Request(`https://relay.example/stream/${registration.id}?token=${token}`, {
        headers: last === undefined ? {} : { "last-event-id": last },
        signal,
      }),
    );
  }
  return {
    ...v,
    relay,
    fetch,
    identity,
    register,
    registration,
    deliver,
    stream,
    time: (value: number) => {
      clock = value;
    },
  };
}
