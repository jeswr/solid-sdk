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
import {
  CAPTURE_PERMISSION_PORT,
  captureOriginPermission,
  capturePermissions,
  releaseCapturePermissions,
} from '../shared/agent-capture-permissions';

type Tab = { id?: number; url?: string; incognito?: boolean };
interface BrowserApi {
  tabs: { query(query: { active: boolean; currentWindow: boolean }): Promise<Tab[]> };
  permissions: {
    contains(permissions: chrome.permissions.Permissions): Promise<boolean>;
    request(permissions: chrome.permissions.Permissions): Promise<boolean>;
    remove(permissions: chrome.permissions.Permissions): Promise<boolean>;
  };
  runtime: {
    connect(info: { name: string }): {
      postMessage(message: unknown): void;
      disconnect(): void;
      onDisconnect: { addListener(listener: () => void): void };
    };
  };
  cookies: { getAll(details: { url: string }): Promise<chrome.cookies.Cookie[]> };
}
export type VaultRequest = NativeRequest extends infer R
  ? R extends NativeRequest
    ? Omit<R, 'id'>
    : never
  : never;
type Choices = Extract<NativeResult, { type: 'list' }>;
const failed = () => new Error('Sign-in sharing unavailable. Review the site and try again.');
export class AgentSiteAccessRequired extends Error {
  constructor() {
    super("Allow this extension on this site from Chrome's extension menu first, then try again.");
  }
}
export class AgentCookieAccessRequired extends Error {
  constructor(message = 'Remove cookie access before sharing a sign-in.') {
    super(message);
  }
}

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
  #permissionWarning = false;
  #permissionPort: ReturnType<BrowserApi['runtime']['connect']> | undefined;
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
  get permissionWarning(): boolean {
    return this.#permissionWarning;
  }
  async #checkCookieAccess(): Promise<boolean> {
    try {
      this.#permissionWarning = await this.browser.permissions.contains(capturePermissions());
    } catch {
      // Sharing requires confirmed absence, even when Chrome cannot report its state.
      this.#permissionWarning = true;
    }
    return this.#permissionWarning;
  }
  async #requireHost(site: string): Promise<void> {
    let granted: boolean;
    try {
      granted = await this.browser.permissions.contains(captureOriginPermission(site));
    } catch {
      throw failed();
    }
    if (!granted) throw new AgentSiteAccessRequired();
  }
  async #removePermissions(): Promise<void> {
    try {
      await releaseCapturePermissions(this.browser.permissions);
      this.#permissionWarning = false;
    } catch {
      this.#permissionWarning = true;
    }
  }
  /** Only the warning's explicit removal click may clear a grant found before capture. */
  async removeCookieAccess(): Promise<boolean> {
    if (this.#busy) throw failed();
    this.cancel();
    this.#busy = true;
    try {
      await this.#removePermissions();
      return !this.#permissionWarning;
    } finally {
      this.#busy = false;
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
    // Check independently of tab/site validation, so failures cannot hide surviving authority.
    const cookieAccess = await this.#checkCookieAccess();
    const tab = await this.#active();
    await this.#requireHost(tab.site);
    if (cookieAccess) throw new AgentCookieAccessRequired();
    const result = await this.#request({ type: 'list', site: tab.site });
    if (result.type !== 'list') throw failed();
    this.#tab = tab;
    this.#choices = result;
    return { site: tab.site, choices: result };
  }
  /** Called from the review click; check existing host access before requesting only cookies. */
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
    let cleanup = false;
    try {
      await this.#requireHost(tab.site);
      if (await this.#checkCookieAccess()) throw new AgentCookieAccessRequired();
      if (version !== this.#version) throw failed();
      const port = this.browser.runtime.connect({ name: CAPTURE_PERMISSION_PORT });
      this.#permissionPort = port;
      port.onDisconnect.addListener(() => {
        if (this.#permissionPort === port) this.cancel();
      });
      port.postMessage({ site: tab.site });
      cleanup = true;
      if (!(await this.browser.permissions.request(capturePermissions()))) throw failed();
      const current = await this.#active();
      if (current.id !== tab.id || current.site !== tab.site || version !== this.#version)
        throw failed();
      const begun = await this.#request({ type: 'beginLogin', site: tab.site, persona, profile });
      if (begun.type !== 'beginLogin' || version !== this.#version) throw failed();
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
    } catch (error) {
      this.#pending = undefined;
      if (error instanceof AgentSiteAccessRequired || error instanceof AgentCookieAccessRequired)
        throw error;
      throw failed();
    } finally {
      // The preview retains only its in-memory snapshot; browser authority ends after reading.
      try {
        if (cleanup) await this.#removePermissions();
      } finally {
        const port = this.#permissionPort;
        this.#permissionPort = undefined;
        port?.disconnect();
        this.#busy = false;
      }
    }
  }
  cancel(): void {
    this.#version++;
    this.#pending = undefined;
    const port = this.#permissionPort;
    this.#permissionPort = undefined;
    port?.disconnect();
  }
  async share(): Promise<void> {
    const pending = this.#pending;
    this.#pending = undefined;
    const version = this.#version;
    if (!pending || this.#busy) throw failed();
    this.#busy = true;
    try {
      // Review has already released its grant. Any authority now is unexpected (e.g. a late
      // prompt), so refuse this snapshot and clean up rather than sending a capture.
      if (await this.#checkCookieAccess()) {
        await this.#removePermissions();
        throw new AgentCookieAccessRequired(
          'Cookie access appeared after review. Sharing refused. Review again to retry.',
        );
      }
      await this.#requireHost(pending.message.site);
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
