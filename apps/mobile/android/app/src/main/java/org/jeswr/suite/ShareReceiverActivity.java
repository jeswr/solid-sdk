// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Receives ACTION_SEND / ACTION_SEND_MULTIPLE from other apps (DESIGN D7). Streams each item into
 * the share store under its caps, then opens the suite. The activity stays alive while copying
 * because the sender's URI grants last only as long as it does.
 */
public class ShareReceiverActivity extends Activity {

    private static final ExecutorService COPIER = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            // Recreated after process death or a config change: the copy (if any) belongs to the old instance.
            finish();
            return;
        }
        Intent intent = getIntent();
        ContentResolver resolver = getContentResolver();
        COPIER.execute(() -> {
            boolean stored = false;
            try {
                List<ShareStore.Incoming> items = incoming(intent, resolver);
                ShareStore.Batch batch = SuiteShareIntakePlugin.store(this).store(items, System.currentTimeMillis());
                SuiteShareIntakePlugin.delivered(batch);
                stored = true;
            } catch (Exception e) {
                // RejectedShare, IOException or a SecurityException from the sender's provider.
            }
            boolean ok = stored;
            new Handler(Looper.getMainLooper()).post(() -> finishShare(ok));
        });
    }

    private void finishShare(boolean stored) {
        if (stored) {
            startActivity(new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        } else {
            Toast.makeText(getApplicationContext(), R.string.share_rejected, Toast.LENGTH_LONG).show();
        }
        finish();
    }

    private List<ShareStore.Incoming> incoming(Intent intent, ContentResolver resolver) throws Exception {
        List<ShareStore.Incoming> items = new ArrayList<>();
        String action = intent.getAction();
        List<Uri> streams = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = extraStream(intent);
            if (uri != null) streams.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> uris = extraStreams(intent);
            if (uris != null) streams.addAll(uris);
        } else {
            throw new ShareStore.RejectedShare("not a share");
        }
        if (streams.size() > ShareStore.MAX_ITEMS) throw new ShareStore.RejectedShare("too many items");
        for (Uri uri : streams) items.add(file(uri, resolver));
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text != null) {
            String value = text.toString();
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            String url = ShareStore.httpUrl(value);
            items.add(url != null ? ShareStore.Incoming.url(url, subject) : ShareStore.Incoming.text(value));
        }
        return items;
    }

    /** Opens a sender's content:// item. Our own providers are refused: no confused-deputy reads. */
    private ShareStore.Incoming file(Uri uri, ContentResolver resolver) throws Exception {
        if (!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme()) || uri.getAuthority() == null) {
            throw new ShareStore.RejectedShare("only content:// items are accepted");
        }
        ProviderInfo provider = getPackageManager().resolveContentProvider(uri.getAuthority(), 0);
        if (provider != null && getPackageName().equals(provider.packageName)) {
            throw new ShareStore.RejectedShare("item from this app's own provider");
        }
        String name = null;
        try (Cursor cursor = resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) name = cursor.getString(0);
        }
        return ShareStore.Incoming.file(name, resolver.getType(uri), () -> resolver.openInputStream(uri));
    }

    @SuppressWarnings("deprecation")
    private static Uri extraStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private static ArrayList<Uri> extraStreams(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }
}
