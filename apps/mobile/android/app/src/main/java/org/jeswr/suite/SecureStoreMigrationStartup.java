// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import android.content.Context;
import com.getcapacitor.CapConfig;
import java.io.InputStream;
import java.security.KeyStore;
import java.util.Collections;
import java.util.List;
import org.json.JSONObject;

/** Called before BridgeActivity.load; never registered as a Capacitor plugin. */
final class SecureStoreMigrationStartup {
    private static SecureStoreMigration migration;

    static synchronized void prepare(Context context, CapConfig config) throws Exception {
        if (config.getServerUrl() != null) return; // Remote builds never migrate.
        if (!"https".equals(config.getAndroidScheme()) || !"localhost".equals(config.getHostname()))
            throw new IllegalStateException("Invalid bundled origin");
        JSONObject info;
        try (InputStream in = context.getAssets().open("public/build-info.json")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = in.read(buffer)) != -1) {
                if (bytes.size() + count > 65536) throw new java.io.IOException("Invalid migration plan");
                bytes.write(buffer, 0, count);
            }
            info = new JSONObject(SecureStoreValidation.utf8(bytes.toByteArray()));
        }
        SecureStoreMigration.origins(info); // Validate before even opening Keystore.
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        SecureStoreMigration next = new SecureStoreMigration(context.getNoBackupFilesDir(), new SecureStoreMigration.Keys() {
            public List<String> aliases() throws Exception { return Collections.list(keys.aliases()); }
            public void delete(String alias) throws Exception { keys.deleteEntry(alias); }
        });
        next.run(info);
        migration = next;
    }

    static synchronized boolean takeNotice(boolean bundled) throws Exception {
        return bundled && migration != null && migration.takeNotice();
    }
}
