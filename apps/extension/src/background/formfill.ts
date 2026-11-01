// AUTHORED-BY Codex GPT-6.1-Sol
import type { FieldCategory } from '../content/formfill/detect';
import {
  type FormFillField,
  type FormFillValue,
  formFillFields,
  formFillValues,
} from '../shared/formfill';
import type {
  FormFillPreview,
  FormFillPreviewRequest,
  FormFillRequest,
  FormFillResponse,
  FormFillTrigger,
  Profile,
} from '../shared/messages';
import type { FormFillData } from './core/formfill-data';
import {
  type FormFillGrant,
  liveFormFillGrant,
  revokeProfileFormFillGrants,
  sanitiseFormFillGrants,
} from './core/formfill-grant';
import { isValidClientIdUrl } from './core/origin-policy';
import { resolveRequestingOrigin } from './core/requesting-origin';

const KEY = 'solid:formfill-grants';
const MENU = 'solid-fill-from-pod';
const LOADING_TIMEOUT = 30_000;
// WCAG 2.2.1 permits a safety limit longer than 20 hours without an extension control.
const REVIEW_SAFETY_CAP = 24 * 60 * 60_000;
interface Choice {
  profileId?: string;
  categories: readonly FieldCategory[];
  remember: boolean;
}
interface LoadedProfile {
  values: FormFillValue[];
  current(): Promise<void>;
}
interface Pending {
  origin: string;
  fields: FormFillField[];
  profiles: readonly Pick<Profile, 'id' | 'label'>[];
  profileId: string;
  version: number;
  grant: FormFillGrant | null;
  loaded: Map<string, Promise<LoadedProfile>>;
  finish(choice: Choice): void;
}

export interface FormFillDependencies {
  profiles(): Promise<{ profiles: readonly Profile[]; defaultProfileId: string | null }>;
  /** Capture one profile's session and recheck it before egress and release. */
  load(profileId: string): Promise<{ data: FormFillData; current(): Promise<void> }>;
  /** The existing lifecycle lock makes grant persistence/release atomic with sign-out. */
  commit<T>(profileId: string, task: () => Promise<T>): Promise<T>;
}

