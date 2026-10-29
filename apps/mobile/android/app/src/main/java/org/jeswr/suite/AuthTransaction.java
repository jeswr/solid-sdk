// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

/** The pure state machine behind {@link AuthManagementActivity}; covered by JVM unit tests. */
public final class AuthTransaction {

    public enum Action { NONE, LAUNCH_BROWSER, CANCELLED }

    private enum State { IDLE, STARTED, BROWSER_OPEN, DONE }

    private State state = State.IDLE;
    private String authorizationUrl;

    /** Starts a transaction; false when there is nothing to start (no URL). */
    public boolean begin(String url, boolean browserAlreadyOpen) {
        if (state != State.IDLE || url == null) return false;
        authorizationUrl = url;
        state = browserAlreadyOpen ? State.BROWSER_OPEN : State.STARTED;
        return true;
    }

    /** First resume opens the browser; a resume after that without a callback is a cancel. */
    public Action onResume() {
        switch (state) {
            case STARTED:
                state = State.BROWSER_OPEN;
                return Action.LAUNCH_BROWSER;
            case BROWSER_OPEN:
                state = State.DONE;
                return Action.CANCELLED;
            default:
                return Action.NONE;
        }
    }

    /** Accepts the redirect only while the browser is open and only the exact callback. */
    public boolean complete(String callbackUrl) {
        if (state != State.BROWSER_OPEN || !RedirectPolicy.isAuthCallback(callbackUrl)) return false;
        state = State.DONE;
        return true;
    }

    /** Ends an open transaction; later redirects are dropped. */
    public boolean cancel() {
        if (state != State.STARTED && state != State.BROWSER_OPEN) return false;
        state = State.DONE;
        return true;
    }

    public boolean browserOpen() {
        return state == State.BROWSER_OPEN;
    }

    public String authorizationUrl() {
        return authorizationUrl;
    }
}
