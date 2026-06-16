// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Ambient typing for the @jeswr/pod-mail/ui module the host consumes. Vite
// bundles the library's TS SOURCE directly (see vite.config.ts's alias), but tsc
// must NOT type-check the out-of-root library source (it is type-checked in its
// own package, against its own node_modules). So we declare ONLY the public
// surface the host imports — kept in lock-step with the real `InboxProps` in
// ../src/ui/Inbox.tsx. If that signature changes, update this declaration in the
// same change (the skill/maintenance rule).
declare module "@jeswr/pod-mail/ui" {
  import type { JSX } from "react";

  export interface InboxProps {
    /**
     * The mailbox DOCUMENT URL to read (e.g. `…/mail/folders/inbox.ttl`). Use the
     * data layer's `folderDocument(podRoot, WellKnownFolders.inbox)` to derive it.
     */
    mailboxUrl: string;
    /**
     * The authenticated fetch for pod reads. Omit to use the ambient global fetch
     * (patched by @solid/reactive-authentication in a real session).
     */
    fetch?: typeof fetch;
    /** Optional heading rendered above the inbox. */
    title?: string;
  }

  export function Inbox(props: InboxProps): JSX.Element;
}
