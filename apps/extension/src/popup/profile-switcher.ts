// AUTHORED-BY GPT-6.1-Sol (Codex)
import type { Profile } from '../shared/messages';
import { ProfileController, type ProfileViewState } from './profile-controller';

/** One native, labelled form shared by the popup and persistent side panel. */
export function mountProfileSwitcher(parent: HTMLElement): {
  controller: ProfileController;
  cleanup: () => void;
} {
  const doc = parent.ownerDocument;
  const root = doc.createElement('section');
  root.id = 'profiles';
  root.setAttribute('aria-labelledby', 'profiles-heading');
  root.innerHTML = `
    <div class="profiles-heading"><h2 id="profiles-heading">Profiles</h2>
      <span id="profiles-count"></span></div>
    <p class="profile-hint">Choose the default account for Solid.</p>
    <ul id="profile-list" aria-label="Saved profiles"></ul>
    <p id="profiles-empty" hidden>No profiles yet. Sign in to add your first account.</p>
    <button type="button" id="profile-add">Add profile</button>
    <p id="profile-limit" class="profile-hint" hidden>All 8 profile slots are in use.</p>
    <form id="profile-editor" hidden aria-labelledby="profile-editor-heading">
      <h3 id="profile-editor-heading"></h3>
      <p id="profile-editor-help" class="profile-hint"></p>
      <label id="profile-input-label" for="profile-input"></label>
      <input id="profile-input" required aria-describedby="profile-editor-help profile-error" />
      <div class="profile-actions">
        <button type="submit" id="profile-save">Save</button>
        <button type="button" id="profile-cancel">Cancel</button>
      </div>
    </form>
    <p id="profile-status" role="status" aria-atomic="true">Loading profiles…</p>
    <p id="profile-error" role="alert" aria-atomic="true"></p>
    <button type="button" id="profile-retry" hidden>Retry profiles</button>`;
  parent.append(root);
  const get = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
  const list = get<HTMLUListElement>('profile-list');
  const editor = get<HTMLFormElement>('profile-editor');
  const input = get<HTMLInputElement>('profile-input');
  const add = get<HTMLButtonElement>('profile-add');
  const save = get<HTMLButtonElement>('profile-save');
  let editing: { action: 'add' | 'rename' | 'remove'; profile?: Profile; trigger: string } | null =
    null;
  let listSignature = '';
  let pendingFocus: string | null = null;
  // A focused control that a render disabled, hid or removed; restored (or replaced by a
  // usable fallback) once the surface is idle.
  let busyFocus: HTMLElement | null = null;
  let disposed = false;

  function button(text: string, key: string, label: string, click: () => void): HTMLButtonElement {
    const el = doc.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.dataset.focus = key;
    el.setAttribute('aria-label', label);
    el.addEventListener('click', () => {
      if (!controller.state.busy) click();
    });
    return el;
  }

  function restoreFocus(key: string): void {
    pendingFocus = key;
    if (controller.state.busy) return;
    const controls = Array.from(list.querySelectorAll<HTMLButtonElement>('button')).filter(
      (el) => !el.disabled,
    );
    const target = controls.find((el) => el.dataset.focus === key);
    (target ?? (add.disabled ? controls[0] : add))?.focus();
    pendingFocus = null;
  }

  function closeEditor(): void {
    const key = editing?.trigger ?? '';
    editing = null;
    editor.hidden = true;
    input.setCustomValidity('');
    // Return focus to the trigger only when the editor owned it (or it was lost); never pull
    // focus back from a usable control the user moved to while an operation completed.
    const active = doc.activeElement;
    if (active === null || active === doc.body || root.contains(active)) restoreFocus(key);
  }

  function openEditor(action: 'add' | 'rename' | 'remove', profile?: Profile): void {
    editing = { action, profile, trigger: profile ? `${action}:${profile.id}` : '' };
    editor.hidden = false;
    get('profile-editor-heading').textContent =
      action === 'add'
        ? 'Add profile'
        : `${action === 'rename' ? 'Rename' : 'Remove'} ${profile?.label}`;
    get('profile-editor-help').textContent =
      action === 'remove'
        ? 'Removing this profile revokes its app access and deletes its saved data from this extension. Your pod is kept.'
        : action === 'add'
          ? 'Enter your account ID to sign in. Your current default stays selected.'
          : 'Choose a name to help you recognise this account.';
    const removal = action === 'remove';
    input.hidden = removal;
    input.required = !removal;
    get('profile-input-label').hidden = removal;
    get('profile-input-label').textContent = action === 'add' ? 'Account ID' : 'Profile name';
    input.type = action === 'add' ? 'url' : 'text';
    input.maxLength = action === 'rename' ? 200 : 2048;
    input.value = action === 'rename' ? (profile?.label ?? '') : '';
    input.setCustomValidity('');
    save.textContent = removal
      ? 'Remove profile'
      : action === 'add'
        ? 'Sign in and add'
        : 'Save name';
    save.classList.toggle('profile-destructive', removal);
    // Destructive confirmation starts on Cancel; Enter on opening cannot remove a profile.
    if (removal) get('profile-cancel').focus();
    else input.focus();
  }

  function focusable(el: HTMLElement): boolean {
    return (
      el.isConnected &&
      root.contains(el) &&
      !(el as HTMLButtonElement).disabled &&
      el.closest('[hidden]') === null
    );
  }

  function render(state: ProfileViewState): void {
    root.setAttribute('aria-busy', String(state.busy));
    // The control focused before this render; if the render disables, hides or replaces it,
    // focus is lost (browsers fix it up to <body> lazily) and is recovered once idle.
    const before = doc.activeElement as HTMLElement | null;
    const hadFocus = before !== null && root.contains(before);
    const signature = JSON.stringify([state.profiles, state.defaultProfileId]);
    if (signature !== listSignature) {
      listSignature = signature;
      const active = doc.activeElement as HTMLElement | null;
      const focusKey = list.contains(active) ? active?.dataset.focus : undefined;
      list.replaceChildren();
      for (const profile of state.profiles) {
        const row = doc.createElement('li');
        row.dataset.profileId = profile.id;
        const identity = doc.createElement('div');
        identity.className = 'profile-identity';
        const avatar = doc.createElement('span');
        avatar.className = 'profile-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent =
          profile.label
            .trim()
            .split(/\s+/)
            .map((part) => part[0])
            .slice(0, 2)
            .join('')
            .toUpperCase() || '?';
        if (profile.avatar && safeAvatar(profile.avatar)) {
          const image = doc.createElement('img');
          image.alt = '';
          image.referrerPolicy = 'no-referrer';
          image.src = profile.avatar;
          image.addEventListener('error', () => image.remove(), { once: true });
          avatar.append(image);
        }
        const text = doc.createElement('div');
        text.className = 'profile-text';
        const name = doc.createElement('strong');
        name.textContent = profile.label;
        const id = doc.createElement('small');
        id.textContent = `Account ID: ${profile.webId}`;
        id.className = 'profile-id';
        id.title = id.textContent;
        const session = doc.createElement('small');
        session.textContent =
          profile.sessionState === 'active'
            ? 'Signed in'
            : profile.sessionState === 'removing'
              ? 'Removal pending'
              : 'Sign-in needed';
        text.append(name, id, session);
        identity.append(avatar, text);
        const actions = doc.createElement('div');
        actions.className = 'profile-actions';
        const selected = state.defaultProfileId === profile.id;
        const select = button(
          selected ? 'Default' : 'Set default',
          `default:${profile.id}`,
          `Set ${profile.label} as default`,
          () => {
            void controller.setDefault(profile.id);
          },
        );
        select.setAttribute('aria-pressed', String(selected));
        actions.append(select);
        if (profile.sessionState === 'signed-out') {
          actions.append(
            button('Sign in', `login:${profile.id}`, `Sign in to ${profile.label}`, () => {
              void controller.add(profile.webId);
            }),
          );
        }
        for (const action of ['rename', 'remove'] as const) {
          const retryRemoval = action === 'remove' && profile.sessionState === 'removing';
          actions.append(
            button(
              retryRemoval ? 'Retry removal' : action === 'rename' ? 'Rename' : 'Remove',
              `${action}:${profile.id}`,
              `${retryRemoval ? 'Retry removal of' : action === 'rename' ? 'Rename' : 'Remove'} ${profile.label}`,
              () => {
                if (retryRemoval) void controller.remove(profile.id);
                else openEditor(action, profile);
              },
            ),
          );
        }
        row.append(identity, actions);
        list.append(row);
        if (profile.sessionState === 'removing') {
          for (const control of row.querySelectorAll('button'))
            control.disabled = control.dataset.focus !== `remove:${profile.id}`;
        }
      }
      if (focusKey) pendingFocus = focusKey;
    }
    get('profiles-count').textContent = `${state.profiles.length} / 8`;
    get('profiles-empty').hidden = !state.ready || state.profiles.length !== 0;
    add.disabled = !state.ready || state.busy || state.profiles.length >= 8;
    get('profile-limit').hidden = state.profiles.length < 8;
    for (const control of list.querySelectorAll('button')) {
      control.setAttribute('aria-disabled', String(state.busy || control.disabled));
    }
    input.readOnly = state.busy;
    save.disabled = state.busy;
    get<HTMLButtonElement>('profile-cancel').disabled = state.busy;
    get('profile-status').textContent =
      state.status || (state.ready || state.error ? '' : 'Loading profiles…');
    get('profile-error').textContent = state.error;
    get('profile-retry').hidden = !state.error || state.busy;
    // Apply disabled states before moving focus, including the busy → idle render.
    if (editing?.profile && !state.profiles.some((p) => p.id === editing?.profile?.id))
      closeEditor();
    if (hadFocus && busyFocus === null && !focusable(before)) busyFocus = before;
    if (pendingFocus !== null) restoreFocus(pendingFocus);
    else if (!state.busy && busyFocus !== null) {
      // Only recover genuinely lost focus: never pull focus back from a usable control the
      // user moved to (e.g. the theme toggle) while the operation was running.
      const active = doc.activeElement as HTMLElement | null;
      if (active === null || active === doc.body || (root.contains(active) && !focusable(active))) {
        if (focusable(busyFocus)) busyFocus.focus();
        else restoreFocus('');
      }
    }
    if (!state.busy) busyFocus = null;
  }
  const controller = new ProfileController(render);
  add.addEventListener('click', () => openEditor('add'));
  get('profile-cancel').addEventListener('click', closeEditor);
  get('profile-retry').addEventListener('click', () => {
    void controller.retry();
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !controller.state.busy) {
      event.preventDefault();
      closeEditor();
    }
  });
  editor.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editing || controller.state.busy) return;
    const { action, profile } = editing;
    if (action !== 'remove' && !input.value.trim()) {
      input.setCustomValidity('Enter a value.');
      input.reportValidity();
      return;
    }
    const operation =
      action === 'add'
        ? controller.add(input.value)
        : action === 'rename'
          ? controller.rename(profile!.id, input.value)
          : controller.remove(profile!.id);
    void operation.then((ok) => {
      if (ok && !disposed) closeEditor();
    });
  });
  // Arrow keys move between profiles at the same action; native Tab/Enter/Space also work.
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const active = doc.activeElement as HTMLElement;
    const action = active.dataset.focus?.split(':')[0];
    if (!action) return;
    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button')).filter(
      (el) => el.dataset.focus?.startsWith(`${action}:`) && !el.disabled,
    );
    const next =
      (buttons.indexOf(active as HTMLButtonElement) +
        (event.key === 'ArrowDown' ? 1 : -1) +
        buttons.length) %
      buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  });
  render(controller.state);
  void controller.refresh();
  return {
    controller,
    cleanup: () => {
      disposed = true;
      controller.dispose();
      root.remove();
    },
  };
}

function safeAvatar(url: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
