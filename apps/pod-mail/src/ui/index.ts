// AUTHORED-BY Claude Opus 4.8
//
// Public barrel for the Pod Mail React view layer (`@jeswr/pod-mail/ui`).
//
// This is the OPTIONAL, React-only surface: a framework-agnostic inbox
// component + its data hook, sitting on top of the React-free data-layer core
// (`@jeswr/pod-mail`). React is a *peer* dependency so a data-layer-only
// consumer never pulls it in. The view never touches RDF/fetch directly — it
// drives the data layer through `useInbox`, and takes the authenticated fetch
// as an injected seam (post-#18 the create-solid-app shell patches the global
// fetch; until then a stub fetch makes it unit-testable today).

export {
  errorMessage,
  formatDate,
  formatSender,
  formatSubject,
  safeHref,
} from "./format.js";
export { Inbox, type InboxProps } from "./Inbox.js";
export {
  type InboxState,
  type MessageView,
  newestFirst,
  type UseInboxOptions,
  useInbox,
} from "./useInbox.js";
