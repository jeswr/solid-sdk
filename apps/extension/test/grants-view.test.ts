// AUTHORED-BY Codex GPT-6.1-Sol
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GrantsController,
  type GrantsMessage,
  type GrantsResponse,
} from '../src/sidepanel/grants-controller';
import { mountGrantsView } from '../src/sidepanel/grants-view';
import { DAY, NOW, profiles, SITE, siteGrant } from './grants-fixtures';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

async function fixture(grants = [siteGrant()]) {
  const dom = new JSDOM('<section id="grants"></section>');
  const doc = dom.window.document;
  // jsdom lacks native dialog opening/closing and keyboard default actions. Real
  // Tab movement and Enter/Space activation are covered by the E2E scenario.
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const send = vi.fn(
    async (message: GrantsMessage): Promise<GrantsResponse> =>
      message.type === 'SOLID_PROFILES_LIST' ? { profiles } : { ok: true, grants },
  );
  const controller = new GrantsController({ send, now: () => NOW });
  const root = doc.getElementById('grants')!;
  const unmount = mountGrantsView(root, controller);
  cleanup = () => {
    unmount();
    controller.dispose();
    dom.window.close();
  };
  await vi.waitFor(() => expect(controller.state.loaded).toBe(true));
  const button = (name: string, scope: ParentNode = root) => {
    const match = Array.from(scope.querySelectorAll('button')).find(
      (node) => node.textContent === name,
    );
    if (!match) throw new Error(`Button missing: ${name}`);
    return match;
  };
  return { dom, doc, root, controller, send, button, dialog: root.querySelector('dialog')! };
}

