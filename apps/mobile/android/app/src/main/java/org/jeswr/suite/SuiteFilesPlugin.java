// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
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
    private PdfPreviewStore store;

    @Override
    public void load() {
        try {
            store();
        } catch (IOException ignored) {
            // Each call retries and fails closed.
        }
    }

    private synchronized PdfPreviewStore store() throws IOException {
        if (store == null) store = new PdfPreviewStore(new File(getContext().getCacheDir(), "pdf-preview"));
        return store;
    }

    @PluginMethod
    public void pdfBegin(PluginCall call) {
        try {
            Object raw = call.getData().opt("size");
            if (!(raw instanceof Number)) throw new PdfPreviewStore.Refused("invalid");
            double size = ((Number) raw).doubleValue();
            if (!Double.isFinite(size) || size != Math.floor(size) || size < 0) throw new PdfPreviewStore.Refused("invalid");
            String handle = store().begin(call.getString("name"), size > Long.MAX_VALUE ? Long.MAX_VALUE : (long) size,
                System.currentTimeMillis());
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
            if (data == null || data.length() > 4 * ((PdfPreviewStore.MAX_CHUNK_BYTES + 2) / 3) ||
                data.length() % 4 != 0 || !data.matches("[A-Za-z0-9+/]*={0,2}")) {
                throw new PdfPreviewStore.Refused("invalid");
            }
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            store().append(call.getString("handle"), bytes, System.currentTimeMillis());
            call.resolve();
        } catch (PdfPreviewStore.Refused e) {
            discard();
            call.reject("Cannot preview this PDF", e.code);
        } catch (IOException | RuntimeException e) {
            discard();
            call.reject("Cannot preview this PDF", "failed");
        }
    }

    @PluginMethod
    public void pdfOpen(PluginCall call) {
        try {
            File file = store().finish(call.getString("handle"), System.currentTimeMillis());
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/pdf")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (view.resolveActivity(getContext().getPackageManager()) == null) {
                discard();
                call.reject("No PDF viewer is installed", "no-viewer");
                return;
            }
            getActivity().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            discard();
            call.reject("No PDF viewer is installed", "no-viewer");
        } catch (PdfPreviewStore.Refused e) {
            discard();
            call.reject("Cannot preview this PDF", e.code);
        } catch (IOException | RuntimeException e) {
            discard();
            call.reject("Cannot preview this PDF", "failed");
        }
    }

    private void discard() {
        try {
            store().clear();
        } catch (IOException ignored) {
            // The next launch empties the directory.
        }
    }
}
