// AUTHORED-BY Claude Opus 5.5
import { AmbiguousIssuerError } from "@jeswr/pod-auth";

/** A WebID lists several providers: the session provider offers them, keeping the WebID. */
export class IssuerChoiceRequiredError extends AmbiguousIssuerError {
  constructor(readonly issuers: readonly string[]) {
    super();
  }
}
