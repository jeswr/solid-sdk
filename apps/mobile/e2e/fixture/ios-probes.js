// AUTHORED-BY GPT-5.6 Codex
(() => {
  if (
    window.Capacitor?.getPlatform?.() !== "ios" &&
    !window.webkit?.messageHandlers?.bridge &&
    new URLSearchParams(location.search).get("platform") !== "ios"
  )
    return;
  const responses = [];
  window.Capacitor ??= {};
  const cap = window.Capacitor;
  const original = cap.fromNative;
  // Capacitor 8 sends plugin replies to the MAIN document, even for an iframe's call.
  // Observe before the original callback deletes data/error. Keep normal plugin delivery intact.
  cap.fromNative = function (response) {
    responses.push(JSON.parse(JSON.stringify(response)));
    return original?.call(this, response);
  };
  const observe = (callbackId, send) =>
    new Promise((resolve) => {
      const started = performance.now();
      let value;
      try {
        value = send();
      } catch (error) {
        resolve({ status: "error", callbackId, detail: String(error) });
        return;
      }
      setTimeout(() => {
        const observedMs = Math.round(performance.now() - started);
        const response = responses.find((reply) => reply.callbackId === callbackId);
        resolve(
          callbackId
            ? {
                status: response
                  ? response.success === true && Array.isArray(response.data?.batches)
                    ? "resolved"
                    : "response"
                  : "no-response",
                callbackId,
                observedMs,
                data: response?.data,
              }
            : { status: value === null ? "no-response" : "response", observedMs, value },
        );
      }, 2000);
    });
  window.__e2eIOS = {
    responses,
    webkit: (callbackId) =>
      observe(callbackId, () =>
        window.webkit.messageHandlers.bridge.postMessage({
          type: "message",
          callbackId,
          pluginId: "SuiteShareIntake",
          methodName: "getPending",
          options: {},
        }),
      ),
    // This is Capacitor 8.5.3's actual synchronous prompt command. Plugin methods do not
    // use prompt: sending getPending there would display a JavaScript dialog in the main frame.
    prompt: () =>
      observe(null, () => window.prompt(JSON.stringify({ type: "CapacitorCookies.isEnabled" }))),
  };
})();
