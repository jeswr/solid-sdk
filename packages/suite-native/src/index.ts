// AUTHORED-BY Claude Opus 5.5
export {
  type AuthSessionPlugin,
  createNativeCodeDriver,
  type GetCode,
  type NativeCodeDriverOptions,
  USER_CANCELLED,
} from "./auth-session.js";
export {
  type ClientIdDocument,
  MOBILE_CLIENT_ID_PATH,
  MOBILE_REDIRECT_URI,
  type MobileClientIdOptions,
  mobileClientIdDocument,
} from "./client-id.js";
export {
  AuthorizationError,
  AuthorizationRequestError,
  BusyError,
  InvalidShareError,
  NativeAuthError,
  SecureStoreError,
  type SecureStoreErrorCode,
  ShareUnavailableError,
  StateMismatchError,
  SuiteNativeError,
  UserCancelledError,
} from "./errors.js";
export {
  clearPdfPreviews,
  openPdf,
  PDF_PREVIEW_CHUNK_BYTES,
  PDF_PREVIEW_MAX_BYTES,
  PDF_PREVIEW_NAME_CODE_POINTS,
  PdfPreviewError,
  type PdfPreviewErrorCode,
  type PdfPreviewPlugin,
} from "./pdf-preview.js";
export { type CapacitorRuntime, isNativeApp, type Platform, platform } from "./platform.js";
export {
  createSecureStore,
  type RefreshTokenIdentity,
  refreshTokenKey,
  type SecureStore,
  type SecureStoreEntry,
  type SecureStorePlugin,
  type SecureStoreSetOptions,
  type SecureStoreStatus,
} from "./secure-store.js";
export {
  type ShareContent,
  type SharePlugin,
  type ShareResult,
  type ShareTargets,
  share,
  type WebShare,
} from "./share.js";
export {
  createShareInbox,
  DEFAULT_SHARE_LIMITS,
  type ShareBatch,
  type ShareFileItem,
  type ShareInbox,
  type ShareInboxOptions,
  type ShareIntakePlugin,
  type ShareItem,
  type ShareLimits,
  type ShareTextItem,
  type ShareUrlItem,
  sanitiseFileName,
  validateShareBatch,
} from "./share-intake.js";
export {
  DEFAULT_SHARE_STAGING_LIMITS,
  type ShareFile,
  type ShareStagingLimits,
  type ShareStagingPlugin,
  shareFiles,
  stageFile,
} from "./share-staging.js";
