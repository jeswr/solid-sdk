// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

/** Serializes permission/token callbacks with local-first disable. No Android dependencies. */
final class PushEnablement<T> {
    interface Silencer { void silence() throws Exception; }
    private T pending;
    synchronized boolean begin(T call) {
        if (pending != null) return false;
        pending = call; return true;
    }
    synchronized boolean withCurrent(T call, Runnable action) {
        if (call == null || pending != call) return false;
        action.run(); return true;
    }
    synchronized boolean finish(T call, Runnable action) {
        if (call == null || pending != call) return false;
        pending = null; action.run(); return true;
    }
    synchronized T disable(Silencer silencer) throws Exception {
        silencer.silence(); // Must persist before invalidating permission/token work.
        T cancelled = pending; pending = null; return cancelled;
    }
}
