// AUTHORED-BY Claude Sonnet 5.5
//
// REACT IS AN OPTIONAL PEER DEPENDENCY. The core entry imports nothing from here; only an app
// that already depends on React reaches for `@jeswr/pod-media-loader/react`.
import { useCallback, useEffect, useRef, useState } from "react";
import { fail, type MediaError } from "./errors.js";
import type { MediaLoader } from "./loader.js";

/** `"over-budget"` is the retryable state: the loader had no room right now. */
export type UseMediaStatus = "idle" | "loading" | "ready" | "error" | "over-budget";

export interface UseMediaResult {
  readonly status: UseMediaStatus;
  /** The `blob:` object URL while `status` is `"ready"`, otherwise `undefined`. */
  readonly url: string | undefined;
  readonly error: MediaError | undefined;
  /**
   * Try again now (any `"error"` or `"over-budget"` state; harmless otherwise). Resets the
   * automatic retry allowance. A stable function for a given hook instance.
   */
  readonly retry: () => void;
}

/** Wait this long after a capacity signal before retrying, so a burst of releases is one retry. */
export const RETRY_DELAY_MS = 250;
/** Automatic retries on capacity signals before the hook waits for a manual `retry()`. */
export const MAX_AUTO_RETRIES = 3;

type Outcome = Omit<UseMediaResult, "retry">;

interface Settled {
  readonly loader: MediaLoader;
  readonly source: string;
  readonly inert: boolean;
  readonly result: Outcome;
}

const IDLE: Outcome = Object.freeze({ status: "idle", url: undefined, error: undefined });
const LOADING: Outcome = Object.freeze({ status: "loading", url: undefined, error: undefined });
const PURGED: Outcome = Object.freeze({
  status: "error",
  url: undefined,
  error: fail("purged").error,
});

/**
 * Show one pod media resource. Acquires on mount, releases on unmount or when the loader, URL or
 * `inert` flag changes. The stored result is dropped in the same cleanup that releases its hold,
 * so a released (possibly revoked) URL is never shown again, and a `purge()` moves the hook to
 * an error state synchronously. Correct under StrictMode's mount, cleanup, mount.
 *
 * When the loader has no room (`over-budget`) the status is `"over-budget"`, not a generic
 * error. The hook then retries by itself when the loader reports freed capacity, at most
 * `MAX_AUTO_RETRIES` times in a row and no more than once per `RETRY_DELAY_MS`; after that, or
 * for any other error, call `retry()`.
 */
export function useMedia(
  loader: MediaLoader,
  url: string | null | undefined,
  options: { inert?: boolean } = {},
): UseMediaResult {
  const inert = options.inert === true;
  const [settled, setSettled] = useState<Settled | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const auto = useRef({ loader, url, inert, count: 0 });

  const retry = useCallback((): void => {
    auto.current.count = 0;
    setAttempt((n) => n + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only exists to re-run the effect on retry
  useEffect(() => {
    if (!url) return undefined;
    const allowance = auto.current;
    if (allowance.loader !== loader || allowance.url !== url || allowance.inert !== inert) {
      auto.current = { loader, url, inert, count: 0 };
    }
    const controller = new AbortController();
    let cancelled = false;
    let release: (() => void) | undefined;
    let wantsCapacity = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (result: Outcome): void => setSettled({ loader, source: url, inert, result });
    // Subscribe first: a purge at any point after this drops the hook out of "ready".
    const unsubscribe = loader.subscribe((event) => {
      if (event === "capacity") {
        if (!wantsCapacity || timer !== undefined || auto.current.count >= MAX_AUTO_RETRIES) return;
        timer = setTimeout(() => {
          timer = undefined;
          auto.current.count++;
          setAttempt((n) => n + 1);
        }, RETRY_DELAY_MS);
        return;
      }
      wantsCapacity = false;
      release?.();
      release = undefined;
      settle(PURGED);
    });
    void loader.acquire(url, { signal: controller.signal, inert }).then((result) => {
      if (cancelled) {
        if (result.ok) result.value.release();
        return;
      }
      if (result.ok) {
        auto.current.count = 0;
        release = result.value.release;
        settle({ status: "ready", url: result.value.url, error: undefined });
      } else if (result.error.code === "over-budget") {
        wantsCapacity = true;
        settle({ status: "over-budget", url: undefined, error: result.error });
      } else {
        settle({ status: "error", url: undefined, error: result.error });
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
      controller.abort();
      release?.();
      setSettled(undefined);
    };
  }, [loader, url, inert, attempt]);

  if (!url) return { ...IDLE, retry };
  const current =
    settled !== undefined &&
    settled.loader === loader &&
    settled.source === url &&
    settled.inert === inert
      ? settled.result
      : undefined;
  return { ...(current ?? LOADING), retry };
}
