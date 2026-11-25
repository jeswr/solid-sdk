// AUTHORED-BY Claude Sonnet 5.5
import { toast } from "@jeswr/suite-ui";

/**
 * Type Index registration only helps other apps find a collection, so a failure is a warning,
 * never a blocker. One wording for every app that registers (Slides, Templates, Wallet, Boards).
 */
export function warnRegistrationFailed(collection: string): void {
  toast.warning(
    `${collection} couldn't be registered in your Type Index, so other apps may not find them. They're still saved in your pod.`,
  );
}
