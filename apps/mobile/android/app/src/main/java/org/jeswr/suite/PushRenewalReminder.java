// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** One private, replaceable P7 notice. Inexact alarms need no exact-alarm permission. */
public final class PushRenewalReminder extends BroadcastReceiver {
    private static final String TAG = "suite-push-renewal";
    private static final String CHANNEL = "suite-renewal";
    static void schedule(Context context, Long expiry) throws java.io.IOException {
        SuitePushPlugin.store(context).setRenewalExpiry(expiry);
        Intent alarm = new Intent(context, PushRenewalReminder.class).putExtra("expiresAt", expiry == null ? 0L : expiry);
        PendingIntent pending = PendingIntent.getBroadcast(context, 0, alarm, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        alarms.cancel(pending);
        NotificationManagerCompat.from(context).cancel(TAG, 0);
        long now = System.currentTimeMillis();
        if (expiry != null && PushPolicy.renewalTrigger(expiry, now) < expiry)
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, PushPolicy.renewalTrigger(expiry, now), pending);
    }
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            try {
                PushStore store = SuitePushPlugin.store(context);
                Long expiry = store.renewalExpiry();
                if (expiry != null && expiry > System.currentTimeMillis() && store.withAnyActive(() -> {})) schedule(context, expiry);
            } catch (Exception ignored) { /* Next app resume retries unreadable state. */ }
            return;
        }
        long expiry = intent.getLongExtra("expiresAt", 0);
        try {
            SuitePushPlugin.store(context).withRenewalReminder(expiry, System.currentTimeMillis(), () -> post(context));
        } catch (Exception ignored) { /* Missing/corrupt/silenced state never produces a notice. */ }
    }
    private static void post(Context context) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, "Solid Suite notification renewal", NotificationManager.IMPORTANCE_DEFAULT));
        Intent tap = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .setData(Uri.parse("suite-push:renewal")).putExtra("suitePushRenewal", true);
        PendingIntent pending = PendingIntent.getActivity(context, 0, tap, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notice = new NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_push)
            .setContentTitle("Solid Suite").setContentText(PushPolicy.RENEWAL).setAutoCancel(true).setContentIntent(pending);
        NotificationManagerCompat.from(context).notify(TAG, 0, notice.build());
    }
}
