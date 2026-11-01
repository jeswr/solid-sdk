// AUTHORED-BY Codex GPT-6.1-Sol
(() => {
  const cap = window.Capacitor;
  const responses = [];
  const ownCallbacks = new Set();
  let hostileMode = false;
  const observeReply = (reply) => {
    if (
      String(reply.callbackId).startsWith("p4-hostile-") ||
      (reply.pluginId === "SuiteSecureStore" && !ownCallbacks.has(reply.callbackId))
    )
      responses.push(reply.callbackId);
  };
  // Android can deliver iframe callbacks into the main document as well. Keep delivery intact.
  if (cap) {
    const original = cap.fromNative;
    cap.fromNative = function (reply) {
      observeReply(reply);
      return original?.call(this, reply);
    };
    if (typeof cap.toNative === "function") {
      const send = cap.toNative;
      cap.toNative = function (pluginId, ...args) {
        const id = send.call(this, pluginId, ...args);
        if (!hostileMode && pluginId === "SuiteSecureStore") ownCallbacks.add(id);
        return id;
      };
    }
  }
  // WebMessage replies use onmessage rather than fromNative in Capacitor 8.
  if (window.androidBridge) {
    const original = window.androidBridge.onmessage;
    window.androidBridge.onmessage = function (event) {
      observeReply(JSON.parse(event.data));
      return original?.call(this, event);
    };
  }
  const plugin = () => cap?.Plugins?.SuiteSecureStore ?? cap?.registerPlugin?.("SuiteSecureStore");
  const call = (method, options = {}) => {
    const store = plugin();
    const promise = store
      ? store[method](options)
      : cap.nativePromise("SuiteSecureStore", method, options);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`SuiteSecureStore.${method} timeout`)), 5000);
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  };
  const write = async (key, value, userPresence = false) => {
    const before = await call("get", { key });
    return call("set", { key, value, userPresence, version: before.version });
  };
  const key = "p4-e2e:retained";
  let gated;
  window.__e2eSecureStore = {
    responses,
    async ungated() {
      const marker = `p4-e2e-plaintext-marker-${crypto.randomUUID()}`;
      const result = { marker, status: await call("status") };
      const firstKey = "p4-e2e:first";
      const secondKey = "p4-e2e:second";
      result.initial = await call("get", { key: firstKey });
      result.created = await call("set", {
        key: firstKey,
        value: marker,
        userPresence: false,
        version: result.initial.version,
      });
      result.read = await call("get", { key: firstKey });
      try {
        await call("set", {
          key: firstKey,
          value: "stale-must-not-commit",
          userPresence: false,
          version: result.initial.version,
        });
        result.staleCode = "resolved";
      } catch (error) {
        result.staleCode = error.code;
      }
      result.updated = await call("set", {
        key: firstKey,
        value: `${marker}-updated`,
        userPresence: false,
        version: result.read.version,
      });
      result.updatedRead = await call("get", { key: firstKey });
      await call("remove", { key: firstKey });
      result.removed = await call("get", { key: firstKey });
      await write(firstKey, marker);
      await write(secondKey, marker);
      result.beforeClear = await Promise.all(
        [firstKey, secondKey].map((key) => call("get", { key })),
      );
      await call("clear");
      result.afterClear = await Promise.all(
        [firstKey, secondKey].map((key) => call("get", { key })),
      );
      result.retainedSet = await write(key, marker);
      result.retained = await call("get", { key });
      return result;
    },
    status: () => call("status"),
    // Start without awaiting the get: the host must be free to drive the real system prompt.
    startGated(path) {
      gated = { path, stage: "preparing", value: `p4-e2e-gated-${crypto.randomUUID()}` };
      const attempt = gated;
      const gatedKey = `p4-e2e:gated-${path}`;
      (async () => {
        attempt.committed = await write(gatedKey, attempt.value, true);
        attempt.stage = "waiting";
        // No fixture timeout here: the host cancels and drains an unautomatable prompt.
        const store = plugin();
        attempt.read = await (store
          ? store.get({ key: gatedKey })
          : cap.nativePromise("SuiteSecureStore", "get", { key: gatedKey }));
        attempt.stage = "done";
      })().catch((error) => {
        attempt.stage = "error";
        attempt.code = error.code ?? "failed";
      });
      return attempt;
    },
    gated: () => gated,
    async cleanup() {
      await call("cancel");
      await call("clear");
      return call("get", { key });
    },
    async hostile(nonce) {
      hostileMode = true;
      const attempts = {};
      const started = performance.now();
      const observe = (channel, method) => {
        const callbackId = `p4-hostile-${nonce}-${channel}-${method}`;
        const options =
          method === "get"
            ? { key }
            : {
                key: "p4-e2e:hostile",
                value: "hostile-must-not-commit",
                version: 0,
                userPresence: false,
              };
        const evidence = { callbackId, status: "no-response", transport: false };
        attempts[`${channel}.${method}`] = evidence;
        try {
          if (channel === "capacitorPlugin") {
            const store = plugin();
            if (store || typeof cap?.nativePromise !== "undefined") {
              const pending = store
                ? store[method](options)
                : cap.nativePromise("SuiteSecureStore", method, options);
              Promise.resolve(pending).then(
                () => {
                  evidence.status = "response";
                },
                (error) => {
                  // A local missing-plugin rejection isn't a reply from native code.
                  if (
                    error?.code === "UNIMPLEMENTED" &&
                    /^"SuiteSecureStore(?:" plugin|\.(?:get|set)\(\)") is not implemented on (?:web|android)$/.test(
                      error.message,
                    )
                  ) {
                    evidence.localRejection = true;
                  } else {
                    evidence.status = "error";
                  }
                },
              );
            }
          } else {
            const target = window[channel === "webMessage" ? "androidBridge" : channel];
            if (typeof target !== "undefined") {
              evidence.transport = true;
              target.postMessage(
                JSON.stringify({
                  callbackId,
                  pluginId: "SuiteSecureStore",
                  methodName: method,
                  options,
                }),
              );
            }
          }
        } catch {
          evidence.status = "error";
        }
      };
      for (const channel of [
        "androidBridge",
        "CapacitorCookiesAndroidInterface",
        "CapacitorHttpAndroidInterface",
        "capacitorPlugin",
        "webMessage",
      ]) {
        for (const method of ["get", "set"]) observe(channel, method);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      for (const evidence of Object.values(attempts)) {
        evidence.observedMs = Math.round(performance.now() - started);
        if (responses.includes(evidence.callbackId)) evidence.status = "response";
        if (evidence.callbackId.includes("-capacitorPlugin-") && responses.length)
          evidence.status = "response";
      }
      return attempts;
    },
  };
})();
