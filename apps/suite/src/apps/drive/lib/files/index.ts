// AUTHORED-BY Codex GPT-6.1-Sol
export { type BreadcrumbSegment, breadcrumbs } from "./breadcrumbs";
export { FileError, type FileErrorCode } from "./errors";
export { detectContentType, guessContentType, sniffContentType } from "./mime";
export {
  encodeResourceName,
  extensionChain,
  MAX_RESOURCE_NAME_LENGTH,
  renameOnConflict,
  uploadFileName,
  withSuffix,
} from "./names";
export { formatFileSize } from "./sizes";
