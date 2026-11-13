// AUTHORED-BY Codex GPT-6
import {
  captureOrigin,
  NATIVE_HOST_NAME,
  NATIVE_MESSAGE_LIMIT,
  type NativeResult,
  nativeRequestSchema,
  nativeResponseSchema,
} from '@jeswr/agent-vault/browser';
import {
  CAPTURE_PERMISSION_PORT,
  releaseCapturePermissions,
} from '../shared/agent-capture-permissions';

/** The worker owns one native port, keeping the vault's scheduler alive after the popup closes. */
export function installNativeVaultBridge(browser = chrome): void {
  const isPopup = (sender: chrome.runtime.MessageSender | undefined) =>
    sender?.id === browser.runtime.id &&
    !sender.tab &&
    sender.url === browser.runtime.getURL('popup/popup.html');
  const leases = new Set<chrome.runtime.Port>();
  const removePermissions = () => {
    void releaseCapturePermissions(browser.permissions).catch(() => {
      // Popup destruction can prevent its warning from rendering. Leave a visible toolbar warning.
      void browser.action.setBadgeText({ text: '!' }).catch(() => {
        /* no browser diagnostics */
      });
    });
  };
  // A permission prompt may finish after Chrome destroys the popup and its JS context.
  browser.permissions.onAdded.addListener((permissions) => {
    if (!leases.size && permissions.permissions?.includes('cookies')) removePermissions();
  });
  browser.runtime.onConnect.addListener((connected) => {
    if (connected.name !== CAPTURE_PERMISSION_PORT) return;
    if (!isPopup(connected.sender)) {
      connected.disconnect();
      return;
    }
    let active = false;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      leases.delete(connected);
      removePermissions();
    };
    connected.onMessage.addListener((message: unknown) => {
      try {
        if (
          closed ||
          active ||
          !message ||
          typeof message !== 'object' ||
          Object.keys(message).join(',') !== 'site' ||
          !('site' in message) ||
          typeof message.site !== 'string'
        )
          throw 0;
        captureOrigin(message.site);
        active = true;
        leases.add(connected);
      } catch {
        cleanup();
        connected.disconnect();
      }
    });
    connected.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      cleanup();
    });
  });
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
      !isPopup(sender) ||
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
