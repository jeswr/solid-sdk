// AUTHORED-BY Codex GPT-6.1-Sol
import { applySetCookies, cookieHeader, cookiesFor, jsonPointer } from "@jeswr/site-executor";
import type { LoginRoute } from "@jeswr/site-model";
import { boundary, origin, sameSiteUrl, VaultError } from "./safe.js";
import type { SessionState, SessionStore } from "./sessions.js";
export interface ClockTimer {
  now(): number;
  set(callback: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}
export type VaultFetch = (
  url: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    redirect: "manual";
  },
) => Promise<{ status: number; text(): Promise<string>; setCookies?: string[] }>;
export class KeepAlive {
  readonly #store: SessionStore;
  readonly #clock: ClockTimer;
  readonly #transport: VaultFetch;
  readonly #floor: number;
  readonly #lead: number;
  readonly #jobs = new Map<string, { cancelled: boolean; handle?: unknown }>();
  constructor(options: {
    sessions: SessionStore;
    clock: ClockTimer;
    transport: VaultFetch;
    floorMs?: number;
    leadMs?: number;
  }) {
    this.#store = options.sessions;
    this.#clock = options.clock;
    this.#transport = options.transport;
    this.#floor = Math.max(30000, options.floorMs ?? 60000);
    this.#lead = Math.max(0, options.leadMs ?? 60000);
    if (!Number.isFinite(this.#floor) || this.#floor > 2147483647 || !Number.isFinite(this.#lead))
      throw new VaultError("invalid");
  }
  stop(site: string, account: string) {
    const key = JSON.stringify([origin(site), account]);
    const j = this.#jobs.get(key);
    if (j) {
      j.cancelled = true;
      if (j.handle !== undefined) this.#clock.clear(j.handle);
      this.#jobs.delete(key);
    }
  }
  start(
    site: string,
    account: string,
    route: LoginRoute,
    options: { frequent?: boolean; intervalMs?: number } = {},
  ): Promise<void> {
    return boundary(async () => {
      site = origin(site);
      if (route.refresh) sameSiteUrl(site, route.refresh.urlTemplate);
      if (route.probeUrl) sameSiteUrl(site, route.probeUrl);
      const interval = Math.max(this.#floor, options.intervalMs ?? 300000);
      if (!Number.isFinite(interval)) throw new VaultError("invalid");
      this.stop(site, account);
      const key = JSON.stringify([origin(site), account]);
      const job: { cancelled: boolean; handle?: unknown } = { cancelled: false };
      this.#jobs.set(key, job);
      let failures = 0;
      const schedule = async () => {
        if (job.cancelled) return;
        const state = await this.#store.state(site, account);
        let delay: number | undefined;
        if (state)
          await state.use((r) => {
            if (r.stale) return;
            if (r.tokens?.refresh && route.refresh)
              delay = Math.max(this.#floor, r.tokens.expiresAt - this.#clock.now() - this.#lead);
            if (options.frequent && route.probeUrl) delay = Math.min(delay ?? interval, interval);
          });
        if (delay === undefined || job.cancelled) return;
        delay = Math.max(delay, Math.min(3600000, this.#floor * 2 ** Math.min(failures, 10)));
        delay = Math.min(delay, 2147483647);
        job.handle = this.#clock.set(() => {
          void tick();
        }, delay);
      };
      const tick = async () => {
        if (job.cancelled) return;
        try {
          const state = await this.#store.state(site, account);
          if (!state) return;
          await state.use(async (r) => {
            if (r.stale) return;
            if (
              r.tokens?.refresh &&
              route.refresh &&
              r.tokens.expiresAt - this.#clock.now() <= this.#lead
            )
              await this.#refresh(r, route, () => job.cancelled);
            else if (options.frequent && route.probeUrl)
              await this.#probe(r, route.probeUrl, () => job.cancelled);
          });
          failures = 0;
        } catch {
          failures++;
        }
        try {
          await schedule();
        } catch {
          /* Storage failure stops this job without exposing diagnostics. */
        }
      };
      try {
        await schedule();
      } catch {
        this.stop(site, account);
        throw new VaultError("unavailable");
      }
    });
  }
  async #refresh(r: SessionState, route: LoginRoute, cancelled: () => boolean) {
    if (!r.tokens?.refresh || !route.refresh) return;
    const url = sameSiteUrl(r.site, route.refresh.urlTemplate);
    if (r.tokens.tokenEndpoint && url.href !== sameSiteUrl(r.site, r.tokens.tokenEndpoint).href)
      throw new VaultError("invalid");
    const response = await this.#transport(url.href, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: r.tokens.refresh,
      }).toString(),
      redirect: "manual",
    });
    if (cancelled()) return;
    if (response.status === 401) {
      await this.#store.stale(r.site, r.account);
      return;
    }
    if (response.status < 200 || response.status >= 300) throw new VaultError("unavailable");
    const text = await response.text();
    if (text.length > 65536) throw new VaultError("invalid");
    const body: unknown = JSON.parse(text);
    const token = jsonPointer(body, route.refresh.tokenPointer);
    const expires = jsonPointer(body, route.refresh.expiresInPointer ?? "/expires_in");
    if (
      typeof token !== "string" ||
      !/^[\x21-\x7e]{1,8192}$/.test(token) ||
      typeof expires !== "number" ||
      !Number.isFinite(expires) ||
      expires <= 0
    )
      throw new VaultError("invalid");
    // An expiry pointer is required to extend validity; never invent an expiry for an unknown response.
    const rotated = jsonPointer(body, "/refresh_token");
    if (
      rotated !== undefined &&
      (typeof rotated !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(rotated))
    )
      throw new VaultError("invalid");
    const tokens = {
      ...r.tokens,
      access: token,
      expiresAt: this.#clock.now() + expires * 1000,
      ...(typeof rotated === "string" ? { refresh: rotated } : {}),
    };
    if (cancelled()) return;
    await this.#store.store({ ...r, tokens });
  }
  async #probe(r: SessionState, probe: string, cancelled: () => boolean) {
    const url = sameSiteUrl(r.site, probe);
    const headers = { ...r.bundle.headers };
    if (r.tokens && r.tokens.expiresAt <= this.#clock.now()) delete headers.authorization;
    const cookies = cookieHeader(cookiesFor(r.bundle.cookies, url, new Date(this.#clock.now())));
    if (cookies) headers.cookie = cookies;
    const response = await this.#transport(url.href, {
      method: "GET",
      headers,
      redirect: "manual",
    });
    if (cancelled()) return;
    if (response.status === 401) {
      await this.#store.stale(r.site, r.account);
      return;
    }
    if (response.status < 200 || response.status >= 300) throw new VaultError("unavailable");
    if (response.setCookies?.length) {
      const merged = applySetCookies(
        r.bundle.cookies,
        response.setCookies,
        url,
        new Date(this.#clock.now()),
      );
      await this.#store.store({ ...r, bundle: { ...r.bundle, cookies: merged.jar } });
    }
  }
}
