// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import static org.junit.Assert.*;
import static org.jeswr.suite.SecureStoreTestSupport.*;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import org.junit.Before;
import org.junit.Test;

public class SecureStoreOperationsTest {
    private static final class Tasks implements Executor {
        final Queue<Runnable> tasks = new ArrayDeque<>();
        @Override public void execute(Runnable task) { tasks.add(task); }
        void run() { while (!tasks.isEmpty()) tasks.remove().run(); }
    }
    private static final class Prompt implements SecureStoreOperations.Prompt {
        SecureStoreOperations.Callback callback;
        int starts, cancels;
        @Override public void start(Object object, SecureStoreOperations.Callback callback) { starts++; this.callback = callback; }
        @Override public void cancel() { cancels++; }
    }
    private static final class Result implements SecureStoreOperations.Result {
        final List<String> events = new ArrayList<>();
        @Override public void success(SecureStore.Value value) { events.add(value.value + ":" + value.version); }
        @Override public void failure(String code) { events.add(code); }
    }
    private Tasks serial, main;
    private List<Prompt> prompts;
    private SecureStoreOperations operations;
    private SecureStore store;
    private Crypto crypto;

    @Before public void setup() throws Exception {
        serial = new Tasks(); main = new Tasks(); prompts = new ArrayList<>(); crypto = new Crypto();
        store = new SecureStore(NS, new Memory(), crypto); store.set("a", "secret", true, 0);
        operations = new SecureStoreOperations(serial, main, () -> { Prompt prompt = new Prompt(); prompts.add(prompt); return prompt; });
    }
    private Result begin() throws Exception {
        Result result = new Result(); operations.begin(store, store.beginGet("a"), result); return result;
    }

    @Test public void backgroundRejectsWithoutSchedulingAPrompt() throws Exception {
        Result result = begin(); main.run(); serial.run();
        assertEquals(List.of("background"), result.events); assertTrue(prompts.isEmpty()); assertEquals(0, crypto.opens);
    }

    @Test public void successRunsOnlyAfterSerialCallbackAndDropsDuplicates() throws Exception {
        operations.foreground(true); Result result = begin();
        assertEquals(0, prompts.get(0).starts); main.run();
        Prompt prompt = prompts.get(0); prompt.callback.success("authorized"); prompt.callback.success("duplicate"); prompt.callback.failure("failed");
        assertTrue(result.events.isEmpty()); assertEquals(0, crypto.opens);
        serial.run(); main.run();
        assertEquals(List.of("secret:1"), result.events); assertEquals(1, crypto.opens); assertEquals(1, prompt.cancels);
    }

    @Test public void everyCancellationSourceDropsLateSuccessAndFailure() throws Exception {
        for (String cause : new String[]{"pause", "stop", "teardown", "navigation", "cancel", "remove", "clear"}) {
            setup(); operations.foreground(true); Result result = begin(); main.run(); Prompt prompt = prompts.get(0);
            switch (cause) {
                case "navigation": operations.navigation(); break;
                case "cancel": operations.cancel(); break;
                case "remove": operations.remove("a"); store.remove("a"); break;
                case "clear": operations.clear(); store.clear(); break;
                default: operations.foreground(false);
            }
            operations.foreground(true);
            prompt.callback.success("late"); prompt.callback.failure("lockout"); serial.run(); main.run();
            assertEquals(cause, List.of("cancelled"), result.events); assertEquals(0, crypto.opens); assertEquals(1, prompt.cancels);
        }
    }

    @Test public void cancellationBeforeMainThreadStartNeverDisplaysAPrompt() throws Exception {
        operations.foreground(true); Result result = begin(); operations.navigation(); main.run();
        assertEquals(0, prompts.get(0).starts); assertEquals(1, prompts.get(0).cancels);
        assertEquals(List.of("cancelled"), result.events);
    }

    @Test public void removingAnotherKeyDoesNotCancelThisRead() throws Exception {
        operations.foreground(true); Result result = begin(); main.run(); operations.remove("b"); store.remove("b");
        prompts.get(0).callback.success("authorized"); serial.run(); main.run();
        assertEquals(List.of("secret:1"), result.events);
    }

    @Test public void oldOperationIdCannotFinishANewPrompt() throws Exception {
        operations.foreground(true); Result old = begin(); main.run(); Prompt first = prompts.get(0);
        Result current = begin(); main.run(); Prompt second = prompts.get(1);
        first.callback.success("late"); first.callback.failure("failed"); serial.run();
        assertEquals(List.of("cancelled"), old.events); assertTrue(current.events.isEmpty()); assertEquals(0, crypto.opens);
        second.callback.success("authorized"); serial.run(); main.run();
        assertEquals(List.of("secret:1"), current.events); assertEquals(1, crypto.opens);
    }

    @Test public void queuedSuccessLosesToCancellationBeforeSerialWork() throws Exception {
        operations.foreground(true); Result result = begin(); main.run(); prompts.get(0).callback.success("queued");
        operations.cancel(); serial.run(); main.run();
        assertEquals(List.of("cancelled"), result.events); assertEquals(0, crypto.opens);
    }

