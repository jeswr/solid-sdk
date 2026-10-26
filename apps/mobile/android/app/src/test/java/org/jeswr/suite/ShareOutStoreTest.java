// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class ShareOutStoreTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private File root;
    private ShareOutStore store;
    private final long now = 1_800_000_000_000L;

    @Before public void setup() throws Exception {
        root = new File(temp.getRoot(), "share-out");
        store = new ShareOutStore(root);
    }

    private String begin(long bytes) throws IOException { return store.begin("file.txt", "text/plain", bytes, now); }
    private int count() { return root.list().length; }
    private void rejectedWrite(String id, long offset, byte[] bytes) {
        assertThrows(IOException.class, () -> store.writeChunk(id, offset, bytes, now));
        assertFalse(new File(root, id).exists());
    }
    private String completed(String name, long timestamp) throws IOException {
        String id = store.begin(name, "text/plain", 0, timestamp);
        store.commit(id, timestamp);
        return id;
    }
    private File diskFile(String name, long bytes, long timestamp) throws IOException {
        File dir = new File(root, UUID.randomUUID().toString());
        assertTrue(dir.mkdir());
        File file = new File(dir, name);
        try (RandomAccessFile out = new RandomAccessFile(file, "rw")) { out.setLength(bytes); }
        assertTrue(dir.setLastModified(timestamp));
        return file;
    }

    @Test public void roundTrip() throws Exception {
        String id = begin(5);
        assertTrue(ShareOutStore.isId(id));
        store.writeChunk(id, 0, "he".getBytes(StandardCharsets.UTF_8), now);
        store.writeChunk(id, 2, "llo".getBytes(StandardCharsets.UTF_8), now);
        File file = store.commit(id, now);
        assertEquals(new File(new File(root, id), "file.txt"), file);
        assertEquals("hello", new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        assertEquals(1, count());
        assertThrows(IOException.class, () -> store.commit(id, now));
        assertFalse(file.exists());
    }

    @Test public void emptyFile() throws Exception {
        File file = store.commit(begin(0), now);
        assertEquals(0, file.length());
        assertTrue(file.isFile());
    }

    @Test public void namesCannotEscapeTheirDirectory() throws Exception {
        assertEquals("_a_b_c_", ShareOutStore.sanitiseName(" ../a\\b/c\u0000 "));
        assertEquals("shared-file", ShareOutStore.sanitiseName(" ... "));
        assertEquals("shared-file", ShareOutStore.sanitiseName(null));
        String raw = "💾".repeat(100);
        String safe = ShareOutStore.sanitiseName(raw);
        assertTrue(safe.getBytes(StandardCharsets.UTF_8).length <= 255);
        assertFalse(Character.isHighSurrogate(safe.charAt(safe.length() - 1)));
        String id = store.begin("../../name.txt", "text/plain", 0, now);
        assertEquals("_.._name.txt", store.commit(id, now).getName());
        String unicode = store.begin(raw, "image/png", 0, now);
        assertTrue(store.commit(unicode, now).isFile());
    }

    @Test public void badMetadataDoesNotAllocate() throws Exception {
        for (long size : new long[]{-1, Long.MAX_VALUE, ShareOutStore.MAX_BYTES + 1}) {
            assertThrows(IOException.class, () -> store.begin("f", "text/plain", size, now));
        }
        for (String mime : new String[]{null, "", "bad", "text/plain; charset=utf8", "text/plain\n", "a".repeat(256)}) {
            assertThrows(IOException.class, () -> store.begin("f", mime, 1, now));
        }
        assertThrows(IOException.class, () -> store.begin(null, "text/plain", 0, now));
        assertThrows(IOException.class, () -> store.begin("a".repeat(4097), "text/plain", 0, now));
        assertEquals(0, count());
    }

    @Test public void offsetsAreContiguous() throws Exception {
        rejectedWrite(begin(4), -1, new byte[1]);
        rejectedWrite(begin(4), 1, new byte[1]);
        rejectedWrite(begin(4), Long.MAX_VALUE, new byte[1]);
        String id = begin(4);
        store.writeChunk(id, 0, new byte[2], now);
        rejectedWrite(id, 0, new byte[1]);
    }

    @Test public void invalidChunkSizesAbort() throws Exception {
        rejectedWrite(begin(4), 0, null);
        rejectedWrite(begin(4), 0, new byte[0]);
        rejectedWrite(begin(ShareOutStore.MAX_BYTES), 0, new byte[ShareOutStore.MAX_CHUNK_BYTES + 1]);
        rejectedWrite(begin(1), 0, new byte[2]);
        String id = begin(ShareOutStore.MAX_CHUNK_BYTES);
        store.writeChunk(id, 0, new byte[ShareOutStore.MAX_CHUNK_BYTES], now);
        assertEquals(ShareOutStore.MAX_CHUNK_BYTES, store.commit(id, now).length());
    }

    @Test public void incompleteCommitAborts() throws Exception {
        String id = begin(1);
        assertThrows(IOException.class, () -> store.commit(id, now));
        assertEquals(0, count());
    }

    @Test public void invalidIdsNeverReachOtherFiles() throws Exception {
        File outside = temp.newFile("outside");
        for (String id : new String[]{null, "", "../outside", "123", UUID.randomUUID().toString().toUpperCase()}) {
            assertFalse(ShareOutStore.isId(id));
            assertThrows(IOException.class, () -> store.commit(id, now));
            assertThrows(IOException.class, () -> store.writeChunk(id, 0, new byte[1], now));
            store.abort(id);
        }
        assertTrue(outside.exists());
        assertThrows(IOException.class, () -> store.commit(UUID.randomUUID().toString(), now));
    }

    @Test public void abortIsIdempotentAndCanRemoveCommittedFiles() throws Exception {
        String id = begin(1);
        store.abort(id);
        store.abort(id);
        String done = completed("done", now);
        store.abort(done);
        assertEquals(0, count());
    }

    @Test public void expiresAfter24HoursIncludingPartialUploads() throws Exception {
        String committed = completed("retained", now);
        String partial = begin(2);
        store.evict(now + ShareOutStore.MAX_AGE_MS);
        assertEquals(2, count());
        store.evict(now + ShareOutStore.MAX_AGE_MS + 1);
        assertEquals(0, count());
        assertThrows(IOException.class, () -> store.commit(committed, now));
        assertThrows(IOException.class, () -> store.writeChunk(partial, 0, new byte[1], now));
    }

    @Test public void operationsAlsoExpireOldUploads() throws Exception {
        String id = begin(1);
        assertThrows(IOException.class, () -> store.writeChunk(id, 0, new byte[1], now + ShareOutStore.MAX_AGE_MS + 1));
        assertEquals(0, count());
        final String old = begin(0);
        assertThrows(IOException.class, () -> store.commit(old, now + ShareOutStore.MAX_AGE_MS + 1));
        assertEquals(0, count());
    }

    @Test public void twentyFileCapEvictsOldest() throws Exception {
        String oldest = completed("first", now);
        for (int i = 1; i < 20; i++) completed("f" + i, now + i);
        String recent = completed("last", now + 30);
        assertFalse(new File(root, oldest).exists());
        assertTrue(new File(root, recent).exists());
        assertEquals(20, count());
    }

    @Test public void filesKeptForTheSameShareAreNeverEvicted() throws Exception {
        String kept = completed("first", now);
        String other = completed("second", now + 1);
        for (int i = 2; i < 20; i++) completed("f" + i, now + i);
        String id = store.begin("next", "text/plain", 0, java.util.Collections.singleton(kept), now + 30);
        assertTrue(new File(root, kept).exists());
        assertFalse(new File(root, other).exists());
        assertTrue(new File(root, id).exists());
        // When only kept files remain there is no room, so the share fails instead of losing them.
        java.util.Set<String> all = new java.util.HashSet<>(java.util.Arrays.asList(root.list()));
        assertThrows(IOException.class, () -> store.begin("more", "text/plain", 0, all, now + 31));
        assertEquals(20, count());
    }

    @Test public void keepListsMustBeArraysOfIds() throws Exception {
        assertTrue(ShareOutStore.keepIds(null).isEmpty());
        String id = UUID.randomUUID().toString();
        assertEquals(java.util.Collections.singleton(id), ShareOutStore.keepIds(new Object[]{id}));
        for (Object bad : new Object[]{"x", 1, new Object[]{"../x"}, new Object[]{1}, new Object[]{null}, new Object[ShareOutStore.MAX_FILES]}) {
            assertThrows(IOException.class, () -> ShareOutStore.keepIds(bad));
        }
    }

    @Test public void activeUploadsCannotBeEvictedByAnotherBegin() throws Exception {
        for (int i = 0; i < 20; i++) begin(0);
        assertThrows(IOException.class, () -> begin(0));
        assertEquals(20, count());
    }

    @Test public void declaredBytesAreReservedUntilAbort() throws Exception {
        String id = begin(ShareOutStore.MAX_BYTES);
        assertThrows(IOException.class, () -> begin(1));
        store.abort(id);
        assertNotNull(begin(1));
    }

    @Test public void diskByteCapEvictsOldestAcrossRestart() throws Exception {
        File oldest = diskFile("old", 60L * 1024 * 1024, now - 2);
        File newer = diskFile("new", 40L * 1024 * 1024, now - 1);
        store = new ShareOutStore(root);
        String id = begin(1);
        assertFalse(oldest.exists());
        assertTrue(newer.exists());
        assertTrue(new File(root, id).isDirectory());
        assertEquals(2, count());
    }

    @Test public void evictRepairsOverflowAndExpiredFilesOnRestart() throws Exception {
        File expired = diskFile("expired", 0, now - ShareOutStore.MAX_AGE_MS - 1);
        File oldest = diskFile("old", 60L * 1024 * 1024, now - 2);
        File newer = diskFile("new", 60L * 1024 * 1024, now - 1);
        store.evict(now);
        assertFalse(expired.exists());
        assertFalse(oldest.exists());
        assertTrue(newer.exists());
        for (int i = 0; i < 21; i++) diskFile("empty", 0, now + i);
        store.evict(now + 30);
        assertEquals(20, count());
    }

    @Test public void partialProcessDeathRemainsBoundedAndCannotBeCommitted() throws Exception {
        String id = begin(1);
        store.writeChunk(id, 0, new byte[1], now);
        store = new ShareOutStore(root);
        assertThrows(IOException.class, () -> store.commit(id, now));
        assertEquals(0, count());
    }

    @Test public void mutationOutsideWriterFailsClosed() throws Exception {
        String id = begin(1);
        Files.write(new File(new File(root, id), "file.txt").toPath(), new byte[2]);
        assertThrows(IOException.class, () -> store.commit(id, now));
        assertEquals(0, count());
    }

    @Test public void symlinkCleanupNeverFollowsLinks() throws Exception {
        File outside = temp.newFolder("outside");
        File secret = new File(outside, "secret");
        assertTrue(secret.createNewFile());
        Files.createSymbolicLink(new File(root, UUID.randomUUID().toString()).toPath(), outside.toPath());
        store.evict(now);
        assertTrue(secret.exists());
        assertEquals(0, count());
        String id = begin(1);
        File file = new File(new File(root, id), "file.txt");
        assertTrue(file.delete());
        Files.createSymbolicLink(file.toPath(), secret.toPath());
        assertThrows(IOException.class, () -> store.commit(id, now));
        assertTrue(secret.exists());
        assertEquals(0, count());
    }

    @Test public void corruptCacheFailsClosedAndUnknownEntriesAreRemoved() throws Exception {
        assertTrue(new File(root, "junk").createNewFile());
        store.evict(now);
        assertEquals(0, count());
        File dir = new File(root, UUID.randomUUID().toString());
        assertTrue(new File(dir, "nested").mkdirs());
        assertTrue(dir.setLastModified(now));
        assertThrows(IOException.class, () -> begin(0));
    }

    @Test public void fileCannotBeUsedAsCacheRoot() throws Exception {
        assertThrows(IOException.class, () -> new ShareOutStore(temp.newFile("file-root")));
    }

    @Test public void bridgeIntegersRejectCoercionAndFractions() throws Exception {
        for (Object value : new Object[]{null, "1", true, -1, 1.5, Double.NaN, Double.POSITIVE_INFINITY, ShareOutStore.MAX_BYTES + 1}) {
            assertThrows(IOException.class, () -> ShareOutStore.integer(value));
        }
        assertEquals(0, ShareOutStore.integer(0));
        assertEquals(1, ShareOutStore.integer(1.0));
        assertEquals(ShareOutStore.MAX_BYTES, ShareOutStore.integer(ShareOutStore.MAX_BYTES));
    }

    @Test public void bridgeBase64IsBoundedBeforeDecode() throws Exception {
        for (String value : new String[]{null, "", "a", "====", "a===", "aa=a", "a a=", "AA==\n", "____", "-AAA", "A".repeat(4 * ((ShareOutStore.MAX_CHUNK_BYTES + 2) / 3) + 4)}) {
            assertThrows(IOException.class, () -> ShareOutStore.checkEncodedChunk(value));
        }
        ShareOutStore.checkEncodedChunk("AA==");
        ShareOutStore.checkEncodedChunk("AAA=");
        ShareOutStore.checkEncodedChunk("AAAA");
        ShareOutStore.checkEncodedChunk(java.util.Base64.getEncoder().encodeToString(new byte[ShareOutStore.MAX_CHUNK_BYTES]));
    }

    @Test public void exact100MiBCanBeWrittenAndCommitted() throws Exception {
        String id = begin(ShareOutStore.MAX_BYTES);
        byte[] chunk = new byte[ShareOutStore.MAX_CHUNK_BYTES];
        for (long offset = 0; offset < ShareOutStore.MAX_BYTES; offset += chunk.length) {
            store.writeChunk(id, offset, chunk, now);
        }
        assertEquals(ShareOutStore.MAX_BYTES, store.commit(id, now).length());
        // A subsequent file may evict it under the bounded retention policy.
        begin(1);
        assertFalse(new File(root, id).exists());
    }
}
