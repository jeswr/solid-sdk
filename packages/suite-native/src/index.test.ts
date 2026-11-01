// AUTHORED-BY Claude Opus 5.5
import { expect, test, vi } from "vitest";
import * as api from "./index.js";

vi.mock("@capacitor/core", () => {
  throw new Error("The root entry must not import Capacitor");
});

test("the root entry point exposes the runtime API without importing Capacitor", () => {
  expect(Object.keys(api).sort()).toEqual([
    "AuthorizationError",
    "AuthorizationRequestError",
    "BusyError",
    "DEFAULT_SHARE_LIMITS",
    "DEFAULT_SHARE_STAGING_LIMITS",
    "InvalidShareError",
    "MOBILE_CLIENT_ID_PATH",
    "MOBILE_REDIRECT_URI",
    "NativeAuthError",
    "PDF_PREVIEW_CHUNK_BYTES",
    "PDF_PREVIEW_MAX_BYTES",
    "PdfPreviewError",
    "SecureStoreError",
    "ShareUnavailableError",
    "StateMismatchError",
    "SuiteNativeError",
    "USER_CANCELLED",
    "UserCancelledError",
    "createNativeCodeDriver",
    "createSecureStore",
    "createShareInbox",
    "isNativeApp",
    "mobileClientIdDocument",
    "openPdf",
    "platform",
    "refreshTokenKey",
    "sanitiseFileName",
    "share",
    "shareFiles",
    "stageFile",
    "validateShareBatch",
  ]);
  expect(new api.UserCancelledError("x")).toBeInstanceOf(api.SuiteNativeError);
  expect(new api.SuiteNativeError("x").name).toBe("SuiteNativeError");
});
