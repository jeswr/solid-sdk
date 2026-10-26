// AUTHORED-BY Claude Opus 5.5
import { expect, test } from "vitest";
import * as api from "./index.js";

test("the root entry point exposes the runtime API without importing Capacitor", () => {
  expect(Object.keys(api).sort()).toEqual([
    "AuthorizationError",
    "AuthorizationRequestError",
    "BusyError",
    "DEFAULT_SHARE_LIMITS",
    "InvalidShareError",
    "MOBILE_CLIENT_ID_PATH",
    "MOBILE_REDIRECT_URI",
    "NativeAuthError",
    "ShareUnavailableError",
    "StateMismatchError",
    "SuiteNativeError",
    "USER_CANCELLED",
    "UserCancelledError",
    "createNativeCodeDriver",
    "createShareInbox",
    "isNativeApp",
    "mobileClientIdDocument",
    "platform",
    "sanitiseFileName",
    "share",
    "validateShareBatch",
  ]);
  expect(new api.UserCancelledError("x")).toBeInstanceOf(api.SuiteNativeError);
  expect(new api.SuiteNativeError("x").name).toBe("SuiteNativeError");
});
