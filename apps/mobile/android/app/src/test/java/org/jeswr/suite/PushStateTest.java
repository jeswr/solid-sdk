// AUTHORED-BY Codex GPT-6.1-Sol
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
        assertEquals(PushReceiver.Kind.GENERIC, PushReceiver.deleted().kind);
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
}
