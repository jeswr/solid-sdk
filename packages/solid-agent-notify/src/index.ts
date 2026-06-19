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

// ── Discovery ──
export { discoverInbox, profileDocUrl } from "./discover.js";
export type { NotifyOptions } from "./discover.js";

// ── Send ──
export { sendNotification, notifyAgent } from "./send.js";
export type { SendResult, NotifyAgentArgs } from "./send.js";

// ── Read ──
export {
  readInbox,
  parseInboxNotification,
  findActivitySubject,
  isDirectChild,
} from "./read.js";
export type { InboxNotification } from "./read.js";

// ── Activity model ──
export {
  buildActivity,
  serializeTurtle,
  ActivityDoc,
  isHttpIri,
} from "./activity.js";
export type { ActivityNotification, ActivityType } from "./activity.js";

// ── Shared federation task model (https://w3id.org/jeswr/task — wf:Task + dct:) ──
export {
  TaskDoc,
  writeTask,
  buildTaskNotification,
  parseTask,
  parseTaskFromNotification,
  notifyTaskAssigned,
  notifyTaskStateChanged,
} from "./task.js";
export type {
  TaskNotification,
  TaskState,
  NotifyTaskArgs,
} from "./task.js";

// ── Errors ──
export {
  AgentNotifyError,
  NoInboxError,
  NotificationSendError,
  InboxScopeError,
} from "./errors.js";

// ── The egress chokepoint + its guard-layer errors (for advanced callers/tests) ──
export {
  guardedFetch,
  GuardedFetchError,
  SsrfError,
  BodyTooLargeError,
} from "./security/guardedFetch.js";
export type {
  GuardedFetchOptions,
  GuardedFetchResult,
} from "./security/guardedFetch.js";
export {
  assertNotSsrf,
  isDeniedHostname,
  isLoopbackAddress,
  isPublicAddress,
  normalizeHostForClassification,
} from "./security/ssrf.js";
export type { LookupAddress } from "./security/ssrf.js";
