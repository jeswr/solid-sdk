// AUTHORED-BY Claude Opus 4.8
/**
 * The per-data-class CONSENT WINDOW — the unspoofable consent surface (design §4.1). It runs
 * in the extension's OWN chrome (a `chrome-extension://` page opened by the service worker),
 * so the requesting origin cannot spoof or script it. It renders the pending request in
 * data-class terms — the requesting app, each requested data class, its modes, purpose, expiry,
 * and the RESOLVED TARGET SET ("this will share these N resources", design §3.4 step 2) — with
 * a per-class approve checkbox, and posts the decision back to the worker.
 *
 * All rendering uses `textContent` (never `innerHTML`) so an app-supplied class IRI / purpose /
 * target URL can never inject markup into the extension's trusted chrome.
 */

import type { ConsentDecisionMessage, PendingConsentView } from '../shared/messages';

function fmtExpiry(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { class?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}

function showError(message: string): void {
  const err = document.getElementById('error');
  if (err) {
    err.textContent = message;
    err.hidden = false;
  }
  for (const id of ['approve']) {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (b) b.disabled = true;
  }
}

function renderClasses(view: PendingConsentView): Map<string, HTMLInputElement> {
  const container = document.getElementById('classes');
  const boxes = new Map<string, HTMLInputElement>();
  if (!container) return boxes;
  let anyTargets = false;

  for (const c of view.classes) {
    const item = el('div', { class: 'class-item' });

    const head = el('label', { class: 'class-head' });
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = c.targets.length > 0; // default-approve only classes that resolved to something
    boxes.set(c.dataClass, box);
    const titleWrap = el('div');
    titleWrap.appendChild(el('div', { class: 'class-title', text: c.dataClass }));
    const chips = el('div', { class: 'chips' });
    for (const m of c.modes) chips.appendChild(el('span', { class: 'chip', text: m }));
    titleWrap.appendChild(chips);
    head.appendChild(box);
    head.appendChild(titleWrap);
    item.appendChild(head);

    const meta = el('div', { class: 'meta' });
    const purposeText = c.purpose ? `Purpose: ${c.purpose} · ` : '';
    meta.textContent = `${purposeText}Expires: ${fmtExpiry(c.expiresAt)} · ${c.targets.length} resource(s)`;
    item.appendChild(meta);

    if (c.targets.length > 0) {
      anyTargets = true;
      const list = el('ul', { class: 'targets' });
      for (const t of c.targets) {
        const li = el('li', { text: t.url });
        if (t.kind === 'container') li.className = 'container-target';
        list.appendChild(li);
      }
      item.appendChild(list);
    }
    container.appendChild(item);
  }

  const emptyNote = document.getElementById('empty-note');
  if (emptyNote) emptyNote.hidden = anyTargets;
  return boxes;
}

function sendDecision(consentId: string, approvedClasses: string[]): void {
  const msg: ConsentDecisionMessage = {
    type: 'SOLID_CONSENT_DECISION',
    consentId,
    approvedClasses,
  };
  chrome.runtime.sendMessage(msg, () => {
    // Close regardless — the worker has recorded the decision (or the window was already gone).
    window.close();
  });
}

async function main(): Promise<void> {
  const consentId = new URLSearchParams(window.location.search).get('consentId');
  if (!consentId) {
    showError('Missing consent request id.');
    return;
  }

  let view: PendingConsentView | null = null;
  try {
    view = (await chrome.runtime.sendMessage({
      type: 'SOLID_GET_PENDING_CONSENT',
      consentId,
    })) as PendingConsentView | null;
  } catch {
    view = null;
  }
  if (!view) {
    showError('This access request has expired or is no longer available.');
    return;
  }

  const originEl = document.getElementById('origin');
  if (originEl) originEl.textContent = view.origin;
  const webidEl = document.getElementById('webid');
  if (webidEl) webidEl.textContent = `(${view.webId})`;

  const boxes = renderClasses(view);

  document.getElementById('approve')?.addEventListener('click', () => {
    const approved: string[] = [];
    for (const [dataClass, box] of boxes) if (box.checked) approved.push(dataClass);
    sendDecision(consentId, approved);
  });
  document.getElementById('deny')?.addEventListener('click', () => {
    sendDecision(consentId, []);
  });

  // If the window is closed with the OS chrome (no button), treat it as a denial so the
  // requestAccess promise still resolves (fail-closed) rather than hanging.
  window.addEventListener('pagehide', () => {
    try {
      chrome.runtime.sendMessage({
        type: 'SOLID_CONSENT_DECISION',
        consentId,
        approvedClasses: [],
      } satisfies ConsentDecisionMessage);
    } catch {
      // best-effort
    }
  });
}

void main();
