// AUTHORED-BY Claude Sonnet 5.5
//
// REACT IS AN OPTIONAL PEER DEPENDENCY. The core entry imports nothing from here; only an app
// that already depends on React reaches for `@jeswr/pod-media-loader/react`.
import { useEffect, useState } from "react";
import type { MediaError } from "./errors.js";
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

/**
 * Show one pod media resource. Acquires on mount, releases on unmount or when the loader, URL or
 * `inert` flag changes. Correct under StrictMode's mount, cleanup, mount: the first acquire is
 * aborted (or released if it already finished), so exactly one hold survives.
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
    void loader.acquire(url, { signal: controller.signal, inert }).then((result) => {
      if (cancelled) {
        if (result.ok) result.value.release();
        return;
      }
      if (result.ok) {
        release = result.value.release;
        setSettled({
          loader,
          source: url,
          inert,
          result: { status: "ready", url: result.value.url, error: undefined },
        });
      } else {
        setSettled({
          loader,
          source: url,
          inert,
          result: { status: "error", url: undefined, error: result.error },
        });
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
      release?.();
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
