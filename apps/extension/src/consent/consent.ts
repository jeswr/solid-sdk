// AUTHORED-BY Claude Opus 4.8
/** Extension-owned ConsentSheet. Untrusted request copy is always rendered as text. */
import { applyResolvedTheme, readStoredTheme, resolveTheme } from '@jeswr/solid-elements';
import { accessModeLabel, dataClassCopy } from '../shared/data-labels';
import type { ConsentDecisionMessage, PendingConsentView } from '../shared/messages';

function fmtExpiry(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string; id?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.id) node.id = opts.id;
  return node;
}

/** Visible scope summary; a folder grant covers everything inside it, so say so. */
function scopeSummary(targets: PendingConsentView['classes'][number]['targets']): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const folders = targets.filter((t) => t.kind === 'container').length;
  const items = targets.length - folders;
  const parts: string[] = [];
  if (folders)
    parts.push(
      `${plural(folders, 'folder', 'folders')} and ${folders === 1 ? 'its' : 'their'} contents`,
    );
  if (items || !folders) parts.push(plural(items, 'item', 'items'));
  return parts.join(' and ');
}

function renderClasses(view: PendingConsentView): Map<string, HTMLInputElement> {
  const container = document.getElementById('classes')!;
  const boxes = new Map<string, HTMLInputElement>();
  container.replaceChildren();
  for (const [index, c] of view.classes.entries()) {
    const copy = dataClassCopy(c.dataClass);
    const item = el('article', { class: 'class-item data-card' });
    const titleId = `class-title-${index}`;
    const descriptionId = `class-description-${index}`;
    item.setAttribute('aria-labelledby', titleId);
    const head = el('label', { class: 'class-head card-check' });
    const box = el('input');
    box.type = 'checkbox';
    box.checked = c.targets.length > 0;
    box.setAttribute('aria-labelledby', titleId);
    box.setAttribute('aria-describedby', descriptionId);
    boxes.set(c.dataClass, box);
    const titleWrap = el('span');
    titleWrap.append(
      el('span', { class: 'class-title card-title', text: copy.label, id: titleId }),
      el('span', {
        class: 'card-description hint',
        text: copy.description,
        id: descriptionId,
      }),
    );
    head.append(box, titleWrap);
    const chips = el('div', { class: 'chips' });
    for (const mode of c.modes)
      chips.append(el('span', { class: 'chip', text: accessModeLabel(mode) }));
    const purpose = c.purpose ? `For: ${c.purpose} · ` : '';
    item.append(
      head,
      chips,
      el('p', {
        class: 'meta',
        text: `${purpose}${scopeSummary(c.targets)} · Ends ${fmtExpiry(c.expiresAt)}`,
      }),
    );
    if (c.targets.length > 0) {
      const scope = el('details', { class: 'scope-details' });
      scope.append(el('summary', { text: 'See included items' }));
      const list = el('ul', { class: 'targets' });
      for (const target of c.targets) {
        list.append(
          el('li', {
            text: `${target.url}${target.kind === 'container' ? ' (folder and its contents)' : ''}`,
            class: target.kind === 'container' ? 'container-target' : undefined,
          }),
        );
      }
      scope.append(list);
      item.append(scope);
    }
    container.append(item);
  }
  document.getElementById('empty-note')!.hidden = view.classes.some((c) => c.targets.length > 0);
  return boxes;
}

function renderRequest(view: PendingConsentView): void {
  document.getElementById('origin')!.textContent = view.origin;
  const purposes = [...new Set(view.classes.map((c) => c.purpose?.trim()).filter(Boolean))];
  document.getElementById('purpose-headline')!.textContent = purposes.length
    ? `To ${purposes.join('; ')}, `
    : '';
  document.getElementById('webid')!.textContent =
    view.profiles.find((profile) => profile.id === view.profileId)?.label ?? 'Selected account';
  // The existing decision protocol cannot change an expiry. Show only the worker's
  // requested end date; never suggest a duration choice that would not be honoured.
  const expiries = [...new Set(view.classes.map((c) => c.expiresAt))];
  document.getElementById('duration-label')!.textContent =
    expiries.length === 1 ? `Until ${fmtExpiry(expiries[0])}` : 'End dates shown on each card';
}

