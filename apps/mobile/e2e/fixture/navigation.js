// AUTHORED-BY GPT-5.6 Codex
window.__e2e = {
  page: "navigation",
  origin: location.origin,
  href: location.href,
  documentId: crypto.randomUUID(),
  done: false,
  navigation: { attempted: false, refused: false },
};
(async () => {
  const { suiteOrigin, foreignOrigin } = await (await fetch("/config.json")).json();
  const state = window.__e2e;
  state.navigation.target = `${foreignOrigin}/foreign.html`;
  const render = () => {
    state.href = location.href;
    state.origin = location.origin;
    document.querySelector("#e2e-result").value = JSON.stringify(state);
  };
  const attempt = () => {
    state.navigation.attempted = true;
    render();
    // An absence assertion needs a bounded observation window. The driver independently checks
    // location.href and that this same document survived, including after foregrounding the app.
    setTimeout(() => {
      state.navigation.refused = location.origin === suiteOrigin;
      state.done = true;
      render();
    }, 2000);
    location.assign(state.navigation.target);
  };
  const link = document.querySelector("#e2e-foreign");
  link.href = state.navigation.target;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    attempt();
  });
  render();
  if (new URLSearchParams(location.search).get("manual") !== "1") attempt();
})().catch((error) => {
  window.__e2e.error = String(error);
  window.__e2e.done = true;
  document.querySelector("#e2e-result").value = JSON.stringify(window.__e2e);
});
