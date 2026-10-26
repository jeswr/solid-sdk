#!/usr/bin/env node
/**
 * awp-credentials — the provider credential helper (docs/PROVIDER-SETUP.md).
 *
 * Human-facing commands (safe output: never a token or client secret):
 *   client google --client-file FILE | client microsoft --client-id ID
 *   profile add --name N --provider google|microsoft --connection ID --account ADDRESS
 *               [--calendar-inventory] [--account-type personal|work-or-school] [--tenant T]
 *   profile remove --name N
 *   login --profile N [--open] [--timeout-seconds S]      (the ONLY command that signs in)
 *   status [--json]
 *   calendars --profile N [--json]                         (explicit calendar inventory)
 *   logout --profile N [--revoke]                          (explicit operator action)
 *   provider-config --out FILE [--force]                   (config for awp-dashboard)
 * Private helper protocol (run BY the actions, output captured; refuses a terminal):
 *   token --profile N
 * Every command needs --dir DIR (or AWP_CREDENTIALS_DIR): the dedicated private directory.
 */
import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  calendars,
  DEFAULT_LOGIN_TIMEOUT_MS,
  EXIT,
  helperExchange,
  login,
  logout,
  status,
} from "./operations.js";
import { GOOGLE, requestedScopes, type Transport } from "./providers.js";
import { CredentialStore, HelperError, NAME, type Profile, writeFully } from "./store.js";

export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** The helper request (token mode only). */
  readStdin?: () => Promise<string>;
  /** Whether stdout is a terminal (token mode refuses one). */
  stdoutIsTTY?: boolean;
  transport?: Transport;
  now?: () => Date;
  /** Opens a URL in a browser (login --open). */
  openBrowser?: (url: string) => void;
  env?: Record<string, string | undefined>;
}

const MAX_STDIN = 8 * 1024;
const MAX_CLIENT_FILE = 64 * 1024;

function readProcessStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(
      () => reject(new HelperError("invalid", "no request on stdin")),
      5_000,
    );
    process.stdin.on("data", (d: Buffer) => {
      size += d.byteLength;
      if (size > MAX_STDIN) {
        clearTimeout(timer);
        reject(new HelperError("invalid", "request too large"));
        process.stdin.destroy();
      } else chunks.push(d);
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      reject(new HelperError("invalid", "stdin could not be read"));
    });
  });
}

function defaultOpen(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(cmd, [url], { stdio: "ignore", shell: false, detached: false });
  child.on("error", () => undefined);
  child.unref();
}

/** Import the Google "Desktop app" client JSON from an explicit path (no searching). */
function readGoogleClientFile(path: string): { clientId: string; clientSecret?: string } {
  if (!isAbsolute(path)) throw new HelperError("invalid", "--client-file must be an absolute path");
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink())
    throw new HelperError("refused", "--client-file must be a regular file (not a link)");
  if (st.size > MAX_CLIENT_FILE) throw new HelperError("invalid", "--client-file is too large");
  let raw: { installed?: Record<string, unknown>; web?: unknown };
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new HelperError("invalid", "--client-file is not JSON");
  }
  if (!raw.installed)
    throw new HelperError(
      "invalid",
      "--client-file is not a Google 'Desktop app' client (expected an \"installed\" section)",
    );
  const i = raw.installed;
  if (typeof i.token_uri === "string" && i.token_uri !== GOOGLE.token)
    throw new HelperError("refused", "--client-file names an unexpected token endpoint (refused)");
  if (typeof i.client_id !== "string")
    throw new HelperError("invalid", "--client-file has no client_id");
  return {
    clientId: i.client_id,
    ...(typeof i.client_secret === "string" ? { clientSecret: i.client_secret } : {}),
  };
}

function writePrivateFile(path: string, text: string, force: boolean): void {
  if (!isAbsolute(path)) throw new HelperError("invalid", "--out must be an absolute path");
  let exists = false;
  try {
    const st = lstatSync(path);
    exists = true;
    if (st.isSymbolicLink() || !st.isFile())
      throw new HelperError("refused", "--out exists and is not a regular file");
  } catch (error) {
    if (error instanceof HelperError) throw error;
  }
  if (exists && !force)
    throw new HelperError("refused", "--out exists (use --force to replace it)");
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFully(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean
    }
    try {
      closeSync(fd);
    } catch {
      // already closed
    }
    throw error;
  }
}

/**
 * Grants are bound to the client they were issued to. Replacing a registered client with a
 * DIFFERENT one while grants of it exist needs --force, and those grants are then unusable until
 * their profiles log in again (they never migrate silently).
 */
