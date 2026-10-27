// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from 'vitest';
import { loadFormFillData } from '../src/background/formfill-data-loader';

const webId = 'https://pod.example/profile/card#me';
it('reads public profile without credentials and only linked private documents on pod origins', async () => {
  const fetch = vi.fn(async (url: string, _authenticated: boolean) => ({
    ok: true,
    text:
      url === webId
        ? `
    @prefix v: <http://www.w3.org/2006/vcard/ns#>.
    <${webId}> v:fn "Alex"; v:hasAddress <../private/address#home>; v:hasEmail <https://foreign.example/secret>;
      v:hasTelephone <https://issuer.example/token>; v:hasName <http://pod.example/name>.
    <https://other.example/#me> v:hasAddress <../unlinked>.
  `
        : `<${webId}> <http://www.w3.org/2006/vcard/ns#hasAddress> <#home>.
    <#home> <http://www.w3.org/2006/vcard/ns#street-address> "42 Sample Street".`,
  }));
  const result = await loadFormFillData(webId, new Set(['https://pod.example']), fetch);
  expect(result.contact.name).toBe('Alex');
  expect(result.address.streetAddress).toBe('42 Sample Street');
  expect(fetch.mock.calls).toEqual([
    [webId, false],
    ['https://pod.example/private/address', true],
  ]);
});
it('fails safely on insecure, missing or malformed public profiles', async () => {
  const fetch = vi.fn(async () => ({ ok: false, text: '' }));
  await expect(loadFormFillData('http://remote.example/#me', new Set(), fetch)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await expect(loadFormFillData(webId, new Set(), fetch)).rejects.toThrow();
  fetch.mockResolvedValue({ ok: true, text: 'not turtle' });
  await expect(loadFormFillData(webId, new Set(), fetch)).rejects.toThrow();
});
