// AUTHORED-BY GPT-5.6 Codex
(() => {
  const state = {
    page: "index",
    documentId: crypto.randomUUID(),
    origin: location.origin,
    done: false,
    errors: [],
    capabilities: {
      secureContext: window.isSecureContext,
      cryptoSubtle: typeof window.crypto?.subtle === "object",
      locks: typeof navigator.locks === "object",
      serviceWorker: typeof navigator.serviceWorker === "object",
    },
    topBridge: false,
    listenerReady: false,
    hostile: null,
    shares: { events: [], pending: [] },
  };
  window.__e2e = state;
  const deadline = (promise, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Native call or hostile frame timed out")),
        ms,
      );
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  async function run() {
    const { suiteOrigin, foreignOrigin } = await (await fetch("/config.json")).json();
    if (location.origin !== suiteOrigin) throw new Error("Unexpected suite origin");
    const frame = document.querySelector("#hostile");
    const nonce = crypto.randomUUID();
    const hostile = new Promise((resolve) => {
      const receive = (event) => {
        if (
          event.source !== frame.contentWindow ||
          event.origin !== foreignOrigin ||
          event.data?.type !== "mob07-hostile" ||
          event.data.nonce !== nonce
        )
          return;
        window.removeEventListener("message", receive);
        resolve(event.data.result);
      };
      window.addEventListener("message", receive);
    });
    // Deliberately no sandbox or CSP that could mask a native isolation regression.
    frame.src = `${foreignOrigin}/hostile.html?parent=${encodeURIComponent(suiteOrigin)}&nonce=${nonce}`;
    const cap = window.Capacitor;
    const intake = cap?.Plugins?.SuiteShareIntake ?? cap?.registerPlugin?.("SuiteShareIntake");
    if (!intake) throw new Error("SuiteShareIntake is unavailable");
    window.__e2eRefreshShares = async () => {
      const response = await deadline(intake.getPending(), 5000);
      if (!Array.isArray(response?.batches)) throw new Error("Invalid getPending response");
      state.shares.pending = response.batches;
      return state.shares;
    };
    window.__e2eAcknowledge = async (batchId) => {
      await deadline(intake.acknowledge({ batchId }), 5000);
      state.shares.events = [];
      return window.__e2eRefreshShares();
    };
    // Register before reading pending, so an event cannot slip through the startup gap.
    await deadline(
      intake.addListener("shareReceived", (batch) => state.shares.events.push(batch)),
      5000,
    );
    state.listenerReady = true;
    await window.__e2eRefreshShares();
    state.topBridge = true;
    state.hostile = await deadline(hostile, 10000);
  }
  run()
    .catch((error) => state.errors.push(String(error)))
    .finally(() => {
      state.done = true;
    });
})();
