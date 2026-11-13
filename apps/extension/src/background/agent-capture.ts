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
import {
  captureCleanupPending,
  clearCaptureCleanup,
  markCaptureCleanup,
} from './agent-capture-cleanup';
import { captureCookies } from './agent-capture-cookies';

const unavailable = 'Sign-in sharing unavailable. Review the site and try again.';
const siteAccess =
  "Allow this extension on this site from Chrome's extension menu first, then try again.";
const busy = 'Another sharing is in progress.';
const finishing = 'Finishing the previous sharing.';
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
  expiresAt: number;
  owner: Owner;
  tab: Tab;
  phase: 'reviewing' | 'acquiring' | 'confirming' | 'sending' | 'cleaning' | 'orphaned';
  expectsCookies: boolean;
  authorizationInvalid: boolean;
  choices: CaptureChoices;
  count?: number;
  persona: string;
  profile: string;
  // Ingress latches interrupt pending Chrome/native work without waiting for the mutex.
  cancelled: boolean;
  stop(): void;
  stopped: Promise<never>;
  permission?: {
    pending: boolean;
    settled: Promise<boolean | undefined>;
    settle(allowed: boolean | undefined): void;
  };
  orphaned?: { expired: boolean; checked: boolean; removals: Set<Promise<boolean>> };
  cleanup?: Promise<boolean>;
  timer: ReturnType<typeof setTimeout>;
  token?: string;
}

/** One worker, one lease, one mutex for Chrome/native work (including cleanup).
 * Cancellation, authorization and prompt ingress latches run outside the mutex.
 * An orphaned prompt wakes settlement waits and retains a sixty-second fence.
 * Its idempotent revocations bypass the mutex; no reads or sends are allowed.
 * All revocations must finish before that lease can end.
 */
