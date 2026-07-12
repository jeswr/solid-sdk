// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure, n8n-independent logic for the Solid node — the scope guard and the
// container-listing parser. The n8n node + credential classes live under
// `nodes/` and `credentials/` (per n8n community-node conventions) and import
// from here; these exports are also directly unit-testable without an n8n runtime.

export { type ContainerMember, parseContainerListing } from "./container.js";
export {
  assertWithinPod,
  isContainerUrl,
  normalizePodBase,
  type ResolvedTarget,
  redactUserinfo,
  resolveTarget,
} from "./scope.js";