describe('sites with access view', () => {
  it('renders site identity, account initials, since and nested plain-language data access', async () => {
    const { root, button } = await fixture([siteGrant({ expiresAt: NOW + DAY * 90 })]);
    expect(root.querySelector('article')?.getAttribute('aria-label')).toBe(SITE);
    expect(root.textContent).toContain('Personal account');
    expect(root.querySelector('.grants-avatar')?.textContent).toBe('C');
    expect(root.querySelector('.grants-bound-account .grants-avatar')?.textContent).toBe('PA');
    expect(root.textContent).toContain('Since');
    expect(root.querySelectorAll('img')).toHaveLength(0);
    const disclosure = button('Access details');
    const details = root.querySelector<HTMLElement>('.grants-details')!;
    expect(details.hidden).toBe(true);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    disclosure.focus();
    disclosure.click();
    expect(details.hidden).toBe(false);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure.getAttribute('aria-controls')).toBe(details.id);
    expect(root.querySelector('.grants-class')?.textContent).toContain('Documents');
    expect(root.querySelector('.grants-class')?.textContent).toContain(
      'Read · Add · Edit and delete',
    );
    expect(root.querySelector('.grants-class')?.textContent).toContain('Expires');
    expect(root.textContent).not.toMatch(/WebID|ACL|origin grant|https:\/\/schema.org/);
    disclosure.click();
    expect(details.hidden).toBe(true);
  });

  it('uses native keyboard-operable controls and focuses Cancel on confirmation', async () => {
    const { doc, button, dialog, send, controller, dom } = await fixture();
    const revoke = button('Revoke');
    expect(revoke.tagName).toBe('BUTTON');
    expect(revoke.type).toBe('button');
    revoke.focus();
    expect(doc.activeElement).toBe(revoke);
    // Emulate the native activation jsdom omits; there are no pointer-only handlers.
    revoke.click();
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h3')?.id);
    expect(doc.activeElement?.textContent).toBe('Cancel');
    expect(send).toHaveBeenCalledTimes(2);
    dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(controller.state.confirmation).toBeNull();
    expect(doc.activeElement).toBe(button('Revoke'));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('returns focus to the focused control after a background refresh disables it', async () => {
    const { doc, button, send, controller } = await fixture();
    const revoke = button('Revoke');
    revoke.focus();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const respond = send.getMockImplementation()!;
    send.mockImplementationOnce(async (message) => {
      await held;
      return respond(message);
    });
    const refreshed = controller.refresh();
    expect(button('Revoke').disabled).toBe(true);
    expect(doc.activeElement?.id).toBe('grants-heading');
    release();
    await refreshed;
    expect(doc.activeElement).toBe(button('Revoke'));
    // A deliberate move elsewhere is not overridden by a later render.
    button('Refresh').focus();
    await controller.refresh();
    expect(doc.activeElement).toBe(button('Refresh'));
  });

  it('wraps Tab and Shift+Tab inside the confirmation dialog', async () => {
    const { doc, button, dialog, dom } = await fixture();
    button('Revoke').click();
    const cancel = button('Cancel', dialog);
    const confirm = button('Revoke access', dialog);
    const tab = (shiftKey = false) => {
      const event = new dom.window.KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        cancelable: true,
        bubbles: true,
      });
      doc.activeElement!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(doc.activeElement).toBe(cancel);
    // Moving forward from the first button is left to the browser.
    expect(tab()).toBe(false);
    confirm.focus();
    expect(tab()).toBe(true);
    expect(doc.activeElement).toBe(cancel);
    expect(tab(true)).toBe(true);
    expect(doc.activeElement).toBe(confirm);
    const other = new dom.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    dialog.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    expect(doc.activeElement).toBe(confirm);
    confirm.disabled = true;
    cancel.focus();
    expect(tab()).toBe(true);
    expect(doc.activeElement).toBe(cancel);
    cancel.disabled = true;
    expect(tab()).toBe(false);
  });

  it('confirms revocation, announces the result and focuses the heading when the site is removed', async () => {
    const { root, button, dialog, send, doc, controller } = await fixture();
    const revoke = button('Revoke');
    revoke.focus();
    revoke.click();
    send.mockResolvedValueOnce({ ok: true, grants: [] });
    button('Revoke access', dialog).click();
    await vi.waitFor(() => expect(controller.state.phase).toBe('ready'));
    expect(root.textContent).toContain('No sites have access yet');
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Access revoked');
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('');
    expect(doc.activeElement).toBe(root.querySelector('h2'));
  });

  it('warns before changing account, disables signed-out accounts and preserves selection on cancel', async () => {
    const { root, button, send, dialog, dom, doc, controller } = await fixture();
    button('Access details').click();
    const picker = root.querySelector('select')!;
    expect(picker.options[2].disabled).toBe(true);
    expect(picker.options[2].textContent).toContain('sign in');
    picker.focus();
    picker.value = '2';
    picker.dispatchEvent(new dom.window.Event('change'));
    expect(dialog.textContent).toContain("clears this site's data access");
    expect(dialog.textContent).toContain('The site must ask again');
    expect(send).toHaveBeenCalledTimes(2);
    button('Cancel', dialog).click();
    expect(root.querySelector('select')?.value).toBe('1');
    expect(doc.activeElement).toBe(root.querySelector('select'));
    const retry = root.querySelector('select')!;
    retry.value = '2';
    retry.dispatchEvent(new dom.window.Event('change'));
    send.mockResolvedValueOnce({
      ok: true,
      grants: [siteGrant({ profileId: '2', scope: { pods: [], classes: [] } })],
    });
    button('Change account', dialog).click();
    await vi.waitFor(() => expect(controller.state.phase).toBe('ready'));
    expect(root.querySelector('.grants-bound-account')?.textContent).toContain('Work');
    expect(root.querySelector('img')?.src).toBe(profiles[1].avatar);
    expect(root.querySelector('img')?.referrerPolicy).toBe('no-referrer');
    expect(root.querySelector('.grants-details')?.textContent).toContain('No data access');
  });

  it('disables longer duration chips with an accessible reason and confirms shortening', async () => {
    const { root, button, dialog, controller, send } = await fixture([
      siteGrant({ expiresAt: NOW + DAY * 90 }),
    ]);
    button('Access details').click();
    for (const label of ['Until revoked', '1 year']) {
      const chip = button(label);
      expect(chip.disabled).toBe(true);
      expect(chip.title).toContain('site must ask again');
      expect(
        root.ownerDocument.getElementById(chip.getAttribute('aria-describedby')!)?.textContent,
      ).toContain('Only shorter durations');
    }
    expect(button('1 day').disabled).toBe(false);
    button('1 day').focus();
    button('1 day').click();
    expect(dialog.textContent).toContain('1 day');
    expect(send).toHaveBeenCalledTimes(2);
    button('Shorten access', dialog).click();
    await vi.waitFor(() => expect(controller.state.phase).toBe('ready'));
    expect(send).toHaveBeenLastCalledWith({
      type: 'SOLID_ORIGIN_GRANT_EXPIRY',
      origin: SITE,
      expiresAt: NOW + DAY,
    });
  });

  it('keeps status and alert regions mounted across failures and retry', async () => {
    const { root, controller, send } = await fixture();
    const alert = root.querySelector('[role="alert"]');
    const status = root.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-atomic')).toBe('true');
    send.mockRejectedValueOnce(new Error('technical internal details'));
    await controller.refresh();
    expect(root.querySelector('[role="alert"]')).toBe(alert);
    expect(alert?.textContent).toBe("Couldn't load sites with access. Try refreshing.");
    expect(root.querySelectorAll('article')).toHaveLength(1);
    await controller.refresh();
    expect(alert?.textContent).toBe('');
    expect(root.querySelector('[role="status"]')).toBe(status);
  });

  it('uses text content for unfamiliar data labels and account names, with no injected markup', async () => {
    const grant = siteGrant();
    const { root, controller, send } = await fixture([
      siteGrant({
        scope: {
          pods: [],
          classes: [
            {
              ...grant.scope.classes![0],
              dataClass: 'https://example.test/#%3Cscript%3Ealert(1)%3C/script%3E',
            },
          ],
        },
      }),
    ]);
    expect(root.querySelectorAll('script')).toHaveLength(0);
    send.mockResolvedValueOnce({ ok: true, grants: [grant] }).mockResolvedValueOnce({
      profiles: [
        { ...profiles[0], label: '<img src=x onerror=alert(1)>', avatar: 'javascript:alert(1)' },
      ],
    });
    await controller.refresh();
    expect(root.querySelector('.grants-bound-account')?.textContent).toContain('<img');
    expect(root.querySelectorAll('img')).toHaveLength(0);
  });

  it('renders empty, unrestricted and unavailable-account states', async () => {
    const { root, controller, send, button } = await fixture([]);
    expect(root.textContent).toContain('No sites have access yet');
    send.mockResolvedValueOnce({
      ok: true,
      grants: [siteGrant({ profileId: 'missing', scope: { pods: [] } })],
    });
    await controller.refresh();
    expect(root.textContent).toContain('Unavailable account');
    expect(root.textContent).toContain('All data in connected storage');
    expect(root.querySelector('select')?.value).toBe('missing');
    button('Access details').click();
    expect(root.querySelector<HTMLElement>('.grants-details')?.hidden).toBe(false);
  });

  it('removes view listeners on unmount without receiving later state changes', async () => {
    const { root, controller } = await fixture();
    cleanup?.();
    cleanup = undefined;
    expect(root.childNodes).toHaveLength(0);
    await controller.refresh();
    expect(root.childNodes).toHaveLength(0);
  });
});
