// AUTHORED-BY Claude Sonnet 5.5
import { SuiteNativeError } from "@jeswr/suite-native";

export type DesktopAuthErrorCode = "timed-out" | "host-failed";

/**
 * A desktop sign-in that did not finish for a reason the app can tell the person about:
 * `timed-out` (no callback arrived in time) or `host-failed` (the shell could not listen for
 * deep links or open the browser, or the request was unusable). The message is the code alone;
 * nothing from the host is carried.
 */
export class DesktopAuthError extends SuiteNativeError {
  override readonly name = "DesktopAuthError";
  constructor(readonly code: DesktopAuthErrorCode) {
    super(code);
  }
}
