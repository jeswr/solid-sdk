// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native startup only. Validate the whole signed plan before opening any storage. */
final class SecureStoreMigration {
    interface Keys {
        List<String> aliases() throws Exception;
        void delete(String alias) throws Exception;
    }
    private final File root;
    private final Keys keys;
    private final SecureStoreFile.IO io;
    private static final String NOTICE = SecureStoreValidation.namespace("migration-notice-v1");

    SecureStoreMigration(File root, Keys keys) { this(root, keys, new SecureStoreFile.IO() {}); }
    SecureStoreMigration(File root, Keys keys, SecureStoreFile.IO io) {
        this.root = root; this.keys = keys; this.io = io;
    }

    static Set<String> origins(JSONObject info) throws Exception {
        if (!"native".equals(info.opt("target"))) throw new IOException("Invalid migration plan");
        Object raw = info.opt("predecessorOrigins");
        if (!(raw instanceof JSONArray) || ((JSONArray) raw).length() > 32) throw new IOException("Invalid migration plan");
        Set<String> result = new LinkedHashSet<>();
        JSONArray list = (JSONArray) raw;
        for (int i = 0; i < list.length(); i++) {
            Object value = list.get(i);
            if (!(value instanceof String)) throw new IOException("Invalid migration plan");
            String origin = (String) value;
            URI url = new URI(origin);
            String host = url.getHost();
            int port = url.getPort();
            String canonical = "https://" + host + (port == -1 ? "" : ":" + port);
            if (!"https".equals(url.getScheme()) || host == null || !host.equals(host.toLowerCase(java.util.Locale.ROOT))
                    || url.getRawUserInfo() != null || !url.getRawPath().isEmpty()
                    || url.getRawQuery() != null || url.getRawFragment() != null
                    || port == 0 || port == 443 || port > 65535 || !origin.equals(canonical)
                    || host.equals("localhost") || host.endsWith(".localhost")) throw new IOException("Invalid migration plan");
            result.add(origin);
        }
        return result;
    }

    private SecureStoreFile journal(String namespace) throws IOException {
        return new SecureStoreFile(new File(root, "securestore-migration"), namespace, io);
    }

    static boolean ownsAlias(String namespace, String alias) {
        return alias.startsWith("suite-securestore." + namespace + ".")
            || alias.startsWith("suite-securestore-gated." + namespace + ".");
    }

    void run(JSONObject info) throws Exception {
        Set<String> origins = origins(info); // No mutation on any invalid entry, even after valid entries.
        for (String origin : origins) {
            // S4 Android hashes the configured origin verbatim, just like SuiteSecureStorePlugin.
            String namespace = SecureStoreValidation.namespace(origin);
            File directory = new File(root, "securestore");
            List<File> files = new ArrayList<>();
            if (directory.exists()) {
                File[] entries = directory.listFiles();
                if (entries == null) throw new IOException("Migration failed");
                for (File file : entries) {
                    String name = file.getName();
                    if (name.equals(namespace + ".bin") || name.matches(namespace + "\\.bin[0-9]+\\.tmp")) files.add(file);
                }
            }
            List<String> aliases = new ArrayList<>();
            for (String alias : keys.aliases()) if (ownsAlias(namespace, alias)) aliases.add(alias);
            SecureStoreFile marker = journal(namespace);
            // Write intent before destroying the last artifact, so a killed process keeps the notice.
            boolean session = false;
            boolean hasState = false;
            for (File file : files) {
                if (!file.getName().equals(namespace + ".bin")) { session = true; continue; }
                hasState = true;
                try { session |= SecureStoreCodec.state(new SecureStoreFile(directory, namespace).read()).count() > 0; }
                catch (Exception e) { session = true; }
            }
            // An empty signed-out state may retain the reusable ungated encryption key.
            if (!hasState && !aliases.isEmpty()) session = true;
            if (session) journal(NOTICE).commit(new byte[] {1});
            for (File file : files) if (!file.delete() && file.exists()) throw new IOException("Migration failed");
            for (String alias : aliases) keys.delete(alias);
            for (File file : files) if (file.exists()) throw new IOException("Migration failed");
            for (String alias : keys.aliases()) if (ownsAlias(namespace, alias)) throw new IOException("Migration failed");
            // Never trust this marker to skip artifacts: a prior run may have been interrupted.
            marker.commit(new byte[] {1});
        }
    }

    synchronized boolean takeNotice() throws IOException {
        SecureStoreFile notice = journal(NOTICE);
        byte[] value = notice.read();
        if (value == null) return false;
        if (value.length != 1 || (value[0] != 0 && value[0] != 1)) throw new IOException("Migration failed");
        if (value[0] == 0) return false;
        notice.commit(new byte[] {0});
        return true;
    }
}
