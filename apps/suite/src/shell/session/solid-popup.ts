// AUTHORED-BY Codex GPT-6.1-Sol
import { SignInError } from "./types";

export interface SolidLoginPopup {
  getCode(url: URL, signal: AbortSignal): Promise<string>;
  close(): void;
}

/** Open during the click, before discovery awaits, so popup blocking is reported immediately. */
export function openSolidLoginPopup(redirectUri: string): SolidLoginPopup {
  const callback = new URL(redirectUri);
  const popup = window.open("about:blank", "_blank", "popup=yes,width=480,height=760");
  if (!popup) throw new SignInError("popup-blocked");
  let cancel: (() => void) | undefined;
  const close = () => {
    cancel?.();
    if (!popup.closed) popup.close();
  };
  return {
    close,
    getCode: (url, signal) =>
      new Promise<string>((resolve, reject) => {
        if (signal.aborted || popup.closed) {
          close();
          reject(signal.reason ?? new SignInError("cancelled"));
          return;
        }
        let settled = false;
        const finish = (value?: string, error?: unknown) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("message", onMessage);
          signal.removeEventListener("abort", onAbort);
          clearInterval(poll);
          clearTimeout(timeout);
          cancel = undefined;
          if (!popup.closed) popup.close();
          if (value !== undefined) resolve(value);
          else reject(error);
        };
        const onMessage = (event: MessageEvent<unknown>) => {
          if (
            event.origin !== callback.origin ||
            event.source !== popup ||
            typeof event.data !== "object" ||
            event.data === null ||
            !("type" in event.data) ||
            event.data.type !== "solid-suite:auth-callback" ||
            !("url" in event.data) ||
            typeof event.data.url !== "string"
          )
            return;
          try {
            const returned = new URL(event.data.url);
            if (
              returned.origin !== callback.origin ||
              returned.pathname !== callback.pathname ||
              returned.username ||
              returned.password
            )
              return;
          } catch {
            return;
          }
          // State, issuer, code and PKCE validation belong exclusively to pod-auth.
          finish(event.data.url);
        };
        const onAbort = () => finish(undefined, signal.reason);
        const poll = setInterval(() => {
          if (popup.closed) finish(undefined, new SignInError("cancelled"));
        }, 250);
        const timeout = setTimeout(() => finish(undefined, new SignInError("cancelled")), 300_000);
        cancel = () => finish(undefined, new SignInError("cancelled"));
        window.addEventListener("message", onMessage);
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          popup.location.href = url.href;
        } catch {
          finish(undefined, new SignInError("failed"));
        }
      }),
  };
}
