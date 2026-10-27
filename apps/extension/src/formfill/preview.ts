// AUTHORED-BY Codex GPT-6.1-Sol
import type { FieldCategory } from '../content/formfill/detect';
import { FIELD_LABELS } from '../shared/formfill';
import type { FormFillPreview, FormFillPreviewRequest } from '../shared/messages';

async function main(): Promise<void> {
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
    try {
      const view = (await chrome.runtime.sendMessage({
        type: 'SOLID_FORMFILL_PREVIEW',
        requestId: requestId!,
        profileId: selected,
      } satisfies FormFillPreviewRequest)) as FormFillPreview | null;
      if (generation !== version || decided) return;
      if (!view) {
        showError('This fill request has expired or your profile is no longer available.');
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
        const legend = document.createElement('legend');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = view.selected.includes(category);
        box.addEventListener('change', updateFill);
        boxes.set(category, box);
        label.append(box, category === 'contact' ? ' Contact details' : ' Address');
        legend.append(label);
        group.append(legend);
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
      if (generation === version) showError('Could not load your profile. Please try again.');
    }
  }
  picker.addEventListener('change', () => {
    void load(picker.value);
  });
  await load();
}
void main();
