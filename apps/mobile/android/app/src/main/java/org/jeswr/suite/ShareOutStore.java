// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Bounded outgoing files in cache/share-out/<uuid>/<name>. All operations are serialised. */
public final class ShareOutStore {
    public static final long MAX_BYTES = 100L * 1024 * 1024;
    public static final int MAX_FILES = 20;
    public static final int MAX_CHUNK_BYTES = 512 * 1024;
    public static final long MAX_AGE_MS = 24L * 60 * 60 * 1000;
    private static final Pattern ID = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private static final Pattern MIME = Pattern.compile("^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$");
    private final File root;
    private final Map<String, Upload> uploads = new HashMap<>();

    private static final class Upload {
        final File file;
        final long size;
        long written;
        Upload(File file, long size) { this.file = file; this.size = size; }
    }

    public ShareOutStore(File root) throws IOException {
        this.root = root.getCanonicalFile();
        if (!this.root.isDirectory() && !this.root.mkdirs()) throw new IOException("Cannot create share-out cache");
    }

    public static boolean isId(String id) { return id != null && ID.matcher(id).matches(); }

    /** Capacitor JSON numbers may be Integer, Long or Double. Never coerce other JSON types. */
    static long integer(Object raw) throws IOException {
        if (!(raw instanceof Number)) throw new IOException("Missing integer");
        double value = ((Number) raw).doubleValue();
        if (!Double.isFinite(value) || value < 0 || value > MAX_BYTES || value != Math.floor(value)) {
            throw new IOException("Invalid integer");
        }
        return (long) value;
    }

    /** Bound the bridge string before the Android decoder can allocate an output buffer. */
    static void checkEncodedChunk(String data) throws IOException {
        if (data == null || data.isEmpty() || data.length() > 4 * ((MAX_CHUNK_BYTES + 2) / 3) ||
            data.length() % 4 != 0 || !data.matches("[A-Za-z0-9+/]*={0,2}")) {
            throw new IOException("Invalid base64 chunk");
        }
    }

    /** Sanitise again at the native boundary, also respecting the filesystem's UTF-8 segment cap. */
    static String sanitiseName(String name) {
        String safe = name == null ? "" : name.replaceAll("[\\u0000-\\u001f\\u007f/\\\\]", "_")
            .replaceAll("^[.\\s]+", "").trim();
        while (safe.getBytes(StandardCharsets.UTF_8).length > 255) safe = safe.substring(0, safe.offsetByCodePoints(safe.length(), -1));
        return safe.isEmpty() ? "shared-file" : safe;
    }

    /** Ids of files already staged for the same share: absent, or an array of fewer than 20 ids. */
    static Set<String> keepIds(Object raw) throws IOException {
        Set<String> ids = new HashSet<>();
        if (raw == null) return ids;
        if (!(raw instanceof Object[]) || ((Object[]) raw).length >= MAX_FILES) throw new IOException("Invalid keep list");
        for (Object id : (Object[]) raw) {
            if (!(id instanceof String) || !isId((String) id)) throw new IOException("Invalid keep id");
            ids.add((String) id);
        }
        return ids;
    }

    public String begin(String name, String mimeType, long size, long now) throws IOException {
        return begin(name, mimeType, size, Collections.emptySet(), now);
    }

    /** {@code keep} names files already staged for the same share, so making room never evicts them. */
    public synchronized String begin(String name, String mimeType, long size, Set<String> keep, long now) throws IOException {
        if (name == null || name.length() > 4096 || mimeType == null || mimeType.length() > 255 ||
            !MIME.matcher(mimeType).matches() || size < 0 || size > MAX_BYTES) throw new IOException("Invalid staging metadata");
        evict(now);
        List<File> dirs = directories();
        dirs.sort(Comparator.comparingLong(File::lastModified).thenComparing(File::getName));
        long reserved = 0;
        for (File dir : dirs) reserved += reservedBytes(dir);
        int count = dirs.size();
        // Active uploads reserve their declared size and cannot be evicted by a concurrent begin.
        for (File dir : dirs) {
            if (count < MAX_FILES && reserved <= MAX_BYTES - size) break;
            if (uploads.containsKey(dir.getName()) || keep.contains(dir.getName())) continue;
            reserved -= reservedBytes(dir);
            remove(dir);
            count--;
        }
        if (count >= MAX_FILES || reserved > MAX_BYTES - size) throw new IOException("Share-out cache is busy");
        String id = UUID.randomUUID().toString();
        File dir = new File(root, id);
        if (!dir.mkdir()) throw new IOException("Cannot create staging directory");
        try {
            File file = new File(dir, sanitiseName(name));
            if (!file.createNewFile() || !dir.setLastModified(now)) throw new IOException("Cannot create staging file");
            uploads.put(id, new Upload(file, size));
            return id;
        } catch (IOException | RuntimeException e) { remove(dir); throw e; }
    }

