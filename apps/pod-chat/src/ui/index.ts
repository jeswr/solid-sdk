// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public barrel for the Pod Chat React view layer (`@jeswr/pod-chat/ui`).
//
// This is the OPTIONAL, React-only surface: a framework-agnostic chat
// rooms + messages component + its data hook, sitting on top of the React-free
// data-layer core (`@jeswr/pod-chat`). React is a *peer* dependency so a
// data-layer-only consumer never pulls it in. The view never touches RDF/fetch
// directly — it drives the data layer through `useChat`, and takes the
// authenticated fetch as an injected seam (post-#18 the create-solid-app shell
// patches the global fetch; until then a stub fetch makes it unit-testable
// today).

export { ChatRooms, type ChatRoomsProps } from "./ChatRooms.js";
export {
  errorMessage,
  formatAuthor,
  formatBody,
  formatDate,
  formatRoomName,
  safeHref,
} from "./format.js";
export { listRoomsOrAccessError, RoomsAccessError } from "./rooms.js";
export {
  type ChatState,
  chronological,
  describeError,
  type MessageView,
  type RoomView,
  type SendStatus,
  type UseChatOptions,
  useChat,
} from "./useChat.js";
