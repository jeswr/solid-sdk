// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NavigationPolicyTest {

    private final NavigationPolicy policy = new NavigationPolicy("https://suite.example");

    @Test
    public void keepsOnlyTheExactSuiteOriginInApp() {
        assertTrue(policy.staysInApp("https://suite.example/drive"));
        assertTrue(policy.staysInApp("https://SUITE.example:443/docs?x#y"));
        assertFalse(policy.staysInApp("http://suite.example/drive"));
        assertFalse(policy.staysInApp("https://suite.example:8443/drive"));
        assertFalse(policy.staysInApp("https://evil.suite.example/"));
        assertFalse(policy.staysInApp("https://user@suite.example/"));
        assertFalse(policy.staysInApp("https://localhost/offline.html"));
        assertFalse(policy.staysInApp("data:text/html,hi"));
        assertFalse(policy.staysInApp(null));
        assertFalse(policy.staysInApp("::bad"));
    }

    @Test
    public void opensOnlySafeSchemesExternally() {
        assertTrue(policy.mayOpenExternally("https://example.org/"));
        assertTrue(policy.mayOpenExternally("http://example.org/"));
        assertTrue(policy.mayOpenExternally("mailto:a@example.org"));
        assertTrue(policy.mayOpenExternally("tel:+441234"));
        assertFalse(policy.mayOpenExternally("intent://scan/#Intent;scheme=zxing;end"));
        assertFalse(policy.mayOpenExternally("file:///data/data/org.jeswr.suite/x"));
        assertFalse(policy.mayOpenExternally("content://x/y"));
        assertFalse(policy.mayOpenExternally("javascript:alert(1)"));
        assertFalse(policy.mayOpenExternally("relative/path"));
        assertFalse(policy.mayOpenExternally("::bad"));
    }

    @Test
    public void normalisesOrigins() {
        assertEquals("http://localhost:80", NavigationPolicy.origin("http://localhost/"));
        assertEquals("http://127.0.0.1:3210", NavigationPolicy.origin("http://127.0.0.1:3210"));
        assertNull(NavigationPolicy.origin("ftp://example.org/"));
        assertNull(NavigationPolicy.origin("mailto:a@example.org"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsANonHttpServerUrl() {
        new NavigationPolicy("capacitor://localhost");
    }
}
