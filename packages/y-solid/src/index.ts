// AUTHORED-BY Codex GPT-6.1-Sol
/** Protocol-neutral Yjs update-log persistence for Solid and LWS. */

export {
  assertWithinPodScope,
  isContainerUrl,
  normalizePodBase,
  PodScopeError,
} from "@jeswr/guarded-fetch";
export {
  SolidPersistence,
  type SolidPersistenceEvents,
  type SolidPersistenceOptions,
  type YSolidOptions,
  YSolidProvider,
} from "./provider.js";
export {
  SolidUpdateStore,
  type SolidUpdateStoreOptions,
  type StoredUpdate,
  UPDATE_CONTENT_TYPE,
} from "./store.js";
