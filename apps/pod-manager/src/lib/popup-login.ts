// AUTHORED-BY Codex GPT-6.1-Sol
import { CodeRequestCancelledError } from "@jeswr/reactive-authentication";

export interface MessageEventLike {
  origin: string;
  source: unknown;
  data: unknown;
}
export interface PopupWindowLike {
  closed: boolean;
  location: { href: string };
  close(): void;
  focus?(): void;
}
export interface OpenerWindowLike {
  open(url?: string, target?: string, features?: string): PopupWindowLike | null;
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}
export class PopupBlockedError extends Error {
  constructor() {
    super("The browser blocked the sign-in window");
    this.name = "PopupBlockedError";
  }
}
/** The sign-in window stayed open past its limit; distinct from an address lookup timeout. */
export class PopupTimeoutError extends Error {
  constructor() {
    super("The sign-in window timed out");
    this.name = "PopupTimeoutError";
  }
}
export interface PopupLoginControllerOptions {
  expectedOrigin: string;
  windowRef?: OpenerWindowLike;
  timeoutMs?: number;
  pollMs?: number;
}

/** A click opens the window synchronously; getCode only navigates that existing window. */
export class PopupLoginController {
  readonly #options: PopupLoginControllerOptions;
  readonly #window: OpenerWindowLike;
  #popup: PopupWindowLike | null = null;
  #cancelPending: (() => void) | null = null;
  constructor(options: PopupLoginControllerOptions) {
    this.#options = options;
    this.#window = options.windowRef ?? window;
  }
  get isOpen(): boolean {
    return this.#popup !== null && !this.#popup.closed;
  }
  open(): void {
    this.cancel();
    this.#popup = this.#window.open(
      "about:blank",
      "podManagerLogin",
      "popup=yes,width=480,height=760",
    );
    if (!this.#popup) throw new PopupBlockedError();
    this.#popup.focus?.();
  }
  closeIfOpen(): void {
    if (this.#popup && !this.#popup.closed) this.#popup.close();
    this.#popup = null;
  }
  cancel(): void {
    this.#cancelPending?.();
    this.closeIfOpen();
  }
  async getCode(url: URL, signal: AbortSignal): Promise<string> {
    if (signal.aborted) {
      this.closeIfOpen();
      signal.throwIfAborted();
    }
    if (url.searchParams.get("prompt")?.split(/\s+/u).includes("none") || !this.isOpen) {
      this.cancel();
      throw new CodeRequestCancelledError(url);
    }
    // A second request must never inherit a pending request's window/listeners.
    if (this.#cancelPending) {
      this.cancel();
      throw new CodeRequestCancelledError(url);
    }
    const popup = this.#popup!;
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (callback?: string, error?: unknown) => {
        if (settled) return;
        settled = true;
        this.#window.removeEventListener("message", onMessage);
        signal.removeEventListener("abort", onAbort);
        clearInterval(poll);
        clearTimeout(timeout);
        this.#cancelPending = null;
        this.closeIfOpen();
        if (callback !== undefined) resolve(callback);
        else reject(error);
      };
      const onMessage = (event: MessageEventLike) => {
        if (
          event.origin !== this.#options.expectedOrigin ||
          event.source !== popup ||
          typeof event.data !== "string"
        )
          return;
        try {
          const callback = new URL(event.data);
          if (
            callback.origin !== this.#options.expectedOrigin ||
            callback.pathname !== "/callback.html"
          )
            return;
        } catch {
          return;
        }
        finish(event.data);
      };
      const onAbort = () => finish(undefined, signal.reason);
      const poll = setInterval(() => {
        if (popup.closed) finish(undefined, new CodeRequestCancelledError(url));
      }, this.#options.pollMs ?? 500);
      const timeout = setTimeout(
        () => finish(undefined, new PopupTimeoutError()),
        this.#options.timeoutMs ?? 300_000,
      );
      this.#cancelPending = () => finish(undefined, new CodeRequestCancelledError(url));
      this.#window.addEventListener("message", onMessage);
      signal.addEventListener("abort", onAbort, { once: true });
      // Assigning location works across origins and never opens a new window.
      try {
        popup.location.href = url.href;
      } catch (error) {
        finish(undefined, error);
      }
    });
  }
}
