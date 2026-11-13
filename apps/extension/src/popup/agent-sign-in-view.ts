// AUTHORED-BY Codex GPT-6
import { AgentCookieAccessRequired, AgentSignIn, AgentSiteAccessRequired } from './agent-sign-in';

/** The only capture UI. No page messages, credential rendering, storage or automatic capture. */
export function mountAgentSignIn(root: HTMLElement, browser = chrome): void {
  const element = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const status = element('agent-sign-in-status');
  const warning = element('agent-permission-warning');
  const warningMessage = element('agent-permission-warning-message');
  const removeAccess = element<HTMLButtonElement>('agent-remove-cookie-access');
  const profile = element<HTMLSelectElement>('agent-profile');
  const persona = element<HTMLSelectElement>('agent-persona');
  const review = element<HTMLButtonElement>('agent-review');
  const confirm = element<HTMLButtonElement>('agent-confirm');
  const cancel = element<HTMLButtonElement>('agent-cancel');
  const preview = element('agent-preview');
  const controller = new AgentSignIn(browser, async (request) => {
    const response: unknown = await browser.runtime.sendMessage({ type: 'AGENT_VAULT', request });
    if (
      !response ||
      typeof response !== 'object' ||
      !('ok' in response) ||
      response.ok !== true ||
      !('result' in response)
    )
      throw 0;
    return response.result;
  });
  let busy = false;
  let loaded = false;
  let personas: Awaited<ReturnType<AgentSignIn['load']>>['choices']['personas'] = [];
  const warningText = warningMessage.textContent;
  const removalFailed = () => {
    warningMessage.textContent =
      "Cookie access could not be removed or its absence verified. Remove it from Chrome's extension settings before sharing.";
  };
  const isAccessError = (error: unknown): error is Error =>
    error instanceof AgentSiteAccessRequired || error instanceof AgentCookieAccessRequired;
  const showWarning = () => {
    warning.hidden = !controller.permissionWarning;
  };
  const discard = () => {
    controller.cancel();
    preview.hidden = true;
    confirm.disabled = true;
    review.disabled = busy || controller.permissionWarning || !loaded || !persona.value;
  };
  const setBusy = (value: boolean) => {
    busy = value;
    showWarning();
    const blocked = value || controller.permissionWarning || !loaded;
    review.disabled = blocked || !persona.value;
    profile.disabled = blocked;
    persona.disabled = blocked;
    confirm.disabled = blocked || preview.hidden;
    removeAccess.disabled = value;
  };
  const option = (value: string, label: string) => {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  };
  const fillPersonas = () => {
    persona.replaceChildren(
      option('', 'Choose a persona'),
      ...personas.filter((p) => p.profile === profile.value).map((p) => option(p.id, p.label)),
    );
  };
  profile.addEventListener('change', () => {
    discard();
    fillPersonas();
    setBusy(busy);
  });
  persona.addEventListener('change', discard);
  cancel.addEventListener('click', () => {
    discard();
    status.textContent = 'Sharing cancelled.';
  });
  review.addEventListener('click', () => {
    if (busy) return;
    discard();
    // Keep the cookies request in this click's call chain, after the host-access check.
    const pending = controller.review(profile.value, persona.value);
    setBusy(true);
    status.textContent = 'Preparing sign-in review…';
    void pending
      .then(
        (result) => {
          preview.textContent = `Share ${result.count} ${result.count === 1 ? 'cookie' : 'cookies'} for ${result.site} with ${result.persona} (${result.profile})? This gives your agent this site’s sign-in.`;
          preview.hidden = false;
          status.textContent = 'Review, then confirm to send to your local vault.';
        },
        (error: unknown) => {
          discard();
          status.textContent = isAccessError(error)
            ? error.message
            : 'Could not prepare sharing. Check the native host, selected site and cookie permission.';
        },
      )
      .finally(() => {
        showWarning();
        setBusy(false);
        if (!preview.hidden) confirm.focus();
      });
  });
  confirm.addEventListener('click', () => {
    if (busy || preview.hidden) return;
    setBusy(true);
    void controller
      .share()
      .then(
        () => {
          status.textContent =
            'Sign-in shared. When the vault reports it stale, sign in here and share again.';
        },
        (error: unknown) => {
          status.textContent = isAccessError(error)
            ? error.message
            : 'Sharing was not confirmed. Review again to retry.';
        },
      )
      .finally(() => {
        showWarning();
        discard();
        setBusy(false);
      });
  });
  const load = async () => {
    loaded = false;
    setBusy(true);
    try {
      const { site, choices } = await controller.load();
      element('agent-site').textContent = site;
      profile.replaceChildren(...choices.profiles.map((p) => option(p.id, p.label)));
      personas = choices.personas;
      fillPersonas();
      loaded = true;
      status.textContent = choices.personas.length
        ? 'Sign in on this site, then choose your vault profile and persona.'
        : 'Add an account for this exact site in the vault, then reopen this popup.';
    } catch (error: unknown) {
      status.textContent = isAccessError(error)
        ? error.message
        : 'Open a signed-in HTTPS site and install the agent vault native host to share its sign-in.';
    } finally {
      setBusy(false);
    }
  };
  removeAccess.addEventListener('click', () => {
    if (busy) return;
    discard();
    setBusy(true);
    warningMessage.textContent = warningText;
    void controller
      .removeCookieAccess()
      .then(async (removed) => {
        if (removed) await load();
        else removalFailed();
      }, removalFailed)
      .finally(() => setBusy(false));
  });
  void load();
}
