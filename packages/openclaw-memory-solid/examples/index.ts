// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// Example OpenClaw extension entry — copy/adapt into `~/.openclaw/extensions/`.
//
// This file is illustrative ONLY: it is NOT part of the built `dist/` (it is
// outside `tsconfig`'s `include`), is not typechecked by the gate, and depends on
// YOU supplying an authenticated Solid pod `fetch`. OpenClaw config is plain JSON
// data, so the pod credentials / authenticated fetch CANNOT be expressed in
// `openclaw.json` — wire them here, in code (e.g. a client-credentials DPoP fetch
// or a `@solid/reactive-authentication` session fetch).
//
// OpenClaw loads a `kind:"memory"` extension via jiti and selects it with
// `plugins.slots.memory` in `openclaw.json`. The module DEFAULT-EXPORTS the plugin
// object; container / agent WebID / default conversation come from the plugin
// config block (or the defaults passed here).

import { createOpenClawMemoryPlugin } from "@jeswr/openclaw-memory-solid/plugin";

/**
 * Replace this with your authenticated Solid pod `fetch` — e.g. a DPoP
 * client-credentials fetch, or the session `fetch` from
 * `@solid/reactive-authentication`. The plugin does NO auth itself (injectable
 * authed-fetch seam).
 */
declare const authedFetch: typeof globalThis.fetch;

export default createOpenClawMemoryPlugin({
  fetch: authedFetch,
  // Defaults; the plugin config block in openclaw.json overrides these.
  container: "https://alice.example/memories/",
  agentWebId: "https://agent.example/profile/card#me",
  defaultLimit: 10,
});
