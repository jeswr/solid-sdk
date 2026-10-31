// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from 'vitest';
import { loadFormFillData } from '../src/background/formfill-data-loader';

const webId = 'https://pod.example/profile/card#me';
it('reads public profile without credentials and only linked private documents on pod origins', async () => {
  const fetch = vi.fn(async (url: string, _authenticated: boolean) => ({
    ok: true,
    url,
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
it('uses final profile and linked document URLs as RDF bases after redirects', async () => {
  const fetch = vi.fn(async (url: string, _authenticated: boolean) =>
    url === webId
      ? {
          ok: true,
          url: 'https://pod.example/profile/card/#redirected',
          text: `@prefix v: <http://www.w3.org/2006/vcard/ns#> .
            <${webId}> v:fn "Alex" ;
              <http://www.w3.org/ns/solid/terms#privateAddressBook> <../private/address> .
            <#me> v:fn "Other person" .`,
        }
      : {
          ok: true,
          url: 'https://pod.example/address-book/index/#redirected',
          text: `@prefix v: <http://www.w3.org/2006/vcard/ns#> .
            <${webId}> v:hasAddress <#home> .
            <https://pod.example/address-book/index/#home> v:street-address "42 Sample Street" .`,
        },
  );
  const result = await loadFormFillData(webId, new Set(['https://pod.example']), fetch);
  expect(result.contact.name).toBe('Alex');
  expect(result.address.streetAddress).toBe('42 Sample Street');
  expect(fetch.mock.calls).toEqual([
    [webId, false],
    ['https://pod.example/profile/private/address', true],
  ]);
});
it('drops relative profile links resolved against a foreign final URL', async () => {
  const fetch = vi.fn(async (url: string, _authenticated: boolean) => ({
    ok: true,
    url: 'https://foreign.example/profile/card/#redirected',
    text: `<${url}> <http://www.w3.org/2006/vcard/ns#fn> "Alex" ;
      <http://www.w3.org/2006/vcard/ns#hasAddress> <../private/address#home> .`,
  }));
  const result = await loadFormFillData(webId, new Set(['https://pod.example']), fetch);
  expect(result.contact.name).toBe('Alex');
  expect(result.address.streetAddress).toBeNull();
  expect(fetch.mock.calls).toEqual([[webId, false]]);
});
it('fails safely on insecure, missing or malformed public profiles', async () => {
  const fetch = vi.fn(async (url: string) => ({ ok: false, text: '', url }));
  await expect(loadFormFillData('http://remote.example/#me', new Set(), fetch)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await expect(loadFormFillData(webId, new Set(), fetch)).rejects.toThrow();
  fetch.mockResolvedValue({ ok: true, text: 'not turtle', url: webId });
  await expect(loadFormFillData(webId, new Set(), fetch)).rejects.toThrow();
});
