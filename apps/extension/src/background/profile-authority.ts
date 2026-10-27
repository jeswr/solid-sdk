// AUTHORED-BY GPT-6.1-Sol (Codex)
/** Worker-owned migration and lazy IndexedDB authority. No caller falls back to legacy tokens. */
import { DpopKeyDb } from './core/dpop-key-db';
import { ProfileStore } from './core/profile-store';
import { ProfileDb } from './profile-db';
import {
  loadClassGrants,
  loadGrantedOrigins,
  loadPodOrigins,
  loadProfile,
  loadSession,
} from './session-store';

export function profileAuthority(
  purge: (webId: string) => Promise<void>,
): () => Promise<ProfileStore> {
  let ready: Promise<ProfileStore> | undefined;
  return () => {
    ready ??= (async () => {
      const db = await ProfileDb.open();
      const store = new ProfileStore(db, purge);
      try {
        await store.initialise(
          async () => {
            const session = await loadSession();
            const keyDb = await DpopKeyDb.open();
            try {
              const keyPair = await keyDb.get();
              return {
                session,
                keyPair: keyPair ?? null,
                display: await loadProfile(),
                grantedOrigins: await loadGrantedOrigins(),
                podOrigins: await loadPodOrigins(),
                classGrants: await loadClassGrants(),
              };
            } finally {
              keyDb.close();
            }
          },
          async () => {
            // Only after the profile transaction commits. Retrying on wake is idempotent.
            for (const key of [
              'solid:session',
              'solid:profile',
              'solid:granted-origins',
              'solid:pod-origins',
              'solid:class-grants',
            ])
              await chrome.storage.local.remove(key);
            const keyDb = await DpopKeyDb.open();
            try {
              await keyDb.clear();
            } finally {
              keyDb.close();
            }
          },
        );
        return store;
      } catch (error) {
        db.close();
        throw error;
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };
}
