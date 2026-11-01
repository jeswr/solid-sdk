// AUTHORED-BY Codex GPT-6.1-Sol

import { formFillFields } from '../shared/formfill';
import { MAX_FORM_FILL_VALUE_LENGTH } from '../shared/formfill-values';
import type { FormFillRequest, FormFillResponse, FormFillTrigger } from '../shared/messages';
import {
  type DetectedField,
  detectField,
  detectFields,
  type FormFillElement,
  fieldRefusalReason,
} from './formfill/detect';
import { refusalReason } from './formfill/refusal';
import { writeValue } from './formfill/write';

/** ISOLATED only: nothing is exposed on window or relayed through postMessage. */
export function installFormFill(view: Window & typeof globalThis): () => void {
  const document = view.document;
  let busy = false;
  let target: FormFillElement | null = null;
  const icons = new Map<HTMLFormElement, { host: HTMLElement; first: FormFillElement }>();
  const categories = new Set<'contact' | 'address'>(['contact', 'address']);
  function permitted(field: DetectedField): boolean {
    try {
      return (
        refusalReason({
          url: view.location.href,
          isTopFrame: view === view.top,
          frameOrigin: view.location.origin,
          topOrigin: view.top!.location.origin,
          field,
          consentedCategories: categories,
        }) === null
      );
    } catch {
      return false;
    }
  }
  const eligible = (root: Document | HTMLFormElement) => detectFields(root).filter(permitted);
  async function fill(root: Document | HTMLFormElement): Promise<void> {
    if (busy) return;
    const fields = eligible(root);
    if (!fields.length) return;
    const origin = view.location.origin;
    busy = true;
    try {
      const request: FormFillRequest = {
        type: 'SOLID_FORMFILL_REQUEST',
        fields: fields.map(({ field, category }) => ({ field, category })),
      };
      const response = (await chrome.runtime.sendMessage(request)) as FormFillResponse | undefined;
      if (
        !response ||
        response.origin !== origin ||
        view.location.origin !== origin ||
        !Array.isArray(response.values)
      )
        return;
      let filled = 0;
      for (const field of fields) {
        if (!field.element.isConnected || fieldRefusalReason(field.element) || !permitted(field))
          continue;
        const current = detectField(field.element);
        if (current?.field !== field.field || current.category !== field.category) continue;
        const approved = response.values.find(
          (v) => v.field === field.field && v.category === field.category,
        );
        if (
          !approved ||
          !formFillFields([approved]).length ||
          typeof approved.value !== 'string' ||
          approved.value.length > MAX_FORM_FILL_VALUE_LENGTH
        )
          continue;
        if (writeValue(field.element, approved.value)) filled++;
      }
      await chrome.runtime.sendMessage({
        type: 'SOLID_FORMFILL_REPORT',
        filled,
        skipped: fields.length - filled,
      });
    } catch {
      /* Closed preview, worker restart or unavailable extension: leave the form alone. */
    } finally {
      busy = false;
    }
  }
  const rememberTarget = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    const element = event.target;
    target =
      element instanceof view.HTMLInputElement ||
      element instanceof view.HTMLTextAreaElement ||
      element instanceof view.HTMLSelectElement
        ? element
        : null;
  };
  document.addEventListener('contextmenu', rememberTarget, true);
  const receive = (message: Partial<FormFillTrigger>, sender: chrome.runtime.MessageSender) => {
    if (message?.type !== 'SOLID_FORMFILL_TRIGGER' || sender.id !== chrome.runtime.id || sender.tab)
      return;
    const active = target ?? document.activeElement;
    if (
      !(
        active instanceof view.HTMLInputElement ||
        active instanceof view.HTMLTextAreaElement ||
        active instanceof view.HTMLSelectElement
      )
    )
      return;
    void fill(active.form ?? document);
  };
  chrome.runtime.onMessage.addListener(receive);

  function scan(): void {
    for (const [form, icon] of icons) {
      if (
        !form.isConnected ||
        eligible(form)[0]?.element !== icon.first ||
        !icon.host.isConnected
      ) {
        icon.host.remove();
        icons.delete(form);
      }
    }
    for (const form of document.forms) {
      if (icons.has(form)) continue;
      const first = eligible(form)[0]?.element;
      if (!first) continue;
      const host = document.createElement('span');
      host.setAttribute('data-solid-formfill', '');
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent =
        ':host{display:inline-block!important;vertical-align:middle!important;margin:0 4px!important}button{font:14px system-ui;cursor:pointer;border:1px solid #777;border-radius:50%;width:28px;height:28px;color:#fff;background:#6554c0}button:focus-visible{outline:3px solid #1785d1;outline-offset:2px}';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '✦';
      button.setAttribute('aria-label', 'Fill from pod');
      button.title = 'Fill from pod';
      button.addEventListener('click', (event) => {
        if (event.isTrusted) void fill(form);
      });
      button.addEventListener('keydown', (event) => {
        if (!event.isTrusted || event.repeat || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        void fill(form);
      });
      shadow.append(style, button);
      first.insertAdjacentElement('afterend', host);
      icons.set(form, { host, first });
    }
  }
  const observer = new view.MutationObserver(scan);
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'autocomplete',
      'type',
      'disabled',
      'readonly',
      'hidden',
      'inert',
      'style',
      'class',
      'form',
      'name',
      'id',
    ],
  });
  scan();
  return () => {
    observer.disconnect();
    document.removeEventListener('contextmenu', rememberTarget, true);
    chrome.runtime.onMessage.removeListener(receive);
    for (const { host } of icons.values()) host.remove();
  };
}
