// AUTHORED-BY GPT-5.6 Codex
window.__e2e = {
  page: "navigation",
  origin: location.origin,
  done: false,
  navigation: { attempted: false, refused: false },
};
(async () => {
  const { suiteOrigin, foreignOrigin } = await (await fetch("/config.json")).json();
  const state = window.__e2e;
  state.navigation.target = `${foreignOrigin}/foreign.html`;
  state.navigation.attempted = true;
  // An absence assertion needs a bounded observation window. The driver independently checks
  // location.href and that this same document survived, including after foregrounding the app.
  setTimeout(() => {
    state.navigation.refused = location.origin === suiteOrigin;
    state.done = true;
  }, 2000);
  location.assign(state.navigation.target);
})().catch((error) => {
  window.__e2e.error = String(error);
  window.__e2e.done = true;
});
