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
// AUTHORED-BY Codex GPT-6.1-Sol
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { HELPER_TERMINATION_GRACE_MS, HELPER_TIMEOUT_MS } from "../../credentials/deadlines.js";
import { parseRfc3339 } from "./common.js";

export type ProviderFamily = "google" | "microsoft";

export interface TokenRequest {
  provider: ProviderFamily;
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
    readonly code: "not-configured" | "revoked" | "unavailable" | "invalid" | "timeout",
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
    .max(50),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/**
 * Load the operator's provider configuration. Refuses files others can write, and any key that
 * looks like a stored credential (tokens are supplied by the helper at run time only).
 */
export function loadProviderConfig(path: string): ProviderConfig {
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o022) throw new Error("provider configuration must not be group/world-writable");
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
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
    const entry = this.config.accounts.find(
      (a) => a.connectionId === request.connectionId && a.provider === request.provider,
    );
    if (!entry)
      throw new CredentialError(
        "not-configured",
        `no ${request.provider} credential is configured for account “${request.connectionId}”`,
      );
    const out = await runHelper(entry.credential.command, entry.credential.args, {
      provider: request.provider,
      connectionId: request.connectionId,
      scopes: request.scopes,
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
 * helper's output). The deadline covers the helper's lock wait + provider call + local work;
 * `timeoutMs` overrides that budget for tests. On deadline, discard output and send SIGTERM,
 * then SIGKILL after a bounded persistence grace period. Even a successful exit during grace
 * is a timeout. Oversized output is killed immediately; early stdin closure (EPIPE) is safe.
 */
export function runHelper(
  command: string,
  args: readonly string[],
  request: unknown,
  timeoutMs = HELPER_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      fn();
    };
    const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "ignore"], shell: false });
    let out = "";
    let size = 0;
    const rejectTimeout = () =>
      reject(new CredentialError("timeout", "the credential helper did not answer in time"));
    const timer = setTimeout(() => {
      timedOut = true;
      out = "";
      // Arm escalation before signalling: a cooperative helper may close immediately.
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        settle(rejectTimeout);
      }, HELPER_TERMINATION_GRACE_MS);
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      if (settled || timedOut) return;
      size += d.byteLength;
      if (size > HELPER_MAX_OUTPUT) child.kill("SIGKILL");
      else out += d.toString("utf8");
    });
    child.stdout.on("error", () => undefined);
    // The helper may exit before reading its request: that is its exit code's business.
    child.stdin.on("error", () => undefined);
    child.on("error", () => {
      // A signal/exit race must not turn a deadline into a generic start failure or
      // interrupt persistence. The grace timer still bounds an uncooperative child.
      if (settled || timedOut) return;
      child.kill("SIGKILL");
      settle(() =>
        reject(new CredentialError("unavailable", "the credential helper could not be started")),
      );
    });
    child.on("close", (code, signal) =>
      settle(() => {
        if (timedOut) rejectTimeout();
        else if (size > HELPER_MAX_OUTPUT)
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
