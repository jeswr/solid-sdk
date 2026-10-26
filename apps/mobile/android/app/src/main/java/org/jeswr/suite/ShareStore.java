// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Pending share batches on disk (DESIGN D7): cache/share/<uuid>/{batch.properties, item-N}.
 * Pure java.io so plain JVM tests cover the caps, sanitising and eviction.
 */
public final class ShareStore {

    public static final long MAX_ITEM_BYTES = 100L * 1024 * 1024;
    public static final long MAX_BATCH_BYTES = 200L * 1024 * 1024;
    public static final long MAX_PENDING_BYTES = 500L * 1024 * 1024;
    public static final int MAX_ITEMS = 20;
    public static final int MAX_PENDING_BATCHES = 10;
    public static final int MAX_TEXT_CHARS = 100_000;
    public static final int MAX_CHUNK_BYTES = 512 * 1024;
    public static final long MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000;
    static final long MAX_PARTIAL_AGE_MS = 60L * 60 * 1000;

    private static final Pattern BATCH_ID = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private static final Pattern MIME = Pattern.compile("^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$");
    private static final String MANIFEST = "batch.properties";

    /** Opens an item's bytes; called only when the item is copied, so a rejected batch opens nothing more. */
    public interface Source {
        InputStream open() throws IOException;
    }

    /** One incoming item before it is stored. */
    public static final class Incoming {
        final String kind;
        final String name;
        final String mimeType;
        final String text;
        final String url;
        final String title;
        final Source source;

        private Incoming(String kind, String name, String mimeType, String text, String url, String title, Source source) {
            this.kind = kind;
            this.name = name;
            this.mimeType = mimeType;
            this.text = text;
            this.url = url;
            this.title = title;
            this.source = source;
        }

        public static Incoming file(String name, String mimeType, Source source) {
            return new Incoming("file", name, mimeType, null, null, null, source);
        }

        public static Incoming text(String text) {
            return new Incoming("text", null, null, text, null, null, null);
        }

        public static Incoming url(String url, String title) {
            return new Incoming("url", null, null, null, url, title, null);
        }
    }

    /** A stored batch, as the plugin reports it to JavaScript. */
    public static final class Batch {
        public final String id;
        public final long receivedAt;
        public final Properties manifest;

        Batch(String id, long receivedAt, Properties manifest) {
            this.id = id;
            this.receivedAt = receivedAt;
            this.manifest = manifest;
        }

        public int size() {
            return Integer.parseInt(manifest.getProperty("count", "0"));
        }

        public String get(int index, String key) {
            return manifest.getProperty(index + "." + key);
        }
    }

    /** Thrown when an incoming share breaks a cap or is malformed; nothing is kept. */
    public static final class RejectedShare extends Exception {
        public RejectedShare(String message) {
            super(message);
        }
    }

    private final File root;

    public ShareStore(File root) {
        this.root = root;
    }

    /** Reduces an untrusted file name to one safe path segment (mirrors suite-native). */
    public static String sanitiseName(String raw) {
        String cleaned = raw == null ? "" : raw.replaceAll("[\\u0000-\\u001f\\u007f/\\\\]", "_");
        cleaned = cleaned.replaceAll("^[.\\s]+", "").trim();
        if (cleaned.length() > 255) cleaned = cleaned.substring(0, 255);
        return cleaned.isEmpty() ? "shared-file" : cleaned;
    }

    static String sanitiseMime(String raw) {
        String lower = raw == null ? "" : raw.toLowerCase(Locale.ROOT);
        return MIME.matcher(lower).matches() ? lower : "application/octet-stream";
    }

    /** The http(s) URL without surrounding space, or null when it is not one or carries credentials. */
    static String httpUrl(String value) {
        if (value == null) return null;
        try {
            URI uri = new URI(value.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("https") && !scheme.equals("http")) return null;
            if (uri.getHost() == null || uri.getRawUserInfo() != null) return null;
            return uri.toString();
        } catch (URISyntaxException e) {
            return null;
        }
    }

    /** Streams the items into a new batch, enforcing every cap while copying. */
    public synchronized Batch store(List<Incoming> items, long now) throws IOException, RejectedShare {
        if (items.isEmpty()) throw new RejectedShare("no items");
        if (items.size() > MAX_ITEMS) throw new RejectedShare("too many items");
        evict(now);
        String id = UUID.randomUUID().toString();
        File dir = new File(root, id);
        if (!dir.mkdirs()) throw new IOException("cannot create batch directory");
        Properties manifest = new Properties();
        long batchBytes = 0;
        try {
            for (int i = 0; i < items.size(); i++) {
                Incoming item = items.get(i);
                manifest.setProperty(i + ".kind", item.kind);
                switch (item.kind) {
                    case "file":
                        long written = copy(item.source, new File(dir, "item-" + i), Math.min(MAX_ITEM_BYTES, MAX_BATCH_BYTES - batchBytes));
                        batchBytes += written;
                        manifest.setProperty(i + ".name", sanitiseName(item.name));
                        manifest.setProperty(i + ".mimeType", sanitiseMime(item.mimeType));
                        manifest.setProperty(i + ".size", Long.toString(written));
                        break;
                    case "url":
                        String url = httpUrl(item.url);
                        if (url == null) throw new RejectedShare("url must be http(s) without credentials");
                        manifest.setProperty(i + ".url", url);
                        if (item.title != null) manifest.setProperty(i + ".title", item.title.length() > 1000 ? item.title.substring(0, 1000) : item.title);
                        break;
                    default:
                        if (item.text == null || item.text.length() > MAX_TEXT_CHARS) throw new RejectedShare("text too long");
                        manifest.setProperty(i + ".text", item.text);
                        break;
                }
            }
            manifest.setProperty("count", Integer.toString(items.size()));
            manifest.setProperty("receivedAt", Long.toString(now));
            try (OutputStream out = new FileOutputStream(new File(dir, MANIFEST))) {
                manifest.store(out, null);
            }
            evictOverflow(id);
            return new Batch(id, now, manifest);
        } catch (IOException | RejectedShare | RuntimeException e) {
            delete(dir);
            throw e;
        }
    }

