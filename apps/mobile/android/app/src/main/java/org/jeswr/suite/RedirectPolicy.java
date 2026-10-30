// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import java.net.URI;
import java.net.URISyntaxException;

/** The only redirect the app accepts: org.jeswr.suite:/oauth/callback (DESIGN D5). */
public final class RedirectPolicy {

    public static final String SCHEME = "org.jeswr.suite";
    public static final String PATH = "/oauth/callback";

    private RedirectPolicy() {}

    /** Exact scheme, no authority (empty host), path /oauth/callback, no fragment. */
    public static boolean isAuthCallback(String url) {
        if (url == null) return false;
        try {
            URI uri = new URI(url);
            String authority = uri.getRawAuthority();
            return (
                SCHEME.equals(uri.getScheme()) &&
                !uri.isOpaque() &&
                (authority == null || authority.isEmpty()) &&
                PATH.equals(uri.getRawPath()) &&
                uri.getRawFragment() == null
            );
        } catch (URISyntaxException e) {
            return false;
        }
    }

    /** Authorization URLs must be https; http only for loopback hosts in debug builds. */
    public static boolean isAuthorizationUrl(String url, boolean allowLoopback) {
        if (url == null) return false;
        try {
            URI uri = new URI(url);
            if (uri.getHost() == null || uri.getRawUserInfo() != null) return false;
            if ("https".equals(uri.getScheme())) return true;
            String host = uri.getHost();
            return (
                allowLoopback &&
                "http".equals(uri.getScheme()) &&
                (host.equals("localhost") || host.equals("127.0.0.1"))
            );
        } catch (URISyntaxException e) {
            return false;
        }
    }
}
