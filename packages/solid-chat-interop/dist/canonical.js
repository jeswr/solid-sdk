// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The CANONICAL in-memory chat model — the hub type every shape (AS2.0, SolidOS
 * LongChat, and any external adapter such as LibreChat) maps to and from.
 *
 * It is aligned to `@jeswr/pod-chat`'s ActivityStreams 2.0 model (the suite's
 * canonical write shape) and the SolidOS LongChat read shape — mints nothing that
 * already exists. A {@link CanonicalMessage} corresponds to an `as:Note` /
 * `sioc:Note`; a {@link CanonicalRoom} to an `as:Collection` / `pc:ChatRoom` /
 * `meeting:LongChat`. The actionable {@link MessageTask} overlay is identical to
 * pod-chat's and is carried by the shared `@jeswr/solid-task-model` `wf:Task`
 * shape, so an actionable canonical message round-trips as the SAME task
 * solid-issues / the Pod Manager read.
 *
 * Plain, serialisable objects (no RDF terms, no platform) — the shape an app's UI
 * works with and the boundary every reconciler/adapter speaks.
 */
export {};
//# sourceMappingURL=canonical.js.map