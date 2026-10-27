// AUTHORED-BY Codex GPT-6.1-Sol
import type { ClassGrant } from '../background/core/class-grant';
import type { OriginGrant } from '../background/core/origin-grant';
import type { Confirmation, GrantsController, GrantsState } from './grants-controller';

const CLASS_LABELS: Readonly<Record<string, string>> = {
  'https://schema.org/TextDigitalDocument': 'Documents',
  'http://schema.org/TextDigitalDocument': 'Documents',
  'https://schema.org/Person': 'Contacts',
  'http://schema.org/Person': 'Contacts',
  'http://www.w3.org/2006/vcard/ns#Individual': 'Contacts',
  'http://www.w3.org/2002/12/cal/ical#Vevent': 'Calendar events',
  'https://schema.org/Event': 'Calendar events',
  'http://www.w3.org/ns/pim/meeting#LongChat': 'Chats',
};
const MODES: Readonly<Record<string, string>> = {
  read: 'Read',
  append: 'Add',
  write: 'Edit and delete',
};

function classLabel(value: string): string {
  if (CLASS_LABELS[value]) return CLASS_LABELS[value];
  // Unknown vocabularies still get a readable local name, never a raw technical URL.
  try {
    const url = new URL(value);
    const local = decodeURIComponent(url.hash.slice(1) || url.pathname.split('/').pop() || '');
    return local.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ') || 'Other data';
  } catch {
    return 'Other data';
  }
}

function date(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    value,
  );
}

