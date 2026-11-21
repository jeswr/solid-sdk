// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class SecureStoreMigrationTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private final String oldOrigin = "https://old.example";
    private final String old = SecureStoreValidation.namespace(oldOrigin);
    private final String unlisted = SecureStoreValidation.namespace("https://unlisted.example");
    private final String local = SecureStoreValidation.namespace("https://localhost");

    private static final class Keys implements SecureStoreMigration.Keys {
        final List<String> entries = new ArrayList<>();
        int deleted;
        int failAfter = -1;
        boolean ignoreDeletion;
        boolean failEnumeration;
        public List<String> aliases() throws Exception {
            if (failEnumeration) throw new IOException("failed");
            return new ArrayList<>(entries);
        }
        public void delete(String alias) throws Exception {
            if (!ignoreDeletion) entries.remove(alias);
            if (++deleted == failAfter) throw new IOException("interrupted");
        }
    }
    private JSONObject info(Object... entries) throws Exception {
        return new JSONObject().put("target", "native").put("predecessorOrigins", new JSONArray(Arrays.asList(entries)));
    }
    private File state(File root, String namespace) { return new File(root, "securestore/" + namespace + ".bin"); }
    private void write(File file, byte[] bytes) throws Exception {
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), bytes);
    }
    private Keys seeded(File root) throws Exception {
        Keys keys = new Keys();
        keys.entries.add("suite-securestore." + old + ".ungated");
        keys.entries.add("suite-securestore-gated." + old + ".key");
        keys.entries.add("suite-securestore." + local + ".ungated");
        keys.entries.add("suite-securestore." + old + "0.neighbour");
        keys.entries.add("unrelated");
        write(state(root, old), SecureStoreCodec.state(new SecureStoreState().write("pod-auth:refresh:a", new byte[] {42})));
        write(state(root, local), new byte[] {43});
        write(state(root, unlisted), new byte[] {46});
        write(new File(root, "share/pending/item"), new byte[] {44});
        return keys;
    }
    private void survivors(File root, Keys keys) throws Exception {
        assertArrayEquals(new byte[] {46}, Files.readAllBytes(state(root, unlisted).toPath()));
        assertArrayEquals(new byte[] {43}, Files.readAllBytes(state(root, local).toPath()));
        assertArrayEquals(new byte[] {44}, Files.readAllBytes(new File(root, "share/pending/item").toPath()));
        assertTrue(keys.entries.contains("suite-securestore." + local + ".ungated"));
        assertTrue(keys.entries.contains("suite-securestore." + old + "0.neighbour"));
        assertTrue(keys.entries.contains("unrelated"));
    }
    private void removed(File root, Keys keys) {
        assertFalse(state(root, old).exists());
        for (String key : keys.entries) assertFalse(SecureStoreMigration.ownsAlias(old, key));
        assertTrue(new File(root, "securestore-migration/" + old + ".bin").isFile());
    }

    @Test public void exactScopeDedupeAndOneShotAcrossRestarts() throws Exception {
        File root = temporary.newFolder();
        Keys keys = seeded(root);
        SecureStoreMigration migration = new SecureStoreMigration(root, keys);
        migration.run(info(oldOrigin, oldOrigin));
        assertEquals(2, keys.deleted);
        removed(root, keys); survivors(root, keys);
        assertTrue(new SecureStoreMigration(root, keys).takeNotice());
        migration.run(info(oldOrigin));
        assertFalse(new SecureStoreMigration(root, keys).takeNotice());
        survivors(root, keys);
    }

    @Test public void resumesEveryCombinationOfMissingArtifactsEvenWithMarker() throws Exception {
        for (int mask = 0; mask < 16; mask++) {
            File root = temporary.newFolder();
            Keys keys = seeded(root);
            File pending = new File(root, "securestore/" + old + ".bin123.tmp");
            write(pending, new byte[] {45});
            if ((mask & 1) != 0) state(root, old).delete();
            if ((mask & 2) != 0) keys.entries.remove("suite-securestore." + old + ".ungated");
            if ((mask & 4) != 0) keys.entries.remove("suite-securestore-gated." + old + ".key");
            if ((mask & 8) != 0) pending.delete();
            write(new File(root, "securestore-migration/" + old + ".bin"), new byte[] {1});
            SecureStoreMigration migration = new SecureStoreMigration(root, keys);
            migration.run(info(oldOrigin));
            removed(root, keys); survivors(root, keys);
            assertFalse(pending.exists());
            assertEquals(mask != 15, migration.takeNotice());
            migration.run(info(oldOrigin));
            assertFalse(migration.takeNotice());
        }
    }

    @Test public void malformedWholePlanMutatesNothing() throws Exception {
        Object[] invalid = {"http://old.example", "https://old.example/", "https://old.example/path",
            "https://a@old.example", "https://old.example?", "https://old.example#", "https://old.example:443",
            "https://old.example:0", "https://old.example:65536", "https://OLD.example", "https://localhost",
            "https://localhost:8443", "https://a.localhost", "capacitor://localhost", "https://old.example\\path",
            " https://old.example", "https://old.example\n", "https://old.example/../", "https://old example", "https://", "https://%65vil.example", "", 5, JSONObject.NULL, new JSONObject()};
        for (Object value : invalid) {
            File root = temporary.newFolder();
            Keys keys = seeded(root);
            try { new SecureStoreMigration(root, keys).run(info(oldOrigin, value)); fail("invalid plan admitted"); }
            catch (Exception expected) { }
            assertEquals(0, keys.deleted);
            assertTrue(state(root, old).exists());
            assertFalse(new File(root, "securestore-migration").exists());
            survivors(root, keys);
        }
        for (JSONObject plan : Arrays.asList(new JSONObject(), info().put("target", "web"), info().put("predecessorOrigins", "origin"), info().put("predecessorOrigins", new JSONArray(java.util.Collections.nCopies(33, oldOrigin))))) {
            File root = temporary.newFolder(); Keys keys = seeded(root);
            try { new SecureStoreMigration(root, keys).run(plan); fail("invalid plan admitted"); }
            catch (Exception expected) { }
            assertTrue(state(root, old).exists()); assertEquals(0, keys.deleted);
        }
    }

    @Test public void interruptionAfterEachKeyDeletionKeepsNoticeUntilSuccessfulStartup() throws Exception {
        for (int after = 1; after <= 2; after++) {
            File root = temporary.newFolder(); Keys keys = seeded(root); keys.failAfter = after;
            try { new SecureStoreMigration(root, keys).run(info(oldOrigin)); fail("not interrupted"); }
            catch (IOException expected) { }
            assertFalse(new File(root, "securestore-migration/" + old + ".bin").exists());
            keys.failAfter = -1;
            SecureStoreMigration resumed = new SecureStoreMigration(root, keys);
            resumed.run(info(oldOrigin)); removed(root, keys); survivors(root, keys);
            assertTrue(resumed.takeNotice()); assertFalse(resumed.takeNotice());
        }
    }

    @Test public void failedNoticeWriteDeletesNothingAndFailedMarkerResumesAfterLastArtifact() throws Exception {
        for (int failOn = 1; failOn <= 2; failOn++) {
            File root = temporary.newFolder(); Keys keys = seeded(root);
            final int target = failOn;
            SecureStoreFile.IO io = new SecureStoreFile.IO() {
                int writes;
                @Override public boolean rename(File from, File to) { return ++writes != target && from.renameTo(to); }
            };
            try { new SecureStoreMigration(root, keys, io).run(info(oldOrigin)); fail("not interrupted"); }
            catch (IOException expected) { }
            if (failOn == 1) { assertTrue(state(root, old).exists()); assertEquals(0, keys.deleted); }
            SecureStoreMigration resumed = new SecureStoreMigration(root, keys);
            resumed.run(info(oldOrigin)); removed(root, keys); survivors(root, keys);
            assertTrue(resumed.takeNotice());
        }
    }

    @Test public void freshInstallEmptyListAndTombstonesNeverNotify() throws Exception {
        File root = temporary.newFolder(); Keys keys = new Keys();
        SecureStoreMigration migration = new SecureStoreMigration(root, keys);
        migration.run(info()); assertFalse(migration.takeNotice());
        write(state(root, old), SecureStoreCodec.state(new SecureStoreState()));
        keys.entries.add("suite-securestore." + old + ".ungated");
        migration.run(info(oldOrigin)); assertFalse(migration.takeNotice());
        assertFalse(state(root, old).exists());
        write(state(root, old), SecureStoreCodec.state(new SecureStoreState()));
        keys.entries.add("suite-securestore." + old + ".ungated");
        migration.run(info(oldOrigin)); assertFalse(migration.takeNotice());
        assertTrue(keys.entries.isEmpty());
        migration.run(info(oldOrigin)); assertFalse(migration.takeNotice());
    }

    @Test public void keyAndFileFailuresDoNotPublishCompletion() throws Exception {
        File root = temporary.newFolder(); Keys keys = seeded(root); keys.ignoreDeletion = true;
        try { new SecureStoreMigration(root, keys).run(info(oldOrigin)); fail(); } catch (IOException expected) { }
        assertFalse(new File(root, "securestore-migration/" + old + ".bin").exists());
        root = temporary.newFolder(); keys = seeded(root); keys.failEnumeration = true;
        try { new SecureStoreMigration(root, keys).run(info(oldOrigin)); fail(); } catch (IOException expected) { }
        assertTrue(state(root, old).exists());
        assertFalse(new File(root, "securestore-migration").exists());
        root = temporary.newFolder(); keys = seeded(root);
        state(root, old).delete(); state(root, old).mkdir(); write(new File(state(root, old), "child"), new byte[]{1});
        try { new SecureStoreMigration(root, keys).run(info(oldOrigin)); fail(); } catch (IOException expected) { }
        assertEquals(0, keys.deleted);
        assertFalse(new File(root, "securestore-migration/" + old + ".bin").exists());
    }

    @Test public void failedNoticeConsumptionStaysPendingAndMalformedJournalFailsClosed() throws Exception {
        File root = temporary.newFolder(); Keys keys = seeded(root);
        SecureStoreMigration migration = new SecureStoreMigration(root, keys);
        migration.run(info(oldOrigin));
        SecureStoreFile.IO failing = new SecureStoreFile.IO() {
            @Override public boolean rename(File from, File to) { return false; }
        };
        try { new SecureStoreMigration(root, keys, failing).takeNotice(); fail(); } catch (IOException expected) { }
        assertTrue(migration.takeNotice()); assertFalse(migration.takeNotice());
        File notice = new File(root, "securestore-migration/" + SecureStoreValidation.namespace("migration-notice-v1") + ".bin");
        for (byte[] bytes : new byte[][] {new byte[0], new byte[]{2}, new byte[]{1, 0}}) {
            write(notice, bytes);
            try { migration.takeNotice(); fail(); } catch (IOException expected) { }
            assertArrayEquals(bytes, Files.readAllBytes(notice.toPath()));
        }
    }

    @Test public void corruptStateStillNotifiesWithoutKeysOrDecryption() throws Exception {
        File root = temporary.newFolder(); Keys keys = new Keys();
        write(state(root, old), new byte[] {42});
        SecureStoreMigration migration = new SecureStoreMigration(root, keys);
        migration.run(info(oldOrigin));
        assertFalse(state(root, old).exists());
        assertTrue(migration.takeNotice());
        assertFalse(migration.takeNotice());
    }

    @Test public void multiplePredecessorsUseTheirOwnNamespaceAndConsumptionFailureRetainsNotice() throws Exception {
        File root = temporary.newFolder(); Keys keys = seeded(root);
        String otherOrigin = "https://other.example:8443";
        String other = SecureStoreValidation.namespace(otherOrigin);
        write(state(root, other), new byte[] {47});
        keys.entries.add("suite-securestore-gated." + other + ".key");
        SecureStoreMigration migration = new SecureStoreMigration(root, keys);
        migration.run(info(oldOrigin, otherOrigin));
        removed(root, keys); survivors(root, keys);
        assertFalse(state(root, other).exists());
        for (String alias : keys.entries) assertFalse(SecureStoreMigration.ownsAlias(other, alias));
        SecureStoreFile.IO failing = new SecureStoreFile.IO() {
            @Override public boolean rename(File from, File to) { return false; }
        };
        try { new SecureStoreMigration(root, keys, failing).takeNotice(); fail(); } catch (IOException expected) { }
        assertTrue(migration.takeNotice()); assertFalse(migration.takeNotice());
    }

}

