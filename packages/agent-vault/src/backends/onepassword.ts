// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { spawn } from "child_process";
import { homedir } from "os";
import { z } from "zod";
import { boundary, identifier, opaque, origin, parse, Secret, VaultError } from "../safe.js";
import { type LoginItem, loginSchema, type SecretBackend, type SecretRef } from "./types.js";
export interface RunRequest {
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  stdin?: string;
}
export type OpRunner = (request: RunRequest) => Promise<{ stdout: string }>;
/** Bounded output and deadline; never forward child diagnostics, inherit env, or invoke a shell. */
export const runOp: OpRunner = (request) =>
  boundary(
    () =>
      new Promise((resolve, reject) => {
        const child = spawn("op", [...request.argv], {
          shell: false,
          env: { PATH: process.env.PATH, HOME: homedir(), ...request.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
        const output: Buffer[] = [];
        let bytes = 0;
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new VaultError("unavailable"));
        }, 60000);
        child.stdout.on("data", (b: Buffer) => {
          bytes += b.length;
          if (bytes > 1024 * 1024) {
            child.kill("SIGKILL");
            reject(new VaultError("unavailable"));
          } else output.push(b);
        });
        child.stderr.on("data", () => {});
        child.stdin.on("error", () => {});
        child.on("error", () => {
          clearTimeout(timeout);
          reject(new VaultError("unavailable"));
        });
        child.on("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve({ stdout: Buffer.concat(output).toString("utf8") });
          else reject(new VaultError("unavailable"));
        });
        child.stdin.end(request.stdin);
      }),
  );