function initials(value: string): string {
  return (
    value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

/** Native controls provide Enter/Space activation, disclosure semantics and modal focus handling. */
export function mountGrantsView(root: HTMLElement, controller: GrantsController): () => void {
  const doc = root.ownerDocument;
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    className?: string,
  ) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text: string, key: string, activate: () => void) => {
    const node = element('button', text);
    node.type = 'button';
    node.dataset.focusKey = key;
    node.addEventListener('click', activate);
    return node;
  };
  root.classList.add('grants-manager');
  const heading = element('h2', 'Sites with access');
  heading.id = 'grants-heading';
  heading.tabIndex = -1;
  root.setAttribute('aria-labelledby', heading.id);
  const introduction = element('p', 'Choose which sites can use your accounts and data.');
  const refresh = button('Refresh', 'refresh', () => {
    void controller.refresh();
  });
  const status = element('p', '', 'grants-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-atomic', 'true');
  const error = element('p', '', 'grants-error');
  error.setAttribute('role', 'alert');
  const list = element('div', undefined, 'grants-list');
  const dialog = element('dialog', undefined, 'grants-dialog');
  dialog.setAttribute('aria-labelledby', 'grants-confirm-title');
  dialog.setAttribute('aria-describedby', 'grants-confirm-description');
  root.replaceChildren(heading, introduction, refresh, status, error, list, dialog);

  const expanded = new Set<string>();
  let currentConfirmation: Confirmation | null = null;
  let restoreKey: string | undefined;
  let dialogConfirm: HTMLButtonElement | undefined;
  let wasSaving = false;
  let disposed = false;

  // A control disabled while loading parks focus on the heading; remember it so the next
  // enabled render can return focus instead of leaving it on the heading.
  let parkedKey: string | undefined;
  const focusedKey = () => {
    const active = doc.activeElement as HTMLElement | null;
    const key = active?.dataset?.focusKey;
    if (key) return key;
    if (active !== heading && active !== doc.body && active !== null) parkedKey = undefined;
    return parkedKey;
  };
  const restoreFocus = (key: string | undefined) => {
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-focus-key]')).find(
      (node) => node.dataset.focusKey === key,
    );
    const disabled = target?.matches(':disabled') ?? false;
    parkedKey = disabled ? key : undefined;
    (disabled ? heading : (target ?? heading)).focus();
  };
  const cancelDialog = (event: Event) => {
    event.preventDefault();
    controller.cancel();
  };
  dialog.addEventListener('cancel', cancelDialog);
  // Chrome lets Tab leave a modal dialog for the browser UI; keep it inside the dialog.
  const trapFocus = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const buttons = Array.from(dialog.querySelectorAll('button')).filter((b) => !b.disabled);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first) return;
    const active = doc.activeElement;
    if (event.shiftKey ? active === first || !dialog.contains(active) : active === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };
  dialog.addEventListener('keydown', trapFocus);

  function renderDialog(state: GrantsState, key: string | undefined) {
    const action = state.confirmation;
    if (action && action !== currentConfirmation) {
      restoreKey = key;
      currentConfirmation = action;
      const title = element(
        'h3',
        action.kind === 'revoke'
          ? 'Revoke site access?'
          : action.kind === 'rebind'
            ? 'Change account?'
            : 'Shorten access?',
      );
      title.id = 'grants-confirm-title';
      const account =
        action.kind === 'rebind'
          ? state.profiles.find((p) => p.id === action.profileId)?.label
          : '';
      const description = element(
        'p',
        action.kind === 'revoke'
          ? `${action.origin} will lose access to your account and data. The site must ask again to regain access.`
          : action.kind === 'rebind'
            ? `Use ${account} for ${action.origin}? Changing the account clears this site's data access. The site must ask again.`
            : `Access for ${action.origin} will end on ${date(action.expiresAt)} (${action.duration} from now). The site must ask again to extend access.`,
      );
      description.id = 'grants-confirm-description';
      const cancel = button('Cancel', 'confirm-cancel', () => controller.cancel());
      dialogConfirm = button(
        action.kind === 'revoke'
          ? 'Revoke access'
          : action.kind === 'rebind'
            ? 'Change account'
            : 'Shorten access',
        'confirm-submit',
        () => {
          void controller.confirm();
        },
      );
      dialogConfirm.className = 'grants-destructive';
      const actions = element('div', undefined, 'grants-actions');
      actions.append(cancel, dialogConfirm);
      dialog.replaceChildren(title, description, actions);
      dialog.showModal();
      cancel.focus();
    } else if (!action && currentConfirmation) {
      currentConfirmation = null;
      dialog.close();
      restoreFocus(restoreKey);
    }
    if (dialogConfirm) dialogConfirm.disabled = state.phase !== 'confirming';
  }

  function renderClass(grant: ClassGrant, parent: OriginGrant) {
    const row = element('li', undefined, 'grants-class');
    const expiry = Math.min(grant.expiresAt, parent.expiresAt ?? Number.POSITIVE_INFINITY);
    row.append(
      element('strong', classLabel(grant.dataClass)),
      element('p', grant.modes.map((mode) => MODES[mode] ?? 'Other access').join(' · ')),
      element('p', `Expires ${date(expiry)}`),
    );
    return row;
  }

  function renderSite(grant: OriginGrant, state: GrantsState, index: number) {
    const busy = state.phase !== 'ready';
    const row = element('article', undefined, 'permission-row');
    row.setAttribute('aria-label', grant.origin);
    const header = element('div', undefined, 'grants-site-header');
    const avatar = element(
      'span',
      new URL(grant.origin).hostname[0].toUpperCase(),
      'grants-avatar',
    );
    avatar.setAttribute('aria-hidden', 'true');
    const identity = element('div', undefined, 'grants-site-identity');
    const name = element('h3', grant.origin);
    const since = element('p', `Since ${date(grant.createdAt)}`);
    identity.append(name, since);
    header.append(avatar, identity);
    const profile = state.profiles.find((p) => p.id === grant.profileId);
    const bound = element('div', undefined, 'grants-bound-account');
    const accountAvatar = element('span', initials(profile?.label ?? ''), 'grants-avatar');
    accountAvatar.setAttribute('aria-hidden', 'true');
    if (profile?.avatar) {
      try {
        const url = new URL(profile.avatar);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          const image = element('img');
          image.alt = '';
          image.referrerPolicy = 'no-referrer';
          image.addEventListener('error', () => image.remove(), { once: true });
          image.src = url.href;
          accountAvatar.append(image);
        }
      } catch {
        /* Initials remain when an account image is unavailable. */
      }
    }
    bound.append(
      accountAvatar,
      element('span', `Account: ${profile?.label ?? 'Unavailable account'}`),
    );
    const classes = grant.scope.classes;
    const chips = element('div', undefined, 'grants-summary');
    chips.append(
      element(
        'span',
        classes === undefined
          ? 'All data in connected storage'
          : `${classes.length} data ${classes.length === 1 ? 'type' : 'types'}`,
      ),
    );
    chips.append(
      element(
        'span',
        grant.expiresAt === undefined ? 'Until revoked' : `Expires ${date(grant.expiresAt)}`,
      ),
    );
    const revoke = button('Revoke', `${grant.origin}:revoke`, () =>
      controller.requestRevoke(grant.origin),
    );
    revoke.className = 'grants-destructive';
    revoke.disabled = busy;

    const detailsId = `grants-details-${index}`;
    const details = element('div', undefined, 'grants-details');
    details.id = detailsId;
    details.hidden = !expanded.has(grant.origin);
    const toggle = button('Access details', `${grant.origin}:details`, () => {
      if (expanded.has(grant.origin)) expanded.delete(grant.origin);
      else expanded.add(grant.origin);
      details.hidden = !expanded.has(grant.origin);
      toggle.setAttribute('aria-expanded', String(!details.hidden));
    });
    toggle.setAttribute('aria-expanded', String(!details.hidden));
    toggle.setAttribute('aria-controls', detailsId);
    const classList = element('ul', undefined, 'grants-classes');
    classList.setAttribute('aria-label', 'Data access');
    if (classes?.length) classList.append(...classes.map((item) => renderClass(item, grant)));
    else
      classList.append(
        element(
          'li',
          classes === undefined
            ? 'Access to all data in connected storage.'
            : 'No data access. This site must ask again.',
        ),
      );

    const label = element('label', 'Account');
    const picker = element('select');
    picker.dataset.focusKey = `${grant.origin}:account`;
    picker.disabled = busy;
    if (!profile) {
      const unavailable = element('option', 'Unavailable account');
      unavailable.value = grant.profileId;
      unavailable.disabled = true;
      picker.append(unavailable);
    }
    for (const account of state.profiles) {
      const option = element(
        'option',
        `${account.label}${account.sessionState === 'active' ? '' : ' — sign in to use'}`,
      );
      option.value = account.id;
      option.disabled = account.sessionState !== 'active';
      picker.append(option);
    }
    picker.value = grant.profileId;
    picker.addEventListener('change', () => {
      const selected = picker.value;
      picker.value = grant.profileId;
      controller.requestRebind(grant.origin, selected);
    });
    label.append(picker);
    const warning = element(
      'p',
      "Changing the account clears this site's data access. The site must ask again.",
    );
    warning.id = `grants-account-warning-${index}`;
    picker.setAttribute('aria-describedby', warning.id);

    const durations = element('fieldset', undefined, 'duration-chips');
    durations.append(element('legend', 'Access duration'));
    const reason = element(
      'p',
      'Only shorter durations are available. To extend access, this site must ask again.',
    );
    reason.id = `grants-duration-reason-${index}`;
    for (const option of controller.durationOptions(grant)) {
      const chip = button(option.label, `${grant.origin}:${option.label}`, () =>
        controller.requestExpiry(grant.origin, option.label),
      );
      chip.disabled = busy || option.reason !== null;
      chip.title = option.reason ?? `End access ${date(option.expiresAt!)}`;
      chip.setAttribute('aria-describedby', reason.id);
      durations.append(chip);
    }
    details.append(classList, label, warning, durations, reason);
    row.append(header, bound, chips, revoke, toggle, details);
    return row;
  }

  const unsubscribe = controller.subscribe((state) => {
    if (disposed) return;
    const key = focusedKey();
    refresh.disabled = state.phase === 'loading' || state.phase === 'saving';
    list.setAttribute('aria-busy', String(state.phase === 'loading' || state.phase === 'saving'));
    status.textContent =
      state.phase === 'loading'
        ? 'Loading sites with access…'
        : state.phase === 'saving'
          ? 'Updating site access…'
          : state.status;
    error.textContent = state.error ?? '';
    if (!state.loaded) {
      list.replaceChildren(
        element(
          'p',
          state.error ? 'Refresh to load sites with access.' : 'Loading sites with access…',
        ),
      );
    } else if (!state.grants.length) {
      list.replaceChildren(element('p', 'No sites have access yet'));
    } else {
      list.replaceChildren(...state.grants.map((grant, index) => renderSite(grant, state, index)));
    }
    if (key && !dialog.open) restoreFocus(key);
    renderDialog(state, key);
    if (wasSaving && state.phase === 'ready') restoreFocus(restoreKey);
    wasSaving = state.phase === 'saving';
  });
  void controller.refresh();

  return () => {
    disposed = true;
    unsubscribe();
    dialog.removeEventListener('cancel', cancelDialog);
    dialog.removeEventListener('keydown', trapFocus);
    if (dialog.open) dialog.close();
    root.replaceChildren();
  };
}
