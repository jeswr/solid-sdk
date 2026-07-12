import { jsx as _jsx } from "react/jsx-runtime";
// AUTHORED-BY Claude Fable 5
//
// ErrorBoundary — the suite's shared React error boundary (cross-app parity
// #72/#73: every app wraps its routed content ONCE instead of hand-rolling a
// per-app copy). A render/lifecycle error anywhere in the subtree is caught and
// replaced with a themed fallback instead of white-screening the whole app.
//
// DESIGN:
//  - `resetKey` (pass the route/pathname): when it CHANGES (`Object.is`) while
//    an error is showing, the boundary clears the error and re-renders the
//    children — so navigating away recovers without a full reload.
//  - `onError(error, info)` is the TELEMETRY seam: it receives the raw error +
//    React's `componentStack`. The DEFAULT fallback never renders any of that —
//    the UI shows only <ErrorState>'s friendly copy (no internals/stack leak,
//    production or otherwise). A CUSTOM fallback author owns what they render.
//  - `fallback` may be a ReactNode, or a render function receiving
//    `{ error, reset }` for custom recovery UI. Default: <ErrorState onRetry={reset}>.
//
// A class component by necessity: `getDerivedStateFromError`/`componentDidCatch`
// have no hook equivalent (this is React's documented pattern).
import { Component } from "react";
import { ErrorState } from "./error-state.js";
/** Normalise any thrown value to an Error (React lets non-Errors propagate). */
function toError(thrown) {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
}
/**
 * Catches render/lifecycle errors in its subtree and shows a themed fallback
 * (default `<ErrorState>`). Recovers on `resetKey` change or `reset()`.
 */
export class ErrorBoundary extends Component {
    state = { error: null };
    static getDerivedStateFromError(thrown) {
        return { error: toError(thrown) };
    }
    componentDidCatch(thrown, info) {
        try {
            this.props.onError?.(toError(thrown), info);
        }
        catch {
            // Deliberate: a throwing telemetry hook must not cascade a SECOND error
            // out of the boundary that exists to contain the first.
        }
    }
    componentDidUpdate(prevProps) {
        // Only a CHANGE while errored resets — an unchanged resetKey re-render
        // (e.g. a parent state update) keeps showing the fallback.
        if (this.state.error !== null && !Object.is(prevProps.resetKey, this.props.resetKey)) {
            this.reset();
        }
    }
    /** Clear the caught error and re-render the children. */
    reset = () => {
        this.setState({ error: null });
    };
    render() {
        const { error } = this.state;
        if (error !== null) {
            const { fallback } = this.props;
            if (typeof fallback === "function")
                return fallback({ error, reset: this.reset });
            if (fallback !== undefined)
                return fallback;
            return _jsx(ErrorState, { onRetry: this.reset });
        }
        return this.props.children;
    }
}
