// AUTHORED-BY Codex GPT-6.1-Sol
import type { NotificationSource } from "./notifications-model";
export interface NotificationVisibility extends EventTarget {
  visibilityState: string;
}
/** Each source without a usable live subscription still needs polling. */
export function startNotificationUpdates(
  sources: readonly NotificationSource[],
  liveUpdates: boolean,
  document: NotificationVisibility,
  refresh: () => void,
): () => void {
  const stops: (() => void)[] = [];
  let needsPolling = false;
  for (const source of sources) {
    if (liveUpdates && source.subscribe) {
      try {
        stops.push(source.subscribe(refresh));
      } catch {
        needsPolling = true;
      }
    } else needsPolling = true;
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  const visibility = () => {
    clearInterval(timer);
    if (needsPolling && document.visibilityState === "visible") {
      refresh();
      timer = setInterval(refresh, 60_000);
    }
  };
  document.addEventListener("visibilitychange", visibility);
  visibility();
  if (!needsPolling) refresh();
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", visibility);
    for (const stop of stops) stop();
  };
}
