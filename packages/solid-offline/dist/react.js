import { useRef, useEffect, useSyncExternalStore, useCallback, useState, useMemo } from 'react';

// src/react.ts

// src/status.ts
var DEFAULT_CHANNEL_NAME = "solid-offline";
function defaultIsOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}
function defaultConnectivity() {
  if (typeof window !== "undefined") return window;
  if (typeof globalThis !== "undefined" && "addEventListener" in globalThis) {
    return globalThis;
  }
  return void 0;
}
function defaultChannel(name) {
  if (typeof BroadcastChannel === "undefined") return void 0;
  return new BroadcastChannel(name);
}
function createStatusSurface(options = {}) {
  const channelName = options.channelName ?? DEFAULT_CHANNEL_NAME;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const channel = options.channel ?? defaultChannel(channelName);
  const connectivity = options.connectivity ?? defaultConnectivity();
  const listeners = /* @__PURE__ */ new Set();
  const resources = /* @__PURE__ */ new Map();
  let online = isOnline();
  let snapshot = computeSnapshot();
  function computeSnapshot() {
    let pending = 0;
    let stale = 0;
    let updated = 0;
    const map = {};
    for (const [url, freshness] of resources) {
      map[url] = freshness;
      if (freshness === "pending") pending += 1;
      else if (freshness === "stale") stale += 1;
      else if (freshness === "updated") updated += 1;
    }
    return { online, pending, stale, updated, resources: map };
  }
  function emit() {
    snapshot = computeSnapshot();
    for (const listener of listeners) listener();
  }
  function setFreshness(url, freshness) {
    if (resources.get(url) === freshness) return;
    resources.set(url, freshness);
    emit();
  }
  const onMessage = (event) => {
    const data = event.data;
    if (!data || data.event !== "updated") return;
    if (resources.has(data.url)) setFreshness(data.url, "updated");
  };
  const onOnline = () => {
    if (online) return;
    online = true;
    emit();
  };
  const onOffline = () => {
    if (!online) return;
    online = false;
    emit();
  };
  channel?.addEventListener("message", onMessage);
  connectivity?.addEventListener("online", onOnline);
  connectivity?.addEventListener("offline", onOffline);
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    markPending(url) {
      setFreshness(url, "pending");
    },
    markFresh(url) {
      setFreshness(url, "fresh");
    },
    markStale(url) {
      setFreshness(url, "stale");
    },
    forget(url) {
      if (!resources.delete(url)) return;
      emit();
    },
    close() {
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      connectivity?.removeEventListener("online", onOnline);
      connectivity?.removeEventListener("offline", onOffline);
      listeners.clear();
      resources.clear();
    }
  };
}

// src/react.ts
function useOfflineStatus(surfaceOrOptions) {
  const provided = isSurface(surfaceOrOptions) ? surfaceOrOptions : void 0;
  const optionsRef = useRef(
    isSurface(surfaceOrOptions) ? void 0 : surfaceOrOptions
  );
  const ownedRef = useRef(void 0);
  if (!provided && !ownedRef.current) {
    ownedRef.current = createStatusSurface(optionsRef.current ?? {});
  }
  const surface = provided ?? ownedRef.current;
  useEffect(() => {
    return () => {
      if (!provided) {
        ownedRef.current?.close();
        ownedRef.current = void 0;
      }
    };
  }, [provided]);
  return useSyncExternalStore(
    useCallback((cb) => surface.subscribe(cb), [surface]),
    () => surface.getSnapshot(),
    () => surface.getSnapshot()
  );
}
function isSurface(x) {
  return typeof x === "object" && x !== null && typeof x.subscribe === "function" && typeof x.getSnapshot === "function";
}
var DEFAULT_CHANNEL_NAME2 = "solid-offline";
function makeUpdatedStore(url, channelName) {
  let version = 0;
  const listeners = /* @__PURE__ */ new Set();
  let channel;
  const onMessage = (event) => {
    const data = event.data;
    if (!data || data.event !== "updated" || data.url !== url) return;
    version += 1;
    for (const l of listeners) l();
  };
  return {
    subscribe(cb) {
      listeners.add(cb);
      if (!channel && url && typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(channelName);
        channel.addEventListener("message", onMessage);
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && channel) {
          channel.removeEventListener("message", onMessage);
          channel.close();
          channel = void 0;
        }
      };
    },
    getSnapshot() {
      return version;
    }
  };
}
function useOfflineResource(url, options = {}) {
  const { fetch: customFetch, init, select, skip } = options;
  const channelName = options.channelName ?? DEFAULT_CHANNEL_NAME2;
  const [data, setData] = useState(void 0);
  const [state, setState] = useState(skip ? "idle" : "loading");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState(void 0);
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [reloadNonce, setReloadNonce] = useState(0);
  const updatedStore = useMemo(() => makeUpdatedStore(url, channelName), [url, channelName]);
  const updatedVersion = useSyncExternalStore(
    updatedStore.subscribe,
    updatedStore.getSnapshot,
    () => 0
  );
  const readVersionRef = useRef(0);
  const outdated = updatedVersion > readVersionRef.current && state === "success";
  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);
  const inputsRef = useRef({ init, select, customFetch });
  inputsRef.current = { init, select, customFetch };
  const actedNonceRef = useRef(0);
  const manualPendingRef = useRef(false);
  const manualUrlRef = useRef(void 0);
  useEffect(() => {
    if (reloadNonce > actedNonceRef.current) {
      actedNonceRef.current = reloadNonce;
      manualPendingRef.current = true;
      manualUrlRef.current = url;
    }
    if (manualPendingRef.current && manualUrlRef.current !== url) {
      manualPendingRef.current = false;
      manualUrlRef.current = void 0;
    }
    if (skip && !manualPendingRef.current || !url) {
      setState("idle");
      return;
    }
    const versionAtRead = updatedVersion;
    let cancelled = false;
    const { init: curInit, select: curSelect, customFetch: curFetch } = inputsRef.current;
    const doFetch = curFetch ?? (typeof fetch !== "undefined" ? fetch : void 0);
    if (!doFetch) {
      setState("error");
      setError(new Error("[solid-offline] no fetch available"));
      return;
    }
    setState("loading");
    setError(void 0);
    const headers = new Headers(curInit?.headers);
    if (!headers.has("accept")) headers.set("accept", "text/turtle");
    (async () => {
      try {
        const response = await doFetch(url, { ...curInit, headers });
        if (cancelled) return;
        setStale(response.headers.get("x-offline") === "stale");
        const value = curSelect ? await curSelect(response.clone()) : response;
        if (cancelled) return;
        setData(value);
        setState("success");
        readVersionRef.current = versionAtRead;
        manualPendingRef.current = false;
        manualUrlRef.current = void 0;
      } catch (err) {
        if (cancelled) return;
        setError(err);
        setState("error");
        manualPendingRef.current = false;
        manualUrlRef.current = void 0;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, skip, reloadNonce, updatedVersion]);
  return {
    data,
    state,
    pending: state === "loading",
    stale,
    outdated,
    online,
    error,
    reload
  };
}

export { useOfflineResource, useOfflineStatus };
//# sourceMappingURL=react.js.map
//# sourceMappingURL=react.js.map