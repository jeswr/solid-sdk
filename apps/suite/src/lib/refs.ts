// AUTHORED-BY Claude Opus 5.5
/**
 * Route references (00-sdk-assumptions A-18) now come from the SDK façade. `InvalidRefError`
 * stays as the app's name for the façade's `RefError`.
 */
export {
  decodeIdentifierRef,
  decodeRef,
  encodeIdentifierRef,
  encodeRef,
  RefError as InvalidRefError,
} from "@jeswr/suite-sdk/react";
