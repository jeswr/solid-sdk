// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Ambient typing for the @jeswr/pod-chat/ui module the host consumes. Vite
// bundles the library's TS SOURCE directly (see vite.config.ts's alias), but tsc
// must NOT type-check the out-of-root library source (it is type-checked in its
// own package, against its own node_modules). So we declare ONLY the public
// surface the host imports — kept in lock-step with the real `ChatRoomsProps` in
// ../src/ui/ChatRooms.tsx. If that signature changes, update this declaration in
// the same change (the skill/maintenance rule).
declare module "@jeswr/pod-chat/ui" {
  import type { JSX } from "react";

  export interface ChatRoomsProps {
    /**
     * The pod root the chat data lives under (e.g. `https://alice.pod/`). The
     * data layer derives the `pod-chat/rooms/` + `pod-chat/messages/` containers
     * from it.
     */
    podRoot: string;
    /** The WebID of the active user — used by the data layer's type-index reads. */
    webId: string;
    /**
     * The authenticated fetch for pod reads. Omit to use the ambient global
     * fetch (patched by @solid/reactive-authentication in a real session).
     */
    fetch?: typeof fetch;
    /** Optional heading rendered above the view. */
    title?: string;
  }

  export function ChatRooms(props: ChatRoomsProps): JSX.Element;
}
