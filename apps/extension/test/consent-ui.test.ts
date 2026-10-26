// AUTHORED-BY GPT-6.1-Sol (Codex)
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import type { PendingConsentView } from '../src/shared/messages';

let dom: JSDOM;
afterEach(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

it('shows the selected profile targets and submits only that profile and its selected classes', async () => {
  dom = new JSDOM(readFileSync(new URL('../src/consent/consent.html', import.meta.url), 'utf8'), {
    url: 'https://extension.example/consent?consentId=fixture',
  });
  const view = (id: string): PendingConsentView => ({
    consentId: 'fixture',
    origin: 'https://app.example',
    webId: `https://pod.example/${id}#me`,
    profileId: id,
    profiles: [
      { id: '1', label: 'Personal', webId: 'https://pod.example/1#me' },
      { id: '2', label: 'Work', webId: 'https://pod.example/2#me' },
    ],
    classes: [
      {
        dataClass: 'https://schema.org/Person',
        modes: ['read'],
        purpose: '<script>page input</script>',
        expiresAt: 3_000_000_000_000,
        shape: null,
        targets: [{ url: `https://pod.example/${id}/private`, kind: 'instance' }],
      },
    ],
  });
  const sendMessage = vi.fn(async (message: Record<string, unknown>, callback?: () => void) => {
    if (message.type === 'SOLID_GET_PENDING_CONSENT') return view(String(message.profileId ?? '1'));
    callback?.();
    return undefined;
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const close = vi.spyOn(dom.window, 'close').mockImplementation(() => {});
  vi.resetModules();
  await import('../src/consent/consent');
  await vi.waitFor(() =>
    expect(dom.window.document.querySelector('.targets')?.textContent).toContain('/1/private'),
  );
  expect(dom.window.document.querySelectorAll('.meta script')).toHaveLength(0);
  const picker = dom.window.document.querySelector('select')!;
  picker.value = '2';
  picker.dispatchEvent(new dom.window.Event('change'));
  expect((dom.window.document.querySelector('#approve') as HTMLButtonElement).disabled).toBe(true);
  await vi.waitFor(() =>
    expect(dom.window.document.querySelector('.targets')?.textContent).toContain('/2/private'),
  );
  expect(dom.window.document.querySelectorAll('.class-item')).toHaveLength(1);
  (dom.window.document.querySelector('#approve') as HTMLButtonElement).click();
  expect(sendMessage).toHaveBeenLastCalledWith(
    {
      type: 'SOLID_CONSENT_DECISION',
      consentId: 'fixture',
      profileId: '2',
      approvedClasses: ['https://schema.org/Person'],
    },
    expect.any(Function),
  );
  expect(close).toHaveBeenCalledOnce();
  close.mockRestore();
});
