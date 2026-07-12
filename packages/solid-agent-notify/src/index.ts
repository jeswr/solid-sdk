// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `solid-agent-notify` — SSRF-hardened cross-pod Linked Data Notifications (LDN)
 * for Solid: discover an agent's `ldp:inbox`, POST an ActivityStreams 2.0
 * notification to it, and read an inbox.
 *
 * Every outbound dereference (profile GET, inbox GET, member GET, notification
 * POST) is forced through the single DNS-pinned, redirect-revalidating egress
 * chokepoint {@link guardedFetch} — the ONLY permitted way to fetch an
 * attacker-influenced URL in this package (`npm run check:fetch` enforces it).
 *
 * @packageDocumentation
 */

export type { ActivityNotification, ActivityType } from "./activity.js";
// ── Activity model ──
export {
  ActivityDoc,
  buildActivity,
  escapeIri,
  isHttpIri,
  safeHttpIri,
  serializeTurtle,
} from "./activity.js";
export type { NotifyOptions } from "./discover.js";
// ── Discovery ──
export { discoverInbox, profileDocUrl } from "./discover.js";
// ── Errors ──
export {
  AgentNotifyError,
  InboxScopeError,
  NoInboxError,
  NotificationSendError,
} from "./errors.js";
export type { InboxNotification } from "./read.js";
// ── Read ──
export {
  findActivitySubject,
  isDirectChild,
  parseInboxNotification,
  readInbox,
} from "./read.js";
export type {
  GuardedFetchOptions,
  GuardedFetchResult,
} from "./security/guardedFetch.js";
// ── The egress chokepoint + its guard-layer errors (for advanced callers/tests) ──
export {
  BodyTooLargeError,
  GuardedFetchError,
  guardedFetch,
  SsrfError,
} from "./security/guardedFetch.js";
export type { LookupAddress } from "./security/ssrf.js";
export {
  assertNotSsrf,
  isDeniedHostname,
  isLoopbackAddress,
  isPublicAddress,
  normalizeHostForClassification,
} from "./security/ssrf.js";
export type { NotifyAgentArgs, SendResult } from "./send.js";
// ── Send ──
export { notifyAgent, sendNotification } from "./send.js";
export type {
  NotifyTaskArgs,
  TaskNotification,
  TaskState,
} from "./task.js";
// ── Shared federation task model (https://w3id.org/jeswr/task — wf:Task + dct:) ──
export {
  buildTaskNotification,
  notifyTaskAssigned,
  notifyTaskStateChanged,
  parseTask,
  parseTaskFromNotification,
  TaskDoc,
  writeTask,
} from "./task.js";
