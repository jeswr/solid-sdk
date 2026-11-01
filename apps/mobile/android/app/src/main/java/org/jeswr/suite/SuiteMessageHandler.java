// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.MessageHandler;
import com.getcapacitor.PluginHandle;
import org.json.JSONException;

/** Captures read admission inside Capacitor's origin/main-frame checked WebMessage listener. */
final class SuiteMessageHandler extends MessageHandler {
    private final Bridge bridge;

    SuiteMessageHandler(Bridge bridge, WebView webView) {
        // No Cordova plugins are used by this shell; their messages are refused below.
        super(bridge, webView, null);
        this.bridge = bridge;
    }

    @Override public void postMessage(String json) {
        // Capacitor 8.5.3's listener calls this synchronously on the UI thread, after its
        // isMainFrame check and WebView's allowed-origin rules. MainActivity narrows those rules
        // to the exact suite origin and removes any JavascriptInterface fallback before loading.
        // Do not post admission to taskHandler: a document commit could overtake it there.
        try {
            JSObject message = new JSObject(json);
            String type = message.getString("type");
            if ("cordova".equals(type) || "js.error".equals(type)) return;
            PluginHandle handle = bridge.getPlugin(message.getString("pluginId"));
            if (handle == null) return;
            if (handle.getInstance() instanceof SuiteSecureStorePlugin && "get".equals(message.getString("methodName"))) {
                JSObject options = message.getJSObject("options", new JSObject());
                // Use the same getString (null default) as MessageHandler's PluginCall creation.
                ((SuiteSecureStorePlugin) handle.getInstance()).admitRead(message.getString("callbackId"), options.opt("key"));
            }
            super.postMessage(json);
        } catch (JSONException ignored) { /* Malformed messages never reach the bridge. */ }
    }
}
