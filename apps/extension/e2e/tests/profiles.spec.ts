/// <reference types="chrome" />
// AUTHORED-BY GPT-6.1-Sol (Codex)
import type { ProfileRecord } from '../../src/background/core/profile-store';
import { expect, test } from '../fixtures';

/** Browser fixtures stay inside the worker; no fixture credential crosses the message API. */
test('profile management persists isolated non-extractable credentials in worker IndexedDB', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  const message = (request: Record<string, unknown>) =>
    page.evaluate((value) => chrome.runtime.sendMessage(value), request);
  expect((await message({ type: 'SOLID_PROFILES_LIST' })).profiles).toEqual([]);

  const worker = context.serviceWorkers()[0];
  await worker.evaluate(async () => {
    const records: ProfileRecord[] = [];
    for (const id of ['1', '2']) {
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign', 'verify'],
      );
      const webId = `https://fixture.invalid/profile-${id}#me`;
      records.push({
        profile: {
          id,
          webId,
          issuer: 'https://fixture.invalid/',
          label: `Profile ${id}`,
          sessionState: 'active',
          dpopKeyRef: id,
        },
        session: {
          webId,
          issuer: 'https://fixture.invalid/',
          accessToken: `fixture-access-${id}`,
          refreshToken: `fixture-refresh-${id}`,
          tokenEndpoint: 'https://fixture.invalid/token',
          clientId: 'https://fixture.invalid/client',
          expiresAt: Date.now() + 3_600_000,
        },
        keyPair,
        grantedOrigins: [],
        podOrigins: [],
        classGrants: [],
      });
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('solid-ext-profiles', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['profiles', 'metadata'], 'readwrite');
        for (const record of records) tx.objectStore('profiles').put(record, record.profile.id);
        tx.objectStore('metadata').put(
          { defaultProfileId: '1', nextId: 3, migrated: true },
          'state',
        );
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });

  const list = await message({ type: 'SOLID_PROFILES_LIST' });
  expect(list.profiles).toHaveLength(2);
  expect(list.defaultProfileId).toBe('1');
  expect(JSON.stringify(list)).not.toMatch(
    /accessToken|refreshToken|privateKey|fixture-access|fixture-refresh/,
  );
  expect((await message({ type: 'SOLID_PROFILE_RENAME', profileId: '2', label: 'Work' })).ok).toBe(
    true,
  );
  expect(
    (await message({ type: 'SOLID_PROFILE_SET_DEFAULT', profileId: '2' })).defaultProfileId,
  ).toBe('2');
  await page.reload();
  expect((await message({ type: 'SOLID_GET_STATE' })).name).toBe('Work');
  expect((await message({ type: 'SOLID_PROFILE_REMOVE', profileId: '1' })).profiles).toHaveLength(
    1,
  );

  // A real IndexedDB close/reopen returns a usable, non-exportable private CryptoKey.
  const custody = await worker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('solid-ext-profiles', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const record = await new Promise<{ keyPair: CryptoKeyPair }>((resolve, reject) => {
        const req = db.transaction('profiles', 'readonly').objectStore('profiles').get('2');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const data = new TextEncoder().encode('fixture-signature');
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        record.keyPair.privateKey,
        data,
      );
      let exportRejected = false;
      try {
        await crypto.subtle.exportKey('jwk', record.keyPair.privateKey);
      } catch {
        exportRejected = true;
      }
      return {
        exportRejected,
        valid: await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          record.keyPair.publicKey,
          signature,
          data,
        ),
      };
    } finally {
      db.close();
    }
  });
  expect(custody).toEqual({ exportRejected: true, valid: true });
  expect(
    (await message({ type: 'SOLID_PROFILE_REMOVE', profileId: '2' })).defaultProfileId,
  ).toBeNull();
});
