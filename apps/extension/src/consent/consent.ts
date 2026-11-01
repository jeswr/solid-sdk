// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/** Extension-owned ConsentSheet. Untrusted request copy is always rendered as text. */
import { applyResolvedTheme, readStoredTheme, resolveTheme } from '@jeswr/solid-elements';
import { accessModeLabel, dataClassCopy } from '../shared/data-labels';
import type { ActionResult, ConsentDecisionMessage, PendingConsentView } from '../shared/messages';
import { PIM_STORAGE_CLASS } from '../shared/storage-class';

/** Whole-pod warning copy derived from the modes actually requested (write implies append). */
function storageWarning(modes: readonly string[]): string {
  const read = modes.includes('read');
  const write = modes.includes('write');
  const append = modes.includes('append');
  if (read && write) return 'This site can read and change everything in this pod';
  if (read && append) return 'This site can read everything in this pod and add to it';
  if (write) return 'This site can change everything in this pod';
  if (append) return 'This site can add to anything in this pod';
  return 'This site can read everything in this pod';
}

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

type ConsentTargetView = PendingConsentView['classes'][number]['targets'][number];

/** Per class: its select-all box and one box per target id. */
interface ClassSelection {
  readonly box: HTMLInputElement;
  readonly targets: Map<string, HTMLInputElement>;
}

const SOURCE_HEADINGS: Record<ConsentTargetView['source'], string> = {
  sai: 'From your data registries',
  'type-index': 'From your type index',
};

/** The class box mirrors its targets: checked when all are, mixed when some are. */
function syncClassBox(selection: ClassSelection): void {
  const boxes = [...selection.targets.values()];
  const checked = boxes.filter((box) => box.checked).length;
  selection.box.checked = boxes.length > 0 && checked === boxes.length;
  selection.box.indeterminate = checked > 0 && checked < boxes.length;
}

