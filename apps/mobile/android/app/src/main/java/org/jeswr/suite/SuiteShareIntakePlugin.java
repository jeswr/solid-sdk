// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.content.Context;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Hands share batches from {@link ShareReceiverActivity} to the suite (DESIGN D7). The batch JSON
 * is untrusted on the JavaScript side too: @jeswr/suite-native re-validates it.
 */
@CapacitorPlugin(name = "SuiteShareIntake")
public class SuiteShareIntakePlugin extends Plugin {

    private static ShareStore store;
    private static SuiteShareIntakePlugin active;

    static synchronized ShareStore store(Context context) {
        if (store == null) store = new ShareStore(new File(context.getApplicationContext().getCacheDir(), "share"));
        return store;
    }

    /** Tells a running suite that a batch arrived; otherwise it waits in getPending. */
    static synchronized void delivered(ShareStore.Batch batch) {
        if (active != null) active.notifyListeners("shareReceived", toJs(batch));
    }

    @Override
    public void load() {
        synchronized (SuiteShareIntakePlugin.class) {
            active = this;
        }
        ShareStore shares = store(getContext());
        // Off the main thread: eviction can wait for a share that is being stored.
        new Thread(() -> shares.evict(System.currentTimeMillis()), "share-evict").start();
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (SuiteShareIntakePlugin.class) {
            if (active == this) active = null;
        }
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSArray batches = new JSArray();
        for (ShareStore.Batch batch : store(getContext()).pending()) batches.put(toJs(batch));
        JSObject ret = new JSObject();
        ret.put("batches", batches);
        call.resolve(ret);
    }

    @PluginMethod
    public void readChunk(PluginCall call) {
        String batchId = call.getString("batchId");
        Integer index = call.getInt("index");
        // JSON numbers below 2^31 arrive as Integer, so getLong() would return null for them.
        Long offset = ShareStore.wholeNumber(call.getData().opt("offset"));
        Integer length = call.getInt("length");
        if (batchId == null || index == null || offset == null || length == null) {
            call.reject("batchId, index, offset and length are required", "INVALID_ARGUMENT");
            return;
        }
        try {
            ShareStore shares = store(getContext());
            byte[] bytes = shares.readChunk(batchId, index, offset, length);
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            ret.put("eof", shares.isEnd(batchId, index, offset + bytes.length));
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Cannot read the shared file", "NOT_FOUND");
        }
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        store(getContext()).acknowledge(call.getString("batchId"));
        call.resolve();
    }

    static JSObject toJs(ShareStore.Batch batch) {
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        JSArray items = new JSArray();
        for (int i = 0; i < batch.size(); i++) {
            JSObject item = new JSObject();
            String kind = batch.get(i, "kind");
            item.put("kind", kind);
            if ("file".equals(kind)) {
                item.put("name", batch.get(i, "name"));
                item.put("mimeType", batch.get(i, "mimeType"));
                item.put("size", Long.parseLong(batch.get(i, "size")));
            } else if ("url".equals(kind)) {
                item.put("url", batch.get(i, "url"));
                if (batch.get(i, "title") != null) item.put("title", batch.get(i, "title"));
            } else {
                item.put("text", batch.get(i, "text"));
            }
            items.put(item);
        }
        JSObject ret = new JSObject();
        ret.put("id", batch.id);
        ret.put("receivedAt", iso.format(new Date(batch.receivedAt)));
        ret.put("items", items);
        return ret;
    }
}
