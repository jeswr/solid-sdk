// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import static org.junit.Assert.*;
import static org.jeswr.suite.SecureStoreTestSupport.*;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class SecureStoreFileTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    private static final class IO implements SecureStoreFile.IO {
        String failure;
        final List<String> steps = new ArrayList<>();
        @Override public FileOutputStream open(File file) throws IOException {
            steps.add("open");
            if ("open".equals(failure)) throw new IOException("Injected open failure");
            if ("write".equals(failure)) return new FileOutputStream(file) {
                @Override public void write(byte[] bytes) throws IOException { super.write(bytes, 0, 1); throw new IOException("Injected partial write"); }
            };
            return SecureStoreFile.IO.super.open(file);
        }
        @Override public void sync(FileOutputStream out) throws IOException {
            steps.add("sync");
            if ("sync".equals(failure)) throw new IOException("Injected sync failure");
            SecureStoreFile.IO.super.sync(out);
        }
        @Override public void close(FileOutputStream out) throws IOException {
            steps.add("close");
            SecureStoreFile.IO.super.close(out);
            if ("close".equals(failure)) throw new IOException("Injected close failure");
        }
        @Override public boolean rename(File from, File to) {
            steps.add("rename");
            assertEquals(from.getParentFile(), to.getParentFile());
            return !"rename".equals(failure) && SecureStoreFile.IO.super.rename(from, to);
        }
    }

    @Test public void realFileAdapterCommitsOnlyAfterSyncAndClose() throws Exception {
        File root = temp.newFolder(); IO io = new IO();
        SecureStoreFile disk = new SecureStoreFile(root, NS, io);
        assertNull(disk.read());
        disk.commit(new byte[]{1, 2, 3});
        assertEquals(List.of("open", "sync", "close", "rename"), io.steps);
        assertArrayEquals(new byte[]{1, 2, 3}, Files.readAllBytes(new File(root, NS + ".bin").toPath()));
        assertArrayEquals(disk.read(), new SecureStoreFile(root, NS).read());
        assertArrayEquals(new String[]{NS + ".bin"}, root.list());
    }

    @Test public void syncCloseRenameAndPartialWriteFailuresPreserveDiskAndMemoryForEveryMutation() throws Exception {
        for (String failure : new String[]{"open", "write", "sync", "close", "rename"}) {
            for (String mutation : new String[]{"set", "remove", "clear", "recover"}) {
                File root = temp.newFolder(); IO io = new IO(); Crypto crypto = new Crypto();
                SecureStoreFile disk = new SecureStoreFile(root, NS, io);
                SecureStore store = new SecureStore(NS, disk, crypto);
                store.set("a", "old", false, 0); store.set("b", "other", false, 0);
                byte[] before = disk.read(); io.steps.clear(); io.failure = failure;
                assertThrows(IOException.class, () -> {
                    switch (mutation) {
                        case "set": store.set("a", "new", false, 1); break;
                        case "remove": store.remove("a"); break;
                        case "clear": store.clear(); break;
                        default: crypto.openFailure = new SecureStore.Unrecoverable(false); get(store, "a");
                    }
                });
                crypto.openFailure = null;
                assertArrayEquals(failure + "/" + mutation, before, disk.read());
                assertEquals("old", get(store, "a").value); assertEquals(1, get(store, "a").version);
                assertEquals("other", get(store, "b").value);
                assertEquals("old", get(new SecureStore(NS, new SecureStoreFile(root, NS), crypto), "a").value);
                assertArrayEquals(new String[]{NS + ".bin"}, root.list());
                if (!failure.equals("rename")) assertFalse(io.steps.contains("rename"));
            }
        }
    }

    @Test public void firstCommitFailuresLeaveNoPublishedState() throws Exception {
        for (String failure : new String[]{"sync", "close", "rename"}) {
            File root = temp.newFolder(); IO io = new IO(); io.failure = failure;
            SecureStoreFile disk = new SecureStoreFile(root, NS, io);
            SecureStore store = new SecureStore(NS, disk, new Crypto());
            assertThrows(IOException.class, () -> store.set("a", "new", false, 0));
            assertNull(disk.read()); assertEquals(0, get(store, "a").version); assertEquals(0, root.list().length);
        }
    }

    @Test public void namespacesHaveSeparateFilesAndClearNeverTouchesAnotherOrigin() throws Exception {
        File root = temp.newFolder(); String other = SecureStoreValidation.namespace("https://other.example");
        SecureStore first = new SecureStore(NS, new SecureStoreFile(root, NS), new Crypto());
        SecureStore second = new SecureStore(other, new SecureStoreFile(root, other), new Crypto());
        first.set("a", "first", false, 0); second.set("a", "second", false, 0);
        first.clear();
        assertNull(get(first, "a").value); assertEquals("second", get(second, "a").value);
        assertEquals("second", get(new SecureStore(other, new SecureStoreFile(root, other), new Crypto()), "a").value);
        assertThrows(IOException.class, () -> new SecureStoreFile(root, "../escape"));
        assertThrows(IOException.class, () -> new SecureStoreFile(temp.newFile(), NS));
    }
}
