// AUTHORED-BY Claude Sonnet 5.5
//
// REACT IS AN OPTIONAL PEER DEPENDENCY. The core entry imports nothing from here; only an app
// that already depends on React reaches for `@jeswr/pod-media-loader/react`.
import { useEffect, useState } from "react";
import { fail, type MediaError } from "./errors.js";
import type { MediaLoader } from "./loader.js";

export type UseMediaStatus = "idle" | "loading" | "ready" | "error";

export interface UseMediaResult {
  readonly status: UseMediaStatus;
  /** The `blob:` object URL while `status` is `"ready"`, otherwise `undefined`. */
  readonly url: string | undefined;
  readonly error: MediaError | undefined;
}

interface Settled {
  readonly loader: MediaLoader;
  readonly source: string;
  readonly inert: boolean;
  readonly result: UseMediaResult;
}

const IDLE: UseMediaResult = Object.freeze({ status: "idle", url: undefined, error: undefined });
const LOADING: UseMediaResult = Object.freeze({
  status: "loading",
  url: undefined,
  error: undefined,
});
const PURGED: UseMediaResult = Object.freeze({
  status: "error",
  url: undefined,
  error: fail("purged").error,
});

/**
 * Show one pod media resource. Acquires on mount, releases on unmount or when the loader, URL or
 * `inert` flag changes. The stored result is dropped in the same cleanup that releases its hold,
 * so a released (possibly revoked) URL is never shown again, and a `purge()` moves the hook to
 * an error state synchronously. Correct under StrictMode's mount, cleanup, mount.
 */
export function useMedia(
  loader: MediaLoader,
  url: string | null | undefined,
  options: { inert?: boolean } = {},
): UseMediaResult {
  const inert = options.inert === true;
  const [settled, setSettled] = useState<Settled | undefined>(undefined);

  useEffect(() => {
    if (!url) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    let release: (() => void) | undefined;
    const settle = (result: UseMediaResult): void =>
      setSettled({ loader, source: url, inert, result });
    // Subscribe first: a purge at any point after this drops the hook out of "ready".
    const unsubscribe = loader.subscribe(() => {
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
        release = result.value.release;
        settle({ status: "ready", url: result.value.url, error: undefined });
      } else {
        settle({ status: "error", url: undefined, error: result.error });
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
      controller.abort();
      release?.();
      setSettled(undefined);
    };
  }, [loader, url, inert]);

  if (!url) return IDLE;
  const current =
    settled !== undefined &&
    settled.loader === loader &&
    settled.source === url &&
    settled.inert === inert
      ? settled.result
      : undefined;
  return current ?? LOADING;
}
