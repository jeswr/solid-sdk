// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from 'vitest';
import { createOfflineClient } from '../src/index.js';
import { reportRevalidation } from '../src/revalidation-events.js';
import { createStatusSurface, type OfflineStatusSurface } from '../src/status.js';

const URL = 'https://pod.example/document';
const BARRIER = 'https://pod.example/delivery-barrier';
type Outcome = 'updated' | 'revalidated' | 'revalidate-failed';

function begin(channel: BroadcastChannel) {
  let settle!: (event: Outcome) => void;
  const result = new Promise<Outcome>((resolve) => {
    settle = resolve;
  });
  return {
    settle,
    done: reportRevalidation(
      URL,
      channel,
      () => result,
      (event) => event,
    ),
  };
}

describe.each(['standalone', 'lazy client'] as const)('%s status subscription', (kind) => {
  describe.each(['older first', 'newer first'] as const)('%s completion', (order) => {
    it.each([
      'revalidated',
      'updated',
      'revalidate-failed',
    ] as const)('does not let an unseen %s settle newer work', async (event) => {
      const channelName = `subscription-${crypto.randomUUID()}`;
      // Independent publishers also exercise correlation across worker instances.
      const olderPublisher = new BroadcastChannel(channelName);
      const newerPublisher = new BroadcastChannel(channelName);
      const observer = new BroadcastChannel(channelName);
      const client = createOfflineClient({ channelName });
      const attempts: ReturnType<typeof begin>[] = [];
      let surface: OfflineStatusSurface | undefined;

      // A marker sent after an outcome proves that the surface processed that
      // outcome on the real channel, without relying on a timed sleep.
      async function flush(publisher: BroadcastChannel) {
        const current = surface;
        if (!current) throw new Error('status surface not created');
        current.markStale(BARRIER);
        publisher.postMessage({ url: BARRIER, event: 'updated' });
        await vi.waitFor(() => expect(current.getSnapshot().resources[BARRIER]).toBe('updated'));
      }

      try {
        const started = new Promise<void>((resolve) => {
          observer.addEventListener('message', () => resolve(), { once: true });
        });
        const older = begin(olderPublisher);
        attempts.push(older);
        await started;
        // Subscribe only after A's start was delivered, including the lazy getter.
        surface = kind === 'standalone' ? createStatusSurface({ channelName }) : client.status;
        surface.markStale(URL);
        expect(surface.getSnapshot().pending).toBe(0);

        const newer = begin(newerPublisher);
        attempts.push(newer);
        await flush(newerPublisher);
        expect(surface.getSnapshot().pending).toBe(1);
        let active = newer;
        if (order === 'newer first') {
          newer.settle('revalidate-failed');
          await newer.done;
          await flush(newerPublisher);
          expect(surface.getSnapshot().pending).toBe(0);
          active = begin(newerPublisher);
          attempts.push(active);
          await flush(newerPublisher);
          expect(surface.getSnapshot().pending).toBe(1);
        }

        older.settle(event);
        await older.done;
        await flush(olderPublisher);
        expect(surface.getSnapshot()).toMatchObject({
          pending: 1,
          resources: { [URL]: 'pending' },
        });
        active.settle('revalidate-failed');
        await active.done;
        await flush(newerPublisher);
        const settled =
          event === 'updated' ? 'updated' : event === 'revalidated' ? 'fresh' : 'stale';
        expect(surface.getSnapshot()).toMatchObject({ pending: 0, resources: { [URL]: settled } });
      } finally {
        for (const attempt of attempts) attempt.settle('revalidate-failed');
        await Promise.all(attempts.map((attempt) => attempt.done));
        surface?.close();
        client.close();
        olderPublisher.close();
        newerPublisher.close();
        observer.close();
      }
    });
  });
});