    @Test public void cancellationDuringDecryptionCannotReturnPlaintext() throws Exception {
        operations.foreground(true); Result result = begin(); main.run(); crypto.duringOpen = operations::navigation;
        prompts.get(0).callback.success("authorized"); serial.run(); main.run();
        assertEquals(List.of("cancelled"), result.events);
    }

    @Test public void lifecycleAndNavigationCancellationDoNotWaitForDecryptionOnAnotherThread() throws Exception {
        for (String cause : new String[]{"background", "navigation", "cancel", "remove", "clear"}) {
            setup(); operations.foreground(true); Result result = begin(); main.run();
            CountDownLatch decrypting = new CountDownLatch(1), resume = new CountDownLatch(1);
            crypto.duringOpen = () -> {
                decrypting.countDown();
                try { assertTrue(resume.await(2, TimeUnit.SECONDS)); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AssertionError(e); }
            };
            prompts.get(0).callback.success("authorized");
            FutureTask<Void> completion = new FutureTask<>(() -> { serial.run(); return null; });
            new Thread(completion).start();
            try {
                assertTrue(decrypting.await(2, TimeUnit.SECONDS));
                switch (cause) {
                    case "background": operations.foreground(false); break;
                    case "navigation": operations.navigation(); break;
                    case "remove": operations.remove("a"); break;
                    case "clear": operations.clear(); break;
                    default: operations.cancel();
                }
                assertEquals(cause, List.of("cancelled"), result.events);
            } finally { resume.countDown(); }
            completion.get(2, TimeUnit.SECONDS); main.run();
            assertEquals(cause, List.of("cancelled"), result.events);
            assertEquals(1, crypto.opens); assertEquals(1, prompts.get(0).cancels);
            crypto.duringOpen = null;
            assertEquals("secret", get(store, "a").value);
        }
    }

    @Test public void ungatedDeliveryRechecksCancellationAndPreservesUnrelatedKeys() throws Exception {
        operations.foreground(true); store.set("a", "ungated", false, 1);
        SecureStoreOperations.Ticket ticket = operations.ticket("a");
        SecureStore.Value value = store.finishGet(store.beginGet("a"), null);
        operations.navigation();
        Result cancelled = new Result(); operations.deliver(ticket, value, cancelled);
        assertEquals(List.of("cancelled"), cancelled.events);
        SecureStoreOperations.Ticket current = operations.ticket("a"); operations.remove("b");
        Result result = new Result(); operations.deliver(current, value, result);
        assertEquals(List.of("ungated:2"), result.events);
    }

    @Test public void promptErrorsPreserveRecordsAndPermitAnotherAttempt() throws Exception {
        operations.foreground(true);
        for (String code : new String[]{"cancelled", "lockout", "unavailable", "failed"}) {
            Result result = begin(); main.run(); prompts.get(prompts.size() - 1).callback.failure(code); serial.run(); main.run();
            assertEquals(List.of(code), result.events); assertEquals("secret", get(store, "a").value);
        }
    }

    @Test public void replacementDuringPromptRejectsStaleWithoutDecrypting() throws Exception {
        operations.foreground(true); Result result = begin(); main.run(); store.set("a", "new", true, 1);
        prompts.get(0).callback.success("authorized"); serial.run(); main.run();
        assertEquals(List.of("stale"), result.events); assertEquals(0, crypto.opens);
    }

    @Test public void cancellationAlsoInvalidatesReadsStillWaitingOnTheStorageQueue() throws Exception {
        for (String cause : new String[]{"background", "navigation", "cancel", "remove", "clear"}) {
            setup(); operations.foreground(true);
            SecureStoreOperations.Ticket ticket = operations.ticket("a");
            switch (cause) {
                case "background": operations.foreground(false); operations.foreground(true); break;
                case "navigation": operations.navigation(); break;
                case "cancel": operations.cancel(); break;
                case "remove": operations.remove("a"); break;
                default: operations.clear();
            }
            assertEquals("cancelled", assertThrows(SecureStoreException.class, () -> operations.check(ticket)).code);
            Result result = new Result(); operations.begin(store, store.beginGet("a"), ticket, result); main.run();
            assertEquals(cause, List.of("cancelled"), result.events); assertTrue(prompts.isEmpty());
        }
    }

    @Test public void laterReadsAndOtherKeysSurviveEarlierCancellation() throws Exception {
        operations.foreground(true); SecureStoreOperations.Ticket ticket = operations.ticket("a");
        operations.remove("b");
        Result result = new Result(); operations.begin(store, store.beginGet("a"), ticket, result); main.run();
        prompts.get(0).callback.success("authorized"); serial.run();
        assertEquals(List.of("secret:1"), result.events);
        operations.clear();
        Result later = begin(); main.run(); prompts.get(1).callback.success("authorized"); serial.run();
        assertEquals(List.of("secret:1"), later.events);
    }

    @Test public void aBackgroundRequestCannotStartAPromptAfterResume() throws Exception {
        SecureStoreOperations.Ticket ticket = operations.ticket("a"); operations.foreground(true);
        Result result = new Result(); operations.begin(store, store.beginGet("a"), ticket, result); main.run();
        assertEquals(List.of("background"), result.events); assertTrue(prompts.isEmpty());
    }
}
