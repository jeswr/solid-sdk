// AUTHORED-BY Codex GPT-6.1-Sol
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
    synchronized void setTopics(String registration, List<?> topics) throws IOException {
        PushPolicy.id(registration);
        if (topics == null || topics.size() > 16) throw new IllegalArgumentException("Topic map capacity");
        if (topics.isEmpty()) {
            registrations().remove(registration);
            for (int i = 0; i < 16; i++) PushJson.object(state.get("counts")).remove(PushPolicy.group(registration, i));
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
        state.remove("launch"); save();
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
    /** Tap intents carry only an opaque pair; the route is read afresh, never accepted from an intent. */
    synchronized void launch(String registration, int index) throws IOException {
        PushPolicy.id(registration);
        if (index < 0 || index > 15) return;
        Map<String, Object> topic = topic(registration, index);
        Map<String, Object> launch = new LinkedHashMap<>(); launch.put("registrationId", registration);
        // Preserve the registration for the shell's signed-out account fallback, never its stale route.
        launch.put("route", topic == null ? "/notifications" : topic.get("route"));
        if (!PushPolicy.route(PushJson.string(launch.get("route")))) return;
        state.put("launch", launch); PushJson.object(state.get("counts")).remove(PushPolicy.group(registration, index)); save();
    }
    synchronized Map<String, Object> consumeLaunch() throws IOException {
        Object launch = state.remove("launch"); save(); return launch == null ? null : PushJson.object(launch);
    }
}
