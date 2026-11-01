// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class PushDeliveryTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test public void detectsEveryNotificationPrefixRegardlessOfValue() {
        for (String key : new String[] {"gcm.n.e", "gcm.n.title", "gcm.n.body", "gcm.n.unknown", "gcm.notification.e", "gcm.notification.body"}) {
            for (Object value : new Object[] {null, "", "0", "1", false}) {
                Map<String, Object> extras = new LinkedHashMap<>(); extras.put(key, value);
                assertTrue(key, PushTransport.notificationBearing(extras));
            }
        }
        assertFalse(PushTransport.notificationBearing((Map<String, Object>) null));
        assertFalse(PushTransport.notificationBearing(java.util.Collections.emptyMap()));
        assertFalse(PushTransport.notificationBearing(java.util.Collections.singletonMap("p", "encrypted")));
    }
    @Test public void backgroundNotificationNeverReachesFirebaseEvenWithoutValidEncryptedData() {
        for (String encrypted : new String[] {null, "corrupt", "encrypted"}) {
            for (String prefix : new String[] {"gcm.n.", "gcm.notification."}) {
                Map<String, Object> extras = new LinkedHashMap<>();
                extras.put(prefix + "e", "1"); extras.put(prefix + "body", "Unvalidated provider text");
                if (encrypted != null) extras.put("p", encrypted);
                PushTransport.dispatch(extras.keySet(), () -> fail("Firebase would auto-display in the background"));
            }
        }
        int[] callbacks = {0};
        PushTransport.dispatch(java.util.Collections.singletonMap("p", "encrypted").keySet(), () -> callbacks[0]++);
        assertEquals(1, callbacks[0]); // Data-only delivery still reaches onMessageReceived through Firebase.
    }
    @Test public void disableSilencesBeforeCancellingStalledPermissionOrTokenAndIgnoresLateCallbacks() throws Exception {
        for (boolean waitingForToken : new boolean[] {false, true}) {
            java.io.File root = temporary.newFolder(); PushStore store = new PushStore(root); store.setTopics("b", PushStateTest.topics());
            PushEnablement<Object> enablement = new PushEnablement<>(); Object old = new Object(), next = new Object();
            assertTrue(enablement.begin(old)); assertFalse(enablement.begin(next));
            int[] tokenRequests = {0}, keyCreations = {0};
            if (waitingForToken) enablement.withCurrent(old, () -> tokenRequests[0]++);
            assertSame(old, enablement.disable(() -> {
                store.silenceAll();
                assertFalse(store.withAnyActive(() -> fail("Still audible during disable")));
                assertTrue(enablement.withCurrent(old, () -> {})); // Silence preceded invalidation.
            }));
            assertFalse(enablement.withCurrent(old, () -> tokenRequests[0]++));
            assertFalse(enablement.finish(old, () -> keyCreations[0]++));
            assertTrue(enablement.begin(next));
            assertFalse(enablement.finish(old, () -> keyCreations[0]++));
            assertTrue(enablement.finish(next, () -> keyCreations[0]++));
            assertEquals(waitingForToken ? 1 : 0, tokenRequests[0]); assertEquals(1, keyCreations[0]);
            assertNull(new PushStore(root).accept(PushStateTest.payload("late", "b", 1)));
        }
    }
    @Test public void timeoutInvalidatesTokenAndCannotCancelAnotherEnable() {
        PushEnablement<Object> enablement = new PushEnablement<>(); Object expired = new Object(), next = new Object();
        assertTrue(enablement.begin(expired));
        assertTrue(enablement.finish(expired, () -> {})); // Injected 30-second deadline.
        assertTrue(enablement.begin(next));
        assertFalse(enablement.finish(expired, () -> fail("Late token or deadline affected new enable")));
        assertTrue(enablement.finish(next, () -> {}));
    }
}
