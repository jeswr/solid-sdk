export interface ErrorStateProps {
    /** Panel heading. Default: "Something went wrong". */
    title?: string | undefined;
    /**
     * Friendly, human-readable line under the title. Default: a generic retry
     * suggestion. Never pass raw error internals/stack text here.
     */
    message?: string | undefined;
    /** When provided, renders a Retry button wired to it (e.g. refetch / reset). */
    onRetry?: (() => void) | undefined;
    /** Retry button label. Default: "Try again". */
    retryLabel?: string | undefined;
    /** Extra classes for placement/sizing; appended LAST so the caller wins. */
    className?: string | undefined;
}
/** Themed error panel (icon + title + message + optional Retry), `role="alert"`. */
export declare function ErrorState({ title, message, onRetry, retryLabel, className, }: ErrorStateProps): import("react").JSX.Element;
