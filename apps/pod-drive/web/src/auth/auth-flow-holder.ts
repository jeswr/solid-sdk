// AUTHORED-BY Codex GPT-6.1-Sol
import type { AuthorizationCodeFlow } from "@jeswr/reactive-authentication/elements";

type GetCode = (url: URL, signal: AbortSignal) => Promise<string>;

// The singleton reads the currently mounted element, including after StrictMode replay.
export const authFlowHolder: { current: GetCode | null } = { current: null };
export const AUTH_FLOW_ELEMENT = "authorization-code-flow";

export function lazyElementGetCode(ui: AuthorizationCodeFlow): GetCode {
  return async (authorizationUri, signal) => {
    signal.throwIfAborted();
    if (typeof ui.getCode !== "function") {
      let onAbort = () => {};
      try {
        await Promise.race([
          customElements.whenDefined(AUTH_FLOW_ELEMENT),
          new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(signal.reason);
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          }),
        ]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    }
    signal.throwIfAborted();
    const callback = await ui.getCode(authorizationUri, signal);
    try {
      signal.throwIfAborted();
      // The engine element returns a disposable callback URL; pod-auth expects the URL itself.
      return callback.value;
    } finally {
      callback[Symbol.dispose]();
    }
  };
}

export const getCodeThroughHolder: GetCode = async (authorizationUri, signal) => {
  const getCode = authFlowHolder.current;
  if (!getCode) throw new Error("No <authorization-code-flow> element is mounted for login");
  return getCode(authorizationUri, signal);
};
