// AUTHORED-BY Codex GPT-6.1-Sol
export { MAX_UPLOAD_CHUNKS, planChunks } from "./chunks";
export { encodeUploadPath, keepBothName, normalizeUploadName } from "./names";
export { planUploads } from "./planner";
export { diffFolderTree } from "./tree";
export type {
  ConflictPolicy,
  DroppedEntry,
  ExistingEntry,
  FolderChange,
  PlannedFile,
  UploadChunk,
  UploadKind,
  UploadPath,
  UploadPlan,
  UploadPlanInput,
} from "./types";
export { UploadPlanningError, type UploadPlanningErrorCode } from "./validation";
