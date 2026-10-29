// AUTHORED-BY GPT-6.1-Sol (Codex)
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const { startTestSiteServer, goto, contextOn } = vi.hoisted(() => ({
  startTestSiteServer: vi.fn(async (_options: unknown) => ({ close: vi.fn() })),
  goto: vi.fn(async (_url: string) => {}),
  contextOn: vi.fn(),
}));

// Execute the real interactive harness without starting processes, browsers, or listeners.
vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    queueMicrotask(() => child.emit('close', 0));
    return child;
  },
}));
vi.mock('node:fs', () => ({
  default: {
    mkdtempSync: () => '/tmp/solid-ext-dev-fixture',
    readFileSync: () => '{}',
    writeFileSync: vi.fn(),
  },
}));
vi.mock('node:http', () => ({
  default: {
    get: (_url: string, callback: (response: { resume: () => void }) => void) => {
      callback({ resume: vi.fn() });
      return Object.assign(new EventEmitter(), { setTimeout: vi.fn() });
    },
  },
}));
vi.mock('playwright', () => ({
  chromium: {
    launchPersistentContext: async () => ({
      serviceWorkers: () => [
        {
          url: () =>
            'chrome-extension://bicabcdahgfbkgmlidjpmiadmjlppikk/background/service-worker.js',
        },
      ],
      close: async () => {},
      pages: () => [{ goto }],
      newPage: async () => ({ goto }),
      on: contextOn,
    }),
  },
}));
vi.mock('../test-site/server', () => ({ startTestSiteServer }));

afterEach(() => vi.restoreAllMocks());

it('configures both development Client ID Documents with the root Chromium redirect', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'on').mockReturnValue(process);

  await import('../scripts/dev');
  await vi.waitFor(() => expect(contextOn).toHaveBeenCalledWith('close', expect.any(Function)));

  expect(startTestSiteServer.mock.calls.map(([options]) => options)).toEqual([
    {
      port: 8080,
      redirectUri: 'https://bicabcdahgfbkgmlidjpmiadmjlppikk.chromiumapp.org/',
      clientName: 'Solid Browser Extension',
    },
    {
      port: 8081,
      redirectUri: 'https://bicabcdahgfbkgmlidjpmiadmjlppikk.chromiumapp.org/',
      clientName: 'My Test App',
      clientIdUrl: 'http://localhost:8081/client-id',
    },
  ]);
  expect(goto).toHaveBeenCalledWith('http://localhost:8081/with-client-id.html');
});
