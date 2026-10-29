// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import org.json.JSONArray;

/** Thin bridge over the plain-Java store. Only bytes and display metadata enter native code. */
@CapacitorPlugin(name = "SuiteShareStaging")
public class SuiteShareStagingPlugin extends Plugin {
    private ShareOutStore store;

    @Override
    public void load() {
        try { store().evict(System.currentTimeMillis()); }
        catch (IOException ignored) { /* Subsequent calls fail closed and retry. */ }
    }

    private synchronized ShareOutStore store() throws IOException {
        if (store == null) store = new ShareOutStore(new File(getContext().getCacheDir(), "share-out"));
        return store;
    }

    private static long integer(PluginCall call, String key) throws IOException {
        return ShareOutStore.integer(call.getData().opt(key));
    }

    /** JSON arrays become Object[] for ShareOutStore.keepIds; any other value is rejected there. */
    private static Object keepValue(Object raw) {
        if (!(raw instanceof JSONArray)) return raw;
        JSONArray list = (JSONArray) raw;
        if (list.length() >= ShareOutStore.MAX_FILES) return raw;
        Object[] values = new Object[list.length()];
        for (int i = 0; i < values.length; i++) values[i] = list.opt(i);
        return values;
    }

    @PluginMethod
    public void begin(PluginCall call) {
        try {
            String id = store().begin(call.getString("name"), call.getString("mimeType"), integer(call, "size"),
                ShareOutStore.keepIds(keepValue(call.getData().opt("keep"))), System.currentTimeMillis());
            JSObject result = new JSObject();
            result.put("stagingId", id);
            call.resolve(result);
        } catch (IOException | RuntimeException e) { call.reject("Cannot begin staging", "INVALID_ARGUMENT"); }
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String id = call.getString("stagingId");
        try {
            String data = call.getString("data");
            ShareOutStore.checkEncodedChunk(data);
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            if (!Base64.encodeToString(bytes, Base64.NO_WRAP).equals(data)) throw new IOException("Noncanonical base64");
            store().writeChunk(id, integer(call, "offset"), bytes, System.currentTimeMillis());
            call.resolve();
        } catch (IOException | RuntimeException e) { fail(call, id); }
    }

    @PluginMethod
    public void commit(PluginCall call) {
        String id = call.getString("stagingId");
        try {
            File file = store().commit(id, System.currentTimeMillis());
            JSObject result = new JSObject();
            // SharePlugin.shareFiles accepts file: and creates the content: URI itself.
            result.put("uri", Uri.fromFile(file).toString());
            call.resolve(result);
        } catch (IOException | RuntimeException e) { fail(call, id); }
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String id = call.getString("stagingId");
        if (!ShareOutStore.isId(id)) { call.reject("Invalid staging id", "INVALID_ARGUMENT"); return; }
        try { store().abort(id); call.resolve(); }
        catch (IOException e) { call.reject("Cannot abort staging", "STAGING_FAILED"); }
    }

    private void fail(PluginCall call, String id) {
        try { store().abort(id); } catch (IOException ignored) { /* Retention retries cleanup. */ }
        call.reject("Cannot stage file", "STAGING_FAILED");
    }
}
