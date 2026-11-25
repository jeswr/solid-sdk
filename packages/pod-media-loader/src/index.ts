// AUTHORED-BY Claude Sonnet 5.5
export { type Dimensions, imageDimensions } from "./dimensions.js";
export type { MediaError, MediaErrorCode, Result } from "./errors.js";
export {
  type AcquireOptions,
  createMediaLoader,
  DEFAULT_ALLOWED_TYPES,
  DEFAULT_ASSUMED_BYTES,
  DEFAULT_BUDGET_WAIT_MS,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_PIXELS,
  DEFAULT_READ_TIMEOUT_MS,
  HEAD_BYPASS_LIMIT,
  INERT_TYPE,
  type MediaHandle,
  type MediaLoader,
  type MediaLoaderEvent,
  type MediaLoaderOptions,
  type MediaLoaderStats,
  type ObjectUrlApi,
  SNIFF_WINDOW,
} from "./loader.js";
export { defaultSniff, type Sniffed, type Sniffer } from "./sniff.js";
export type { MediaScope } from "./url.js";
