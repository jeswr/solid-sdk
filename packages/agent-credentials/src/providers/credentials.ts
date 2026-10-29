// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Provider credentials: a SEPARABLE token supply, never stored settings.
 *
 * Adapters ask an `AccessTokenProvider` for a short-lived access token for one configured
 * account and the minimum scopes they need. Where the token comes from (an OAuth refresh done by
 * a separate setup/credential tool, an OS keychain, …) is outside this code. The one concrete
 * provider here runs an operator-configured **credential helper** executable (no shell), in the
 * style of git credential helpers: JSON request on stdin, JSON token on stdout, bounded time and
 * output. Configuration comes from a trusted operator file (`ProviderConfig`), never from a
 * browser or an action request, and must not contain tokens.
 */
import { spawn } from "child_process";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "fs";
import { isAbsolute } from "path";
import { z } from "zod";
import { HELPER_KILL_TIMEOUT_MS } from "../timeouts.js";
import { parseRfc3339 } from "./common.js";

export type ProviderFamily = "google" | "microsoft";

export interface TokenRequest {
  provider: ProviderFamily;
  purpose?: "read" | "send";
  /** The dashboard connection (account record) id the token is for. */
  connectionId: string;
  /** Minimum scopes the adapter needs (the helper may return broader ones). */
  scopes: readonly string[];
}

export interface AccessToken {
  token: string;
  expiresAt?: string;
  /** Scopes actually granted, when the helper knows them (checked against the minimum). */
  grantedScopes?: readonly string[];
}

export class CredentialError extends Error {
  constructor(
    readonly code: "not-configured" | "revoked" | "unavailable" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "CredentialError";
  }
}

export interface AccessTokenProvider {
  getAccessToken(request: TokenRequest): Promise<AccessToken>;
}

// ------------------------------------------------------------------ operator configuration

const FORBIDDEN_KEYS = /token|secret|password|refresh|bearer/i;

const helperSchema = z.strictObject({
  type: z.literal("helper"),
  /** Absolute path of the credential helper executable (trusted operator configuration). */
  command: z.string().min(2).max(500).refine(isAbsolute, "must be an absolute path"),
  /** Fixed arguments (no shell; never from a request). */
  args: z.array(z.string().max(200)).max(10).default([]),
});

export const providerConfigSchema = z.strictObject({
  version: z.literal(1),
  accounts: z
    .array(
      z.strictObject({
        /** Dashboard connection id this entry configures. */
        connectionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
        provider: z.enum(["google", "microsoft"]),
        credential: helperSchema,
      }),
    )
    .max(50)
    .refine(
      (accounts) =>
        new Set(accounts.map((a) => JSON.stringify([a.provider, a.connectionId]))).size ===
        accounts.length,
      "duplicate provider/connection mappings are not allowed",
    ),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/**
 * Load the operator's provider configuration from one verified descriptor. Refuses symlinks,
 * non-files, foreign owners, files others can write, and keys that look like stored credentials.
 */
export function loadProviderConfig(path: string): ProviderConfig {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw: unknown;
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error("provider configuration must be a regular file");
    if (typeof process.getuid !== "function")
      throw new Error("provider configuration ownership cannot be verified on this platform");
    if (st.uid !== process.getuid())
      throw new Error("provider configuration is owned by another user (refused)");
    if (st.mode & 0o022) throw new Error("provider configuration must not be group/world-writable");
    raw = JSON.parse(readFileSync(fd, "utf8")) as unknown;
  } finally {
    closeSync(fd);
  }
  const scan = (v: unknown): void => {
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.test(k))
          throw new Error(`provider configuration must not contain credentials ("${k}")`);
        scan(x);
      }
  };
  scan(raw);
  return providerConfigSchema.parse(raw);
}

// ------------------------------------------------------------------ helper-process provider

const HELPER_MAX_OUTPUT = 16 * 1024;
const helperOutput = z.object({
  access_token: z.string().regex(/^[\x21-\x7e]{8,8192}$/),
  expires_at: z.string().max(64).optional(),
  scope: z.string().max(4000).optional(),
});

export class HelperTokenProvider implements AccessTokenProvider {
  constructor(private readonly config: ProviderConfig) {}

  async getAccessToken(request: TokenRequest): Promise<AccessToken> {
    const entries = this.config.accounts.filter(
      (a) => a.connectionId === request.connectionId && a.provider === request.provider,
    );
    if (entries.length === 0)
      throw new CredentialError(
        "not-configured",
        `no ${request.provider} credential is configured for account “${request.connectionId}”`,
      );
    if (entries.length !== 1)
      throw new CredentialError("invalid", "exactly one matching helper mapping is required");
    const entry = entries[0] as ProviderConfig["accounts"][number];
    const out = await runHelper(entry.credential.command, entry.credential.args, {
      provider: request.provider,
      connectionId: request.connectionId,
      scopes: request.scopes,
      purpose: request.purpose ?? "read",
    });
    let parsed: z.infer<typeof helperOutput>;
    try {
      parsed = helperOutput.parse(JSON.parse(out));
    } catch {
      throw new CredentialError("invalid", "the credential helper returned an unusable answer");
    }
    if (parsed.expires_at !== undefined) {
      const exp = parseRfc3339(parsed.expires_at);
      if (exp === undefined)
        throw new CredentialError("invalid", "the credential helper returned an invalid expiry");
      if (exp <= Date.now())
        throw new CredentialError("revoked", "the credential helper returned an expired token");
    }
    return {
      token: parsed.access_token,
      ...(parsed.expires_at ? { expiresAt: parsed.expires_at } : {}),
      ...(parsed.scope ? { grantedScopes: parsed.scope.split(/\s+/).filter(Boolean) } : {}),
    };
  }
}

/**
 * Run the helper once. Settles exactly once; every failure is a typed CredentialError (never the
 * helper's output); the child is killed on timeout or oversize, and an early exit that closes
 * stdin (EPIPE) is handled rather than crashing the caller.
 */
export function runHelper(
  command: string,
  args: readonly string[],
  request: unknown,
  timeoutMs = HELPER_KILL_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "ignore"], shell: false });
    let out = "";
    let size = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() =>
        reject(new CredentialError("unavailable", "the credential helper did not answer in time")),
      );
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      size += d.byteLength;
      if (size > HELPER_MAX_OUTPUT) child.kill("SIGKILL");
      else out += d.toString("utf8");
    });
    child.stdout.on("error", () => undefined);
    // The helper may exit before reading its request: that is its exit code's business.
    child.stdin.on("error", () => undefined);
    child.on("error", () => {
      child.kill("SIGKILL");
      settle(() =>
        reject(new CredentialError("unavailable", "the credential helper could not be started")),
      );
    });
    child.on("close", (code, signal) =>
      settle(() => {
        if (size > HELPER_MAX_OUTPUT)
          reject(new CredentialError("invalid", "the credential helper answer was too large"));
        else if (code === 3)
          reject(new CredentialError("revoked", "the credential helper reports revoked access"));
        else if (code !== 0)
          reject(
            new CredentialError(
              "unavailable",
              `the credential helper failed (${signal ? `signal ${signal}` : `exit ${code}`})`,
            ),
          );
        else resolve(out);
      }),
    );
    child.stdin.end(JSON.stringify(request));
  });
}
