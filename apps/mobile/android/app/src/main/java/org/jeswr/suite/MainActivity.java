// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.os.Bundle;
import android.view.Gravity;
import android.webkit.WebView;
import android.widget.TextView;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

/**
 * The suite shell. Registers the local plugins and refuses to start the Capacitor bridge on a
 * WebView without WEB_MESSAGE_LISTENER, because Capacitor would then fall back to
 * addJavascriptInterface, which exposes the bridge to every frame (DESIGN D3).
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SuiteAuthSessionPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView message = new TextView(this);
            message.setText(R.string.webview_too_old);
            message.setGravity(Gravity.CENTER);
            message.setPadding(48, 48, 48, 48);
            setContentView(message);
            return;
        }
        super.load();
        bridge.setWebViewClient(new SuiteWebViewClient(bridge));
        WebView webView = bridge.getWebView();
        // Capacitor's cookie and HTTP plugins install JavascriptInterfaces for every frame whatever
        // their config. The suite patches neither, so remove both and restart the first load so no
        // document sees them (DESIGN D3). The plugin bridge itself cannot fall back to an interface:
        // WEB_MESSAGE_LISTENER is checked above and the origin rules (local origin + server.url, a
        // validated bare origin, no allowNavigation) are always valid.
        for (String name : FRAME_INTERFACES) {
            webView.removeJavascriptInterface(name);
        }
        webView.stopLoading();
        webView.loadUrl(bridge.getAppUrl());
    }

    private static final String[] FRAME_INTERFACES = {
        "CapacitorCookiesAndroidInterface",
        "CapacitorHttpAndroidInterface",
    };
}
