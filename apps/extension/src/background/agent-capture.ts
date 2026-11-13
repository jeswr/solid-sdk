// AUTHORED-BY Codex GPT-6.1-Sol
import {
  captureOrigin,
  NATIVE_MESSAGE_LIMIT,
  type NativeResult,
  nativeResultSchema,
} from '@jeswr/agent-vault/browser';
import {
  type CaptureChoices,
  type CaptureView,
  captureIntent,
  type VaultRequest,
} from '../shared/agent-capture';
import {
  CAPTURE_PERMISSION_PORT,
  captureOriginPermission,
  capturePermissions,
  releaseCapturePermissions,
} from '../shared/agent-capture-permissions';
import { captureCookies } from './agent-capture-cookies';

const unavailable = 'Sign-in sharing unavailable. Review the site and try again.';
const siteAccess =
  "Allow this extension on this site from Chrome's extension menu first, then try again.";
const busy = 'Another sharing is in progress.';
type Tab = { id: number; site: string; url: string };
interface Owner {
  port: chrome.runtime.Port;
  closed: boolean;
  view: CaptureView;
  tab?: Tab;
  lastLease?: Lease;
}
interface Lease {
  id: number;
  owner: Owner;
  tab: Tab;
  phase: 'reviewing' | 'confirming' | 'sending' | 'cleaning';
  expectsCookies: boolean;
  resultReceived: boolean;
  choices: CaptureChoices;
  count?: number;
  persona: string;
  profile: string;
  requestedCookies: boolean;
  // These ingress latches fence cancellation and prompts even while the mutex awaits Chrome.
  promptStarted: boolean;
  promptPending: boolean;
  cancelled: boolean;
  stop(): void;
  stopped: Promise<never>;
  timer: ReturnType<typeof setTimeout>;
  token?: string;
}

/** One worker, one lease, one mutex for *all* Chrome/native work (including cleanup).
 * Only cancellation/prompt ingress latches run outside the mutex; they perform no I/O.
 * A cancelled outstanding prompt leaves a fence until its result/onAdded is cleaned.
 */
