// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executor;

/** A prompt has one id from scheduling through decryption; cancellation makes every callback inert. */
final class SecureStoreOperations {
    interface Authenticator { Prompt create(); }
    interface Prompt {
        void start(Object cryptoObject, Callback callback);
        void cancel();
    }
    interface Callback {
        void success(Object authorization);
        void failure(String code);
    }
    interface Result {
        void success(SecureStore.Value value);
        void failure(String code);
    }
    static final class Ticket {
        final String key;
        final long id, generation, keyGeneration;
        final boolean foreground;
        Ticket(String key, long id, long generation, long keyGeneration, boolean foreground) {
            this.key = key; this.id = id; this.generation = generation; this.keyGeneration = keyGeneration;
            this.foreground = foreground;
        }
    }
    private static final class Operation {
        final long id;
        final SecureStore store;
        final SecureStore.Read read;
        final Prompt prompt;
        final Result result;
        boolean completing;
        Operation(long id, SecureStore store, SecureStore.Read read, Prompt prompt, Result result) {
            this.id = id; this.store = store; this.read = read; this.prompt = prompt; this.result = result;
        }
    }
    private final Executor serial, main;
    private final Authenticator authenticator;
    private boolean foreground;
    private long nextId;
    private long generation;
    private final Map<String, Long> keyGenerations = new HashMap<>();
    private Operation pending;

    SecureStoreOperations(Executor serial, Executor main, Authenticator authenticator) {
        this.serial = serial; this.main = main; this.authenticator = authenticator;
    }

    synchronized void foreground(boolean active) { foreground = active; if (!active) cancel(); }
    synchronized boolean foreground() { return foreground; }
    synchronized void navigation() { cancel(); }
    synchronized void remove(String key) {
        keyGenerations.put(key, keyGenerations.getOrDefault(key, 0L) + 1);
        if (pending != null && pending.read.key.equals(key)) cancelPending();
    }
    synchronized void clear() { cancel(); }

    synchronized void cancel() {
        generation++;
        cancelPending();
    }

    private void cancelPending() {
        Operation operation = pending;
        if (operation == null) return;
        pending = null;
        main.execute(operation.prompt::cancel);
        operation.result.failure("cancelled");
    }

    synchronized void begin(SecureStore store, SecureStore.Read read, Result result) {
        begin(store, read, ticket(read.key), result);
    }

    synchronized Ticket ticket(String key) {
        return new Ticket(key, ++nextId, generation, keyGenerations.getOrDefault(key, 0L), foreground);
    }

    synchronized void check(Ticket ticket) throws SecureStoreException {
        if (ticket.generation != generation || ticket.keyGeneration != keyGenerations.getOrDefault(ticket.key, 0L)) {
            throw new SecureStoreException("cancelled");
        }
    }

    synchronized void deliver(Ticket ticket, SecureStore.Value value, Result result) {
        // Ungated reads need the same indivisible generation check and bridge delivery as prompted reads.
        try { check(ticket); }
        catch (SecureStoreException e) { result.failure(e.code); return; }
        result.success(value);
    }

    synchronized void begin(SecureStore store, SecureStore.Read read, Ticket ticket, Result result) {
        try {
            check(ticket);
            if (!ticket.key.equals(read.key)) throw new SecureStoreException("cancelled");
        } catch (SecureStoreException e) { result.failure(e.code); return; }
        if (!ticket.foreground || !foreground) { result.failure("background"); return; }
        cancelPending();
        Operation operation = new Operation(ticket.id, store, read, authenticator.create(), result);
        pending = operation;
        main.execute(() -> start(operation));
    }

    private void start(Operation operation) {
        if (!live(operation.id)) return;
        if (!foreground()) { cancel(); return; }
        try {
            operation.prompt.start(operation.read.cryptoObject, new Callback() {
                @Override public void success(Object authorization) { serial.execute(() -> complete(operation, authorization, null)); }
                @Override public void failure(String code) { serial.execute(() -> complete(operation, null, code)); }
            });
        } catch (RuntimeException e) { serial.execute(() -> complete(operation, null, "failed")); }
    }

    private synchronized boolean live(long id) { return pending != null && pending.id == id; }
    private synchronized boolean completing(Operation operation) {
        if (!live(operation.id) || operation.completing) return false;
        operation.completing = true;
        return true;
    }

    private void complete(Operation operation, Object authorization, String code) {
        if (!completing(operation)) return;
        SecureStore.Value value = null;
        if (code == null) {
            try { value = operation.store.finishGet(operation.read, authorization); }
            catch (Exception e) { code = SecureStoreException.code(e); }
        }
        synchronized (this) {
            if (!live(operation.id)) return;
            pending = null;
            main.execute(operation.prompt::cancel);
            if (code == null) operation.result.success(value);
            else operation.result.failure(code);
        }
    }
}
