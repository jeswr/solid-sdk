// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { inspect } from "util";
import { z } from "zod";

export class VaultError extends Error {
  constructor(readonly code: "invalid" | "denied" | "unavailable" | "missing" | "ambiguous") {
    super(`Vault ${code}.`);
    this.name = "VaultError";
  }
}
/** Never retain an external error, cause, diagnostic, response or validation input. */
export async function boundary<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new VaultError(e instanceof VaultError ? e.code : "unavailable");
  }
}
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    const r = schema.safeParse(input);
    if (!r.success) throw new VaultError("invalid");
    return r.data;
  } catch {
    throw new VaultError("invalid");
  }
}
/** Host-only structural values remain usable by the executor; default diagnostics are opaque. */
export function opaque<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) opaque(v);
    Object.defineProperties(value, {
      toJSON: { value: () => "[redacted]", configurable: true },
      toString: { value: () => "[redacted]", configurable: true },
      [inspect.custom]: { value: () => "[redacted]", configurable: true },
    });
  }
  return value;
}
export class Secret<T> {
  readonly #value: T;
  constructor(value: T) {
    this.#value = opaque(value);
  }
  /** Only trusted host adapters receive the value. Failures are sanitised. */
  use<R>(fn: (value: T) => R | Promise<R>): Promise<R> {
    return boundary(() => fn(this.#value));
  }
  toJSON() {
    return "[redacted]";
  }
  toString() {
    return "[redacted]";
  }
  [inspect.custom]() {
    return "[redacted]";
  }
}
export const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export function origin(input: string): string {
  try {
    const u = new URL(input);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      (u.protocol !== "https:" &&
        !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    )
      throw 0;
    return u.origin;
  } catch {
    throw new VaultError("invalid");
  }
}
export function sameSiteUrl(site: string, input: string): URL {
  try {
    const u = new URL(input);
    if (u.origin !== origin(site) || u.username || u.password || u.hash) throw 0;
    return u;
  } catch {
    throw new VaultError("invalid");
  }
}
