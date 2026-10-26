// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Pure main-frame navigation rules (java.net.URI only, so plain JVM tests cover it). */
public final class NavigationPolicy {

    private final String suiteOrigin;
    private final String errorPage;

    public NavigationPolicy(String suiteUrl) {
        this(suiteUrl, null);
    }

    /** {@code errorUrl} is Capacitor's local offline page (https://localhost/offline.html), or null. */
    public NavigationPolicy(String suiteUrl, String errorUrl) {
        this.suiteOrigin = origin(suiteUrl);
        if (this.suiteOrigin == null) {
            throw new IllegalArgumentException("server.url must be an http(s) URL");
        }
        this.errorPage = page(errorUrl);
    }

    /**
     * True when a main-frame load may proceed: GET only (POST responses can redirect anywhere
     * without passing shouldOverrideUrlLoading), to the suite origin or exactly the offline page.
     */
    public boolean allowsMainFrameLoad(String url, String method) {
        if (!"GET".equals(method)) return false;
        return staysInApp(url) || isErrorPage(url);
    }

    /** True for exactly the offline page, ignoring query and fragment. */
    public boolean isErrorPage(String url) {
        String target = page(url);
        return errorPage != null && errorPage.equals(target);
    }

    /** True when the main frame may navigate to {@code url} inside the app WebView. */
    public boolean staysInApp(String url) {
        String target = origin(url);
        return target != null && target.equals(suiteOrigin);
    }

    /** True for links that may be handed to another app: http(s), mailto and tel only. */
    public boolean mayOpenExternally(String url) {
        try {
            String scheme = new URI(url).getScheme();
            if (scheme == null) return false;
            scheme = scheme.toLowerCase(Locale.ROOT);
            return scheme.equals("https") || scheme.equals("http") || scheme.equals("mailto") || scheme.equals("tel");
        } catch (URISyntaxException e) {
            return false;
        }
    }

    /** origin + raw path, or null when not an http(s) URL. */
    static String page(String url) {
        String origin = origin(url);
        if (origin == null) return null;
        try {
            String path = new URI(url).getRawPath();
            return origin + (path == null || path.isEmpty() ? "/" : path);
        } catch (URISyntaxException e) {
            return null;
        }
    }

    /** scheme://host:port with the default port made explicit, or null when not http(s). */
    static String origin(String url) {
        if (url == null) return null;
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || uri.getRawUserInfo() != null) return null;
            scheme = scheme.toLowerCase(Locale.ROOT);
            int port = uri.getPort();
            if (scheme.equals("https")) {
                port = port == -1 ? 443 : port;
            } else if (scheme.equals("http")) {
                port = port == -1 ? 80 : port;
            } else {
                return null;
            }
            return scheme + "://" + host.toLowerCase(Locale.ROOT) + ":" + port;
        } catch (URISyntaxException e) {
            return null;
        }
    }
}
