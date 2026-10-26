// AUTHORED-BY GPT-5.6 Codex
(async () => {
  const params = new URLSearchParams(location.search);
  const attempts = {};
  if (params.get("platform") === "ios") {
    const [webkitBridge, prompt] = await Promise.all([
      window.__e2eIOS.webkit(`mob07-hostile-${params.get("nonce")}-webkit`),
      window.__e2eIOS.prompt(),
    ]);
    parent.postMessage(
      {
        type: "mob07-hostile",
        nonce: params.get("nonce"),
        result: { origin: location.origin, attempts: { webkitBridge, prompt } },
      },
      params.get("parent"),
    );
    return;
  }
  const message = JSON.stringify({
    callbackId: `mob07-hostile-${params.get("nonce")}`,
    pluginId: "SuiteShareIntake",
    methodName: "getPending",
    options: {},
  });
  function attempt(name, target, call) {
    if (typeof target === "undefined") {
      attempts[name] = { status: "unavailable" };
      return;
    }
    // Presence fails even when a method is missing, throws, or returns false.
    attempts[name] = { status: "exposed" };
    try {
      call(target);
    } catch (error) {
      attempts[name].detail = String(error);
    }
  }
  attempt("androidBridge", window.androidBridge, (bridge) => bridge.postMessage(message));
  attempt("CapacitorCookiesAndroidInterface", window.CapacitorCookiesAndroidInterface, (api) =>
    api.isEnabled(),
  );
  attempt("CapacitorHttpAndroidInterface", window.CapacitorHttpAndroidInterface, (api) =>
    api.isEnabled(),
  );
  // WebViewCompat.addWebMessageListener uses the SAME androidBridge name as the legacy interface.
  attempt("webMessage", window.androidBridge, (listener) => listener.postMessage(message));
  let timer;
  try {
    const cap = window.Capacitor;
    let plugin = cap?.Plugins?.SuiteShareIntake;
    if (typeof plugin === "undefined" && typeof cap?.registerPlugin !== "undefined") {
      plugin = cap.registerPlugin("SuiteShareIntake");
    }
    if (typeof plugin === "undefined" && typeof cap?.nativePromise === "undefined") {
      attempts.capacitorPlugin = { status: "unavailable" };
    } else {
      const response =
        typeof plugin === "undefined"
          ? cap.nativePromise("SuiteShareIntake", "getPending", {})
          : plugin.getPending();
      attempts.capacitorPlugin = await Promise.race([
        Promise.resolve(response).then(() => ({ status: "exposed" })),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ status: "no-response" }), 2000);
        }),
      ]);
    }
  } catch (error) {
    const knownRejection =
      error?.code === "UNIMPLEMENTED" &&
      typeof error.message === "string" &&
      /^"SuiteShareIntake(?:" plugin|\.getPending\(\)") is not implemented on (?:web|android)$/.test(
        error.message,
      );
    attempts.capacitorPlugin = {
      status: knownRejection ? "rejected" : "error",
      code: error?.code,
      message: error?.message,
      detail: String(error),
    };
  } finally {
    clearTimeout(timer);
  }
  parent.postMessage(
    {
      type: "mob07-hostile",
      nonce: params.get("nonce"),
      result: { origin: location.origin, attempts },
    },
    params.get("parent"),
  );
})();