    private static long copy(Source from, File target, long limit) throws IOException, RejectedShare {
        if (from == null) throw new RejectedShare("file item without data");
        long total = 0;
        byte[] buffer = new byte[64 * 1024];
        try (InputStream source = from.open(); OutputStream out = new FileOutputStream(target)) {
            if (source == null) throw new RejectedShare("file item without data");
            int read;
            while ((read = source.read(buffer)) != -1) {
                total += read;
                if (total > limit) throw new RejectedShare("share is too large");
                out.write(buffer, 0, read);
            }
        }
        return total;
    }

    /** Valid pending batches, oldest first. Broken batches are deleted. */
    public synchronized List<Batch> pending() {
        List<Batch> batches = new ArrayList<>();
        for (String id : pendingIds()) {
            Batch batch = load(id);
            if (batch != null) batches.add(batch);
        }
        batches.sort(Comparator.comparingLong(b -> b.receivedAt));
        return batches;
    }

    /** Reads up to {@code length} bytes (capped at 512 KiB) of a stored file item. */
    public synchronized byte[] readChunk(String batchId, int index, long offset, int length) throws IOException {
        Batch batch = load(batchId);
        if (batch == null || index < 0 || index >= batch.size() || !"file".equals(batch.get(index, "kind"))) {
            throw new IOException("no such file item");
        }
        if (offset < 0 || length < 0) throw new IOException("bad range");
        File file = new File(new File(root, batchId), "item-" + index);
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            long available = Math.max(0, raf.length() - offset);
            int size = (int) Math.min(Math.min(length, MAX_CHUNK_BYTES), available);
            byte[] bytes = new byte[size];
            raf.seek(offset);
            raf.readFully(bytes);
            return bytes;
        }
    }

    /** True when {@code end} (offset plus bytes read) reaches the end of the stored item. */
    public synchronized boolean isEnd(String batchId, int index, long end) {
        return end >= new File(new File(root, batchId), "item-" + index).length();
    }

    public synchronized void acknowledge(String batchId) {
        if (BATCH_ID.matcher(batchId == null ? "" : batchId).matches()) delete(new File(root, batchId));
    }

    /** Drops batches older than seven days and copies a killed process left without a manifest. */
    public synchronized void evict(long now) {
        for (String id : pendingIds()) {
            File dir = new File(root, id);
            if (!new File(dir, MANIFEST).isFile() && now - dir.lastModified() > MAX_PARTIAL_AGE_MS) delete(dir);
        }
        for (Batch batch : pending()) {
            if (now - batch.receivedAt > MAX_AGE_MS) acknowledge(batch.id);
        }
    }

    /** Deletes the oldest batches (never {@code keep}) until at most 10 batches and 500 MB remain. */
    private void evictOverflow(String keep) {
        List<Batch> batches = pending();
        long total = 0;
        for (Batch batch : batches) total += bytes(batch.id);
        int count = batches.size();
        for (Batch batch : batches) {
            if (count <= MAX_PENDING_BATCHES && total <= MAX_PENDING_BYTES) break;
            if (batch.id.equals(keep)) continue;
            total -= bytes(batch.id);
            count--;
            acknowledge(batch.id);
        }
    }

    private long bytes(String id) {
        long total = 0;
        File[] files = new File(root, id).listFiles();
        if (files != null) {
            for (File f : files) total += f.length();
        }
        return total;
    }

    private List<String> pendingIds() {
        String[] names = root.list();
        if (names == null) return new ArrayList<>();
        List<String> ids = new ArrayList<>();
        for (String name : names) {
            if (BATCH_ID.matcher(name).matches()) ids.add(name);
        }
        return ids;
    }

    private Batch load(String id) {
        if (id == null || !BATCH_ID.matcher(id).matches()) return null;
        File manifestFile = new File(new File(root, id), MANIFEST);
        if (!manifestFile.isFile()) return null;
        Properties manifest = new Properties();
        try (InputStream in = new FileInputStream(manifestFile)) {
            manifest.load(in);
            return new Batch(id, Long.parseLong(manifest.getProperty("receivedAt")), manifest);
        } catch (IOException | RuntimeException e) {
            delete(new File(root, id));
            return null;
        }
    }

    private static void delete(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) delete(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
