// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Ambient typing for the pod-money modules the host consumes. Vite bundles the
// library's TS SOURCE directly (see vite.config.ts's alias), but tsc must NOT
// type-check the out-of-root library source (it is type-checked in its own
// package, against its own node_modules). So we declare ONLY the public surface
// the host imports — kept in lock-step with the real signatures in
// ../src/ui/AccountsView.tsx and ../src/store.ts. If those change, update this
// declaration in the same change (the skill/maintenance rule).

declare module "@jeswr/pod-money/ui" {
  import type { JSX } from "react";

  export interface AccountsViewProps {
    /**
     * The finance ledger resource URL to read, e.g.
     * `https://alice.pod.example/finance/ledger.ttl`.
     */
    ledgerUrl: string;
    /**
     * The authenticated fetch for pod reads. Omit to use the ambient global
     * fetch (patched by @solid/reactive-authentication in a real session).
     */
    fetch?: typeof fetch;
    /** Optional heading rendered above the view. */
    title?: string;
  }

  export function AccountsView(props: AccountsViewProps): JSX.Element;
}

declare module "@jeswr/pod-money" {
  /** A location registered for a class IRI in a Solid Type Index. */
  export interface RegistrationLocation {
    /** A single resource holding instances of the class. */
    instance?: string;
    /** A container listing instances of the class. */
    container?: string;
  }

  export interface MoneyStoreOptions {
    /** The pod root URL (must end in `/`). */
    podRoot: string;
    /** The HTTP `fetch` used for PUTs. Defaults to `globalThis.fetch`. */
    fetch?: typeof fetch;
  }

  /** The pod-shaped data access object for Pod Money. One instance per pod root. */
  export class MoneyStore {
    constructor(options: MoneyStoreOptions);
    readonly podRoot: string;
    /** The finance container URL (`<podRoot>finance/`). */
    get financeContainer(): string;
    /** The ledger resource URL (`<podRoot>finance/ledger.ttl`). */
    get ledgerUrl(): string;
    /**
     * Discover where a class is stored in this pod via the public type index.
     * Returns the registered locations (empty if the index or class is absent).
     */
    discover(classIri: string): Promise<RegistrationLocation[]>;
    /** The IRI of Pod Money's primary class (fin:Transaction). */
    static get primaryClass(): string;
  }
}
