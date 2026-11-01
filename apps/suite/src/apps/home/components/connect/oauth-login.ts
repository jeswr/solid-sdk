// AUTHORED-BY Codex GPT-6
import { IntegrationAuthError, type OAuthAppConfig, type TokenSet } from "@jeswr/pod-connectors";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  generatePkcePair,
  generateState,
  OAUTH_CALLBACK_PATH,
  parseCallbackUrl,
} from "@jeswr/pod-connectors/oauth";
import { fetchWithSignal } from "./import-service";

// Captured at module initialization, before a session can install Pod auth.
export const sourceFetch: typeof fetch = globalThis.fetch.bind(globalThis);

/** Crypto and response parsing cannot always be interrupted. Stop awaiting them
 * on cancellation, and never let their completion continue the login flow. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** Own the lifecycle around the package's PKCE primitives. Reserve one popup
 * during the click gesture; a blocked popup gets a native link to the same request.
 * A popup that reads as closed may still be open (a provider page sending
 * Cross-Origin-Opener-Policy severs the opener), so keep waiting for the callback
 * and report it through onClosed; the caller's signal is the only way to give up. */
export async function login(
  id: string,
  config: OAuthAppConfig,
  signal: AbortSignal,
  onBlocked: (href: string) => void,
  onClosed: () => void = () => {},
): Promise<TokenSet> {
  signal.throwIfAborted();
  if (!config.clientId) throw new IntegrationAuthError(id, "not-configured");
  const popup = window.open("", "pod-manager-oauth", "popup,width=520,height=720");
  const close = () => popup?.close();
  signal.addEventListener("abort", close, { once: true });
  try {
    signal.throwIfAborted();
    const pair = await abortable(generatePkcePair(), signal);
    signal.throwIfAborted();
    const state = generateState();
    const redirectUri = new URL(OAUTH_CALLBACK_PATH, window.location.href).href;
    const href = buildAuthorizationUrl(config, { state, challenge: pair.challenge, redirectUri });
    const callback = await new Promise<string>((resolve, reject) => {
      const channel = new BroadcastChannel("suite-connector-oauth");
      const cleanup = () => {
        window.removeEventListener("message", message);
        signal.removeEventListener("abort", abort);
        clearInterval(closedPoll);
        channel.close();
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const message = (event: MessageEvent) => {
        if (
          event.origin !== window.location.origin ||
          event.data?.type !== "pod-manager-oauth" ||
          typeof event.data.url !== "string"
        )
          return;
        let answer: URL;
        try {
          answer = new URL(event.data.url);
        } catch {
          return;
        }
        if (
          answer.origin !== window.location.origin ||
          answer.pathname !== OAUTH_CALLBACK_PATH ||
          answer.searchParams.get("state") !== state
        )
          return;
        cleanup();
        resolve(answer.href);
      };
      const closedPoll = setInterval(() => {
        if (!popup?.closed) return;
        clearInterval(closedPoll);
        onClosed();
      }, 500);
      signal.addEventListener("abort", abort, { once: true });
      window.addEventListener("message", message);
      channel.onmessage = (event) =>
        message({ origin: window.location.origin, data: event.data } as MessageEvent);
      try {
        signal.throwIfAborted();
        if (popup) popup.location.href = href;
        else onBlocked(href);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
    close();
    signal.throwIfAborted();
    const { code } = parseCallbackUrl(id, callback, state);
    const token = await abortable(
      exchangeCodeForToken(
        id,
        config,
        { code, verifier: pair.verifier, redirectUri },
        fetchWithSignal(sourceFetch, signal),
      ),
      signal,
    );
    signal.throwIfAborted();
    return token;
  } finally {
    signal.removeEventListener("abort", close);
    close();
  }
}
