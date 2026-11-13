// AUTHORED-BY Codex GPT-6
import { AgentSignIn } from './agent-sign-in';

/** The only capture UI. No page messages, credential rendering, storage or automatic capture. */
export function mountAgentSignIn(root: HTMLElement, browser = chrome): void {
  const element = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const status = element('agent-sign-in-status');
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
  const discard = () => {
    controller.cancel();
    preview.hidden = true;
    confirm.disabled = true;
    review.disabled = busy || !persona.value;
  };
  const setBusy = (value: boolean) => {
    busy = value;
    review.disabled = value || !persona.value;
    profile.disabled = value;
    persona.disabled = value;
    confirm.disabled = value || preview.hidden;
  };
  profile.addEventListener('change', discard);
  persona.addEventListener('change', discard);
  cancel.addEventListener('click', () => {
    discard();
    status.textContent = 'Sharing cancelled.';
  });
  review.addEventListener('click', () => {
    if (busy) return;
    discard();
    // Initiate before yielding the user gesture to any asynchronous work.
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
        () => {
          discard();
          status.textContent =
            'Could not prepare sharing. Check the native host, selected site and cookie permission.';
        },
      )
      .finally(() => {
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
        () => {
          status.textContent = 'Sharing was not confirmed. Review again to retry.';
        },
      )
      .finally(() => {
        discard();
        setBusy(false);
      });
  });
  void controller.load().then(
    ({ site, choices }) => {
      element('agent-site').textContent = site;
      const option = (value: string, label: string) => {
        const node = document.createElement('option');
        node.value = value;
        node.textContent = label;
        return node;
      };
      profile.replaceChildren(...choices.profiles.map((p) => option(p.id, p.label)));
      const fillPersonas = () => {
        persona.replaceChildren(
          option('', 'Choose a persona'),
          ...choices.personas
            .filter((p) => p.profile === profile.value)
            .map((p) => option(p.id, p.label)),
        );
        setBusy(false);
      };
      profile.addEventListener('change', fillPersonas);
      fillPersonas();
      status.textContent = choices.personas.length
        ? 'Sign in on this site, then choose your vault profile and persona.'
        : 'Add an account for this exact site in the vault, then reopen this popup.';
    },
    () => {
      status.textContent =
        'Open a signed-in HTTPS site and install the agent vault native host to share its sign-in.';
    },
  );
}
