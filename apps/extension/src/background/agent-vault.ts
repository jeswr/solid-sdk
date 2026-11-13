// AUTHORED-BY Codex GPT-6
import {
  NATIVE_HOST_NAME,
  NATIVE_MESSAGE_LIMIT,
  type NativeResult,
  nativeRequestSchema,
  nativeResponseSchema,
} from '@jeswr/agent-vault/browser';

/** The worker owns one native port, keeping the vault's scheduler alive after the popup closes. */
export function installNativeVaultBridge(browser = chrome): void {
  let port: chrome.runtime.Port | undefined;
  let nextId = 0;
  const pending = new Map<
    number,
    {
      type: string;
      resolve: (value: NativeResult) => void;
      reject: () => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const disconnect = () => {
    const previous = port;
    port = undefined;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject();
    }
    pending.clear();
    previous?.disconnect();
  };
  const request = (input: unknown): Promise<NativeResult> =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const fail = () => reject(new Error('Agent vault unavailable.'));
      if (!input || typeof input !== 'object' || pending.size >= 16) return fail();
      const checked = nativeRequestSchema.safeParse({ ...input, id });
      if (
        !checked.success ||
        new TextEncoder().encode(JSON.stringify(checked.data)).byteLength > NATIVE_MESSAGE_LIMIT
      )
        return fail();
      try {
        if (!port) {
          port = browser.runtime.connectNative(NATIVE_HOST_NAME);
          const connected = port;
          connected.onMessage.addListener((message: unknown) => {
            if (port !== connected) return;
            const response = nativeResponseSchema.safeParse(message);
            if (!response.success) {
              disconnect();
              return;
            }
            const waiting = pending.get(response.data.id);
            if (!waiting) {
              disconnect();
              return;
            }
            pending.delete(response.data.id);
            clearTimeout(waiting.timer);
            if (response.data.ok && response.data.result.type === waiting.type)
              waiting.resolve(response.data.result);
            else waiting.reject();
          });
          connected.onDisconnect.addListener(() => {
            // Read and discard Chrome's diagnostic; it may contain paths to the host executable.
            void browser.runtime.lastError;
            if (port === connected) disconnect();
          });
        }
        pending.set(id, {
          type: checked.data.type,
          resolve,
          reject: fail,
          timer: setTimeout(disconnect, 30000),
        });
        port.postMessage(checked.data);
      } catch {
        disconnect();
        fail();
      }
    });
  browser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'AGENT_VAULT'
    )
      return false;
    // No content script, iframe, other extension or page can reach this host capability.
    if (
      sender.id !== browser.runtime.id ||
      sender.tab ||
      sender.url !== browser.runtime.getURL('popup/popup.html') ||
      Object.keys(message).sort().join(',') !== 'request,type' ||
      !('request' in message)
    ) {
      respond({ ok: false });
      return false;
    }
    void request(message.request).then(
      (result) => respond({ ok: true, result }),
      () => respond({ ok: false }),
    );
    return true;
  });
}
