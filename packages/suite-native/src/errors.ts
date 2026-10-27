// AUTHORED-BY Claude Opus 5.5

/** Base class for every error this package throws, so callers can branch on one type. */
export class SuiteNativeError extends Error {
  override readonly name: string = "SuiteNativeError";
}

/** The authorization request or the redirect it produced failed a fail-closed check. */
export class AuthorizationRequestError extends SuiteNativeError {
  override readonly name = "AuthorizationRequestError";
}

/** The callback's `state` does not match the request: a possible CSRF or mix-up attempt. */
export class StateMismatchError extends SuiteNativeError {
  override readonly name = "StateMismatchError";
}

/** The authorization server answered with an RFC 6749 §4.1.2.1 error response. */
export class AuthorizationError extends SuiteNativeError {
  override readonly name = "AuthorizationError";
  constructor(
    readonly code: string,
    readonly description?: string,
  ) {
    super(
      description
        ? `Authorization failed (${code}): ${description}`
        : `Authorization failed (${code})`,
    );
  }
}

/** The person closed the system browser sheet before finishing sign-in. */
export class UserCancelledError extends SuiteNativeError {
  override readonly name = "UserCancelledError";
}

/** A sign-in is already in progress; the native session supports one at a time. */
export class BusyError extends SuiteNativeError {
  override readonly name = "BusyError";
}

/** The native authentication session failed for a platform reason. */
export class NativeAuthError extends SuiteNativeError {
  override readonly name = "NativeAuthError";
}

/** Neither a native share sheet nor the Web Share API can handle the request. */
export class ShareUnavailableError extends SuiteNativeError {
  override readonly name = "ShareUnavailableError";
}

/** A share batch from native code failed validation. */
export class InvalidShareError extends SuiteNativeError {
  override readonly name = "InvalidShareError";
}
