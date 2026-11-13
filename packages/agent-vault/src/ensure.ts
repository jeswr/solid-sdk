// AUTHORED-BY Codex GPT-6.1-Sol
import type { LoginItem, SecretBackend, SecretRef } from "./backends/types.js";
import { acceptCapture, type SessionCapture } from "./capture.js";
import type { PermissionPolicy } from "./permission.js";
import { type AccountResolution, type PersonaContext, PersonaResolver } from "./persona.js";
import type { Account, AccountRoute, Profiles } from "./profiles.js";
import { boundary, origin, Secret, VaultError } from "./safe.js";
import type { SessionBundle, SessionStore } from "./sessions.js";
export interface LoginRequest {
  site: string;
  account: Account;
  route: AccountRoute;
  sessions: SessionStore;
}
export type PasswordLogin = (
  request: LoginRequest & { credentials: Secret<LoginItem>; otp: () => Promise<Secret<string>> },
) => Promise<Secret<SessionCapture>> | Promise<void>;
export type InteractiveLogin = (
  request: LoginRequest & { otp?: Secret<string> },
) => Promise<Secret<SessionCapture>>;
export interface EnsureContext extends PersonaContext {
  credentials?: Secret<LoginItem>;
}
export type EnsureResult =
  | { session: SessionBundle; account: Account; save?: "saved" | "declined" | "denied" | "failed" }
  | Extract<AccountResolution, { ask: unknown }>;
export interface VaultOptions {
  profiles: Profiles;
  sessions: SessionStore;
  permissions: PermissionPolicy;
  backends: readonly SecretBackend[];
  passwordLogin: PasswordLogin;
  interactiveLogin: InteractiveLogin;
  askOtp?: (request: { site: string; account: Account }) => Promise<Secret<string>>;
  offerSave?: (request: {
    site: string;
    account: Account;
    backends: string[];
  }) => Promise<{ backend: string; ref?: string } | undefined>;
  now?: () => number;
}
export class AgentVault {
  readonly #options: VaultOptions;
  readonly #inflight = new Map<string, Promise<EnsureResult>>();
  constructor(options: VaultOptions) {
    this.#options = options;
    if (new Set(options.backends.map((b) => b.id)).size !== options.backends.length)
      throw new VaultError("invalid");
  }
  ensureSession(site: string, context: EnsureContext = {}): Promise<EnsureResult> {
    return boundary(async () => {
      const s = origin(site);
      const resolved = new PersonaResolver(this.#options.profiles).resolveAccount(s, context);
      if ("ask" in resolved) return resolved;
      const key = JSON.stringify([s, resolved.account.id]);
      const running = this.#inflight.get(key);
      if (running) return running;
      const task = this.#ensure(s, resolved.account, context);
      this.#inflight.set(key, task);
      try {
        return await task;
      } finally {
        this.#inflight.delete(key);
      }
    });
  }
  async #ensure(site: string, account: Account, context: EnsureContext): Promise<EnsureResult> {
    const o = this.#options;
    const route = o.profiles.route(site, account.id);
    const matchesRoute = (bundle: SessionBundle) =>
      !route?.sessionCookies?.length ||
      !!bundle.headers?.authorization ||
      route.sessionCookies.some((name) => bundle.cookies.some((c) => c.name === name));
    const existing = await o.sessions.get(site, account.id);
    if (existing && matchesRoute(existing)) return { session: existing, account };
    if (!route) throw new VaultError("missing");
    const request = { site, account, route, sessions: o.sessions };
    let selected: { backend: SecretBackend; ref: SecretRef } | undefined;
    const select = async () => {
      if (selected) return selected;
      if (
        !account.item &&
        o.profiles.accounts(site).filter((a) => a.profile === account.profile).length > 1
      )
        throw new VaultError("ambiguous");
      const matches: { backend: SecretBackend; ref: SecretRef }[] = [];
      for (const backend of o.backends) {
        if (account.backend && backend.id !== account.backend) continue;
        for (const ref of await backend.find(site))
          if (
            ref.backend === backend.id &&
            ref.profile === account.profile &&
            (!account.item || ref.ref === account.item)
          )
            matches.push({ backend, ref });
      }
      if (matches.length !== 1 || !matches[0])
        throw new VaultError(matches.length ? "ambiguous" : "missing");
      selected = matches[0];
      return selected;
    };
    const otp = async (): Promise<Secret<string>> => {
      // A person-entered password need not have a password-manager item.
      if (!context.credentials || account.backend || account.item) {
        let match: Awaited<ReturnType<typeof select>> | undefined;
        try {
          match = await select();
        } catch (e) {
          if (!(e instanceof VaultError && e.code === "missing" && o.askOtp)) throw e;
        }
        if (match?.backend.totp) {
          const { backend, ref } = match;
          await o.permissions.check(
            { site, account: account.id, backend: backend.id, purpose: "totp" },
            ref.ref,
          );
          return match.backend.totp(ref.ref);
        }
      }
      if (!o.askOtp) throw new VaultError("missing");
      return o.askOtp({ site, account });
    };
    let capture: Secret<SessionCapture> | undefined;
    try {
      if (route.method === "password") {
        let credential = context.credentials;
        if (!credential) {
          const { backend, ref } = await select();
          await o.permissions.check(
            { site, account: account.id, backend: backend.id, purpose: "login" },
            ref.ref,
          );
          credential = await backend.read(ref.ref, "login");
        }
        await credential.use((c) => {
          const credentialSite = origin(c.site);
          if (credentialSite !== site && !selected?.backend.allowsOrigin?.(site, credentialSite))
            throw new VaultError("invalid");
        });
        await o.sessions.beginLogin(site, account.id);
        capture =
          (await o.passwordLogin({ ...request, credentials: credential, otp })) || undefined;
      } else
        capture = await o.interactiveLogin({
          ...request,
          ...(route.method === "otp" ? { otp: await otp() } : {}),
        });
      if (capture) await acceptCapture(o.sessions, capture, { site, account: account.id }, o.now);
      const session = await o.sessions.get(site, account.id);
      if (!session || !matchesRoute(session)) throw new VaultError("missing");
      if (route.method === "password" && context.credentials && o.offerSave) {
        try {
          const choice = await o.offerSave({
            site,
            account,
            backends: o.backends
              .filter((b) => b.profiles?.includes(account.profile))
              .map((b) => b.id),
          });
          if (choice) {
            const backend = o.backends.find((b) => b.id === choice.backend);
            if (
              !backend?.profiles?.includes(account.profile) ||
              backend.profileFor?.(choice.ref) !== account.profile
            )
              throw new VaultError("invalid");
            await o.permissions.check(
              { site, account: account.id, backend: backend.id, purpose: "save" },
              choice.ref ?? "new",
            );
            const ref = await context.credentials.use((c) =>
              backend.save(new Secret({ ...c, ref: choice.ref })),
            );
            if (ref.profile !== account.profile || ref.backend !== backend.id)
              throw new VaultError("invalid");
            await o.profiles.putAccount({ ...account, backend: backend.id, item: ref.ref });
            return { session, account, save: "saved" };
          }
          return { session, account, save: "declined" };
        } catch (e) {
          return {
            session,
            account,
            save: e instanceof VaultError && e.code === "denied" ? "denied" : "failed",
          };
        }
      }
      return { session, account };
    } catch (e) {
      await o.sessions.stale(site, account.id);
      throw e;
    }
  }
}
