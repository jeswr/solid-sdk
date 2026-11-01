// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * Receives org.jeswr.suite: links. Android ignores intent-filter paths without a host, so the
 * filter matches the scheme only and this activity forwards nothing but the exact callback.
 */
public class AuthRedirectActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent().getData();
        if (data != null && RedirectPolicy.isAuthCallback(data.toString())) {
            Intent forward = new Intent(this, AuthManagementActivity.class)
                .setData(data)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(forward);
        }
        finish();
    }
}
