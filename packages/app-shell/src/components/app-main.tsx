// AUTHORED-BY Claude Sonnet 5.5
import type { ReactNode } from "react";

export interface AppMainProps<T> {
  /** The resolved value the view needs; while null/undefined the `loading` content is shown. */
  value: T | null | undefined;
  /** Loading indicator content (for example a spinner element) shown while `value` is missing. */
  loading: ReactNode;
  /** Optional note rendered before `<main>` (for example a Type Index fallback `<p className="app-note">`). */
  notice?: ReactNode;
  /** Renders the view once `value` is available. */
  children: (value: T) => ReactNode;
}

/**
 * The suite's `<main className="app-main">` with a discovery wait: `.app-loading` wrapping
 * the host's `loading` content until `value` resolves, then the view built from it.
 */
export function AppMain<T>({ value, loading, notice, children }: AppMainProps<T>) {
  return (
    <>
      {notice}
      <main className="app-main">
        {value ? children(value) : <p className="app-loading">{loading}</p>}
      </main>
    </>
  );
}