async function main(): Promise<void> {
  applyResolvedTheme(resolveTheme(readStoredTheme() ?? 'system'));
  const consentId = new URLSearchParams(window.location.search).get('consentId');
  const approve = document.getElementById('approve') as HTMLButtonElement;
  const picker = document.getElementById('profile') as HTMLSelectElement;
  const selectAll = document.getElementById('select-all') as HTMLInputElement;
  const container = document.getElementById('classes')!;
  const error = document.getElementById('error')!;
  let boxes = new Map<string, HTMLInputElement>();
  let selectedProfileId: string | undefined;
  let loading = true;
  let decided = false;
  let version = 0;
  const updateSelection = () => {
    const checked = [...boxes.values()].filter((box) => box.checked).length;
    approve.disabled = loading || decided || checked === 0;
    selectAll.disabled = loading || decided || boxes.size === 0;
    selectAll.checked = boxes.size > 0 && checked === boxes.size;
    selectAll.indeterminate = checked > 0 && checked < boxes.size;
    document.getElementById('selection-hint')!.textContent = checked
      ? `${checked} ${checked === 1 ? 'data type' : 'data types'} selected. Only checked data will be shared.`
      : 'Choose at least one data type to share.';
  };
  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
    loading = true;
    updateSelection();
  };
  const decide = (approvedClasses: string[]) => {
    if (!consentId || decided) return;
    decided = true;
    updateSelection();
    const message: ConsentDecisionMessage = {
      type: 'SOLID_CONSENT_DECISION',
      consentId,
      approvedClasses,
      // Retain the existing denial payload; only an approval needs an account binding.
      ...(approvedClasses.length ? { profileId: selectedProfileId } : {}),
    };
    chrome.runtime.sendMessage(message, () => window.close());
  };
  document.getElementById('deny')!.addEventListener('click', () => decide([]));
  approve.addEventListener('click', () => {
    if (!approve.disabled)
      decide([...boxes].filter(([, box]) => box.checked).map(([dataClass]) => dataClass));
  });
  container.addEventListener('change', updateSelection);
  selectAll.addEventListener('change', () => {
    for (const box of boxes.values()) box.checked = selectAll.checked;
    updateSelection();
  });
  // Closing the trusted window still denies the request, without overwriting an approval.
  window.addEventListener('pagehide', () => {
    try {
      decide([]);
    } catch {
      // Best effort when extension chrome is being destroyed.
    }
  });
  if (!consentId) {
    showError('Missing consent request id.');
    return;
  }
  async function load(profileId?: string): Promise<void> {
    const generation = ++version;
    loading = true;
    error.hidden = true;
    error.textContent = '';
    container.setAttribute('aria-busy', 'true');
    updateSelection();
    try {
      const view = (await chrome.runtime.sendMessage({
        type: 'SOLID_GET_PENDING_CONSENT',
        consentId,
        ...(profileId ? { profileId } : {}),
      })) as PendingConsentView | null;
      if (generation !== version || decided) return;
      if (!view) {
        showError('This access request has expired or the account is no longer available.');
        return;
      }
      selectedProfileId = view.profileId;
      renderRequest(view);
      boxes = renderClasses(view);
      picker.replaceChildren(
        ...view.profiles.map((profile) => {
          const option = el('option', { text: profile.label });
          option.value = profile.id;
          return option;
        }),
      );
      picker.value = selectedProfileId;
      // The worker includes only active accounts in this request's choices.
      document.getElementById('account-switcher')!.hidden = view.profiles.length <= 1;
      picker.disabled = view.profiles.length <= 1;
      loading = false;
      updateSelection();
    } catch {
      if (generation === version && !decided) showError('Could not load the selected account.');
    } finally {
      if (generation === version) container.setAttribute('aria-busy', 'false');
    }
  }
  picker.addEventListener('change', () => void load(picker.value));
  await load();
}

void main();
