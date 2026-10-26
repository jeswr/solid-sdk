/**
 * The action registry: validation, permission gating, preparation tokens and the published
 * catalogue. Generic: it never inspects what an action is about.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { digestOf } from "../pilot/core/canonical.js";
import {
  type ActionContext,
  type ActionDefinition,
  type ActionDescriptor,
  type ActionReport,
  OPERATOR_ORIGINS,
  type PermissionCheck,
} from "./types.js";

export const PREPARATION_TTL_MS = 10 * 60_000;
const MAX_PREPARATIONS = 100;

export interface Preparation {
  token: string;
  action: string;
  /** The action version the preparation was made with (a different version refuses). */
  version: string;
  /** Digest over action, version, input and result (re-checked before execution). */
  digest: string;
  input: unknown;
  result: unknown;
  expiresAt: string;
}

export const preparationDigest = (
  p: Pick<Preparation, "action" | "version" | "input" | "result">,
): string =>
  digestOf({ action: p.action, version: p.version, input: p.input, result: p.result } as never);

/** Where preparations wait for execution (single use). */
export interface PreparationStore {
  put(p: Preparation): void;
  /** Atomically claim and remove (single use, even across processes). */
  take(token: string): Preparation | undefined;
}

export class MemoryPreparationStore implements PreparationStore {
  private readonly items = new Map<string, Preparation>();
  put(p: Preparation): void {
    if (this.items.size >= MAX_PREPARATIONS)
      this.items.delete(this.items.keys().next().value as string);
    this.items.set(p.token, p);
  }
  take(token: string): Preparation | undefined {
    const p = this.items.get(token);
    this.items.delete(token);
    return p;
  }
}

const preparationSchema = z.strictObject({
  token: z.string().max(100),
  action: z.string().max(100),
  version: z.string().max(40),
  digest: z.string().max(200),
  input: z.unknown(),
  result: z.unknown(),
  expiresAt: z.string().max(40),
});

/**
 * File-backed store for the operator CLI, whose prepare and execute run as separate processes:
 * one 0600 file per preparation in a 0700 directory, named by the SHA-256 of the token. A claim
 * is an atomic rename to a unique name: exactly one process can win it, so a token is single use
 * even when several processes execute it at the same moment. Unreadable files are refused.
 */
export class FilePreparationStore implements PreparationStore {
  constructor(private readonly dir: string) {}

  private file(token: string): string {
    return join(this.dir, `${createHash("sha256").update(token).digest("hex")}.json`);
  }

