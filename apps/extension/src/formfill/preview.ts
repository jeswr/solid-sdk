// AUTHORED-BY Codex GPT-6.1-Sol
import { applyResolvedTheme, readStoredTheme, resolveTheme } from '@jeswr/solid-elements';
import type { FieldCategory } from '../content/formfill/detect';
import { FIELD_LABELS } from '../shared/formfill';
import type { FormFillPreview, FormFillPreviewRequest } from '../shared/messages';

async function main(): Promise<void> {
  applyResolvedTheme(resolveTheme(readStoredTheme() ?? 'system'));
  const requestId = new URLSearchParams(window.location.search).get('requestId');
  const error = document.getElementById('error')!;
  const picker = document.getElementById('profile') as HTMLSelectElement;
  const fill = document.getElementById('fill') as HTMLButtonElement;
  const selectionHint = document.getElementById('selection-hint')!;
  const remember = document.getElementById('remember') as HTMLInputElement;
  const boxes = new Map<FieldCategory, HTMLInputElement>();
  let profileId: string | undefined;
  let version = 0;
  let decided = false;
  let loading = true;
  const updateFill = () => {
    const selected = [...boxes.values()].some((box) => box.checked);
    fill.disabled = loading || decided || !selected;
    selectionHint.textContent = selected
      ? 'Only the checked kinds of detail will be filled.'
      : 'Choose at least one kind of detail to fill.';
  };
  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
    fill.disabled = true;
  };
  async function decide(categories: FieldCategory[]): Promise<void> {
    if (!requestId || decided) return;
    decided = true;
    fill.disabled = true;
    try {
      await chrome.runtime.sendMessage({
        type: 'SOLID_FORMFILL_DECISION',
        requestId,
        profileId,
        categories,
        remember: remember.checked,
      } satisfies FormFillPreviewRequest);
    } finally {
      window.close();
    }
  }
  document.getElementById('cancel')!.addEventListener('click', () => {
    void decide([]);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      void decide([]);
    }
  });
  window.addEventListener('pagehide', () => {
    void decide([]);
  });
  document.getElementById('preview')!.addEventListener('submit', (event) => {
    event.preventDefault();
    if (fill.disabled) return;
    void decide([...boxes].filter(([, box]) => box.checked).map(([category]) => category));
  });
  if (!requestId) {
    showError('This fill request is unavailable.');
    return;
  }
  async function load(selected?: string): Promise<void> {
    const generation = ++version;
    loading = true;
    fill.disabled = true;
    error.hidden = true;
    error.textContent = '';
    try {
      const view = (await chrome.runtime.sendMessage({
        type: 'SOLID_FORMFILL_PREVIEW',
        requestId: requestId!,
        profileId: selected,
      } satisfies FormFillPreviewRequest)) as FormFillPreview | null;
      if (generation !== version || decided) return;
      if (!view) {
        showError('This fill request has expired or your account is no longer available.');
        return;
      }
      profileId = view.profileId;
      document.getElementById('origin')!.textContent = view.origin;
      if (!picker.options.length)
        for (const p of view.profiles) {
          const option = document.createElement('option');
          option.value = p.id;
          option.textContent = p.label;
          picker.append(option);
        }
      picker.value = profileId;
      picker.disabled = false;
      remember.checked = view.selected.length > 0;
      const container = document.getElementById('categories')!;
      container.replaceChildren();
      boxes.clear();
      for (const category of ['contact', 'address'] as const) {
        const values = view.values.filter((v) => v.category === category);
        if (!values.length) continue;
        const group = document.createElement('fieldset');
        group.className = 'data-card category-card';
        const legend = document.createElement('legend');
        const heading = document.createElement('div');
        heading.className = 'category-header';
        const title = category === 'contact' ? 'Contact details' : 'Address';
        legend.textContent = title;
        legend.className = 'visually-hidden';
        const label = document.createElement('label');
        label.className = 'card-check card-title';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = view.selected.includes(category);
        box.setAttribute('aria-describedby', `${category}-hint`);
        box.addEventListener('change', updateFill);
        boxes.set(category, box);
        label.append(box, ` ${title}`);
        heading.append(label);
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.id = `${category}-hint`;
        hint.textContent =
          category === 'contact'
            ? 'Fill the matching name, email and phone fields with these values.'
            : 'Fill the matching address fields with these values.';
        group.append(legend, heading, hint);
        const list = document.createElement('dl');
        for (const value of values) {
          const term = document.createElement('dt');
          term.textContent = FIELD_LABELS[value.field];
          const description = document.createElement('dd');
          description.textContent = value.value;
          list.append(term, description);
        }
        group.append(list);
        container.append(group);
      }
      document.getElementById('empty')!.hidden = view.values.length > 0;
      loading = false;
      updateFill();
    } catch {
      if (generation === version) showError('Could not load your account. Please try again.');
    }
  }
  picker.addEventListener('change', () => {
    void load(picker.value);
  });
  await load();
}
void main();