function renderClasses(view: PendingConsentView): Map<string, ClassSelection> {
  const container = document.getElementById('classes')!;
  const selections = new Map<string, ClassSelection>();
  container.replaceChildren();
  for (const [index, c] of view.classes.entries()) {
    const isStorage = c.dataClass === PIM_STORAGE_CLASS;
    const copy = dataClassCopy(c.dataClass);
    const item = el('article', { class: 'class-item data-card' });
    const titleId = `class-title-${index}`;
    const descriptionId = `class-description-${index}`;
    item.setAttribute('aria-labelledby', titleId);
    const head = el('label', { class: 'class-head card-check' });
    const box = el('input');
    box.type = 'checkbox';
    // A class with nothing to pin cannot be granted (C5), so it cannot be selected.
    box.disabled = c.targets.length === 0;
    box.setAttribute('aria-labelledby', titleId);
    box.setAttribute('aria-describedby', descriptionId);
    const selection: ClassSelection = { box, targets: new Map() };
    selections.set(c.dataClass, selection);
    const titleWrap = el('span');
    titleWrap.append(
      el('span', { class: 'class-title card-title', text: copy.label, id: titleId }),
      el('span', {
        class: isStorage ? 'card-description warning' : 'card-description hint',
        text: isStorage ? storageWarning(c.modes) : copy.description,
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
    if (c.truncated) item.appendChild(el('p', { text: 'Some data could not be checked' }));
    if (c.targets.length > 0) {
      const lists = el('div', { class: 'target-groups' });
      const sources = [...new Set(c.targets.map((target) => target.source))];
      for (const source of sources) {
        // Whole-pod storage has one source and its own warning; a heading adds nothing.
        if (!isStorage)
          lists.append(el('p', { class: 'target-group', text: SOURCE_HEADINGS[source] }));
        const list = el('ul', { class: 'targets' });
        for (const target of c.targets.filter((t) => t.source === source)) {
          const row = el('li', {
            class: target.kind === 'container' ? 'container-target' : undefined,
          });
          const label = el('label', { class: 'target-check' });
          const targetBox = el('input');
          targetBox.type = 'checkbox';
          targetBox.checked = target.preselected;
          targetBox.dataset.targetId = target.id;
          selection.targets.set(target.id, targetBox);
          label.append(
            targetBox,
            el('span', {
              text: `${target.url}${!isStorage && target.kind === 'container' ? ' (folder and its contents)' : ''}`,
            }),
          );
          row.append(label);
          if (!target.preselected && !isStorage) {
            const hintId = `target-hint-${target.id}`;
            targetBox.setAttribute('aria-describedby', hintId);
            row.append(
              el('span', {
                class: 'target-hint hint',
                id: hintId,
                text: `Couldn't confirm this holds ${copy.label.toLowerCase()}`,
              }),
            );
          }
          list.append(row);
        }
        lists.append(list);
      }
      if (isStorage) item.append(lists);
      else {
        const scope = el('details', { class: 'scope-details' });
        // Unconfirmed targets start unselected; open the list so that choice is visible.
        scope.open = c.targets.some((target) => !target.preselected);
        scope.append(el('summary', { text: 'See included items' }), lists);
        item.append(scope);
      }
    }
    syncClassBox(selection);
    container.append(item);
  }
  document.getElementById('empty-note')!.hidden = view.classes.some((c) => c.targets.length > 0);
  return selections;
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
  let selections = new Map<string, ClassSelection>();
  const targetBoxes = () => [...selections.values()].flatMap((c) => [...c.targets.values()]);
  let selectedProfileId: string | undefined;
  let loading = true;
  let decided = false;
  let version = 0;
  const updateSelection = () => {
    const all = targetBoxes();
    const checked = all.filter((box) => box.checked).length;
    for (const selection of selections.values()) syncClassBox(selection);
    approve.disabled = loading || decided || checked === 0;
    selectAll.disabled = loading || decided || all.length === 0;
    selectAll.checked = all.length > 0 && checked === all.length;
    selectAll.indeterminate = checked > 0 && checked < all.length;
    document.getElementById('selection-hint')!.textContent = checked
      ? `${checked} ${checked === 1 ? 'item' : 'items'} selected. Only checked items will be shared.`
      : 'Choose at least one item to share.';
  };
  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
    loading = true;
    updateSelection();
  };
  const decide = (approvedTargets: Record<string, string[]>) => {
    if (!consentId || decided) return;
    decided = true;
    picker.disabled = true;
    updateSelection();
    const approving = Object.keys(approvedTargets).length > 0;
    const message: ConsentDecisionMessage = {
      type: 'SOLID_CONSENT_DECISION',
      consentId,
      approvedTargets,
      // Retain the existing denial payload; only an approval needs an account binding.
      ...(approving ? { profileId: selectedProfileId } : {}),
    };
    chrome.runtime.sendMessage(message, (result: ActionResult | undefined) => {
      if (result?.error) showError(result.error);
      else window.close();
    });
  };
  document.getElementById('deny')!.addEventListener('click', () => {
    if (decided) window.close();
    else decide({});
  });
  approve.addEventListener('click', () => {
    if (approve.disabled) return;
    const approved: Record<string, string[]> = {};
    for (const [dataClass, selection] of selections) {
      const ids = [...selection.targets].filter(([, box]) => box.checked).map(([id]) => id);
      if (ids.length) approved[dataClass] = ids;
    }
    decide(approved);
  });
  container.addEventListener('change', (event) => {
    // A class box selects or clears every target in its class.
    for (const selection of selections.values()) {
      if (event.target !== selection.box) continue;
      for (const box of selection.targets.values()) box.checked = selection.box.checked;
    }
    updateSelection();
  });
  selectAll.addEventListener('change', () => {
    for (const box of targetBoxes()) box.checked = selectAll.checked;
    updateSelection();
  });
  // Closing the trusted window still denies the request, without overwriting an approval.
  window.addEventListener('pagehide', () => {
    try {
      decide({});
    } catch {
      // Best effort when extension chrome is being destroyed.
    }
  });
  if (!consentId) {
    showError('Missing consent request id.');
    return;
  }
  async function load(profileId?: string): Promise<void> {
    if (decided) return;
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
      selections = renderClasses(view);
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
