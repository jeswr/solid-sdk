// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class ShareStoreTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private File root;
    private ShareStore store;

    @Before
    public void setUp() throws IOException {
        root = tmp.newFolder("share");
        store = new ShareStore(root);
    }

    /** A source of {@code size} zero bytes that never allocates them all. */
    private static ShareStore.Source zeros(long size) {
        return () -> new InputStream() {
            long left = size;

            @Override
            public int read() {
                if (left == 0) return -1;
                left--;
                return 0;
            }

            @Override
            public int read(byte[] b, int off, int len) {
                if (left == 0) return -1;
                int n = (int) Math.min(len, left);
                Arrays.fill(b, off, off + n, (byte) 0);
                left -= n;
                return n;
            }
        };
    }

    private static ShareStore.Incoming file(String name, byte[] bytes) {
        return ShareStore.Incoming.file(name, "text/plain", () -> new ByteArrayInputStream(bytes));
    }

    private ShareStore.Batch storeOne(long now) throws Exception {
        return store.store(Collections.singletonList(ShareStore.Incoming.text("hi")), now);
    }

    private void rejects(List<ShareStore.Incoming> items) throws IOException {
        try {
            store.store(items, 1000);
            fail("expected a rejected share");
        } catch (ShareStore.RejectedShare expected) {
            assertEquals("nothing is kept", 0, root.list().length);
        }
    }

    @Test
    public void storesAMixedBatchAndReadsItBack() throws Exception {
        byte[] bytes = "hello world".getBytes(StandardCharsets.UTF_8);
        ShareStore.Batch batch = store.store(Arrays.asList(
                file("../../etc/passwd", bytes),
                ShareStore.Incoming.url(" https://example.org/a?b=c ", "Example"),
                ShareStore.Incoming.text("note")), 1000);
        List<ShareStore.Batch> pending = store.pending();
        assertEquals(1, pending.size());
        ShareStore.Batch read = pending.get(0);
        assertEquals(batch.id, read.id);
        assertEquals(1000, read.receivedAt);
        assertEquals(3, read.size());
        assertEquals("file", read.get(0, "kind"));
        assertEquals("_.._etc_passwd", read.get(0, "name"));
        assertEquals("text/plain", read.get(0, "mimeType"));
        assertEquals("11", read.get(0, "size"));
        assertEquals("https://example.org/a?b=c", read.get(1, "url"));
        assertEquals("Example", read.get(1, "title"));
        assertEquals("note", read.get(2, "text"));

        assertArrayEquals("hello".getBytes(StandardCharsets.UTF_8), store.readChunk(batch.id, 0, 0, 5));
        assertFalse(store.isEnd(batch.id, 0, 5));
        assertArrayEquals(" world".getBytes(StandardCharsets.UTF_8), store.readChunk(batch.id, 0, 5, 100));
        assertTrue(store.isEnd(batch.id, 0, 11));
        assertEquals("reads past the end are empty", 0, store.readChunk(batch.id, 0, 11, 10).length);

        store.acknowledge(batch.id);
        assertTrue(store.pending().isEmpty());
        assertEquals(0, root.list().length);
    }

    @Test
    public void capsChunksAt512KiB() throws Exception {
        ShareStore.Batch batch = store.store(Collections.singletonList(
                ShareStore.Incoming.file("big", null, zeros(ShareStore.MAX_CHUNK_BYTES + 10))), 1000);
        assertEquals("application/octet-stream", batch.get(0, "mimeType"));
        assertEquals(ShareStore.MAX_CHUNK_BYTES, store.readChunk(batch.id, 0, 0, Integer.MAX_VALUE).length);
    }

    @Test
    public void readChunkRejectsBadTargets() throws Exception {
        ShareStore.Batch batch = store.store(Arrays.asList(file("a", new byte[3]), ShareStore.Incoming.text("t")), 1000);
        String[][] cases = {{batch.id, "1"}, {batch.id, "2"}, {batch.id, "-1"}, {"../share", "0"}, {null, "0"},
            {"00000000-0000-0000-0000-000000000000", "0"}};
        for (String[] c : cases) {
            try {
                store.readChunk(c[0], Integer.parseInt(c[1]), 0, 1);
                fail("expected IOException for " + Arrays.toString(c));
            } catch (IOException expected) {
                // rejected
            }
        }
        try {
            store.readChunk(batch.id, 0, -1, 1);
            fail("negative offset");
        } catch (IOException expected) {
            // rejected
        }
    }

    @Test
    public void rejectsOversizedAndMalformedShares() throws Exception {
        rejects(Collections.emptyList());
        ShareStore.Incoming[] many = new ShareStore.Incoming[ShareStore.MAX_ITEMS + 1];
        Arrays.fill(many, ShareStore.Incoming.text("x"));
        rejects(Arrays.asList(many));
        rejects(Collections.singletonList(ShareStore.Incoming.file("big", "a/b", zeros(ShareStore.MAX_ITEM_BYTES + 1))));
        rejects(Arrays.asList(
                ShareStore.Incoming.file("a", "a/b", zeros(ShareStore.MAX_ITEM_BYTES)),
                ShareStore.Incoming.file("b", "a/b", zeros(ShareStore.MAX_ITEM_BYTES)),
                ShareStore.Incoming.file("c", "a/b", zeros(1))));
        rejects(Collections.singletonList(ShareStore.Incoming.file("none", "a/b", null)));
        rejects(Collections.singletonList(ShareStore.Incoming.file("null", "a/b", () -> null)));
        boolean[] opened = {false};
        rejects(Arrays.asList(ShareStore.Incoming.url("ftp://x", null),
                ShareStore.Incoming.file("later", "a/b", () -> {
                    opened[0] = true;
                    return new ByteArrayInputStream(new byte[1]);
                })));
        assertFalse("items after a rejection are never opened", opened[0]);
        char[] longText = new char[ShareStore.MAX_TEXT_CHARS + 1];
        rejects(Collections.singletonList(ShareStore.Incoming.text(new String(longText))));
        rejects(Collections.singletonList(ShareStore.Incoming.text(null)));
        for (String url : new String[] {"javascript:alert(1)", "file:///data/x", "https://user:pw@example.org/",
            "https://", "not a url", null}) {
            rejects(Collections.singletonList(ShareStore.Incoming.url(url, null)));
        }
    }

    @Test
    public void acceptsExactlyTheCaps() throws Exception {
        ShareStore.Batch batch = store.store(Arrays.asList(
                ShareStore.Incoming.file("a", "a/b", zeros(ShareStore.MAX_ITEM_BYTES)),
                ShareStore.Incoming.file("b", "a/b", zeros(ShareStore.MAX_ITEM_BYTES))), 1000);
        assertEquals(Long.toString(ShareStore.MAX_ITEM_BYTES), batch.get(1, "size"));
    }

    @Test
    public void evictsTheOldestBeyondTenBatches() throws Exception {
        String first = storeOne(1).id;
        for (int i = 2; i <= ShareStore.MAX_PENDING_BATCHES; i++) storeOne(i);
        assertEquals(10, store.pending().size());
        String newest = storeOne(100).id;
        List<ShareStore.Batch> pending = store.pending();
        assertEquals(10, pending.size());
        assertFalse(pending.stream().anyMatch(b -> b.id.equals(first)));
        assertEquals(newest, pending.get(9).id);
    }

    @Test
    public void evictsTheOldestBeyond500MB() throws Exception {
        String a = store.store(Collections.singletonList(ShareStore.Incoming.file("a", "a/b", zeros(ShareStore.MAX_BATCH_BYTES / 2))), 1).id;
        String b = store.store(Collections.singletonList(ShareStore.Incoming.file("b", "a/b", zeros(ShareStore.MAX_BATCH_BYTES / 2))), 2).id;
        String c = store.store(Collections.singletonList(ShareStore.Incoming.file("c", "a/b", zeros(ShareStore.MAX_BATCH_BYTES / 2))), 3).id;
        store.store(Arrays.asList(
                ShareStore.Incoming.file("d", "a/b", zeros(ShareStore.MAX_ITEM_BYTES)),
                ShareStore.Incoming.file("e", "a/b", zeros(ShareStore.MAX_ITEM_BYTES))), 4);
        List<String> ids = store.pending().stream().map(x -> x.id).collect(java.util.stream.Collectors.toList());
        assertEquals("300 MB + 200 MB fits; the oldest goes", 3, ids.size());
        assertFalse(ids.contains(a));
        assertTrue(ids.contains(b) && ids.contains(c));
    }

    @Test
    public void evictsWeekOldBatchesAndStalePartials() throws Exception {
        String old = storeOne(0).id;
        String fresh = storeOne(ShareStore.MAX_AGE_MS).id;
        File partial = new File(root, "11111111-1111-1111-1111-111111111111");
        assertTrue(partial.mkdirs());
        assertTrue(partial.setLastModified(0));
        File recentPartial = new File(root, "22222222-2222-2222-2222-222222222222");
        assertTrue(recentPartial.mkdirs());
        File unrelated = new File(root, "keep-me");
        assertTrue(unrelated.mkdirs());
        store.evict(ShareStore.MAX_AGE_MS + 1);
        assertEquals(1, store.pending().size());
        assertEquals(fresh, store.pending().get(0).id);
        assertNull(store.pending().stream().filter(b -> b.id.equals(old)).findFirst().orElse(null));
        assertFalse(partial.exists());
        assertTrue("a copy in progress survives", recentPartial.exists() || recentPartial.lastModified() < 0);
        assertTrue(unrelated.exists());
    }

    @Test
    public void dropsCorruptManifests() throws Exception {
        String id = storeOne(5).id;
        java.nio.file.Files.write(new File(new File(root, id), "batch.properties").toPath(),
                "receivedAt=soon\n".getBytes(StandardCharsets.UTF_8));
        assertTrue(store.pending().isEmpty());
        assertFalse(new File(root, id).exists());
    }

    @Test
    public void acknowledgeIgnoresNonBatchNames() throws Exception {
        File unrelated = new File(root, "keep-me");
        assertTrue(unrelated.mkdirs());
        store.acknowledge("keep-me");
        store.acknowledge("../share");
        store.acknowledge(null);
        assertTrue(unrelated.exists());
    }

    @Test
    public void sanitisesNamesAndTypesLikeSuiteNative() {
        assertEquals("shared-file", ShareStore.sanitiseName(null));
        assertEquals("shared-file", ShareStore.sanitiseName(" .. "));
        assertEquals("a_b_c", ShareStore.sanitiseName("a/b\\c"));
        assertEquals("x_y", ShareStore.sanitiseName("x\u0000y"));
        assertEquals(255, ShareStore.sanitiseName(new String(new char[300]).replace('\0', 'n')).length());
        assertEquals("image/png", ShareStore.sanitiseMime("IMAGE/PNG"));
        assertEquals("application/octet-stream", ShareStore.sanitiseMime("text/html; charset=utf-8"));
        assertEquals("application/octet-stream", ShareStore.sanitiseMime(null));
    }
}
