// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Validation and display decisions shared by the bridge, service and notification tap path. */
final class PushPolicy {
    static final String GENERIC = "You have new activity";
    static final String RENEWAL = "Open Solid Suite to keep notifications on";
    /** Bridge numbers are epoch milliseconds, not strings, floats, booleans or unsafe integers. */
    static Long renewalExpiry(Object value, long now) {
        if (value == null) return null;
        if (!(value instanceof Long) || (Long) value <= now || (Long) value > 9007199254740991L)
            throw new IllegalArgumentException("Invalid renewal expiry");
        return (Long) value;
    }
    static long renewalTrigger(long expiry, long now) {
        return Math.max(now + 1000, expiry - 86400000L);
    }
    static boolean route(String value) {
        return value != null && value.length() <= 512 && !value.contains("..") && !value.equals("/chat/.")
            && (value.equals("/notifications") || value.matches("/chat/[A-Za-z0-9_.~-]+"));
    }
    static String id(Object value) {
        String id = PushJson.string(value);
        if (!id.matches("[A-Za-z0-9_-]{1,128}")) throw new IllegalArgumentException("Invalid identifier");
        return id;
    }
    static String group(String registration, int index) {
        byte[] bytes = PushCrypto.sha256(PushCrypto.utf8(registration + ":" + index));
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < 16; i++) out.append(String.format(java.util.Locale.ROOT, "%02x", bytes[i] & 255));
        return out.toString();
    }
    static String text(String kind, String label) {
        return kind.equals("inbox") ? "New item in your inbox" : "New message in " + label;
    }
    static final class Payload {
        final String id, kind, registrationId, nonce;
        final int topicIndex;
        Payload(Map<String, Object> map) {
            boolean challenge = "challenge".equals(map.get("kind"));
            Set<String> keys = new HashSet<>(Arrays.asList("v", "id", "kind", "registrationId", "topicIndex", "sentAt"));
            if (challenge) keys.add("nonce");
            if (!map.keySet().equals(keys) || PushJson.integer(map.get("v"), 1) != 1) throw new IllegalArgumentException("Invalid push version/fields");
            id = PushPolicy.id(map.get("id")); kind = PushJson.string(map.get("kind"));
            if (!Arrays.asList("inbox", "chat", "challenge").contains(kind)) throw new IllegalArgumentException("Unknown push kind");
            registrationId = PushPolicy.id(map.get("registrationId")); topicIndex = PushJson.integer(map.get("topicIndex"), 15);
            Object sentAt = map.get("sentAt");
            if (!(sentAt instanceof Long) || (Long) sentAt < 0) throw new IllegalArgumentException("Invalid sentAt");
            nonce = challenge ? PushJson.string(map.get("nonce")) : null;
            if (challenge && PushCrypto.unb64(nonce).length != 16) throw new IllegalArgumentException("Invalid nonce");
        }
    }
    static Payload plaintext(byte[] bytes) throws Exception {
        if (bytes.length != 512) throw new IllegalArgumentException("Push plaintext must be 512 bytes");
        String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        int end = text.length();
        while (end > 0 && text.charAt(end - 1) == ' ') end--;
        if (end == 0 || text.charAt(end - 1) != '}') throw new IllegalArgumentException("Invalid push padding");
        return new Payload(PushJson.object(PushJson.parse(text.substring(0, end))));
    }
}