  put(p: Preparation): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    this.prune();
    const tmp = join(this.dir, `.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
    // writeFileSync completes short writes itself; only a fully written file is renamed into place.
    try {
      writeFileSync(tmp, JSON.stringify(p), { mode: 0o600, flag: "wx" });
      renameSync(tmp, this.file(p.token));
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }

  take(token: string): Preparation | undefined {
    const claimed = join(this.dir, `.claimed-${process.pid}-${randomBytes(8).toString("hex")}`);
    try {
      renameSync(this.file(token), claimed); // atomic: only one claimant succeeds
    } catch {
      return undefined; // unknown, already used, or claimed by another process
    }
    try {
      const parsed = preparationSchema.safeParse(JSON.parse(readFileSync(claimed, "utf8")));
      return parsed.success && parsed.data.token === token
        ? (parsed.data as Preparation)
        : undefined;
    } catch {
      return undefined;
    } finally {
      rmSync(claimed, { force: true });
    }
  }

  /** Drop expired preparations and keep at most MAX_PREPARATIONS (soonest-expiring first). */
  private prune(): void {
    const now = Date.now();
    const entries = readdirSync(this.dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => {
        const path = join(this.dir, n);
        try {
          const p = JSON.parse(readFileSync(path, "utf8")) as { expiresAt?: string };
          return { path, expires: Date.parse(p.expiresAt ?? "") };
        } catch {
          return { path, expires: 0 };
        }
      })
      .sort((a, b) => a.expires - b.expires);
    for (const [i, e] of entries.entries())
      if (!(e.expires > now) || entries.length - i > MAX_PREPARATIONS - 1)
        rmSync(e.path, { force: true });
  }
}

export class ActionRegistry<Env> {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous action definitions
  private readonly actions = new Map<string, ActionDefinition<any, any, Env>>();

  constructor(private readonly preparations: PreparationStore = new MemoryPreparationStore()) {}

  register<I, R>(def: ActionDefinition<I, R, Env>): this {
    if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(def.id))
      throw new Error(`bad action id ${def.id}`);
    if (this.actions.has(def.id)) throw new Error(`duplicate action ${def.id}`);
    if (def.execute && def.effect !== "local-write")
      throw new Error(`${def.id}: only local-write actions may have an execute step`);
    this.actions.set(def.id, def);
    return this;
  }

  has(id: string): boolean {
    return this.actions.has(id);
  }

  describe(ctx?: ActionContext<Env>): ActionDescriptor[] {
    return [...this.actions.values()].map((d) => ({
      id: d.id,
      version: d.version,
      title: d.title,
      description: d.description,
      effect: d.effect,
      capabilities: d.capabilities,
      limitations: d.limitations,
      phases: d.execute ? ["prepare", "execute"] : ["prepare"],
      executeOrigins: d.execute ? OPERATOR_ORIGINS : [],
      // What callers may send (defaulted fields are optional).
      inputSchema: z.toJSONSchema(d.input, { io: "input", unrepresentable: "any" }),
      resultSchema: z.toJSONSchema(d.result, { unrepresentable: "any" }),
      ...(ctx && d.example ? { example: d.example(ctx) } : {}),
    }));
  }

  /** Validate, check owner permissions, prepare. Unknown actions and bad input are refused. */
  async prepare(id: string, rawInput: unknown, ctx: ActionContext<Env>): Promise<ActionReport> {
    const def = this.actions.get(id);
    const base = {
      action: id,
      version: def?.version ?? "",
      phase: "prepare" as const,
      origin: ctx.origin,
      deterministic: true as const,
      computedAt: ctx.now().toISOString(),
    };
    if (!def) return { ...base, status: "refused", reasons: ["unknown action"], permissions: [] };
    const parsed = def.input.safeParse(rawInput);
    if (!parsed.success)
      return {
        ...base,
        status: "refused",
        reasons: parsed.error.issues
          .slice(0, 10)
          .map(
            (i) =>
              `input ${i.path.join(".") || "(root)"}: ${/received undefined$/.test(i.message) ? "is required" : i.message}`,
          ),
        permissions: [],
      };
    const input = parsed.data;
    const permissions: PermissionCheck[] = def.permissions ? await def.permissions(ctx, input) : [];
    const denied = permissions.filter((p) => !p.allowed);
    if (denied.length > 0)
      return {
        ...base,
        status: "refused",
        reasons: denied.map((p) => `${p.subject}: ${p.why}`),
        permissions,
      };
    const outcome = await def.prepare(ctx, input);
    if (outcome.result !== undefined) {
      const checked = def.result.safeParse(outcome.result);
      if (!checked.success)
        return {
          ...base,
          status: "blocked",
          reasons: ["the action produced a result outside its declared schema (withheld)"],
          permissions,
        };
      outcome.result = checked.data;
    }
    const report: ActionReport = { ...base, ...outcome, permissions };
    if (def.execute && outcome.status === "ok") {
      const token = randomBytes(18).toString("base64url");
      const digest = preparationDigest({
        action: id,
        version: def.version,
        input,
        result: outcome.result,
      });
      const expiresAt = new Date(ctx.now().getTime() + PREPARATION_TTL_MS).toISOString();
      this.preparations.put({
        token,
        action: id,
        version: def.version,
        digest,
        input,
        result: outcome.result,
        expiresAt,
      });
      report.preparation = { token, digest, expiresAt };
    }
    return report;
  }

  /** Run a prepared, effectful action (single-use token; operator origins only). */
  async execute(token: string, ctx: ActionContext<Env>): Promise<ActionReport> {
    const base = {
      version: "",
      phase: "execute" as const,
      origin: ctx.origin,
      deterministic: true as const,
      computedAt: ctx.now().toISOString(),
      permissions: [],
    };
    if (!OPERATOR_ORIGINS.includes(ctx.origin))
      return {
        ...base,
        action: "",
        status: "refused",
        reasons: [
          `execution is only available to operator origins (${OPERATOR_ORIGINS.join(", ")})`,
        ],
      };
    const p = this.preparations.take(token);
    if (!p)
      return {
        ...base,
        action: "",
        status: "refused",
        reasons: ["unknown or already used preparation"],
      };
    const def = this.actions.get(p.action);
    if (!def?.execute)
      return {
        ...base,
        action: p.action,
        status: "refused",
        reasons: ["action cannot be executed"],
      };
    const refuse = (status: "refused" | "needs-review", reason: string): ActionReport => ({
      ...base,
      action: p.action,
      version: def.version,
      status,
      reasons: [reason],
    });
    if (Date.parse(p.expiresAt) <= ctx.now().getTime() || Number.isNaN(Date.parse(p.expiresAt)))
      return refuse("needs-review", "the preparation expired; prepare again with fresh data");
    // The preparation must still describe exactly this action version and content.
    if (p.version !== def.version)
      return refuse(
        "refused",
        `prepared with version ${p.version}; the action is now version ${def.version}. Prepare again.`,
      );
    if (preparationDigest(p) !== p.digest)
      return refuse(
        "refused",
        "the stored preparation does not match its digest (changed or corrupted)",
      );
    // Re-validate the stored input and result, and re-check permissions NOW.
    const input = def.input.safeParse(p.input);
    const prepared = def.result.safeParse(p.result);
    if (!input.success || !prepared.success)
      return refuse("refused", "the stored preparation no longer matches the action's schemas");
    const permissions = def.permissions ? await def.permissions(ctx, input.data) : [];
    const denied = permissions.filter((x) => !x.allowed);
    if (denied.length > 0)
      return {
        ...base,
        action: p.action,
        version: def.version,
        permissions,
        status: "refused",
        reasons: denied.map((x) => `${x.subject}: ${x.why}`),
      };
    const outcome = await def.execute(ctx, input.data, prepared.data);
    return { ...base, action: p.action, version: def.version, permissions, ...outcome };
  }
}
