// AUTHORED-BY Codex GPT-6.1-Sol
/** Browser entry: callers supply a scoped browser fetch; no Node networking is bundled. */
export { findComponents, getProperty, parseComponents } from "./ical.js";
export { vcardToContact } from "./map.js";
export { type DavAuth, DavFetchError, fetchDavWithFetch as fetchDav } from "./remote-core.js";
