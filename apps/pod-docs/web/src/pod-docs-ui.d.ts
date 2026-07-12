// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Ambient typing for the @jeswr/pod-docs/ui module the host consumes. Vite
// bundles the library's TS SOURCE directly (see vite.config.ts's alias), but tsc
// must NOT type-check the out-of-root library source (it is type-checked in its
// own package, against its own node_modules). So we declare ONLY the public
// surface the host imports — kept in lock-step with the real
// `DocumentBrowserProps` in ../src/ui/DocumentBrowser.tsx. If that signature
// changes, update this declaration in the same change (the skill/maintenance
// rule).
declare module "@jeswr/pod-docs/ui" {
  import type { JSX } from "react";

  export interface DocumentBrowserProps {
    /** The pod root URL whose documents container is browsed. */
    podRoot: string;
    /** The pod owner's WebID — needed for type-index container discovery. */
    webId: string;
    /**
     * The authenticated fetch for pod reads. Omit to use the ambient global
     * fetch (patched by @solid/reactive-authentication in a real session).
     */
    fetch?: typeof fetch;
    /** Optional heading rendered above the listing. */
    title?: string;
  }

  export function DocumentBrowser(props: DocumentBrowserProps): JSX.Element;
}
