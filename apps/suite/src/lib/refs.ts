// AUTHORED-BY Claude Opus 5.5
/**
 * Route references (00-sdk-assumptions A-18) come from the SDK's pure `./refs` subpath, so server
 * routes and models do not load the `./react` façade. `InvalidRefError` stays as the app's
 * name for the SDK's `RefError`.
 */
export {
  decodeIdentifierRef,
  decodeRef,
  encodeIdentifierRef,
  encodeRef,
  RefError as InvalidRefError,
} from "@jeswr/suite-sdk/refs";
