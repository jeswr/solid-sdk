// AUTHORED-BY Claude Sonnet 5.5
export { type Dimensions, imageDimensions } from "./dimensions.js";
export type { MediaError, MediaErrorCode, Result } from "./errors.js";
export {
  type AcquireOptions,
  createMediaLoader,
  DEFAULT_ALLOWED_TYPES,
  INERT_TYPE,
  type MediaHandle,
  type MediaLoader,
  type MediaLoaderOptions,
  type MediaLoaderStats,
  type ObjectUrlApi,
} from "./loader.js";
export { defaultSniff, type Sniffed, type Sniffer } from "./sniff.js";
export type { MediaScope } from "./url.js";
