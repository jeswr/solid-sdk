import { Component, type ErrorInfo, type ReactNode } from "react";
/** Arguments passed to a function-form `fallback`. */
export interface ErrorBoundaryFallbackProps {
    /**
     * The caught error (normalised: a thrown non-Error is wrapped). For the
     * fallback author's own categorisation/recovery — render raw internals at
     * your own risk; the default fallback never does.
     */
    error: Error;
    /** Clears the caught error and re-renders the children. */
    reset: () => void;
}
export interface ErrorBoundaryProps {
    /** The subtree to guard. */
    children?: ReactNode;
    /**
     * Reset trigger. When this value changes (`Object.is`) while an error is
     * showing, the boundary recovers — pass the current route/pathname so
     * navigation clears a caught error.
     */
    resetKey?: unknown;
    /**
     * Telemetry hook — receives the raw error and React error info
     * (`componentStack`). This is the ONLY place error internals go; the default
     * fallback UI never shows them.
     */
    onError?: ((error: Error, info: ErrorInfo) => void) | undefined;
    /**
     * Custom fallback: a node, or a render function receiving `{ error, reset }`.
     * Omitted → the default `<ErrorState onRetry={reset} />`.
     */
    fallback?: ReactNode | ((props: ErrorBoundaryFallbackProps) => ReactNode) | undefined;
}
/**
 * The boundary's state shape. Exported only because it appears in the public
 * class type (`Component<Props, State>`) — not an extension surface.
 */
export interface ErrorBoundaryState {
    error: Error | null;
}
/**
 * Catches render/lifecycle errors in its subtree and shows a themed fallback
 * (default `<ErrorState>`). Recovers on `resetKey` change or `reset()`.
 */
export declare class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState;
    static getDerivedStateFromError(thrown: unknown): ErrorBoundaryState;
    componentDidCatch(thrown: Error, info: ErrorInfo): void;
    componentDidUpdate(prevProps: ErrorBoundaryProps): void;
    /** Clear the caught error and re-render the children. */
    reset: () => void;
    render(): ReactNode;
}
