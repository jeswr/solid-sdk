// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Collections;

/** Keeps the main frame on the exact suite origin; other http(s)/mailto/tel links open outside. */
public class SuiteWebViewClient extends BridgeWebViewClient {

    private final NavigationPolicy policy;
    private final Bridge bridge;

    public SuiteWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        this.policy = new NavigationPolicy(bridge.getServerUrl());
    }

    /**
     * Android skips shouldOverrideUrlLoading for POST navigations, so a form could still replace the
     * main frame with a foreign page. Every main-frame load off the suite origin gets an empty 403.
     */
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (request.isForMainFrame() && !policy.staysInApp(request.getUrl().toString())) {
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String target = url.toString();
        if (request.isForMainFrame() && !policy.staysInApp(target)) {
            if (policy.mayOpenExternally(target)) {
                try {
                    bridge.getContext().startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException ignored) {
                    // Nothing can open it; the navigation is still blocked.
                }
            }
            return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
    }
}
