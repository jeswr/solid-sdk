// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

/** Checked same-directory write/sync/close/rename. Memory is published by the caller after commit. */
final class SecureStoreFile implements SecureStore.Persistence {
    interface IO {
        default FileOutputStream open(File file) throws IOException { return new FileOutputStream(file); }
        default void sync(FileOutputStream out) throws IOException { out.getFD().sync(); }
        default void close(FileOutputStream out) throws IOException { out.close(); }
        default boolean rename(File from, File to) { return from.renameTo(to); }
    }
    private final File file;
    private final IO io;

    SecureStoreFile(File directory, String namespace) throws IOException { this(directory, namespace, new IO() {}); }
    SecureStoreFile(File directory, String namespace, IO io) throws IOException {
        if (!namespace.matches("[0-9a-f]{64}")) throw new IOException("Invalid namespace");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create secure store");
        file = new File(directory.getCanonicalFile(), namespace + ".bin");
        this.io = io;
    }

    @Override public byte[] read() throws IOException {
        if (!file.exists()) return null;
        try (FileInputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = in.read(buffer)) != -1) out.write(buffer, 0, length);
            return out.toByteArray();
        }
    }

    @Override public void commit(byte[] bytes) throws IOException {
        File temporary = File.createTempFile(file.getName(), ".tmp", file.getParentFile());
        try {
            FileOutputStream out = io.open(temporary);
            try {
                out.write(bytes);
                io.sync(out);
            } finally {
                // close must succeed too, before rename can publish anything.
                try { io.close(out); } finally { out.close(); }
            }
            if (!io.rename(temporary, file)) throw new IOException("Cannot commit secure store");
        } finally {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
        }
    }
}
