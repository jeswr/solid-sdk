// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class PushStateTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    static String json(String id, String kind, String registration, int index) {
        return "{\"v\":1,\"id\":\"" + id + "\",\"kind\":\"" + kind + "\",\"registrationId\":\"" + registration + "\",\"topicIndex\":" + index + ",\"sentAt\":1}";
    }
    static byte[] padded(String json) {
        byte[] data = new byte[512]; Arrays.fill(data, (byte) ' '); byte[] text = json.getBytes(StandardCharsets.UTF_8);
        System.arraycopy(text, 0, data, 0, text.length); return data;
    }
    static PushPolicy.Payload payload(String id, String registration, int index) throws Exception { return PushPolicy.plaintext(padded(json(id, "chat", registration, index))); }
    static List<?> topics() {
        return (List<?>) PushJson.parse("[{\"index\":1,\"kind\":\"chat\",\"label\":\"Book club\",\"route\":\"/chat/book\",\"enabled\":true},{\"index\":2,\"kind\":\"inbox\",\"label\":\"Inbox\",\"route\":\"/notifications\",\"enabled\":true}]");
    }
    @Test public void routeVectors() {
        for (String route : new String[] {"/notifications", "/chat/book", "/chat/abc-_.~01"}) assertTrue(route, PushPolicy.route(route));
        for (String route : new String[] {"", "/", "/chat/", "/chat/a/b", "/notifications/", "/chat/..", "/chat/a..b", "/chat/.",
            "https://evil/chat/a", "//evil/chat/a", "chat:a", "/chat/%2f", "/chat/%2F", "/chat/%252f", "/chat/%5c", "/chat/\\x", "/chat/a?x", "/chat/a#x", "/chat/a\n", "/chat/a\u0000", "/chat/你好", "/chat/../a"}) {
            assertFalse(route, PushPolicy.route(route));
        }
        assertFalse(PushPolicy.route(null)); assertFalse(PushPolicy.route("/chat/" + new String(new char[512]).replace('\0', 'a')));
    }
    @Test public void renewalArgumentsRequireFutureSafeIntegerMilliseconds() {
        long now = 1000000L;
        assertNull(PushPolicy.renewalExpiry(null, now));
        assertEquals(Long.valueOf(now + 1), PushPolicy.renewalExpiry(now + 1, now));
        assertEquals(Long.valueOf(9007199254740991L), PushPolicy.renewalExpiry(9007199254740991L, now));
        for (Object invalid : new Object[] {true, false, "2000000", 2000000.5d, 2000000.0d, Double.NaN,
            Double.POSITIVE_INFINITY, now, now - 1, 9007199254740992L}) {
            assertThrows(Exception.class, () -> PushPolicy.renewalExpiry(invalid, now));
        }
        assertEquals(now + 6 * 86400000L, PushPolicy.renewalTrigger(now + 7 * 86400000L, now));
        assertEquals(now + 1000, PushPolicy.renewalTrigger(now + 2000, now));
    }
    @Test public void renewalNoticeRechecksReplacementExpiryAndLocalSilence() throws Exception {
        File root = temporary.newFolder(); PushStore store = new PushStore(root);
        store.setTopics("a", topics()); store.setTopics("b", topics()); store.setRenewalExpiry(2000L);
        assertEquals(Long.valueOf(2000), new PushStore(root).renewalExpiry());
        assertTrue(new PushStore(root).withRenewalReminder(2000, 1000, () -> {}));
        assertFalse(store.withRenewalReminder(1999, 1000, () -> fail("Replaced notice")));
        assertFalse(store.withRenewalReminder(2000, 2000, () -> fail("Expired notice")));
        store.silence("a"); assertTrue(store.withRenewalReminder(2000, 1000, () -> assertTrue(Thread.holdsLock(store))));
        store.silence("b"); assertFalse(store.withRenewalReminder(2000, 1000, () -> fail("Silenced notice")));
        store.setTopics("b", topics()); store.setRenewalExpiry(null);
        assertNull(store.renewalExpiry());
        assertFalse(store.withRenewalReminder(2000, 1000, () -> fail("Cancelled notice")));
        store.launch("b", 1); store.launchNotifications();
        Map<String, Object> route = new PushStore(root).consumeLaunch();
        assertNull(route.get("registrationId")); assertEquals("/notifications", route.get("route"));
        PushStore reopened = new PushStore(root); assertNull(reopened.consumeLaunch());
        reopened.launchNotifications(); reopened.launch("b", 1); assertEquals("/chat/book", reopened.consumeLaunch().get("route"));
    }
    @Test public void rejectsInvalidPlaintextAndDuplicateKeys() throws Exception {
        String valid = json("id", "chat", "b", 1); assertEquals("id", PushPolicy.plaintext(padded(valid)).id);
        for (String invalid : new String[] {valid.replace("\"v\":1", "\"v\":2"), valid.replace("\"v\":1", "\"v\":true"),
            valid.replace("\"v\":1", "\"v\":1.0"), valid.replace("\"v\":1", "\"v\":1,\"v\":1"), valid.replace("\"chat\"", "\"html\""),
            valid.replace("\"topicIndex\":1", "\"topicIndex\":16"), valid.replace("\"sentAt\":1", "\"sentAt\":-1"),
            valid.replace("\"id\":\"id\"", "\"id\":\"https://evil\""), valid.replace("}", ",\"url\":\"https://evil\"}"), valid + "\n", "[]", "null"}) {
            assertThrows(invalid, Exception.class, () -> PushPolicy.plaintext(padded(invalid)));
        }
        for (int size : new int[] {0, 511, 513, 4097}) assertThrows(Exception.class, () -> PushPolicy.plaintext(new byte[size]));
        byte[] badUTF8 = padded(valid); badUTF8[10] = (byte) 0xff; assertThrows(Exception.class, () -> PushPolicy.plaintext(badUTF8));
    }
    @Test public void persistsDedupeCountsSilenceAndAccountIsolation() throws Exception {
        File root = temporary.newFolder(); PushStore store = new PushStore(root); store.setTopics("a", topics()); store.setTopics("b", topics());
        PushStore.Delivery first = store.accept(payload("id", "b", 1)); assertNotNull(first); assertEquals("New message in Book club", first.body); assertEquals(1, first.count);
        store = new PushStore(root); assertNull(store.accept(payload("id", "b", 1)));
        assertEquals(2, store.accept(payload("next", "b", 1)).count);
        assertNotEquals(first.group, store.accept(payload("another", "a", 1)).group);
        assertNotEquals(PushPolicy.group("b", 1), PushPolicy.group("b", 2)); assertEquals(32, first.group.length()); assertEquals("34340f0e82d75a3446150f4a916c20c1", first.group);
        assertEquals("New item in your inbox", store.accept(PushPolicy.plaintext(padded(json("inbox", "inbox", "b", 2)))).body);
        assertNull(store.accept(payload("unknown", "c", 1))); assertNull(store.accept(payload("topic", "b", 0))); assertNull(store.accept(payload("wrong-kind", "b", 2)));
        store.silence("b"); assertNull(new PushStore(root).accept(payload("silenced", "b", 1))); assertNotNull(store.accept(payload("other-account", "a", 1)));
        store.silenceAll(); assertNull(store.accept(payload("all", "a", 1)));
        store.setTopics("a", topics()); assertNotNull(store.accept(payload("reenabled", "a", 1)));
        for (int i = 0; i < 50; i++) store.accept(payload("m" + i, "a", 1));
        assertNotNull(store.accept(payload("reenabled", "a", 1))); // last 50 only
    }
    @Test public void validatesTopicMapsAndConsumesColdAndWarmRoutesOnce() throws Exception {
        File root = temporary.newFolder(); PushStore store = new PushStore(root); store.setTopics("b", topics());
        final PushStore validationStore = store;
        for (String bad : new String[] {"/chat/%2f", "//evil", "/chat/../a", "/notifications?x"}) {
            List<?> invalid = (List<?>) PushJson.parse(PushJson.encode(topics()).replace("/chat/book", bad));
            assertThrows(Exception.class, () -> validationStore.setTopics("b", invalid));
        }
        assertThrows(Exception.class, () -> validationStore.setTopics("b", Arrays.asList(topics().get(0), topics().get(0))));
        assertNull(store.consumeLaunch()); store.launch("b", 1);
        Map<String, Object> cold = new PushStore(root).consumeLaunch(); assertEquals("b", cold.get("registrationId")); assertEquals("/chat/book", cold.get("route"));
        store = new PushStore(root); assertNull(store.consumeLaunch()); store.launch("b", 2); assertEquals("/notifications", store.consumeLaunch().get("route"));
        store.silence("b"); store.launch("b", 1); assertEquals("/notifications", store.consumeLaunch().get("route"));
    }
    @Test public void finalSilenceCheckAndForgettingRegistrations() throws Exception {
        PushStore store = new PushStore(temporary.newFolder());
        for (String id : new String[] {"a", "b", "c", "d"}) store.setTopics(id, topics());
        assertThrows(Exception.class, () -> store.setTopics("e", topics()));
        PushPolicy.Payload pending = payload("pending", "b", 1); assertNotNull(store.accept(pending)); store.silence("b");
        assertFalse(store.withActive(pending, () -> fail("Delivered after silence")));
        store.setTopics("b", java.util.Collections.emptyList()); store.setTopics("e", topics());
        assertNull(store.accept(payload("forgotten", "b", 1)));
        List<?> disabled = (List<?>) PushJson.parse(PushJson.encode(topics()).replace("true", "false"));
        store.setTopics("e", disabled); assertNull(store.accept(payload("disabled", "e", 1)));
    }
    @Test public void lockedAndDeletedPathsDoNotReadKeysOrLabelsAndChallengeNeverNotifies() throws Exception {
        PushReceiver.Decryptor forbidden = value -> { throw new AssertionError("Touched keys before unlock"); };
        PushReceiver.Storage forbiddenStore = () -> { throw new AssertionError("Touched topic state before unlock"); };
        assertEquals(PushReceiver.Kind.GENERIC, PushReceiver.receive("p", false, forbidden, forbiddenStore).kind);
        assertTrue(PushReceiver.deleted(false, forbiddenStore, () -> {}));
        assertEquals(PushReceiver.Kind.DROP, PushReceiver.receive(null, false, forbidden, forbiddenStore).kind);
        assertEquals(PushReceiver.Kind.DROP, PushReceiver.receive(new String(new char[6000]), false, forbidden, forbiddenStore).kind);
        PushStore store = new PushStore(temporary.newFolder());
        String nonce = PushCrypto.b64(new byte[16]);
        byte[] plain = padded(json("challenge", "challenge", "installation", 0).replace("}", ",\"nonce\":\"" + nonce + "\"}"));
        PushReceiver.Result result = PushReceiver.receive("p", true, value -> plain, () -> store);
        assertEquals(PushReceiver.Kind.CHALLENGE, result.kind); assertNull(result.delivery);
        assertEquals(PushReceiver.Kind.DROP, PushReceiver.receive("p", true, value -> plain, () -> store).kind);
        PushActivation activation = new PushActivation(); activation.deliver("installation", nonce, 0);
        assertNull(activation.take("other", 1)); assertEquals(nonce, activation.take("installation", 59999)); assertNull(activation.take("installation", 59999));
        activation.deliver("installation", nonce, 0); assertNull(activation.take("installation", 60000));
        activation.deliver("installation", nonce, 0); activation.clear(); assertNull(activation.take("installation", 1));
    }
    @Test public void launchResolvesTheCurrentMapAtConsumption() throws Exception {
        File root = temporary.newFolder(); PushStore store = new PushStore(root); store.setTopics("b", topics());
        store.launch("b", 1);
        Map<String, Object> saved = PushJson.object(PushJson.parse(new String(PushStore.read(new File(root, "topics.json"), 131072), StandardCharsets.UTF_8)));
        assertEquals(new java.util.HashSet<>(Arrays.asList("registrationId", "topicIndex")), PushJson.object(saved.get("launch")).keySet());
        store.silence("b");
        Map<String, Object> silenced = store.consumeLaunch();
        assertEquals("b", silenced.get("registrationId")); assertEquals("/notifications", silenced.get("route"));
        store.setTopics("b", topics()); store.launch("b", 1); store.silenceAll();
        assertEquals("/notifications", new PushStore(root).consumeLaunch().get("route"));
        store = new PushStore(root); store.setTopics("b", topics()); store.launch("b", 1);
        store.setTopics("b", (List<?>) PushJson.parse(PushJson.encode(topics()).replace("/chat/book", "/chat/new")));
        assertEquals("/chat/new", store.consumeLaunch().get("route"));
        store.launch("b", 1); store.setTopics("b", Arrays.asList(topics().get(1)));
        assertEquals("/notifications", store.consumeLaunch().get("route"));
        store.setTopics("b", topics()); store.launch("b", 1);
        store.setTopics("b", (List<?>) PushJson.parse(PushJson.encode(topics()).replace("true", "false")));
        assertEquals("/notifications", store.consumeLaunch().get("route"));
        store.launch("b", 1); store.setTopics("b", java.util.Collections.emptyList());
        Map<String, Object> forgotten = store.consumeLaunch();
        assertNull(forgotten.get("registrationId")); assertEquals("/notifications", forgotten.get("route")); assertNull(store.consumeLaunch());
        store.launch("unknown", 1); assertNull(store.consumeLaunch().get("registrationId"));
    }
    @Test public void legacySavedRouteNeverOverridesTheCurrentMap() throws Exception {
        File root = temporary.newFolder(); PushStore store = new PushStore(root); store.setTopics("b", topics());
        Map<String, Object> state = PushJson.object(PushJson.parse(new String(PushStore.read(new File(root, "topics.json"), 131072), StandardCharsets.UTF_8)));
        state.put("launch", PushJson.parse("{\"registrationId\":\"b\",\"route\":\"/chat/stale\"}"));
        PushStore.write(new File(root, "topics.json"), PushCrypto.utf8(PushJson.encode(state)));
        Map<String, Object> launch = new PushStore(root).consumeLaunch();
        assertEquals("b", launch.get("registrationId")); assertEquals("/notifications", launch.get("route"));
    }
    @Test public void overflowRespectsSilenceAndDoesNotReadProtectedStateInDirectBoot() throws Exception {
        PushStore store = new PushStore(temporary.newFolder()); int[] notices = {0};
        Runnable post = () -> notices[0]++;
        assertFalse(PushReceiver.deleted(true, () -> store, post));
        store.setTopics("a", topics()); store.setTopics("b", topics()); store.silence("b");
        assertTrue(PushReceiver.deleted(true, () -> store, post)); assertEquals(1, notices[0]);
        assertTrue(PushReceiver.deleted(true, () -> store, () -> assertTrue(Thread.holdsLock(store))));
        store.silenceAll(); assertFalse(PushReceiver.deleted(true, () -> store, post));
        store.clear(); assertFalse(PushReceiver.deleted(true, () -> store, post));
        assertFalse(PushReceiver.deleted(true, () -> { throw new java.io.IOException(); }, post));
        assertEquals(1, notices[0]);
        assertTrue(PushReceiver.deleted(false, () -> { throw new AssertionError("Read protected state"); }, post));
        assertEquals(2, notices[0]);
    }
}
