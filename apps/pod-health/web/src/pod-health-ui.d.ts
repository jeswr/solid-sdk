// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Ambient typing for the `pod-health/ui` module the host consumes. Vite bundles
// the library's TS SOURCE directly (see vite.config.ts's alias), but tsc must NOT
// type-check the out-of-root library source (it is type-checked in its own
// package, against its own node_modules). So we declare ONLY the public surface
// the host imports — kept in lock-step with the real `HealthRecordsProps` in
// ../src/ui/HealthRecords.tsx. If that signature changes, update this declaration
// in the same change (the skill/maintenance rule).
declare module "pod-health/ui" {
  import type { JSX } from "react";

  export interface HealthRecordsProps {
    /** The health resource URL to read (a single LDP resource, e.g.
     *  `https://carol.example/health/record.ttl`). */
    resourceUrl: string;
    /**
     * The authenticated fetch for pod reads. Omit to use the ambient global
     * fetch (patched by @solid/reactive-authentication in a real session).
     */
    fetch?: typeof fetch;
    /** Optional heading rendered above the list. */
    title?: string;
  }

  export function HealthRecords(props: HealthRecordsProps): JSX.Element;
}
