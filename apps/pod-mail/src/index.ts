// AUTHORED-BY Claude Opus 4.8
/**
 * @jeswr/pod-mail — the Solid-native mail data layer.
 *
 * Public surface of the non-throwaway core: the typed RDF model for messages,
 * threads and folders (schema:EmailMessage / SIOC), pod-shaped read/write/list,
 * serialisation, and type-index registration. The UI and the IMAP/SMTP bridge
 * are deliberate follow-ups built on top of this layer.
 */

export * from "./model/folder.js";
export * from "./model/mailbox.js";
export * from "./model/message.js";
export * from "./model/paths.js";
export * from "./model/serialise.js";
export * from "./model/store.js";
export * from "./model/thread.js";
export * from "./model/typeIndex.js";
export * from "./model/vocab.js";
