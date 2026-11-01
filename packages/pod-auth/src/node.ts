// AUTHORED-BY Codex GPT-6.1-Sol
import { createAgentAuth } from "./agent.js";
import { secureUrl, validateCid } from "./options.js";
import type { CidSubject, PodAuth } from "./types.js";

/** Static credential roots for an in-memory Node agent. */
export interface AgentOptions {
  boundary: string[];
  allowInsecureLoopback?: boolean;
  clock?: () => number;
}

export interface ClientCredentialsOptions extends AgentOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export interface CidAgentOptions extends AgentOptions, CidSubject {
  privateKey: CryptoKey;
}

function policy(options: AgentOptions) {
  if (!Array.isArray(options.boundary) || options.boundary.length === 0)
    throw new TypeError("Agent boundary requires at least one root");
  if (options.clock !== undefined && typeof options.clock !== "function")
    throw new TypeError("clock must be a function");
  if (options.allowInsecureLoopback === true && process.env.NODE_ENV === "production")
    throw new TypeError("allowInsecureLoopback is for local development only");
  for (const root of options.boundary)
    secureUrl(root, options.allowInsecureLoopback === true, "boundary root");
  return {
    boundary: { roots: [...options.boundary], automatic: false },
    ...(options.allowInsecureLoopback === undefined
      ? {}
      : { allowInsecureLoopback: options.allowInsecureLoopback }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  };
}

/** Establish a DPoP client-credentials session. Tokens and proof keys stay inside PodAuth. */
export async function forClientCredentials(options: ClientCredentialsOptions): Promise<PodAuth> {
  const boundary = policy(options);
  const issuer = secureUrl(options.issuer, options.allowInsecureLoopback === true, "issuer");
  if (issuer.hash || issuer.search)
    throw new TypeError("issuer must not contain a query or fragment");
  if (
    typeof options.clientId !== "string" ||
    !options.clientId ||
    typeof options.clientSecret !== "string" ||
    !options.clientSecret
  )
    throw new TypeError("Client credentials require a clientId and clientSecret");
  const auth = createAgentAuth(boundary, {
    kind: "client-credentials",
    issuer: issuer.href,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
  });
  await auth.login();
  return auth;
}

/** Resolve an existing CID authentication method and establish its self-issued LWS identity. */
export async function forCid(options: CidAgentOptions): Promise<PodAuth> {
  const boundary = policy(options);
  validateCid(options);
  const auth = createAgentAuth(boundary, {
    kind: "cid",
    cid: { documentUrl: options.documentUrl, keyId: options.keyId, privateKey: options.privateKey },
  });
  await auth.login();
  return auth;
}

export type { Identity, PodAuth } from "./types.js";
