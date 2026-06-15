// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public barrel for the Pod Health React view layer (`pod-health/ui`).
//
// This is the OPTIONAL, React-only surface: a framework-agnostic
// health-records list component + its data hook, sitting on top of the
// React-free data-layer core (`pod-health`). React is a *peer* dependency so a
// data-layer-only consumer never pulls it in. The view never touches RDF/fetch
// directly — it drives the data layer through `useHealthRecords`
// (`readHealth` → `listHealthEntries`), and takes the authenticated fetch as an
// injected seam (post-#18 the create-solid-app shell patches the global fetch;
// until then a stub fetch makes it unit-testable today).

export { entryIcon, errorMessage, formatDate, formatValue } from "./format.js";
export { HealthRecords, type HealthRecordsProps } from "./HealthRecords.js";
export {
  type HealthRecordsState,
  type UseHealthRecordsOptions,
  useHealthRecords,
} from "./useHealthRecords.js";
