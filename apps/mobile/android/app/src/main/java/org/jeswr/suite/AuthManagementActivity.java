// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import androidx.browser.customtabs.CustomTabsIntent;

/**
 * Owns one sign-in transaction (DESIGN D4): idle -> browserOpen -> callback | cancelled.
 * Launches the Custom Tab on first resume; a later resume without a callback means the person
 * left the sign-in (USER_CANCELLED). Redirects reach it only through {@link AuthRedirectActivity}.
 */
public class AuthManagementActivity extends Activity {

    static final String EXTRA_AUTHORIZATION_URL = "org.jeswr.suite.AUTHORIZATION_URL";
    static final String EXTRA_CALLBACK_URL = "org.jeswr.suite.CALLBACK_URL";
    static final String ACTION_CANCEL = "org.jeswr.suite.CANCEL_SIGN_IN";
    static final int RESULT_NO_BROWSER = RESULT_FIRST_USER;
    private static final String STATE_BROWSER_OPEN = "browserOpen";

    private final AuthTransaction transaction = new AuthTransaction();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String url = getIntent().getStringExtra(EXTRA_AUTHORIZATION_URL);
        boolean restored = savedInstanceState != null && savedInstanceState.getBoolean(STATE_BROWSER_OPEN);
        if (!transaction.begin(url, restored)) {
            // Started by a stray redirect with no transaction, or without a URL: nothing to do.
            finish();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        switch (transaction.onResume()) {
            case LAUNCH_BROWSER:
                try {
                    new CustomTabsIntent.Builder().setShowTitle(true).build()
                        .launchUrl(this, Uri.parse(transaction.authorizationUrl()));
                } catch (ActivityNotFoundException e) {
                    transaction.cancel();
                    setResult(RESULT_NO_BROWSER);
                    finish();
                }
                break;
            case CANCELLED:
                setResult(RESULT_CANCELED);
                finish();
                break;
            case NONE:
            default:
                break;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (ACTION_CANCEL.equals(intent.getAction())) {
            if (transaction.cancel()) {
                setResult(RESULT_CANCELED);
                finish();
            }
            return;
        }
        Uri data = intent.getData();
        String callback = data == null ? null : data.toString();
        if (transaction.complete(callback)) {
            setResult(RESULT_OK, new Intent().putExtra(EXTRA_CALLBACK_URL, callback));
            finish();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean(STATE_BROWSER_OPEN, transaction.browserOpen());
    }
}
