// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RedirectPolicyTest {

    @Test
    public void acceptsOnlyTheExactCallback() {
        assertTrue(RedirectPolicy.isAuthCallback("org.jeswr.suite:/oauth/callback?code=c&state=s"));
        assertTrue(RedirectPolicy.isAuthCallback("org.jeswr.suite:///oauth/callback?code=c"));
        assertFalse(RedirectPolicy.isAuthCallback(null));
        assertFalse(RedirectPolicy.isAuthCallback("org.jeswr.suite://evil/oauth/callback?code=c"));
        assertFalse(RedirectPolicy.isAuthCallback("org.jeswr.suite:/oauth/callback/x?code=c"));
        assertFalse(RedirectPolicy.isAuthCallback("org.jeswr.suite:/oauth/callback#code=c"));
        assertFalse(RedirectPolicy.isAuthCallback("org.jeswr.suite:oauth/callback"));
        assertFalse(RedirectPolicy.isAuthCallback("ORG.JESWR.SUITE:/oauth/callback"));
        assertFalse(RedirectPolicy.isAuthCallback("org.jeswr.evil:/oauth/callback"));
        assertFalse(RedirectPolicy.isAuthCallback("https://suite.example/oauth/callback"));
        assertFalse(RedirectPolicy.isAuthCallback("org.jeswr.suite:/oauth/%63allback"));
        assertFalse(RedirectPolicy.isAuthCallback("not a uri"));
    }

    @Test
    public void authorizationUrlsMustBeHttps() {
        assertTrue(RedirectPolicy.isAuthorizationUrl("https://idp.example/authorize?x=1", false));
        assertFalse(RedirectPolicy.isAuthorizationUrl(null, false));
        assertFalse(RedirectPolicy.isAuthorizationUrl("http://idp.example/authorize", true));
        assertFalse(RedirectPolicy.isAuthorizationUrl("https://u:p@idp.example/authorize", false));
        assertFalse(RedirectPolicy.isAuthorizationUrl("javascript:alert(1)", false));
        assertFalse(RedirectPolicy.isAuthorizationUrl("http://localhost:3000/.oidc/auth", false));
        assertTrue(RedirectPolicy.isAuthorizationUrl("http://localhost:3000/.oidc/auth", true));
        assertTrue(RedirectPolicy.isAuthorizationUrl("http://127.0.0.1:3000/.oidc/auth", true));
        assertFalse(RedirectPolicy.isAuthorizationUrl("http://10.0.2.2:3000/.oidc/auth", true));
        assertFalse(RedirectPolicy.isAuthorizationUrl("not a uri", true));
    }
}