function guardClientReplacement(
  store: CredentialStore,
  provider: "google" | "microsoft",
  clientId: string,
  force: boolean,
): string {
  const current = provider === "google" ? store.googleClient() : store.microsoftClient();
  if (!current || current.clientId === clientId) return "";
  const affected = store.profiles().filter((n) => {
    try {
      const g = store.grant(n);
      return g?.provider === provider && g.clientId !== clientId;
    } catch {
      return false;
    }
  });
  if (affected.length === 0) return "";
  if (!force)
    throw new HelperError(
      "refused",
      `a different ${provider} client is registered and ${affected.length} grant(s) were issued to it (${affected.join(", ")}); replacing it makes them unusable until those profiles log in again — rerun with --force to do that`,
    );
  return `\nThe previous client was replaced: these profiles must log in again: ${affected.join(", ")}.`;
}

const describeScopes = (p: Profile) =>
  requestedScopes(p)
    .map((s) => `  ${s}`)
    .join("\n");

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const env = io.env ?? process.env;
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.stderr(`awp-credentials: ${(error as Error).message.split("\n")[0]} (see: help)\n`);
    return 1;
  }
  const { values, positionals } = parsed;
  const [command, sub] = positionals;
  const print = (s: string) => io.stdout(`${s}\n`);
  if (command === "help" || values.help || command === undefined) {
    print(USAGE);
    return command === undefined && !values.help ? 1 : 0;
  }
  try {
    return await run(values, command, sub, env, io, print);
  } catch (error) {
    const message =
      error instanceof HelperError
        ? error.message
        : (error as NodeJS.ErrnoException).code
          ? `file system error (${(error as NodeJS.ErrnoException).code})`
          : "unexpected failure";
    io.stderr(`awp-credentials: ${message}\n`);
    if (command === "token")
      return error instanceof HelperError && error.code === "refused"
        ? EXIT.refused
        : EXIT.unavailable;
    return 1;
  }
}

const USAGE = `awp-credentials — provider credential helper (docs/PROVIDER-SETUP.md)

Every command needs --dir DIR (absolute; or AWP_CREDENTIALS_DIR). None prints a token or secret.
  client google --client-file FILE        register the Google Desktop-app client
  client microsoft --client-id GUID       register the Microsoft public client
     (replacing a client that existing grants were issued to needs --force)
  profile add --name N --provider google|microsoft --connection ID --account ADDRESS
              [--calendar-inventory] [--account-type personal|work-or-school] [--tenant T]
  profile remove --name N
  login --profile N [--open] [--timeout-seconds S]   the only command that signs in
  status [--json]
  calendars --profile N [--json]
  provider-config --out FILE [--force]
  logout --profile N [--revoke]
  help
Private protocol, run by the actions only (refuses a terminal): token --profile N`;

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      "client-file": { type: "string" },
      "client-id": { type: "string" },
      name: { type: "string" },
      provider: { type: "string" },
      connection: { type: "string" },
      account: { type: "string" },
      "calendar-inventory": { type: "boolean" },
      "account-type": { type: "string" },
      tenant: { type: "string" },
      profile: { type: "string" },
      open: { type: "boolean" },
      "timeout-seconds": { type: "string" },
      json: { type: "boolean" },
      revoke: { type: "boolean" },
      out: { type: "string" },
      force: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
}

