// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class PdfPreviewStoreTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private File root;
    private PdfPreviewStore store;
    private final long now = 1_800_000_000_000L;
    private static final byte[] PDF = "%PDF-1.7\n%%EOF\n".getBytes(StandardCharsets.US_ASCII);

    @Before public void setup() throws Exception {
        root = new File(temp.getRoot(), "pdf-preview");
        store = new PdfPreviewStore(root);
    }

    private String code(ThrowingRunnable action) {
        try {
            action.run();
        } catch (PdfPreviewStore.Refused e) {
            return e.code;
        } catch (Exception e) {
            throw new AssertionError(e);
        }
        throw new AssertionError("expected a refusal");
    }

    private interface ThrowingRunnable { void run() throws Exception; }

    private int files() {
        int count = 0;
        for (File dir : root.listFiles()) count += dir.isDirectory() ? dir.listFiles().length : 1;
        return count;
    }

    @Test public void writesAndFinishesOnePdf() throws Exception {
        String handle = store.begin("Report", PDF.length, now);
        store.append(handle, PDF, now + 1);
        File file = store.finish(handle, now + 2);
        assertEquals("Report.pdf", file.getName());
        assertArrayEquals(PDF, Files.readAllBytes(file.toPath()));
        assertEquals(root.getCanonicalFile(), file.getParentFile().getParentFile());
        assertEquals("invalid", code(() -> store.append(handle, PDF, now + 3)));
        assertEquals("invalid", code(() -> store.finish(handle, now + 3)));
    }

    @Test public void capsTheDeclaredSizeAndEveryAppend() throws Exception {
        assertEquals("too-large", code(() -> store.begin("a.pdf", PdfPreviewStore.MAX_BYTES + 1, now)));
        assertEquals(0, files());
        String handle = store.begin("a.pdf", PDF.length, now);
        byte[] longer = new byte[PDF.length + 1];
        System.arraycopy(PDF, 0, longer, 0, PDF.length);
        assertEquals("too-large", code(() -> store.append(handle, longer, now)));
        assertEquals(0, files());
        assertEquals("invalid", code(() -> store.append(handle, PDF, now)));
        String big = store.begin("a.pdf", PdfPreviewStore.MAX_BYTES, now);
        assertEquals("invalid", code(() -> store.append(big, new byte[PdfPreviewStore.MAX_CHUNK_BYTES + 1], now)));
    }

    @Test public void requiresTheSignatureOnTheFirstBytes() throws Exception {
        String handle = store.begin("a.pdf", 16, now);
        assertEquals("not-pdf", code(() -> store.append(handle, "<html>evil</html".getBytes(StandardCharsets.US_ASCII), now)));
        assertEquals(0, files());
        String shortFirst = store.begin("a.pdf", 16, now);
        assertEquals("not-pdf", code(() -> store.append(shortFirst, "%PD".getBytes(StandardCharsets.US_ASCII), now)));
        String split = store.begin("a.pdf", 10, now);
        store.append(split, "%PDF-".getBytes(StandardCharsets.US_ASCII), now);
        store.append(split, "<html".getBytes(StandardCharsets.US_ASCII), now);
        assertEquals(10, store.finish(split, now).length());
    }

    @Test public void refusesEmptyMissingAndIncompleteInput() throws Exception {
        assertEquals("invalid", code(() -> store.begin(null, 10, now)));
        assertEquals("invalid", code(() -> store.begin("a.pdf", 4, now)));
        String handle = store.begin("a.pdf", PDF.length, now);
        assertEquals("invalid", code(() -> store.append(handle, new byte[0], now)));
        String next = store.begin("a.pdf", PDF.length, now);
        assertEquals("invalid", code(() -> store.append("not-the-handle", PDF, now)));
        assertEquals("invalid", code(() -> store.finish(next, now)));
        assertEquals(0, files());
    }

    @Test public void aNewBeginReplacesThePreviousHandleAndFile() throws Exception {
        String first = store.begin("first.pdf", PDF.length, now);
        store.append(first, PDF, now);
        store.finish(first, now);
        String second = store.begin("second.pdf", PDF.length, now);
        assertEquals("invalid", code(() -> store.append(first, PDF, now)));
        assertEquals(1, files());
        store.append(second, PDF, now);
        assertEquals("second.pdf", store.finish(second, now).getName());
        assertEquals(1, root.listFiles().length);
    }

    @Test public void dropsAHandleIdleForSixtySeconds() throws Exception {
        String handle = store.begin("a.pdf", PDF.length * 2L, now);
        store.append(handle, PDF, now + PdfPreviewStore.IDLE_MS);
        assertEquals("invalid", code(() -> store.append(handle, PDF, now + 2 * PdfPreviewStore.IDLE_MS + 1)));
        assertEquals(0, files());
    }

    @Test public void aStaleHandleLeavesTheLiveTransferAndFileIntact() throws Exception {
        String stale = store.begin("a.pdf", PDF.length, now);
        String live = store.begin("b.pdf", PDF.length * 2L, now);
        assertEquals("invalid", code(() -> store.append(stale, PDF, now)));
        assertEquals("invalid", code(() -> store.finish(stale, now)));
        store.discard(stale);
        store.release(stale);
        store.append(live, PDF, now);
        store.append(live, PDF, now);
        File file = store.finish(live, now);
        // After finish, a late call from either caller must not delete the file a viewer has open.
        assertEquals("invalid", code(() -> store.append(stale, PDF, now)));
        assertEquals("invalid", code(() -> store.append(live, PDF, now)));
        store.discard(live);
        store.discard(stale);
        store.release(stale);
        assertTrue(file.exists());
        store.release(live);
        assertFalse(file.exists());
    }

    @Test public void discardDropsOnlyTheLiveUnfinishedTransfer() throws Exception {
        String handle = store.begin("a.pdf", PDF.length, now);
        store.discard(handle);
        assertEquals(0, files());
        assertEquals("invalid", code(() -> store.append(handle, PDF, now)));
    }

    @Test public void sweepDeletesAbandonedTransfersAndOldFinishedFiles() throws Exception {
        String partial = store.begin("a.pdf", PDF.length, now);
        store.sweep(now + PdfPreviewStore.IDLE_MS);
        assertEquals(1, files());
        store.sweep(now + PdfPreviewStore.IDLE_MS + 1);
        assertEquals(0, files());
        assertEquals("invalid", code(() -> store.append(partial, PDF, now)));
        String done = store.begin("a.pdf", PDF.length, now);
        store.append(done, PDF, now);
        File file = store.finish(done, now);
        store.sweep(now + PdfPreviewStore.FINISHED_MS);
        assertTrue(file.exists());
        store.sweep(now + PdfPreviewStore.FINISHED_MS + 1);
        assertFalse(file.exists());
        store.sweep(now + 10 * PdfPreviewStore.FINISHED_MS);
    }

    @Test public void boundsTheNameInUtf16Units() throws Exception {
        store.begin("a".repeat(PdfPreviewStore.MAX_NAME_UNITS), PDF.length, now);
        assertEquals("invalid", code(() -> store.begin("a".repeat(PdfPreviewStore.MAX_NAME_UNITS + 1), PDF.length, now)));
    }

    @Test public void acceptsOnlyWholeNonNegativeNumbersAsTheSize() throws Exception {
        assertEquals(10L, PdfPreviewStore.declaredSize(10));
        assertEquals(10L, PdfPreviewStore.declaredSize(10.0));
        assertEquals(Long.MAX_VALUE, PdfPreviewStore.declaredSize(1e300));
        for (Object bad : new Object[] {null, "10", true, 1.5, -1, Double.NaN, Double.POSITIVE_INFINITY}) {
            assertEquals("invalid", code(() -> PdfPreviewStore.declaredSize(bad)));
        }
    }

    @Test public void acceptsOnlyCanonicalPaddedBase64Chunks() throws Exception {
        for (String good : new String[] {"AAAA", "AA==", "AAA=", "+/+/"}) PdfPreviewStore.checkChunk(good);
        String longest = "A".repeat(4 * ((PdfPreviewStore.MAX_CHUNK_BYTES + 2) / 3));
        PdfPreviewStore.checkChunk(longest);
        for (String bad : new String[] {null, "", "AAA", "A===", "AA=A", "=AAA", "AA-_", "AA\nA", longest + "AAAA"}) {
            assertEquals("invalid", code(() -> PdfPreviewStore.checkChunk(bad)));
        }
    }

    @Test public void emptiesTheDirectoryOnLaunch() throws Exception {
        File stale = new File(new File(root, "left-by-a-killed-process"), "x.pdf");
        assertTrue(stale.getParentFile().mkdirs());
        assertTrue(stale.createNewFile());
        assertTrue(new File(root, "loose").createNewFile());
        new PdfPreviewStore(root);
        assertEquals(0, root.listFiles().length);
    }

    @Test public void namesEndInPdfAndStayInTheirDirectory() {
        assertEquals("a.PDF", PdfPreviewStore.fileName("a.PDF"));
        assertEquals("notes.txt.pdf", PdfPreviewStore.fileName("notes.txt"));
        assertEquals("_.._x.pdf", PdfPreviewStore.fileName("/../x"));
        assertEquals("document.pdf", PdfPreviewStore.fileName(""));
        assertEquals("document.pdf", PdfPreviewStore.fileName("..."));
        String longName = PdfPreviewStore.fileName("é".repeat(200));
        assertTrue(longName.endsWith(".pdf"));
        assertTrue(longName.getBytes(StandardCharsets.UTF_8).length <= 255);
    }
}