export class FormFillWorker {
  private readonly pending = new Map<string, Pending>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: FormFillDependencies) {}

  private async grants(): Promise<FormFillGrant[]> {
    await this.tail;
    return sanitiseFormFillGrants((await chrome.storage.local.get(KEY))[KEY]);
  }
  private update(change: (grants: FormFillGrant[]) => readonly FormFillGrant[]): Promise<void> {
    const run = this.tail.then(async () => {
      const grants = sanitiseFormFillGrants((await chrome.storage.local.get(KEY))[KEY]);
      await chrome.storage.local.set({ [KEY]: sanitiseFormFillGrants(change(grants)) });
    });
    this.tail = run.catch(() => {});
    return run;
  }
  async revokeProfile(profileId: string): Promise<void> {
    for (const p of this.pending.values()) {
      if (p.profileId === profileId || p.loaded.has(profileId))
        p.finish({ categories: [], remember: false });
    }
    await this.update((grants) => revokeProfileFormFillGrants(grants, profileId));
  }
  async reconcile(profiles: readonly Profile[]): Promise<void> {
    const active = new Set(profiles.filter((p) => p.sessionState === 'active').map((p) => p.id));
    for (const p of this.pending.values()) {
      if (
        (p.profileId && !active.has(p.profileId)) ||
        [...p.loaded.keys()].some((id) => !active.has(id))
      )
        p.finish({ categories: [], remember: false });
    }
    await this.update((grants) =>
      grants.filter(
        (g) => active.has(g.profileId) && (g.expiresAt === undefined || g.expiresAt > Date.now()),
      ),
    );
  }

  private load(p: Pending, profileId: string): Promise<LoadedProfile> {
    let loaded = p.loaded.get(profileId);
    if (!loaded) {
      loaded = this.deps
        .load(profileId)
        .then(({ data, current }) => ({ values: formFillValues(data, p.fields), current }));
      p.loaded.set(profileId, loaded);
    }
    return loaded;
  }

  async preview(
    message: FormFillPreviewRequest,
    sender: chrome.runtime.MessageSender,
  ): Promise<FormFillPreview | null> {
    const p = this.pending.get(message.requestId);
    // Only this extension's top-level preview document can inspect values or decide.
    const expected = chrome.runtime.getURL('formfill/preview.html');
    if (
      !p ||
      sender.id !== chrome.runtime.id ||
      sender.url?.split('?')[0] !== expected ||
      (sender.frameId && sender.frameId !== 0)
    )
      return null;
    if (message.type === 'SOLID_FORMFILL_DECISION') {
      const categories = Array.isArray(message.categories)
        ? message.categories.filter((c) => c === 'contact' || c === 'address')
        : [];
      if (categories.length && message.profileId !== p.profileId) return null;
      p.finish({ profileId: p.profileId, categories, remember: message.remember === true });
      return null;
    }
    const profileId = message.profileId ?? p.profileId;
    if (!p.profiles.some((profile) => profile.id === profileId)) return null;
    const version = ++p.version;
    const loaded = await this.load(p, profileId);
    await loaded.current();
    if (this.pending.get(message.requestId) !== p || version !== p.version) return null;
    p.profileId = profileId;
    return {
      requestId: message.requestId,
      origin: p.origin,
      profileId,
      profiles: p.profiles,
      values: loaded.values,
      selected: p.grant?.profileId === profileId ? p.grant.categories : [],
    };
  }

  async request(
    message: FormFillRequest,
    sender: chrome.runtime.MessageSender,
  ): Promise<FormFillResponse> {
    const empty: FormFillResponse = { values: [] };
    const origin = resolveRequestingOrigin(sender, sender.url);
    const fields = formFillFields(message.fields);
    const tabId = sender.tab?.id;
    if (
      !origin ||
      !isValidClientIdUrl(origin) ||
      tabId === undefined ||
      sender.frameId === undefined ||
      !fields.length
    )
      return empty;
    let topOrigin: string;
    try {
      topOrigin = new URL(sender.tab!.url!).origin;
    } catch {
      return empty;
    }
    if (origin !== topOrigin || !isValidClientIdUrl(topOrigin)) return empty;
    // One outstanding request per document/origin prevents accidental duplicate previews.
    if ([...this.pending.values()].some((p) => p.origin === origin)) return empty;
    const requestId = crypto.randomUUID();
    let windowId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let finish!: (choice: Choice) => void;
    const choice = new Promise<Choice>((resolve) => {
      finish = (decision) => {
        if (finished) return;
        finished = true;
        resolve(decision);
      };
    });
    const p: Pending = {
      origin,
      fields,
      profiles: [],
      profileId: '',
      version: 0,
      grant: null,
      loaded: new Map(),
      finish,
    };
    this.pending.set(requestId, p);
    const cancel = () => finish({ categories: [], remember: false });
    const removed = (id: number) => {
      if (id === windowId) cancel();
    };
    const tabRemoved = (id: number) => {
      if (id === tabId) cancel();
    };
    const tabUpdated = (id: number, change: chrome.tabs.TabChangeInfo) => {
      if (id !== tabId || change.url === undefined) return;
      try {
        if (new URL(change.url).origin === origin) return;
      } catch {
        // An opaque or invalid destination cannot retain this request's authority.
      }
      cancel();
    };
    try {
      chrome.windows.onRemoved?.addListener(removed);
      chrome.tabs.onRemoved?.addListener(tabRemoved);
      chrome.tabs.onUpdated?.addListener(tabUpdated);
      timer = setTimeout(cancel, LOADING_TIMEOUT);
      const ready = (async () => {
        const grant = liveFormFillGrant(await this.grants(), origin, Date.now());
        if (finished) return false;
        const all = await this.deps.profiles();
        // Late discovery results never load data or reopen a cancelled request.
        if (finished) return false;
        p.profiles = all.profiles
          .filter((profile) => profile.sessionState === 'active')
          .map(({ id, label }) => ({ id, label }));
        const profileId = grant?.profileId ?? all.defaultProfileId;
        if (!profileId || !p.profiles.some((profile) => profile.id === profileId)) return false;
        p.grant = grant;
        p.profileId = profileId;
        await this.load(p, profileId);
        return true;
      })();
      if (!(await Promise.race([ready, choice.then(() => false)])) || finished) return empty;
      clearTimeout(timer);
      // Review time starts after discovery; switching profiles does not restart a short timer.
      timer = setTimeout(cancel, REVIEW_SAFETY_CAP);
      chrome.windows.create(
        {
          url: chrome.runtime.getURL(`formfill/preview.html?requestId=${requestId}`),
          type: 'popup',
          width: 480,
          height: 680,
        },
        (window) => {
          if (chrome.runtime.lastError || window?.id === undefined)
            finish({ categories: [], remember: false });
          else if (!this.pending.has(requestId))
            void chrome.windows.remove(window.id).catch(() => {});
          else windowId = window.id;
        },
      );
      const decision = await choice;
      if (!decision.categories.length || !decision.profileId) return empty;
      const chosen = await this.load(p, decision.profileId);
      const values = chosen.values.filter((v) => decision.categories.includes(v.category));
      if (!values.length) return empty;
      return await this.deps.commit(decision.profileId, async () => {
        await chosen.current();
        const tab = await chrome.tabs.get(tabId);
        if (new URL(tab.url!).origin !== origin) return empty;
        // Detect a concurrent remembered binding change rather than silently rebinding it.
        const current = liveFormFillGrant(await this.grants(), origin, Date.now());
        if (JSON.stringify(current) !== JSON.stringify(p.grant)) return empty;
        if (decision.remember)
          await this.update((grants) => [
            ...grants.filter((g) => g.origin !== origin),
            {
              origin,
              profileId: decision.profileId!,
              categories: [...new Set(values.map((v) => v.category))],
              createdAt: Date.now(),
            },
          ]);
        await chosen.current();
        return { origin, values };
      });
    } catch {
      return empty;
    } finally {
      clearTimeout(timer);
      this.pending.delete(requestId);
      chrome.windows.onRemoved?.removeListener(removed);
      chrome.tabs.onRemoved?.removeListener(tabRemoved);
      chrome.tabs.onUpdated?.removeListener(tabUpdated);
      if (windowId !== undefined) void chrome.windows.remove(windowId).catch(() => {});
    }
  }
}

export function registerFormFillMenu(): void {
  const create = () => {
    if (!chrome.contextMenus?.remove) return;
    chrome.contextMenus.remove(MENU, () => {
      void chrome.runtime.lastError;
      chrome.contextMenus.create({ id: MENU, title: 'Fill from pod', contexts: ['editable'] });
    });
  };
  chrome.runtime.onInstalled.addListener(create);
  create();
  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU || tab?.id === undefined) return;
    void chrome.tabs
      .sendMessage(tab.id, { type: 'SOLID_FORMFILL_TRIGGER' } satisfies FormFillTrigger, {
        frameId: info.frameId ?? 0,
      })
      .catch(() => {});
  });
}
