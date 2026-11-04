// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;

/**
 * The Drive "Open PDF" handoff (MOB-P3 E5): base64 chunks into {@link PdfPreviewStore}, then an
 * ACTION_VIEW intent with a read-only FileProvider URI. Only bytes and a display name cross.
 */
@CapacitorPlugin(name = "SuiteFiles")
public class SuiteFilesPlugin extends Plugin {
    // One store per process: a recreated activity must not delete a file an external viewer reads.
    // The store empties the directory when first created, which clears what a killed process left.
    private static PdfPreviewStore store;

    @Override
    public void load() {
        try {
            store();
        } catch (IOException ignored) {
            // Each call retries and fails closed.
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        try {
            store().sweep(SystemClock.elapsedRealtime());
        } catch (IOException ignored) {
            // The next begin or launch empties the directory.
        }
    }

    private PdfPreviewStore store() throws IOException {
        synchronized (SuiteFilesPlugin.class) {
            if (store == null) store = new PdfPreviewStore(new File(getContext().getCacheDir(), "pdf-preview"));
            return store;
        }
    }

    @PluginMethod
    public void pdfBegin(PluginCall call) {
        try {
            long size = PdfPreviewStore.declaredSize(call.getData().opt("size"));
            String handle = store().begin(call.getString("name"), size, SystemClock.elapsedRealtime());
            JSObject result = new JSObject();
            result.put("handle", handle);
            call.resolve(result);
        } catch (PdfPreviewStore.Refused e) {
            call.reject("Cannot preview this PDF", e.code);
        } catch (IOException | RuntimeException e) {
            call.reject("Cannot preview this PDF", "failed");
        }
    }

    @PluginMethod
    public void pdfChunk(PluginCall call) {
        try {
            String data = call.getString("data");
            PdfPreviewStore.checkChunk(data);
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            store().append(call.getString("handle"), bytes, SystemClock.elapsedRealtime());
            call.resolve();
        } catch (PdfPreviewStore.Refused e) {
            // The store already discarded a live transfer it refused; a stale handle changes nothing.
            call.reject("Cannot preview this PDF", e.code);
        } catch (IOException | RuntimeException e) {
            discard(call.getString("handle"), false);
            call.reject("Cannot preview this PDF", "failed");
        }
    }

    @PluginMethod
    public void pdfOpen(PluginCall call) {
        try {
            File file = store().finish(call.getString("handle"), SystemClock.elapsedRealtime());
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/pdf")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (view.resolveActivity(getContext().getPackageManager()) == null) {
                discard(call.getString("handle"), true);
                call.reject("No PDF viewer is installed", "no-viewer");
                return;
            }
            getActivity().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            discard(call.getString("handle"), true);
            call.reject("No PDF viewer is installed", "no-viewer");
        } catch (PdfPreviewStore.Refused e) {
            call.reject("Cannot preview this PDF", e.code);
        } catch (IOException | RuntimeException e) {
            discard(call.getString("handle"), true);
            call.reject("Cannot preview this PDF", "failed");
        }
    }

    /**
     * Sign-out or account switch (sst-8wx.18): drops any transfer and deletes every preview file,
     * so the next account never sees them. An external viewer keeps only what it already read.
     */
    @PluginMethod
    public void pdfClear(PluginCall call) {
        try {
            store().clear();
            call.resolve();
        } catch (IOException | RuntimeException e) {
            call.reject("Cannot clear PDF previews", "failed");
        }
    }

    /**
     * Discards the live preview named by {@code handle}: an unfinished transfer, or with
     * {@code finished} also a finished file no viewer took. Other handles change nothing.
     */
    private void discard(String handle, boolean finished) {
        try {
            if (finished) store().release(handle);
            else store().discard(handle);
        } catch (IOException ignored) {
            // The next launch empties the directory.
        }
    }
}
