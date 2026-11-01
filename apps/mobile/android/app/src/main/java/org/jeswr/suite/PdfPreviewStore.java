// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;

/**
 * The PDF preview handoff's cache (MOB-P3 E5): cache/pdf-preview/&lt;handle&gt;/&lt;name&gt;.pdf, at most
 * one file. Native code enforces the 25 MiB cap on the declared size and on every append, requires
 * the first bytes to be {@code %PDF-}, accepts one handle at a time and drops a handle idle for 60
 * seconds. All operations are serialised.
 */
public final class PdfPreviewStore {
    public static final long MAX_BYTES = 25L * 1024 * 1024;
    public static final int MAX_CHUNK_BYTES = 1024 * 1024;
    public static final long IDLE_MS = 60_000;
    private static final byte[] SIGNATURE = "%PDF-".getBytes(StandardCharsets.US_ASCII);

    /** A refusal with the code the plugin rejects with. */
    public static final class Refused extends Exception {
        public final String code;

        Refused(String code) {
            super(code);
            this.code = code;
        }
    }

    private final File root;
    private String handle;
    private File file;
    private long size;
    private long written;
    private long touched;
    private boolean finished;

    /** Creates the store and empties its directory, which also clears files a killed process left. */
    public PdfPreviewStore(File root) throws IOException {
        this.root = root.getCanonicalFile();
        if (!this.root.isDirectory() && !this.root.mkdirs()) throw new IOException("Cannot create pdf-preview cache");
        clear();
    }

    /** Starts a preview, discarding the previous handle and its file. */
    public synchronized String begin(String name, long size, long now) throws Refused, IOException {
        clear();
        if (size > MAX_BYTES) throw new Refused("too-large");
        if (name == null || name.length() > 4096 || size < SIGNATURE.length) throw new Refused("invalid");
        String id = UUID.randomUUID().toString();
        File dir = new File(root, id);
        File created = new File(dir, fileName(name));
        if (!dir.mkdir() || !created.createNewFile()) throw new IOException("Cannot create preview file");
        this.handle = id;
        this.file = created;
        this.size = size;
        this.written = 0;
        this.touched = now;
        this.finished = false;
        return id;
    }

    /** Appends one decoded chunk. Any refusal discards the preview. */
    public synchronized void append(String id, byte[] bytes, long now) throws Refused, IOException {
        current(id, now);
        try {
            if (bytes == null || bytes.length == 0 || bytes.length > MAX_CHUNK_BYTES) throw new Refused("invalid");
            if (written + bytes.length > size) throw new Refused("too-large");
            if (written == 0 && !startsWithSignature(bytes)) throw new Refused("not-pdf");
            try (FileOutputStream out = new FileOutputStream(file, true)) {
                out.write(bytes);
            }
            written += bytes.length;
            touched = now;
        } catch (Refused | IOException e) {
            clear();
            throw e;
        }
    }

    /** The complete file, ready for the viewer. Later appends to this handle are refused. */
    public synchronized File finish(String id, long now) throws Refused, IOException {
        current(id, now);
        if (written != size) {
            clear();
            throw new Refused("invalid");
        }
        finished = true;
        touched = now;
        return file;
    }

    /** Drops the handle and empties the directory. */
    public synchronized void clear() throws IOException {
        handle = null;
        file = null;
        finished = false;
        File[] entries = root.listFiles();
        if (entries == null) throw new IOException("Cannot list pdf-preview cache");
        for (File entry : entries) remove(entry);
    }

    private void current(String id, long now) throws Refused, IOException {
        if (handle == null || finished || !handle.equals(id)) throw new Refused("invalid");
        if (now - touched > IDLE_MS) {
            clear();
            throw new Refused("invalid");
        }
    }

    private static boolean startsWithSignature(byte[] bytes) {
        if (bytes.length < SIGNATURE.length) return false;
        for (int i = 0; i < SIGNATURE.length; i++) if (bytes[i] != SIGNATURE[i]) return false;
        return true;
    }

    /** A filesystem-safe display name that always ends in .pdf. */
    static String fileName(String name) {
        String safe = ShareOutStore.sanitiseName(name);
        if (safe.equals("shared-file")) safe = "document";
        if (!safe.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
            while (safe.getBytes(StandardCharsets.UTF_8).length > 251) {
                safe = safe.substring(0, safe.offsetByCodePoints(safe.length(), -1));
            }
            safe = safe + ".pdf";
        }
        return safe;
    }

    private static void remove(File entry) throws IOException {
        File[] children = entry.isDirectory() ? entry.listFiles() : null;
        if (children != null) for (File child : children) remove(child);
        if (!entry.delete() && entry.exists()) throw new IOException("Cannot remove " + entry.getName());
    }
}