export function installAgentCapture(
  browser: typeof chrome,
  transport: (request: VaultRequest) => Promise<NativeResult>,
): void {
  let tail = Promise.resolve();
  const enqueue = (work: () => Promise<unknown>) => {
    tail = tail
      .then(async () => {
        await work();
      })
      .catch(() => {
        /* Errors are rendered without browser diagnostics. */
      });
  };
  let active: Lease | undefined;
  let pendingPrompt: Lease | undefined;
  // Prompt ownership is singular; cleanup ownership survives independently by lease id.
  const cleanups = new Map<number, Lease>();
  const occupied = () => active !== undefined || pendingPrompt !== undefined || cleanups.size > 0;
  let nextId = 0;
  // Display only: each lease owns its cleanup result; notices never skip cleanup.
  let cleanupNotice: 'cleaning' | 'failed' | undefined;
  const busyMessage = () =>
    cleanupNotice === 'failed'
      ? 'Remove cookie access before sharing a sign-in.'
      : cleanups.size ||
          pendingPrompt ||
          active?.cancelled ||
          active?.authorizationInvalid ||
          active?.phase === 'cleaning'
        ? finishing
        : busy;
  const owners = new Set<Owner>();
  const emit = (owner: Owner, update: Partial<CaptureView>) => {
    owner.view = {
      ...owner.view,
      ...update,
      warning: cleanupNotice !== undefined,
      cleanupFailed: cleanupNotice === 'failed',
    };
    owner.view.armedLease =
      active?.owner === owner &&
      active.expectsCookies &&
      active.phase === 'reviewing' &&
      !active.authorizationInvalid &&
      !active.cancelled &&
      owner.view.phase === 'permission' &&
      !cleanupNotice
        ? active.id
        : undefined;
    owner.view.expiresAt = active?.owner === owner ? active.expiresAt : undefined;
    if (!owner.closed) {
      try {
        owner.port.postMessage(owner.view);
      } catch {
        /* onDisconnect owns cleanup. */
      }
    }
  };
  const warnings = () => {
    for (const owner of owners)
      emit(
        owner,
        (cleanups.size || active?.cancelled || active?.phase === 'cleaning') &&
          owner !== active?.owner &&
          !['failed', 'cancelled', 'shared'].includes(owner.view.phase)
          ? { phase: 'busy', message: busyMessage() }
          : {},
      );
  };
  const cleanupStatus = async (failed: boolean) => {
    cleanupNotice = failed ? 'failed' : undefined;
    try {
      await browser.action.setBadgeText({ text: failed ? '!' : '' });
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
  const cookieWindow = () =>
    active &&
    !active.cancelled &&
    !active.authorizationInvalid &&
    ['acquiring', 'confirming', 'sending'].includes(active.phase);
  const orphanedLease = () => [...cleanups.values()].find((lease) => lease.orphaned);
  const remove = async () => {
    cleanupNotice = 'cleaning';
    warnings();
    // Persistence helps explain interrupted cleanup, but never controls revocation.
    try {
      await markCaptureCleanup(browser.storage);
    } catch {
      /* Still remove authority if the display notice cannot be stored. */
    }
    let failed = false;
    try {
      await releaseCapturePermissions(browser.permissions);
      await clearCaptureCleanup(browser.storage);
    } catch {
      failed = true;
    }
    await cleanupStatus(failed);
    return !failed;
  };
  const recover = async () => {
    if (cookieWindow()) return true;
    try {
      if (await captureCleanupPending(browser.storage)) {
        cleanupNotice = 'cleaning';
        warnings();
      }
    } catch {
      /* A missing/unreadable display marker never prevents authority cleanup. */
    }
    if (cookieWindow()) return true;
    const present = await cookieAccess();
    if (cookieWindow()) return true;
    if (present !== false) return remove();
    try {
      await clearCaptureCleanup(browser.storage);
      await cleanupStatus(false);
      return true;
    } catch {
      await cleanupStatus(true);
      return false;
    }
  };
  const removeOrphaned = (lease: Lease) => {
    const orphaned = lease.orphaned!;
    // Never queue behind a settlement wait or another removal. In this state
    // authority can only be revoked, and the fence prevents a new capture.
    const removal = remove();
    orphaned.removals.add(removal);
    void removal.then((cleaned) => {
      // Retain completed revocations until the drain joins them. A grant and its
      // failed removal can both finish during an older absence check; that older
      // observation must not release the fence without another verification.
      // A successful retry can release every expired fence, regardless of which
      // lease triggered it. A failed final attempt waits for an explicit retry.
      if (cleaned)
        for (const other of cleanups.values()) if (other.orphaned) other.orphaned.checked = false;
      enqueue(drainExpired);
    });
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
    if (active !== lease || lease.cancelled || lease.authorizationInvalid || lease.owner.closed)
      throw new Error(unavailable);
  };
  const wait = async <T>(lease: Lease, work: () => Promise<T>): Promise<T> => {
    alive(lease);
    const value = await Promise.race([work(), lease.stopped]);
    alive(lease);
    return value;
  };
  const mutate = async <T>(lease: Lease, work: () => Promise<T>): Promise<T> => {
    alive(lease);
    const value = await work();
    alive(lease);
    return value;
  };
  const validate = async (lease: Lease) => {
    alive(lease);
    const tab = await wait(lease, current);
    // Validate the CURRENT active tab before checking its existing host grant.
    await wait(lease, () => host(tab));
    if (tab.id !== lease.tab.id || tab.site !== lease.tab.site) throw new Error(unavailable);
    return tab;
  };
  const request = async (input: VaultRequest) => {
    const result = nativeResultSchema.safeParse(await transport(input));
    if (!result.success || result.data.type !== input.type) throw new Error(unavailable);
    return result.data;
  };
  const release = (lease: Lease) => {
    clearTimeout(lease.timer);
    cleanups.delete(lease.id);
    if (pendingPrompt === lease) pendingPrompt = undefined;
    if (active === lease) active = undefined;
  };
  const resume = () => {
    if (!occupied() && !cleanupNotice)
      for (const owner of owners)
        if (owner.view.phase === 'busy') {
          emit(owner, { phase: 'loading', lease: undefined, message: 'Loading sign-in sharing…' });
          enqueue(() => load(owner));
        }
  };
  const releaseVerified = () => {
    if (active || pendingPrompt) return;
    if ([...cleanups.values()].some((lease) => lease.orphaned?.removals.size)) return;
    for (const lease of cleanups.values())
      if (!lease.orphaned || lease.orphaned.expired) release(lease);
    resume();
  };
  const drainExpired = async () => {
    if (cookieWindow()) return;
    // Drain the entire collection, never just the fence whose timer/removal woke us.
    const expired = [...cleanups.values()].filter(
      (lease) => lease.orphaned?.expired && !lease.orphaned.checked,
    );
    if (!expired.length) return;
    let cleaned: boolean;
    do {
      const joined = [...cleanups.values()].flatMap((lease) =>
        lease.orphaned ? [{ state: lease.orphaned, removals: [...lease.orphaned.removals] }] : [],
      );
      await Promise.all(joined.flatMap(({ removals }) => removals));
      for (const { state, removals } of joined)
        for (const removal of removals) state.removals.delete(removal);
      for (const lease of expired) lease.orphaned!.checked = true;
      cleaned = await recover();
    } while ([...cleanups.values()].some((lease) => lease.orphaned?.removals.size));
    // One final attempt per expiry. Failure stays visible with the retry button;
    // queued completions cannot silently retry forever or leave a hidden busy state.
    if (cleaned) releaseVerified();
    resume();
  };
  const recoverIdle = async () => {
    if (await recover()) releaseVerified();
    await drainExpired();
  };
  const finish = async (
    lease: Lease,
    phase: 'failed' | 'shared' | 'cancelled',
    message: string,
  ) => {
    if (lease.orphaned) {
      await drainExpired();
      return;
    }
    if (active !== lease) return;
    cleanups.set(lease.id, lease);
    lease.phase = 'cleaning';
    emit(lease.owner, {
      phase: lease.cancelled ? 'cancelled' : 'cleaning',
      message: lease.cancelled ? 'Sharing cancelled.' : message,
      preview: undefined,
    });
    // Mutating work retains the mutex until settlement or worker-owned abandonment.
    await lease.permission?.settled;
    if (lease.orphaned) {
      await drainExpired();
      return;
    }
    lease.cleanup = recover();
    const cleaned = await lease.cleanup;
    clearTimeout(lease.timer);
    if (pendingPrompt === lease) pendingPrompt = undefined;
    // Cancel can arrive while removal is pending. Never publish an older completion.
    emit(lease.owner, {
      phase: lease.cancelled ? 'cancelled' : phase,
      message: lease.cancelled ? 'Sharing cancelled.' : message,
    });
    if (active === lease) active = undefined;
    if (cleaned) releaseVerified();
    await drainExpired();
    resume();
  };
  const cancel = (lease: Lease, abandoned = false) => {
    if (active !== lease && !(abandoned && pendingPrompt === lease)) return;
    lease.cancelled = true;
    lease.stop();
    if (abandoned && lease.permission?.pending && !lease.orphaned) {
      lease.phase = 'orphaned';
      lease.orphaned = { expired: false, checked: false, removals: new Set() };
      cleanups.set(lease.id, lease);
      if (active === lease) active = undefined;
      if (pendingPrompt === lease) pendingPrompt = undefined;
      clearTimeout(lease.timer);
      lease.timer = setTimeout(() => {
        lease.orphaned!.expired = true;
        enqueue(drainExpired);
      }, 60000);
      // Undefined is abandonment, never an authorization result. It wakes both
      // the prompt handler and cleanup even when the popup can never report back.
      lease.permission.settle(undefined);
      removeOrphaned(lease);
    }
    emit(lease.owner, { phase: 'cancelled', message: 'Sharing cancelled.', preview: undefined });
    warnings();
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
    if (occupied()) {
      emit(owner, { phase: 'busy', message: busyMessage() });
      return;
    }
    if (!cleanupNotice && present !== false) await remove();
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
      if (cleanupNotice) {
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
    if (occupied()) {
      emit(owner, { phase: 'busy', message: busyMessage() });
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
      expiresAt: Date.now() + 120000,
      owner,
      tab: owner.tab,
      phase: 'reviewing',
      expectsCookies: false,
      authorizationInvalid: false,
      choices,
      persona,
      profile,
      cancelled: false,
      stopped,
      stop,
      timer: setTimeout(() => cancel(lease, true), 120000),
    };
    active = lease;
    owner.lastLease = lease;
    emit(owner, { phase: 'reviewing', lease: lease.id, message: 'Checking the current site…' });
    await run(lease, async () => {
      const present = await wait(lease, cookieAccess);
      if (cleanupNotice) throw new Error(unavailable);
      if (present !== false) {
        await mutate(lease, remove);
        if (cleanupNotice) throw new Error(unavailable);
      }
      await validate(lease);
      lease.expectsCookies = true;
      emit(owner, {
        phase: 'permission',
        message: 'Click Allow cookies and review to grant temporary cookie access.',
      });
    });
  };
  const granted = async (lease: Lease, allowed: boolean | undefined) => {
    if (lease.orphaned) {
      await finish(lease, 'cancelled', 'Sharing cancelled.');
      return;
    }
    if (pendingPrompt === lease) pendingPrompt = undefined;
    if (active !== lease) {
      // A stale result cannot claim a newer lease's authority.
      if (!active) await recoverIdle();
      return;
    }
    if (lease.phase !== 'acquiring') return;
    lease.phase = 'confirming';
    await run(lease, async () => {
      if (!allowed || (await wait(lease, cookieAccess)) !== true) throw 0;
      await validate(lease); // Access withdrawn DURING the prompt cannot reach beginLogin.
      alive(lease);
      const begun = await mutate(lease, () =>
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
        await wait(lease, () => browser.cookies.getAll({ url: tab.url })),
        lease.choices.cookieDomains,
        Date.now(),
      );
      await validate(lease);
      if (!cookies.length) throw 0;
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
      if (lease.phase !== 'confirming' || !lease.token || pendingPrompt === lease) throw 0;
      lease.phase = 'sending';
      emit(lease.owner, { phase: 'sending', message: 'Sharing sign-in…' });
      if ((await wait(lease, cookieAccess)) !== true) throw 0;
      const tab = await validate(lease);
      const cookies = captureCookies(
        tab.site,
        await wait(lease, () => browser.cookies.getAll({ url: tab.url })),
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
      alive(lease); // No await between this authorization latch and native dispatch.
      await mutate(lease, () => request(input));
      await finish(lease, 'shared', 'Sign-in shared.');
    });

  const invalidate = () => {
    const lease = active;
    if (!lease || lease.phase === 'cleaning' || lease.cancelled || lease.authorizationInvalid)
      return;
    const reviewing = lease.phase === 'reviewing' || lease.phase === 'acquiring';
    lease.authorizationInvalid = true;
    lease.stop();
    emit(lease.owner, {
      phase: 'failed',
      preview: undefined,
      message: 'Site access changed. Review sign-in sharing again.',
    });
    enqueue(async () => {
      await finish(lease, 'failed', 'Site access changed. Review sign-in sharing again.');
      if (reviewing && !lease.cancelled && !lease.owner.closed && !occupied() && !cleanupNotice)
        await load(lease.owner);
    });
  };
  browser.tabs.onActivated.addListener(invalidate);
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (tabId === active?.tab.id && change.url !== undefined) invalidate();
  });
  browser.windows.onFocusChanged.addListener(invalidate);
  browser.permissions.onRemoved.addListener(invalidate);
  browser.permissions.onAdded.addListener((permissions) => {
    const cookies = permissions.permissions?.includes('cookies');
    const orphaned = orphanedLease();
    if (cookies && orphaned) {
      removeOrphaned(orphaned);
      return;
    }
    // Only the current armed gesture may acquire authority. Every permission change
    // during confirmation/sending invalidates the authorization latch.
    if (
      cookies &&
      permissions.permissions?.length === 1 &&
      !permissions.origins?.length &&
      active?.phase === 'acquiring' &&
      cookieWindow() &&
      pendingPrompt === active
    ) {
      return;
    }
    invalidate();
    enqueue(recoverIdle);
  });

  // Queue recovery at top-level before any port work, and serialize startup events too.
  enqueue(recoverIdle);
  browser.runtime.onStartup.addListener(() => enqueue(recoverIdle));
  browser.runtime.onInstalled.addListener(() => enqueue(recoverIdle));
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
      view: {
        phase: 'loading',
        message: 'Loading sign-in sharing…',
        warning: cleanupNotice !== undefined,
        cleanupFailed: cleanupNotice === 'failed',
      },
    };
    owners.add(owner);
    emit(owner, occupied() ? { phase: 'busy', message: busyMessage() } : {});
    port.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      owner.closed = true;
      owners.delete(owner);
      const lease =
        active?.owner === owner
          ? active
          : pendingPrompt?.owner === owner
            ? pendingPrompt
            : undefined;
      if (lease) cancel(lease, true);
    });
    port.onMessage.addListener((input: unknown) => {
      const intent = captureIntent(input);
      if (!intent || owner.closed) return;
      if (intent.type === 'load') {
        emit(owner, occupied() ? { phase: 'busy', message: busyMessage() } : {});
        enqueue(() => load(owner));
        return;
      }
      if (intent.type === 'start') {
        if (occupied()) {
          emit(owner, { phase: 'busy', message: busyMessage() });
          return;
        }
        enqueue(() => start(owner, intent.profile, intent.persona));
        return;
      }
      if (intent.type === 'removeCookieAccess') {
        const orphaned = orphanedLease();
        if (orphaned) {
          removeOrphaned(orphaned);
          return;
        }
        enqueue(async () => {
          if (active || pendingPrompt) {
            emit(owner, { phase: 'busy', message: busyMessage() });
            return;
          }
          emit(owner, { phase: 'loading', message: 'Removing cookie access…' });
          await remove();
          if (cleanupNotice)
            emit(owner, {
              phase: 'failed',
              message: "Remove cookie access from Chrome's extension settings before sharing.",
            });
          else {
            releaseVerified();
            await drainExpired();
            await load(owner);
            resume();
          }
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
        // Refuse before changing any lease or prompt. In particular, an old popup
        // must never replace or cancel another popup's unsettled prompt.
        if (
          pendingPrompt ||
          cleanups.size ||
          active !== lease ||
          !lease.expectsCookies ||
          lease.phase !== 'reviewing' ||
          lease.cancelled ||
          lease.authorizationInvalid ||
          cleanupNotice ||
          Date.now() >= lease.expiresAt
        ) {
          emit(owner, {
            phase: 'busy',
            lease: undefined,
            message: cleanupNotice === 'failed' ? busyMessage() : finishing,
          });
          if (!occupied()) enqueue(() => load(owner));
          return;
        }
        lease.expectsCookies = false;
        let settle!: (allowed: boolean | undefined) => void;
        const settled = new Promise<boolean | undefined>((resolve) => {
          settle = resolve;
        });
        const permission = {
          pending: true,
          settled,
          settle: (allowed: boolean | undefined) => {
            if (!permission.pending) return;
            permission.pending = false;
            settle(allowed);
          },
        };
        lease.permission = permission;
        pendingPrompt = lease;
        // Synchronous ingress: onAdded can arrive before the queued prompt update.
        lease.phase = 'acquiring';
        enqueue(async () => {
          if (!lease.cancelled && !lease.authorizationInvalid && active === lease)
            emit(owner, { phase: 'prompt', message: 'Waiting for cookie permission…' });
          // Result ingress or worker-owned abandonment wakes this wait. onAdded
          // never authorizes a request or releases an orphaned lease's fence.
          await granted(lease, await settled);
        });
        return;
      }
      if (intent.type === 'permission') {
        lease.permission?.settle(intent.granted);
        return;
      }
      if (intent.type === 'confirm' && lease === active && lease.phase === 'confirming')
        enqueue(() => confirm(lease));
    });
  });
}
