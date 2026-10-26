// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AuthTransactionTest {

    private static final String AUTH = "https://idp.example/authorize";
    private static final String CALLBACK = "org.jeswr.suite:/oauth/callback?code=c&state=s";

    @Test
    public void opensTheBrowserOnceThenDeliversTheCallback() {
        AuthTransaction t = new AuthTransaction();
        assertTrue(t.begin(AUTH, false));
        assertEquals(AUTH, t.authorizationUrl());
        assertEquals(AuthTransaction.Action.LAUNCH_BROWSER, t.onResume());
        assertTrue(t.browserOpen());
        assertTrue(t.complete(CALLBACK));
        assertFalse(t.browserOpen());
        assertEquals(AuthTransaction.Action.NONE, t.onResume());
        assertFalse("a second callback is dropped", t.complete(CALLBACK));
    }

    @Test
    public void aResumeWithoutACallbackIsACancel() {
        AuthTransaction t = new AuthTransaction();
        t.begin(AUTH, false);
        t.onResume();
        assertEquals(AuthTransaction.Action.CANCELLED, t.onResume());
        assertFalse("late callbacks are dropped", t.complete(CALLBACK));
    }

    @Test
    public void rejectsForeignCallbacksAndCallbacksBeforeTheBrowser() {
        AuthTransaction t = new AuthTransaction();
        t.begin(AUTH, false);
        assertFalse(t.complete(CALLBACK));
        t.onResume();
        assertFalse(t.complete("org.jeswr.suite://evil/oauth/callback?code=c"));
        assertFalse(t.complete(null));
        assertTrue(t.complete(CALLBACK));
    }

    @Test
    public void cancelEndsAnOpenTransactionOnly() {
        AuthTransaction t = new AuthTransaction();
        assertFalse(t.cancel());
        t.begin(AUTH, false);
        assertTrue(t.cancel());
        assertFalse(t.cancel());
        assertEquals(AuthTransaction.Action.NONE, t.onResume());
        assertFalse(t.complete(CALLBACK));
    }

    @Test
    public void restoresAnOpenBrowserAfterRecreation() {
        AuthTransaction t = new AuthTransaction();
        assertTrue(t.begin(AUTH, true));
        assertTrue(t.browserOpen());
        assertTrue(t.complete(CALLBACK));
    }

    @Test
    public void needsAUrlAndStartsOnce() {
        AuthTransaction t = new AuthTransaction();
        assertFalse(t.begin(null, false));
        assertTrue(t.begin(AUTH, false));
        assertFalse(t.begin(AUTH, false));
    }
}