    public synchronized void writeChunk(String id, long offset, byte[] bytes, long now) throws IOException {
        try {
            evict(now);
            Upload upload = upload(id);
            if (bytes == null || bytes.length == 0 || bytes.length > MAX_CHUNK_BYTES || offset != upload.written ||
                bytes.length > upload.size - offset) throw new IOException("Invalid staging chunk");
            try (FileOutputStream out = new FileOutputStream(upload.file, true)) { out.write(bytes); }
            upload.written += bytes.length;
        } catch (IOException | RuntimeException e) { abort(id); throw e; }
    }

    /** A file URI: @capacitor/share 8.0.3 wraps it in its FileProvider and grants read permission. */
    public synchronized File commit(String id, long now) throws IOException {
        try {
            evict(now);
            Upload upload = upload(id);
            if (upload.written != upload.size) throw new IOException("Staged size does not match declaration");
            if (!upload.file.getParentFile().setLastModified(now)) throw new IOException("Cannot retain staged file");
            uploads.remove(id);
            return upload.file;
        } catch (IOException | RuntimeException e) { abort(id); throw e; }
    }

    public synchronized void abort(String id) throws IOException {
        if (!isId(id)) return;
        uploads.remove(id);
        remove(new File(root, id));
    }

    public synchronized void evict(long now) throws IOException {
        for (File dir : directories()) {
            if (now - dir.lastModified() > MAX_AGE_MS) abort(dir.getName());
        }
        List<File> dirs = directories();
        dirs.sort(Comparator.comparingLong(File::lastModified).thenComparing(File::getName));
        long total = 0;
        for (File dir : dirs) total = Math.addExact(total, reservedBytes(dir));
        int count = dirs.size();
        for (File dir : dirs) {
            if (count <= MAX_FILES && total <= MAX_BYTES) break;
            if (uploads.containsKey(dir.getName())) continue;
            total -= reservedBytes(dir);
            remove(dir);
            count--;
        }
        if (count > MAX_FILES || total > MAX_BYTES) throw new IOException("Share-out cache is busy");
    }

    private Upload upload(String id) throws IOException {
        if (!isId(id)) throw new IOException("Invalid staging id");
        Upload upload = uploads.get(id);
        if (upload == null || !upload.file.isFile() || !safe(upload.file.getParentFile()) || !safe(upload.file) ||
            upload.file.length() != upload.written) throw new IOException("No such staging upload");
        return upload;
    }

    private boolean safe(File file) throws IOException { return file.getAbsoluteFile().equals(file.getCanonicalFile()); }

    private List<File> directories() throws IOException {
        List<File> dirs = new ArrayList<>();
        File[] files = root.listFiles();
        if (files == null) throw new IOException("Cannot list share-out cache");
        for (File file : files) {
            if (!isId(file.getName()) || !safe(file) || !file.isDirectory()) { remove(file); continue; }
            dirs.add(file);
        }
        return dirs;
    }

    private long reservedBytes(File dir) throws IOException {
        Upload upload = uploads.get(dir.getName());
        if (upload != null) return upload.size;
        long total = 0;
        File[] files = dir.listFiles();
        if (files == null) throw new IOException("Cannot list staged files");
        for (File file : files) {
            if (!safe(file) || !file.isFile()) throw new IOException("Invalid staged file");
            total = Math.addExact(total, file.length());
        }
        return total;
    }

    /** Do not follow links, including when cleaning a corrupt cache entry. */
    private void remove(File file) throws IOException {
        if (safe(file) && file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("Cannot list staging directory");
            for (File child : children) remove(child);
        }
        if (!file.delete() && file.exists()) throw new IOException("Cannot delete staged file");
    }
}
