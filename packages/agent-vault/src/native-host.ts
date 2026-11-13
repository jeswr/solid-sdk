// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { endianness } from "os";
import type { Readable, Writable } from "stream";
import { TextDecoder } from "util";
import {
  cookieDomainAllowed,
  NATIVE_MESSAGE_LIMIT,
  type NativeResponse,
  nativeRequestSchema,
  nativeResponseSchema,
} from "./browser.js";
import { acceptCapture, sessionCapture } from "./capture.js";
import type { Profiles } from "./profiles.js";
import { origin, parse, VaultError } from "./safe.js";
import type { LoginTransaction, SessionStore } from "./sessions.js";

/** One authenticated Chrome port. Tokens are bounded, short lived and single use. */
export class NativeVault {
  readonly #pending = new Map<
    string,
    { transaction: LoginTransaction; expires: number; profile: string }
  >();
  readonly #options;
  constructor(options: {
    profiles: Profiles;
    sessions: SessionStore;
    now?: () => number;
    cookieDomains?: readonly string[];
    beginning?: (site: string, account: string) => void;
    captured?: (site: string, account: string) => void | Promise<void>;
  }) {
    this.#options = options;
  }
  async handle(input: unknown): Promise<NativeResponse> {
    let id = 0;
    try {
      const request = parse(nativeRequestSchema, input);
      id = request.id;
      const { profiles, sessions } = this.#options;
      const now = this.#options.now ?? Date.now;
      for (const [token, pending] of this.#pending)
        if (pending.expires <= now()) this.#pending.delete(token);
      if (request.type === "list") {
        const site = origin(request.site);
        const personas = profiles
          .accounts(site)
          .map(({ id, profile, label }) => ({ id, profile, label }));
        return parse(nativeResponseSchema, {
          id,
          ok: true,
          result: {
            type: "list",
            personas,
            profiles: profiles.profiles(),
            cookieDomains: (this.#options.cookieDomains ?? []).filter((domain) =>
              cookieDomainAllowed(new URL(site).hostname, domain, false, [domain]),
            ),
          },
        });
      }
      if (request.type === "beginLogin") {
        const site = origin(request.site);
        if (
          !profiles
            .accounts(site)
            .some((a) => a.id === request.persona && a.profile === request.profile)
        )
          throw new VaultError("denied");
        for (const [token, pending] of this.#pending)
          if (pending.transaction.site === site && pending.transaction.account === request.persona)
            this.#pending.delete(token);
        if (this.#pending.size >= 8) throw new VaultError("denied");
        this.#options.beginning?.(site, request.persona);
        const transaction = await sessions.beginLogin(site, request.persona);
        this.#pending.set(transaction.generation, {
          transaction,
          profile: request.profile,
          expires: now() + 300000,
        });
        return { id, ok: true, result: { type: "beginLogin", token: transaction.generation } };
      }
      const pending = this.#pending.get(request.token);
      // Consume even on failure; a rejected capture needs a fresh explicit review.
      this.#pending.delete(request.token);
      if (!pending) throw new VaultError("denied");
      const { transaction } = pending;
      if (
        !profiles
          .accounts(transaction.site)
          .some((a) => a.id === transaction.account && a.profile === pending.profile)
      )
        throw new VaultError("denied");
      const host = new URL(transaction.site).hostname;
      for (const cookie of request.message.cookies)
        if (
          !cookieDomainAllowed(
            host,
            cookie.domain.replace(/^\./, "").toLowerCase(),
            cookie.hostOnly ?? false,
            this.#options.cookieDomains ?? [],
          )
        )
          throw new VaultError("invalid");
      if (!request.message.cookies.length && !request.message.tokens)
        throw new VaultError("invalid");
      // The bundle never crosses stdout. acceptCapture checks time and the persisted generation.
      await acceptCapture(sessions, sessionCapture(request.message), transaction, now);
      // Capture is durable even if optional scheduler setup fails; never ask for an automatic retry.
      try {
        await this.#options.captured?.(transaction.site, transaction.account);
      } catch {
        /* no diagnostics */
      }
      return { id, ok: true, result: { type: "capture" } };
    } catch (error) {
      return {
        id,
        ok: false,
        error:
          error instanceof VaultError && error.code !== "missing" && error.code !== "ambiguous"
            ? error.code
            : "unavailable",
      };
    }
  }
  close(): void {
    this.#pending.clear();
  }
}

/** Parse without buffering an unbounded stream or allocating the advertised oversized body. */
export async function* readFrames(input: Readable): AsyncGenerator<unknown> {
  const header = Buffer.alloc(4);
  let headerUsed = 0;
  let body: Buffer | undefined;
  let used = 0;
  try {
    for await (const chunk of input) {
      if (!(chunk instanceof Uint8Array)) throw new VaultError("invalid");
      let offset = 0;
      while (offset < chunk.length) {
        if (!body) {
          const size = Math.min(4 - headerUsed, chunk.length - offset);
          header.set(chunk.subarray(offset, offset + size), headerUsed);
          offset += size;
          headerUsed += size;
          if (headerUsed < 4) continue;
          const length = endianness() === "LE" ? header.readUInt32LE() : header.readUInt32BE();
          if (!length || length > NATIVE_MESSAGE_LIMIT) throw new VaultError("invalid");
          body = Buffer.alloc(length);
          used = 0;
          headerUsed = 0;
        }
        const size = Math.min(body.length - used, chunk.length - offset);
        body.set(chunk.subarray(offset, offset + size), used);
        offset += size;
        used += size;
        if (used === body.length) {
          const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
          body = undefined;
          used = 0;
          yield value;
        }
      }
    }
    if (headerUsed || body) throw new VaultError("invalid");
  } catch {
    throw new VaultError("invalid");
  }
}
export async function writeFrame(output: Writable, value: unknown): Promise<void> {
  try {
    const body = Buffer.from(JSON.stringify(value), "utf8");
    if (!body.length || body.length > NATIVE_MESSAGE_LIMIT) throw 0;
    const head = Buffer.alloc(4);
    if (endianness() === "LE") head.writeUInt32LE(body.length);
    else head.writeUInt32BE(body.length);
    await new Promise<void>((resolve, reject) =>
      output.write(Buffer.concat([head, body]), (error) => (error ? reject(0) : resolve())),
    );
  } catch {
    throw new VaultError("invalid");
  }
}
export async function runNativeHost(
  input: Readable,
  output: Writable,
  host: NativeVault,
): Promise<void> {
  try {
    for await (const message of readFrames(input))
      await writeFrame(output, await host.handle(message));
  } finally {
    host.close();
  }
}
