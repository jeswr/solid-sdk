// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type CaptureIntent,
  type CaptureView,
  terminalCapturePhase,
} from '../shared/agent-capture';
import { CAPTURE_PERMISSION_PORT, capturePermissions } from '../shared/agent-capture-permissions';

/** A port-backed view. The only local capability is the gesture-bound cookie request. */
export function mountAgentSignIn(root: HTMLElement, browser = chrome): void {
  const element = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const status = element('agent-sign-in-status');
  const warning = element('agent-permission-warning');
  const warningMessage = element('agent-permission-warning-message');
  const remove = element<HTMLButtonElement>('agent-remove-cookie-access');
  const profile = element<HTMLSelectElement>('agent-profile');
  const persona = element<HTMLSelectElement>('agent-persona');
  const review = element<HTMLButtonElement>('agent-review');
  const confirm = element<HTMLButtonElement>('agent-confirm');
  const cancel = element<HTMLButtonElement>('agent-cancel');
  const preview = element('agent-preview');
  const port = browser.runtime.connect({ name: CAPTURE_PERMISSION_PORT });
  let view: CaptureView = {
    phase: 'loading',
    message: 'Loading sign-in sharing…',
    warning: false,
    cleanupFailed: false,
  };
  let closed = false;
  const send = (intent: CaptureIntent) => {
    if (!closed) port.postMessage(intent);
  };
  let choices: CaptureView['choices'];
  const option = (value: string, label: string) => {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  };
  const fillPersonas = () =>
    persona.replaceChildren(
      option('', 'Choose a persona'),
      ...(choices?.personas
        .filter((p) => p.profile === profile.value)
        .map((p) => option(p.id, p.label)) ?? []),
    );
  // This synchronous snapshot is updated only by worker pushes; no await can precede
  // the gesture-bound request. An armed lease must match both the latest push and view.
  let validated: CaptureView | undefined;
  const armed = () =>
    !closed &&
    !view.warning &&
    view.phase === 'permission' &&
    view.lease !== undefined &&
    validated?.phase === 'permission' &&
    validated.armedLease === view.lease &&
    validated.lease === view.lease;
  const render = (next: CaptureView) => {
    // Cancellation is visible immediately, even while the worker awaits removal/native I/O.
    // Delayed progress or a native response cannot resurrect a terminal view for this lease.
    if (view.lease !== undefined && view.lease === next.lease && terminalCapturePhase(view.phase)) {
      next = { ...view, warning: next.warning, cleanupFailed: next.cleanupFailed };
    }
    view = next;
    status.textContent = view.message;
    warning.hidden = !view.warning;
    warningMessage.textContent = view.cleanupFailed
      ? "Cookie access could not be removed or its absence verified. Sharing is blocked. Remove it from Chrome's extension settings before sharing."
      : 'Cleaning up a previous sharing. Cookie access is being removed before sharing a sign-in.';
    if (view.site) element('agent-site').textContent = view.site;
    if (view.choices !== choices) {
      choices = view.choices;
      profile.replaceChildren(...(choices?.profiles.map((p) => option(p.id, p.label)) ?? []));
      fillPersonas();
    }
    const ready = view.phase === 'ready' && !view.warning;
    profile.disabled = !ready;
    persona.disabled = !ready;
    review.textContent =
      view.phase === 'permission' ? 'Allow cookies and review' : 'Review sign-in sharing';
    review.disabled = !(ready && persona.value) && !armed();
    confirm.disabled = view.phase !== 'confirming' || view.warning;
    preview.hidden = view.phase !== 'confirming';
    if (view.preview && !preview.hidden) {
      const { count, persona: person, profile: vault } = view.preview;
      preview.textContent = `Share ${count} ${count === 1 ? 'cookie' : 'cookies'} for ${view.site} with ${person} (${vault})? This gives your agent this site’s sign-in.`;
    }
    remove.disabled =
      !view.warning || !['ready', 'failed', 'cancelled', 'shared'].includes(view.phase);
    cancel.disabled = view.lease === undefined || terminalCapturePhase(view.phase);
  };
  port.onMessage.addListener((next: CaptureView) => {
    validated = next;
    render(next);
  });
  port.onDisconnect.addListener(() => {
    void browser.runtime.lastError;
    closed = true;
    if (!terminalCapturePhase(view.phase))
      render({
        ...view,
        phase: 'failed',
        message: 'Sharing disconnected. Reopen the popup to check cookie access.',
      });
  });
  profile.addEventListener('change', () => {
    fillPersonas();
    render(view);
  });
  persona.addEventListener('change', () => render(view));
  cancel.addEventListener('click', () => {
    if (view.lease === undefined || terminalCapturePhase(view.phase)) return;
    send({ type: 'cancel', lease: view.lease });
    render({ ...view, phase: 'cancelled', message: 'Sharing cancelled.', preview: undefined });
  });
  review.addEventListener('click', () => {
    if (view.phase === 'ready' && !view.warning && persona.value) {
      send({ type: 'start', profile: profile.value, persona: persona.value });
    } else if (armed()) {
      const lease = view.lease!;
      send({ type: 'requesting', lease });
      if (!armed() || view.lease !== lease) {
        send({ type: 'permission', lease, granted: false });
        return;
      }
      render({ ...view, phase: 'prompt', message: 'Waiting for cookie permission…' });
      // No await/message round trip before this API: it executes INSIDE this click gesture,
      // and only after the worker has exclusively acquired and validated the lease.
      try {
        void browser.permissions.request(capturePermissions()).then(
          (granted) => send({ type: 'permission', lease, granted }),
          () => send({ type: 'permission', lease, granted: false }),
        );
      } catch {
        send({ type: 'permission', lease, granted: false });
      }
    }
  });
  confirm.addEventListener('click', () => {
    if (view.phase === 'confirming' && view.lease !== undefined && !view.warning)
      send({ type: 'confirm', lease: view.lease });
  });
  remove.addEventListener('click', () => {
    if (!remove.disabled) send({ type: 'removeCookieAccess' });
  });
  render(view);
  send({ type: 'load' });
}