async function run(
  values: ReturnType<typeof parse>["values"],
  command: string,
  sub: string | undefined,
  env: Record<string, string | undefined>,
  io: CliIo,
  print: (s: string) => void,
): Promise<number> {
  {
    const dir = values.dir ?? env.AWP_CREDENTIALS_DIR;
    if (!dir) throw new HelperError("invalid", "--dir DIR (or AWP_CREDENTIALS_DIR) is required");
    // Token mode first: its stdout is the private protocol and must never reach a terminal.
    if (command === "token" && io.stdoutIsTTY)
      throw new HelperError(
        "refused",
        "token mode prints a secret and only runs with its output captured by the actions (not in a terminal)",
      );
    const store = new CredentialStore(dir);
    const deps = {
      store,
      transport: io.transport ?? (globalThis.fetch as Transport),
      now: io.now ?? (() => new Date()),
    };
    const profileName = () => {
      const n = values.profile ?? values.name;
      if (!n || !NAME.test(n)) throw new HelperError("invalid", "--profile NAME is required");
      return n;
    };
    switch (command) {
      case "client": {
        if (sub === "google") {
          const file = values["client-file"];
          if (!file) throw new HelperError("invalid", "--client-file FILE is required");
          const c = readGoogleClientFile(file);
          const note = guardClientReplacement(store, "google", c.clientId, values.force === true);
          store.putClient({
            version: 1,
            provider: "google",
            clientId: c.clientId,
            ...(c.clientSecret ? { clientSecret: c.clientSecret } : {}),
            importedFrom: basename(file),
            importedAt: deps.now().toISOString(),
          });
          print(
            `Registered the Google OAuth client (…${c.clientId.split(".")[0]?.slice(-6)}); its secret is stored privately and not shown.\nThis registers the app only: no account has consented. Next: profile add, then login.${note}`,
          );
          return 0;
        }
        if (sub === "microsoft") {
          const id = values["client-id"];
          if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
            throw new HelperError("invalid", "--client-id must be the app's (client) id, a GUID");
          const note = guardClientReplacement(
            store,
            "microsoft",
            id.toLowerCase(),
            values.force === true,
          );
          store.putClient({
            version: 1,
            provider: "microsoft",
            clientId: id.toLowerCase(),
            addedAt: deps.now().toISOString(),
          });
          print(
            `Registered the Microsoft app (public client, no secret). This registers the app only: no account has consented. Next: profile add, then login.${note}`,
          );
          return 0;
        }
        throw new HelperError("invalid", "client google|microsoft");
      }
      case "profile": {
        const name = profileName();
        if (sub === "remove") {
          if (store.grant(name))
            throw new HelperError("refused", "this profile has a grant; run logout first");
          if (!store.profile(name)) throw new HelperError("setup", `no profile “${name}”`);
          unlinkSync(`${store.dir}/profiles/${name}.json`);
          print(`Removed profile ${name}.`);
          return 0;
        }
        if (sub !== "add") throw new HelperError("invalid", "profile add|remove");
        if (store.profile(name))
          throw new HelperError(
            "refused",
            `profile “${name}” exists (profiles are not overwritten)`,
          );
        const provider = values.provider;
        if (provider !== "google" && provider !== "microsoft")
          throw new HelperError("invalid", "--provider google|microsoft is required");
        const connectionId = values.connection ?? "";
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(connectionId))
          throw new HelperError(
            "invalid",
            "--connection must be the dashboard account (connection) id",
          );
        const account = (values.account ?? "").toLowerCase();
        if (!/^[^\s@<>"]{1,64}@[^\s@<>"]+\.[^\s@<>"]+$/.test(account) || account.length > 254)
          throw new HelperError("invalid", "--account must be the exact account address");
        let microsoft: Profile["microsoft"];
        if (provider === "microsoft") {
          const type = values["account-type"];
          if (type === "personal") microsoft = { accountType: "personal", tenant: "consumers" };
          else if (type === "work-or-school") {
            const tenant = (values.tenant ?? "organizations").toLowerCase();
            if (
              tenant !== "organizations" &&
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tenant)
            )
              throw new HelperError(
                "invalid",
                "--tenant must be organizations or a tenant id (GUID)",
              );
            microsoft = { accountType: "work-or-school", tenant };
          } else
            throw new HelperError(
              "invalid",
              "--account-type personal|work-or-school is required for Microsoft",
            );
        } else if (values["account-type"] || values.tenant)
          throw new HelperError("invalid", "--account-type/--tenant are for Microsoft profiles");
        const p: Profile = {
          version: 1,
          name,
          provider,
          connectionId,
          account,
          inventory: provider === "google" && values["calendar-inventory"] === true,
          ...(microsoft ? { microsoft } : {}),
          createdAt: deps.now().toISOString(),
        };
        store.putProfile(p);
        print(
          `Created profile ${name} (${provider}, dashboard account ${connectionId}, chosen account ${account}).\nScopes that login will request:\n${describeScopes(p)}`,
        );
        return 0;
      }
      case "login": {
        const name = profileName();
        const seconds = values["timeout-seconds"] ? Number(values["timeout-seconds"]) : undefined;
        if (
          seconds !== undefined &&
          !(Number.isInteger(seconds) && seconds >= 10 && seconds <= 900)
        )
          throw new HelperError("invalid", "--timeout-seconds must be 10–900");
        const timeoutMs = seconds ? seconds * 1000 : DEFAULT_LOGIN_TIMEOUT_MS;
        const r = await login(deps, name, {
          timeoutMs,
          onUrl: (url) => {
            const p = store.profile(name) as Profile;
            print(
              `Sign in as ${p.account} (${p.provider}). Open this address in a browser:\n\n${url}\n\nWaiting up to ${Math.round(timeoutMs / 1000)} s for the response on ${new URL(url).searchParams.get("redirect_uri")} (this computer only).`,
            );
            if (values.open) {
              try {
                (io.openBrowser ?? defaultOpen)(url);
              } catch {
                print("Could not open a browser; open the address yourself.");
              }
            }
          },
        });
        print(
          [
            `Signed in: ${r.account.username} (verified from the provider's signed ID token; the account is now pinned to this profile).`,
            `Granted: ${r.grantedScopes.join(" ")}`,
            ...(r.extraScopes.length
              ? [
                  `Note: the grant also carries ${r.extraScopes.join(" ")} (not requested by this helper and never used by it).`,
                ]
              : []),
            r.replacedExisting ? "The previous grant of this same account was replaced." : "",
            "The consent stays at the provider until it is revoked (see: logout).",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return 0;
      }
      case "status": {
        const s = status(store, requestedScopes);
        if (values.json) {
          print(JSON.stringify(s, null, 2));
          return 0;
        }
        print(`Credential directory: ${store.dir}`);
        print(`Google client: ${s.clients.google}`);
        print(`Microsoft client: ${s.clients.microsoft}`);
        if (s.profiles.length === 0) print("No profiles.");
        for (const p of s.profiles) {
          print(`\nProfile ${p.profile}: ${p.provider}, dashboard account ${p.connectionId}`);
          print(
            `  chosen account: ${p.chosenAccount}${p.accountType ? ` — ${p.accountType}` : ""}`,
          );
          print(`  client: ${p.client}`);
          const g = p.grant;
          if (g.state === "none") print("  grant: none (no consent yet: run login)");
          else if (g.state === "unreadable") print(`  grant: UNREADABLE — ${g.problem}`);
          else {
            print(`  grant: ${g.state}${g.problem ? ` — ${g.problem}` : ""}`);
            print(`  verified account: ${g.verifiedAccount} (subject pinned)`);
            if (g.binding !== "ok") print(`  NOT USED: ${g.binding}`);
            print(`  granted scopes: ${g.grantedScopes.join(" ")}`);
            print(
              `  refresh token: ${g.refreshToken}; cached access token valid until: ${g.accessTokenValidUntil ?? "none"}`,
            );
          }
        }
        return 0;
      }
      case "calendars": {
        const list = await calendars(deps, profileName());
        if (values.json) print(JSON.stringify(list, null, 2));
        else
          for (const c of list)
            print(`${c.primary ? "* " : "  "}${c.id}\t${c.name}\t${c.accessRole}`);
        return 0;
      }
      case "logout": {
        const r = await logout(deps, profileName(), values.revoke === true);
        print(`${r.removed ? "Local grant removed." : "No local grant."} ${r.remains}`);
        return 0;
      }
      case "provider-config": {
        const out = values.out;
        if (!out) throw new HelperError("invalid", "--out FILE is required");
        const cli = fileURLToPath(import.meta.url);
        const accounts = store.profiles().map((name) => {
          const p = store.profile(name) as Profile;
          const args = [cli, "--dir", store.dir, "token", "--profile", name];
          if (args.some((a) => a.length > 200))
            throw new HelperError(
              "invalid",
              "a path is longer than the provider configuration allows",
            );
          return {
            connectionId: p.connectionId,
            provider: p.provider,
            credential: { type: "helper", command: process.execPath, args },
          };
        });
        writePrivateFile(
          out,
          `${JSON.stringify({ version: 1, accounts }, null, 2)}\n`,
          values.force === true,
        );
        print(
          `Wrote ${out} (${accounts.length} account(s); no secrets). Use it with: awp-dashboard serve|actions … --provider-config ${out}`,
        );
        return 0;
      }
      case "token": {
        const name = profileName();
        const request = await (io.readStdin ?? readProcessStdin)();
        const r = await helperExchange(deps, name, request);
        if (r.stdout !== undefined) io.stdout(r.stdout);
        else io.stderr(`awp-credentials token: ${r.problem ?? "failed"}\n`);
        return r.exit;
      }
      default:
        throw new HelperError(
          "invalid",
          "commands: client, profile, login, status, calendars, logout, provider-config, help",
        );
    }
  }
}

const isMain =
  process.argv[1] !== undefined &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    stdoutIsTTY: process.stdout.isTTY === true,
  }).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    },
  );
}