export function installAgentCapture(
  browser: typeof chrome,
  transport: (request: VaultRequest) => Promise<NativeResult>,
): void {
  let tail = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    tail = tail.then(work).catch(() => {
      /* Errors are rendered without browser diagnostics. */
    });
  };
  let active: Lease | undefined;
  const pendingPrompts = new Set<Lease>();
  let orphanGrant = false;
  let nextId = 0;
  let warning = false;
  let cleanupFailed = false;
  const owners = new Set<Owner>();
  const emit = (owner: Owner, update: Partial<CaptureView>) => {
    owner.view = { ...owner.view, ...update, warning, cleanupFailed };
    if (!owner.closed) {
      try {
        owner.port.postMessage(owner.view);
      } catch {
        /* onDisconnect owns cleanup. */
      }
    }
  };
  const warnings = () => {
    for (const owner of owners) emit(owner, {});
  };
  const remove = async () => {
    try {
      await releaseCapturePermissions(browser.permissions);
      warning = false;
      cleanupFailed = false;
    } catch {
      warning = true;
      cleanupFailed = true;
    }
    try {
      await browser.action.setBadgeText({ text: warning ? '!' : '' });
    } catch {
      /* No diagnostics. */
    }
    warnings();
  };
  const cookieAccess = async () => {
    try {
      return await browser.permissions.contains(capturePermissions());
    } catch {
      return undefined;
    } // Unknown authority is neither confirmed absent nor granted.
  };
  const current = async (): Promise<Tab> => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || tab.id === undefined || tab.incognito) throw new Error(unavailable);
    const url = new URL(tab.url);
    if (url.username || url.password) throw new Error(unavailable);
    const site = captureOrigin(url.origin);
    return { id: tab.id, site, url: `${site}${url.pathname}` };
  };
  const host = async (tab: Tab) => {
    if (!(await browser.permissions.contains(captureOriginPermission(tab.site))))
      throw new Error(siteAccess);
  };
  const alive = (lease: Lease) => {
    if (active !== lease || lease.cancelled || lease.owner.closed) throw new Error(unavailable);
  };
  const wait = async <T>(lease: Lease, result: Promise<T>): Promise<T> => {
    const value = await Promise.race([result, lease.stopped]);
    alive(lease);
    return value;
  };
  const validate = async (lease: Lease) => {
    alive(lease);
    const tab = await wait(lease, current());
    // Validate the CURRENT active tab before checking its existing host grant.
    await wait(lease, host(tab));
    if (tab.id !== lease.tab.id || tab.site !== lease.tab.site) throw new Error(unavailable);
    return tab;
  };
  const request = async (input: VaultRequest) => {
    const result = nativeResultSchema.safeParse(await transport(input));
    if (!result.success || result.data.type !== input.type) throw new Error(unavailable);
    return result.data;
  };
  const finish = async (
    lease: Lease,
    phase: 'failed' | 'shared' | 'cancelled',
    message: string,
  ) => {
    if (active !== lease) return;
    lease.phase = 'cleaning';
    clearTimeout(lease.timer);
    emit(lease.owner, {
      phase: lease.cancelled ? 'cancelled' : 'cleaning',
      message: lease.cancelled ? 'Sharing cancelled.' : message,
      preview: undefined,
    });
    if (lease.requestedCookies || lease.promptStarted) await remove();
    // Cancel can arrive while removal is pending. Never publish an older completion.
    emit(lease.owner, {
      phase: lease.cancelled ? 'cancelled' : phase,
      message: lease.cancelled ? 'Sharing cancelled.' : message,
    });
    active = undefined;
  };
  const cancel = (lease: Lease) => {
    if (active !== lease) return;
    lease.cancelled = true;
    lease.stop();
    emit(lease.owner, { phase: 'cancelled', message: 'Sharing cancelled.', preview: undefined });
    enqueue(() => finish(lease, 'cancelled', 'Sharing cancelled.'));
  };
  const run = async (lease: Lease, work: () => Promise<void>) => {
    try {
      alive(lease);
      await work();
    } catch (error) {
      await finish(
        lease,
        'failed',
        error instanceof Error && error.message === siteAccess ? siteAccess : unavailable,
      );
    }
  };
  const load = async (owner: Owner) => {
    if (owner.closed) return;
    // Cookie checking precedes even invalid-tab/withheld-site validation on EVERY load.
    const present = await cookieAccess();
    if (active || pendingPrompts.size || orphanGrant) {
      emit(owner, { phase: 'busy', message: busy });
      return;
    }
    warning ||= present !== false;
    emit(owner, {
      phase: 'loading',
      message: 'Loading sign-in sharing…',
      lease: undefined,
      choices: undefined,
      preview: undefined,
    });
    try {
      const tab = await current();
      await host(tab);
      if (warning) {
        emit(owner, { phase: 'failed', message: 'Remove cookie access before sharing a sign-in.' });
        return;
      }
      if (owner.closed) return;
      const choices = await request({ type: 'list', site: tab.site });
      if (choices.type !== 'list') throw 0;
      owner.tab = tab;
      emit(owner, {
        phase: 'ready',
        site: tab.site,
        choices,
        message: 'Sign in on this site, then choose your vault profile and persona.',
      });
    } catch (error) {
      emit(owner, {
        phase: 'failed',
        message:
          error instanceof Error && error.message === siteAccess
            ? siteAccess
            : 'Open a signed-in HTTPS site and install the agent vault native host to share its sign-in.',
      });
    }
  };
  const start = async (owner: Owner, profile: string, persona: string) => {
    if (owner.closed) return;
    if (active || pendingPrompts.size || orphanGrant) {
      emit(owner, { phase: 'busy', message: busy });
      return;
    }
    const choices = owner.view.choices;
    if (
      owner.view.phase !== 'ready' ||
      !owner.tab ||
      !choices?.personas.some((p) => p.id === persona && p.profile === profile) ||
      !choices.profiles.some((p) => p.id === profile)
    )
      return;
    let stop!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      stop = () => reject(new Error(unavailable));
    });
    void stopped.catch(() => {});
    const lease: Lease = {
      id: ++nextId,
      owner,
      tab: owner.tab,
      phase: 'reviewing',
      expectsCookies: false,
      resultReceived: false,
      choices,
      persona,
      profile,
      requestedCookies: false,
      promptStarted: false,
      promptPending: false,
      cancelled: false,
      stopped,
      stop,
      timer: setTimeout(() => cancel(lease), 120000),
    };
    active = lease;
    owner.lastLease = lease;
    emit(owner, { phase: 'reviewing', lease: lease.id, message: 'Checking the current site…' });
    await run(lease, async () => {
      const present = await wait(lease, cookieAccess());
      if (present !== false || warning) {
        warning = true;
        throw new Error(unavailable); // A pre-existing grant is NEVER automatically removed.
      }
      await validate(lease);
      lease.expectsCookies = true;
      emit(owner, {
        phase: 'permission',
        message: 'Click Allow cookies and review to grant temporary cookie access.',
      });
    });
  };
  const granted = async (lease: Lease, allowed: boolean) => {
    lease.promptPending = false;
    if (active !== lease) {
      // A cancelled prompt can resolve after cleanup. Keep its acquisition fence through
      // this removal; never let the grant be observed by a newer capture.
      if (pendingPrompts.has(lease)) await remove();
      pendingPrompts.delete(lease);
      return;
    }
    pendingPrompts.delete(lease);
    await run(lease, async () => {
      if (
        lease.phase !== 'reviewing' ||
        !allowed ||
        !lease.requestedCookies ||
        (await wait(lease, cookieAccess())) !== true
      )
        throw 0;
      await validate(lease); // Access withdrawn DURING the prompt cannot reach beginLogin.
      const begun = await wait(
        lease,
        request({
          type: 'beginLogin',
          site: lease.tab.site,
          persona: lease.persona,
          profile: lease.profile,
        }),
      );
      if (begun.type !== 'beginLogin') throw 0;
      lease.token = begun.token;
      const tab = await validate(lease);
      const cookies = captureCookies(
        tab.site,
        await wait(lease, browser.cookies.getAll({ url: tab.url })),
        lease.choices.cookieDomains,
        Date.now(),
      );
      await validate(lease);
      if (!cookies.length) throw 0;
      lease.phase = 'confirming';
      lease.count = cookies.length;
      emit(lease.owner, {
        phase: 'confirming',
        message: 'Review, then confirm to send to your local vault.',
        preview: {
          count: cookies.length,
          persona: lease.choices.personas.find(
            (p) => p.id === lease.persona && p.profile === lease.profile,
          )!.label,
          profile: lease.choices.profiles.find((p) => p.id === lease.profile)!.label,
        },
      });
    });
  };
  const confirm = async (lease: Lease) =>
    run(lease, async () => {
      if (
        lease.phase !== 'confirming' ||
        !lease.token ||
        !lease.requestedCookies ||
        lease.promptPending
      )
        throw 0;
      lease.phase = 'sending';
      emit(lease.owner, { phase: 'sending', message: 'Sharing sign-in…' });
      if ((await wait(lease, cookieAccess())) !== true) throw 0;
      const tab = await validate(lease);
      const cookies = captureCookies(
        tab.site,
        await wait(lease, browser.cookies.getAll({ url: tab.url })),
        lease.choices.cookieDomains,
        Date.now(),
      );
      // Fresh snapshot must still match the reviewed count; recheck site/access after reading.
      if (!cookies.length || cookies.length !== lease.count) throw 0;
      await validate(lease);
      const input = {
        type: 'capture' as const,
        token: lease.token,
        message: { site: tab.site, account: lease.persona, cookies, capturedAt: Date.now() },
      };
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > NATIVE_MESSAGE_LIMIT - 100)
        throw 0;
      await wait(lease, request(input));
      await finish(lease, 'shared', 'Sign-in shared.');
    });

  browser.permissions.onAdded.addListener((permissions) => {
    if (!permissions.permissions?.includes('cookies')) return;
    const solePrompt = pendingPrompts.size === 1 ? [...pendingPrompts][0] : undefined;
    // A grant is usable only by the live, expected request. A stale click from a
    // revoked view invalidates the current lease before any of its steps continue.
    if (
      active?.promptStarted &&
      !active.cancelled &&
      (!pendingPrompts.size || solePrompt === active)
    ) {
      active.promptPending = false;
      pendingPrompts.delete(active);
      return;
    }
    orphanGrant = true;
    if (active) cancel(active);
    enqueue(async () => {
      await remove();
      if (solePrompt) {
        solePrompt.promptPending = false;
        pendingPrompts.delete(solePrompt);
      }
      orphanGrant = false;
    });
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CAPTURE_PERMISSION_PORT) return;
    if (
      port.sender?.id !== browser.runtime.id ||
      port.sender.tab ||
      port.sender.url !== browser.runtime.getURL('popup/popup.html')
    ) {
      port.disconnect();
      return;
    }
    const owner: Owner = {
      port,
      closed: false,
      view: { phase: 'loading', message: 'Loading sign-in sharing…', warning, cleanupFailed },
    };
    owners.add(owner);
    port.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      owner.closed = true;
      owners.delete(owner);
      if (active?.owner === owner) cancel(active);
    });
    port.onMessage.addListener((input: unknown) => {
      const intent = captureIntent(input);
      if (!intent || owner.closed) return;
      if (intent.type === 'load') {
        enqueue(() => load(owner));
        return;
      }
      if (intent.type === 'start') {
        if (active || pendingPrompts.size || orphanGrant) {
          emit(owner, { phase: 'busy', message: busy });
          return;
        }
        enqueue(() => start(owner, intent.profile, intent.persona));
        return;
      }
      if (intent.type === 'removeCookieAccess') {
        enqueue(async () => {
          if (active || pendingPrompts.size || orphanGrant) {
            emit(owner, { phase: 'busy', message: busy });
            return;
          }
          emit(owner, { phase: 'loading', message: 'Removing cookie access…' });
          await remove();
          if (warning)
            emit(owner, {
              phase: 'failed',
              message: "Remove cookie access from Chrome's extension settings before sharing.",
            });
          else await load(owner);
        });
        return;
      }
      if (!('lease' in intent)) return;
      const lease = owner.lastLease?.id === intent.lease ? owner.lastLease : undefined;
      if (!lease) return;
      if (intent.type === 'cancel') {
        cancel(lease);
        return;
      }
      if (intent.type === 'requesting') {
        if (!lease.expectsCookies || lease.promptStarted) return;
        lease.promptStarted = true;
        lease.promptPending = true;
        pendingPrompts.add(lease);
        if (active !== lease || lease.cancelled) {
          // The worker may have timed out while the popup still displays the armed
          // click. Quarantine that prompt too, and stop any newer capture immediately.
          if (active) cancel(active);
          return;
        }
        enqueue(async () => {
          lease.requestedCookies = true;
          if (!lease.cancelled && active === lease)
            emit(owner, { phase: 'prompt', message: 'Waiting for cookie permission…' });
        });
        return;
      }
      if (intent.type === 'permission') {
        if (!lease.promptStarted || lease.resultReceived) return;
        lease.resultReceived = true;
        enqueue(() => granted(lease, intent.granted));
        return;
      }
      if (intent.type === 'confirm' && lease === active && lease.phase === 'confirming')
        enqueue(() => confirm(lease));
    });
  });
}
