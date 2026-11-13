// AUTHORED-BY Codex GPT-6
import {
  captureOrigin,
  captureSchema,
  cookieDomainAllowed,
  NATIVE_MESSAGE_LIMIT,
  type NativeRequest,
  type NativeResult,
  nativeResultSchema,
  type SessionCapture,
} from '@jeswr/agent-vault/browser';

type Tab = { id?: number; url?: string; incognito?: boolean };
interface BrowserApi {
  tabs: { query(query: { active: boolean; currentWindow: boolean }): Promise<Tab[]> };
  permissions: { request(permissions: { origins: string[] }): Promise<boolean> };
  cookies: { getAll(details: { url: string }): Promise<chrome.cookies.Cookie[]> };
}
export type VaultRequest = NativeRequest extends infer R
  ? R extends NativeRequest
    ? Omit<R, 'id'>
    : never
  : never;
type Choices = Extract<NativeResult, { type: 'list' }>;
const failed = () => new Error('Sign-in sharing unavailable. Review the site and try again.');

/** Only cookies for the chosen host, or an explicitly vetted parent, survive the browser query. */
export function captureCookies(
  site: string,
  input: chrome.cookies.Cookie[],
  parents: readonly string[],
  now: number,
): SessionCapture['cookies'] {
  const url = new URL(captureOrigin(site));
  const cookies: SessionCapture['cookies'] = [];
  for (const c of input) {
    const domain = c.domain.replace(/^\./, '').toLowerCase();
    if (
      c.partitionKey ||
      !cookieDomainAllowed(url.hostname, domain, c.hostOnly, parents) ||
      (c.secure && url.protocol !== 'https:') ||
      (!c.session && (c.expirationDate === undefined || c.expirationDate * 1000 <= now))
    )
      continue;
    const sameSite =
      c.sameSite === 'strict'
        ? 'Strict'
        : c.sameSite === 'lax'
          ? 'Lax'
          : c.sameSite === 'no_restriction'
            ? 'None'
            : undefined;
    cookies.push({
      name: c.name,
      value: c.value,
      domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      hostOnly: c.hostOnly,
      ...(sameSite ? { sameSite } : {}),
      expires: c.session ? -1 : c.expirationDate,
    });
  }
  const result = captureSchema.safeParse({ site, cookies, capturedAt: now });
  if (!result.success) throw failed();
  return result.data.cookies;
}
export class AgentSignIn {
  #tab: { id: number; site: string } | undefined;
  #choices: Choices | undefined;
  #pending: { token: string; message: SessionCapture } | undefined;
  #version = 0;
  #busy = false;
  constructor(
    readonly browser: BrowserApi,
    readonly transport: (request: VaultRequest) => Promise<unknown>,
    readonly now: () => number = Date.now,
  ) {}
  async #request(request: VaultRequest): Promise<NativeResult> {
    try {
      const response = nativeResultSchema.safeParse(await this.transport(request));
      if (!response.success || response.data.type !== request.type) throw 0;
      return response.data;
    } catch {
      throw failed();
    }
  }
  async #active() {
    try {
      const [tab] = await this.browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || tab.id === undefined || tab.incognito) throw failed();
      const url = new URL(tab.url);
      const site = captureOrigin(url.origin);
      if (url.username || url.password) throw failed();
      return { id: tab.id, site, url: `${site}${url.pathname}` };
    } catch {
      throw failed();
    }
  }
  async load(): Promise<{ site: string; choices: Choices }> {
    this.cancel();
    this.#tab = undefined;
    this.#choices = undefined;
    const tab = await this.#active();
    const result = await this.#request({ type: 'list', site: tab.site });
    if (result.type !== 'list') throw failed();
    this.#tab = tab;
    this.#choices = result;
    return { site: tab.site, choices: result };
  }
  /** Called directly from the review click: permissions.request precedes the first await. */
  async review(profile: string, persona: string) {
    if (this.#busy) throw failed();
    this.cancel();
    const version = this.#version;
    const tab = this.#tab;
    const choices = this.#choices;
    const account = choices?.personas.find((a) => a.id === persona && a.profile === profile);
    const selectedProfile = choices?.profiles.find((p) => p.id === profile);
    if (!tab || !choices || !account || !selectedProfile) throw failed();
    this.#busy = true;
    try {
      const url = new URL(tab.site);
      const pattern = `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}/*`;
      if (!(await this.browser.permissions.request({ origins: [pattern] }))) throw failed();
      const current = await this.#active();
      if (current.id !== tab.id || current.site !== tab.site || version !== this.#version)
        throw failed();
      const begun = await this.#request({ type: 'beginLogin', site: tab.site, persona, profile });
      if (begun.type !== 'beginLogin') throw failed();
      const cookies = captureCookies(
        tab.site,
        await this.browser.cookies.getAll({ url: current.url }),
        choices.cookieDomains,
        this.now(),
      );
      const checked = await this.#active();
      if (
        version !== this.#version ||
        checked.id !== tab.id ||
        checked.site !== tab.site ||
        !cookies.length
      )
        throw failed();
      this.#pending = {
        token: begun.token,
        message: { site: tab.site, account: persona, cookies, capturedAt: this.now() },
      };
      return {
        site: tab.site,
        count: cookies.length,
        persona: account.label,
        profile: selectedProfile.label,
      };
    } catch {
      this.#pending = undefined;
      throw failed();
    } finally {
      this.#busy = false;
    }
  }
  cancel(): void {
    this.#version++;
    this.#pending = undefined;
  }
  async share(): Promise<void> {
    const pending = this.#pending;
    this.#pending = undefined;
    const version = this.#version;
    if (!pending || this.#busy) throw failed();
    this.#busy = true;
    try {
      const tab = await this.#active();
      if (
        version !== this.#version ||
        tab.id !== this.#tab?.id ||
        tab.site !== pending.message.site ||
        this.now() - pending.message.capturedAt >= 300000
      )
        throw failed();
      const request = { type: 'capture' as const, ...pending };
      if (new TextEncoder().encode(JSON.stringify(request)).byteLength > NATIVE_MESSAGE_LIMIT - 100)
        throw failed();
      await this.#request(request);
    } finally {
      this.#busy = false;
    }
  }
}
