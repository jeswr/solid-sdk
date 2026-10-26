// AUTHORED-BY GPT-5.6 Codex
(async () => {
  const params = new URLSearchParams(location.search);
  const attempts = {};
  const message = JSON.stringify({
    callbackId: `mob07-hostile-${params.get("nonce")}`,
    pluginId: "SuiteShareIntake",
    methodName: "getPending",
    options: {},
  });
  function attempt(name, target, call) {
    if (target == null) {
      attempts[name] = { status: "unavailable" };
      return;
    }
    try {
      call(target);
      // A native surface exposed to this foreign origin fails even without a reply.
      attempts[name] = { status: "exposed" };
    } catch (error) {
      attempts[name] = { status: "rejected", detail: String(error) };
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
  const cap = window.Capacitor;
  const plugin = cap?.Plugins?.SuiteShareIntake ?? cap?.registerPlugin?.("SuiteShareIntake");
  if (!plugin && typeof cap?.nativePromise !== "function") {
    attempts.capacitorPlugin = { status: "unavailable" };
  } else {
    let timer;
    try {
      const response = plugin
        ? plugin.getPending()
        : cap.nativePromise("SuiteShareIntake", "getPending", {});
      attempts.capacitorPlugin = await Promise.race([
        Promise.resolve(response).then(() => ({ status: "exposed" })),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ status: "no-response" }), 2000);
        }),
      ]);
    } catch (error) {
      attempts.capacitorPlugin = { status: "rejected", detail: String(error) };
    } finally {
      clearTimeout(timer);
    }
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