export interface OpAccount {
  account: string;
  profile: string;
  vault: string;
  auth: { mode: "desktop" } | { mode: "service"; token: () => Promise<Secret<string>> };
}
const fieldSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  type: z.string().optional(),
  purpose: z.string().optional(),
});
const itemSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/),
  category: z.string().optional(),
  vault: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
  urls: z.array(z.object({ href: z.string() })).optional(),
  fields: z.array(fieldSchema).optional(),
});
export class OnePasswordCliBackend implements SecretBackend {
  readonly id: string;
  get profiles(): readonly string[] {
    return this.#accounts.map((a) => a.profile);
  }
  readonly #accounts: readonly OpAccount[];
  readonly #runner: OpRunner;
  readonly #domains: readonly string[];
  constructor(options: {
    id?: string;
    accounts: readonly OpAccount[];
    runner?: OpRunner;
    domainGroups?: readonly string[];
  }) {
    if (
      !options.accounts.length ||
      new Set(options.accounts.map((a) => a.account)).size !== options.accounts.length
    )
      throw new VaultError("invalid");
    for (const a of options.accounts) {
      parse(identifier, a.profile);
      if (![a.account, a.vault].every((s) => /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,100}$/.test(s)))
        throw new VaultError("invalid");
    }
    this.id = options.id ?? "onepassword";
    this.#accounts = options.accounts.map((a) => ({ ...a, auth: { ...a.auth } }));
    this.#runner = options.runner ?? runOp;
    this.#domains = options.domainGroups ?? [];
    if (this.#domains.some((d) => !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(d)))
      throw new VaultError("invalid");
  }
  profileFor(ref?: string): string | undefined {
    return ref ? this.#select(ref).account.profile : undefined;
  }
  #ref(a: OpAccount, id: string): SecretRef {
    return { backend: this.id, profile: a.profile, ref: `${a.account}/${id}` };
  }
  #select(ref: string): { account: OpAccount; id: string } {
    const [account, id, extra] = ref.split("/");
    const a = this.#accounts.find((a) => a.account === account);
    if (!a || !id || extra || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(id))
      throw new VaultError("invalid");
    return { account: a, id };
  }
  #run(a: OpAccount, args: string[], stdin?: string): Promise<string> {
    return boundary(async () => {
      const exec = async (token?: string) => {
        const r = await this.#runner(
          opaque<RunRequest>({
            argv: [...args, "--account", a.account, "--vault", a.vault, "--format", "json"],
            env: token ? { OP_SERVICE_ACCOUNT_TOKEN: token } : {},
            ...(stdin === undefined ? {} : { stdin }),
          }),
        );
        return r.stdout;
      };
      return a.auth.mode === "service"
        ? (await a.auth.token()).use((t) => {
            if (!/^[\x21-\x7e]{1,8192}$/.test(t)) throw new VaultError("invalid");
            return exec(t);
          })
        : exec();
    });
  }
  #matches(site: string, candidate: string): boolean {
    try {
      const a = new URL(site);
      const b = new URL(candidate);
      if (b.username || b.password || b.protocol !== a.protocol || b.port !== a.port) return false;
      if (a.origin === b.origin) return true;
      return this.#domains.some((d) =>
        [a.hostname, b.hostname].every((h) => h === d || h.endsWith(`.${d}`)),
      );
    } catch {
      return false;
    }
  }
  allowsOrigin(site: string, credentialSite: string): boolean {
    try {
      return this.#matches(origin(site), origin(credentialSite));
    } catch {
      return false;
    }
  }
  find(site: string): Promise<SecretRef[]> {
    return boundary(async () => {
      const target = origin(site);
      const refs: SecretRef[] = [];
      for (const a of this.#accounts) {
        const items = parse(
          z.array(itemSchema),
          JSON.parse(await this.#run(a, ["item", "list", "--categories", "Login"])),
        );
        for (const item of items)
          if (item.urls?.some((u) => this.#matches(target, u.href)))
            refs.push(this.#ref(a, item.id));
      }
      return refs;
    });
  }
  read(ref: string, purpose: "login"): Promise<Secret<LoginItem>> {
    return boundary(async () => {
      if (purpose !== "login") throw new VaultError("denied");
      const { account: a, id } = this.#select(ref);
      const item = parse(itemSchema, JSON.parse(await this.#run(a, ["item", "get", id])));
      if (item.id !== id || (item.category && item.category !== "LOGIN"))
        throw new VaultError("invalid");
      const field = (name: string) =>
        item.fields?.find((f) => f.id === name || f.purpose?.toLowerCase() === name)?.value;
      return new Secret(
        parse(loginSchema, {
          site: new URL(item.urls?.[0]?.href ?? "").origin,
          ref,
          title: "Login",
          username: field("username"),
          password: field("password"),
        }),
      );
    });
  }
  totp(ref: string): Promise<Secret<string>> {
    return boundary(async () => {
      const { account: a, id } = this.#select(ref);
      // op's --otp returns a code on stdout (JSON string or plain digit output, depending on CLI release).
      const raw = (await this.#run(a, ["item", "get", id, "--otp"])).trim();
      let code: unknown;
      try {
        code = JSON.parse(raw);
      } catch {
        code = raw;
      }
      if (typeof code === "number") code = raw;
      return new Secret(parse(z.string().regex(/^\d{6,8}$/), code));
    });
  }
  save(item: Secret<LoginItem>): Promise<SecretRef> {
    return boundary(() =>
      item.use(async (input) => {
        const value = parse(loginSchema, input);
        const site = origin(value.site);
        // New saves require an explicit account selector in ref: '<account>/new'.
        const { account: a, id } = this.#select(value.ref ?? "");
        if (id !== "new") {
          const old = parse(itemSchema, JSON.parse(await this.#run(a, ["item", "get", id])));
          if (old.id !== id || !old.urls?.some((u) => this.#matches(site, u.href)))
            throw new VaultError("denied");
        }
        const template = {
          category: "LOGIN",
          title: value.title,
          urls: [{ href: site, primary: true }],
          fields: [
            { id: "username", type: "STRING", purpose: "USERNAME", value: value.username },
            { id: "password", type: "CONCEALED", purpose: "PASSWORD", value: value.password },
          ],
        };
        const saved = parse(
          itemSchema,
          JSON.parse(
            await this.#run(
              a,
              id === "new" ? ["item", "create", "-"] : ["item", "edit", id],
              JSON.stringify(template),
            ),
          ),
        );
        if (id !== "new" && saved.id !== id) throw new VaultError("invalid");
        return this.#ref(a, saved.id);
      }),
    );
  }
}
