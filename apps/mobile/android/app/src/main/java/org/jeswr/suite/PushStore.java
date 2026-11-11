// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Credential-protected, no-backup topic state. One app-process instance serializes service/bridge IO. */
final class PushStore {
    private final File root;
    private Map<String, Object> state;
    PushStore(File root) throws IOException {
        this.root = root;
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create push store");
        File file = new File(root, "topics.json");
        try { state = file.exists() ? PushJson.object(PushJson.parse(new String(read(file, 131072), java.nio.charset.StandardCharsets.UTF_8))) : empty(); }
        catch (RuntimeException e) { throw new IOException("Cannot read push state", e); }
    }
    static Map<String, Object> empty() {
        Map<String, Object> state = new LinkedHashMap<>(); state.put("registrations", new LinkedHashMap<String, Object>());
        state.put("seen", new ArrayList<String>()); state.put("counts", new LinkedHashMap<String, Object>()); return state;
    }
    static byte[] read(File file, int limit) throws IOException {
        try (FileInputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int n;
            while ((n = in.read(buffer)) != -1) { if (out.size() + n > limit) throw new IOException("Push file too large"); out.write(buffer, 0, n); }
            return out.toByteArray();
        }
    }
    static void write(File file, byte[] bytes) throws IOException {
        File temp = new File(file.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) { out.write(bytes); out.getFD().sync(); }
        if (!temp.renameTo(file)) throw new IOException("Cannot save push state");
    }
    private void save() throws IOException { write(new File(root, "topics.json"), PushCrypto.utf8(PushJson.encode(state))); }
    private Map<String, Object> registrations() { return PushJson.object(state.get("registrations")); }
    private static String tokenHash(String token) {
        if (token == null || token.isEmpty() || PushCrypto.utf8(token).length > 8192) throw new IllegalArgumentException("Invalid push token");
        return PushCrypto.b64(PushCrypto.sha256(PushCrypto.utf8(token)));
    }
    /** Persist only hashes; no raw provider token is stored here or logged. */
    synchronized void recordToken(String token) throws IOException {
        state.put("tokenHash", tokenHash(token)); save();
    }
    synchronized boolean registrationStale() {
        return withAnyActive(() -> {}) && (state.get("tokenHash") == null || !state.get("tokenHash").equals(state.get("registeredTokenHash")));
    }
    synchronized void setTopics(String registration, List<?> topics) throws IOException {
        setTopics(registration, topics, null);
    }
    /** pushToken acknowledges confirmed relay activation, never merely a successful enable. */
    synchronized void setTopics(String registration, List<?> topics, String pushToken) throws IOException {
        PushPolicy.id(registration);
        if (topics == null || topics.size() > 16) throw new IllegalArgumentException("Topic map capacity");
        String confirmedHash = pushToken == null ? null : tokenHash(pushToken);
        if (confirmedHash != null && !confirmedHash.equals(state.get("tokenHash"))) throw new IllegalArgumentException("Push token changed; refresh registration");
        if (topics.isEmpty()) {
            registrations().remove(registration);
            for (int i = 0; i < 16; i++) PushJson.object(state.get("counts")).remove(PushPolicy.group(registration, i));
            if (confirmedHash != null) state.put("registeredTokenHash", confirmedHash);
            save(); return;
        }
        if (!registrations().containsKey(registration) && registrations().size() >= 4) throw new IllegalArgumentException("Registration capacity");
        Map<String, Object> entries = new LinkedHashMap<>();
        for (Object entry : topics) {
            Map<String, Object> topic = PushJson.object(entry);
            if (!topic.keySet().equals(new java.util.HashSet<>(java.util.Arrays.asList("index", "kind", "label", "route", "enabled")))) throw new IllegalArgumentException("Unknown topic fields");
            int index = PushJson.integer(topic.get("index"), 15);
            String kind = PushJson.string(topic.get("kind")), label = PushJson.string(topic.get("label"));
            if ((!kind.equals("inbox") && !kind.equals("chat")) || label.isEmpty() || label.length() > 160
                || label.codePoints().anyMatch(c -> Character.isISOControl(c)) || !PushPolicy.route(PushJson.string(topic.get("route")))
                || !(topic.get("enabled") instanceof Boolean) || entries.containsKey("" + index)) throw new IllegalArgumentException("Invalid push topic");
            entries.put("" + index, new LinkedHashMap<>(topic));
        }
        Map<String, Object> reg = new LinkedHashMap<>(); reg.put("silenced", false); reg.put("topics", entries);
        if (confirmedHash != null) state.put("registeredTokenHash", confirmedHash);
        registrations().put(registration, reg); save();
    }
    synchronized void silence(String registration) throws IOException {
        PushPolicy.id(registration);
        Object raw = registrations().get(registration);
        if (raw != null) PushJson.object(raw).put("silenced", true);
        save();
    }
    synchronized void silenceAll() throws IOException {
        for (Object reg : registrations().values()) PushJson.object(reg).put("silenced", true);
        save();
    }
    synchronized void setRenewalExpiry(Long expiry) throws IOException {
        if (expiry == null) state.remove("renewalExpiry"); else state.put("renewalExpiry", expiry);
        save();
    }
    synchronized Long renewalExpiry() {
        Object value = state.get("renewalExpiry");
        return value instanceof Long ? (Long) value : null;
    }
    /** Recheck replacement, expiry and local silence under the same lock as notification posting. */
    synchronized boolean withRenewalReminder(long expiry, long now, Runnable action) {
        return expiry > now && Long.valueOf(expiry).equals(state.get("renewalExpiry")) && withAnyActive(action);
    }
    synchronized void clear() throws IOException { state = empty(); save(); }
    static final class Delivery {
        final PushPolicy.Payload payload;
        final String group, body, route;
        final int count;
        Delivery(PushPolicy.Payload p, String body, String route, int count) {
            payload = p; group = PushPolicy.group(p.registrationId, p.topicIndex); this.body = body; this.route = route; this.count = count;
        }
    }
    private Map<String, Object> topic(String registration, int index) {
        Object raw = registrations().get(registration);
        if (raw == null) return null;
        Map<String, Object> reg = PushJson.object(raw);
        if (!Boolean.FALSE.equals(reg.get("silenced"))) return null;
        Object topic = PushJson.object(reg.get("topics")).get("" + index);
        if (topic == null || !Boolean.TRUE.equals(PushJson.object(topic).get("enabled"))) return null;
        return PushJson.object(topic);
    }
    @SuppressWarnings("unchecked")
    synchronized boolean remember(String id) throws IOException {
        List<Object> seen = (List<Object>) state.get("seen");
        if (seen.contains(id)) return false;
        seen.add(id); while (seen.size() > 50) seen.remove(0); save(); return true;
    }
    @SuppressWarnings("unchecked")
    synchronized Delivery accept(PushPolicy.Payload p) throws IOException {
        if (p.kind.equals("challenge")) return null;
        Map<String, Object> topic = topic(p.registrationId, p.topicIndex);
        if (topic == null || !p.kind.equals(topic.get("kind"))) return null;
        List<Object> seen = (List<Object>) state.get("seen");
        if (seen.contains(p.id)) return null;
        seen.add(p.id); while (seen.size() > 50) seen.remove(0);
        String group = PushPolicy.group(p.registrationId, p.topicIndex);
        Map<String, Object> counts = PushJson.object(state.get("counts"));
        int count = counts.containsKey(group) ? Math.min(PushJson.integer(counts.get(group), Integer.MAX_VALUE), 999998) + 1 : 1;
        counts.put(group, (long) count); save();
        return new Delivery(p, PushPolicy.text(p.kind, PushJson.string(topic.get("label"))), PushJson.string(topic.get("route")), count);
    }
    /** Recheck under the same lock as silence, immediately before posting the OS notification. */
    synchronized boolean withActive(PushPolicy.Payload p, Runnable action) {
        Map<String, Object> topic = topic(p.registrationId, p.topicIndex);
        if (topic == null || !p.kind.equals(topic.get("kind"))) return false;
        action.run(); return true;
    }
    synchronized boolean withAnyActive(Runnable action) {
        for (Object raw : registrations().values()) {
            if (Boolean.FALSE.equals(PushJson.object(raw).get("silenced"))) { action.run(); return true; }
        }
        return false;
    }
    /** Tap intents carry only an opaque pair; the route is read afresh, never accepted from an intent. */
    synchronized void launch(String registration, int index) throws IOException {
        PushPolicy.id(registration);
        if (index < 0 || index > 15) return;
        Map<String, Object> launch = new LinkedHashMap<>(); launch.put("registrationId", registration);
        launch.put("topicIndex", (long) index);
        state.put("launch", launch); PushJson.object(state.get("counts")).remove(PushPolicy.group(registration, index)); save();
    }
    synchronized void launchNotifications() throws IOException {
        Map<String, Object> launch = new LinkedHashMap<>(); launch.put("notifications", true);
        state.put("launch", launch); save();
    }
    synchronized Map<String, Object> consumeLaunch() throws IOException {
        Object raw = state.remove("launch");
        Map<String, Object> result = null;
        if (raw != null) {
            Map<String, Object> launch = PushJson.object(raw);
            if (Boolean.TRUE.equals(launch.get("notifications"))) {
                result = new LinkedHashMap<>(); result.put("registrationId", null); result.put("route", "/notifications");
                save(); return result;
            }
            String registration = PushPolicy.id(launch.get("registrationId"));
            // Old saved routes have no index: consume them with the safe fallback only.
            Map<String, Object> topic = launch.containsKey("topicIndex") ? topic(registration, PushJson.integer(launch.get("topicIndex"), 15)) : null;
            Object route = topic == null ? null : topic.get("route");
            result = new LinkedHashMap<>();
            result.put("registrationId", registrations().containsKey(registration) ? registration : null);
            result.put("route", route instanceof String && PushPolicy.route((String) route) ? route : "/notifications");
        }
        save(); return result;
    }
}
