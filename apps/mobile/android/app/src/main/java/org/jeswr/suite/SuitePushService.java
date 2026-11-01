// AUTHORED-BY Codex GPT-6.1-Sol
package org.jeswr.suite;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.UserManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** FCM data only: no provider-rendered content. Unknown, disabled or invalid messages post nothing. */
public class SuitePushService extends FirebaseMessagingService {
    private static final String CHANNEL = "suite-activity";
    @Override public void onMessageReceived(RemoteMessage message) {
        UserManager users = getSystemService(UserManager.class);
        PushReceiver.Result result = PushReceiver.receive(message.getData().get("p"), users == null || users.isUserUnlocked(), encoded -> {
            PushKeys keys = new PushKeys(this, false);
            return PushCrypto.decrypt(encoded, keys.privateKey, keys.publicKey, keys.auth);
        }, () -> SuitePushPlugin.store(this));
        if (result.kind == PushReceiver.Kind.GENERIC) post("suite-generic", PushPolicy.GENERIC, 1, null, -1);
        else if (result.kind == PushReceiver.Kind.CHALLENGE) SuitePushPlugin.challenge(result.payload);
        else if (result.kind == PushReceiver.Kind.NOTIFY) {
            PushStore.Delivery delivery = result.delivery;
            try {
                SuitePushPlugin.store(this).withActive(result.payload, () ->
                    post(delivery.group, delivery.body, delivery.count, result.payload.registrationId, result.payload.topicIndex));
            } catch (Exception ignored) { /* Silence/storage failure wins over an in-flight notification. */ }
        }
    }
    @Override public void onDeletedMessages() { post("suite-generic", PushPolicy.GENERIC, 1, null, -1); }
    private void post(String tag, String body, int count, String registration, int topic) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, "Solid Suite activity", NotificationManager.IMPORTANCE_HIGH));
        Intent tap = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .setData(Uri.parse("suite-push:" + tag));
        if (registration != null) tap.putExtra("suitePushRegistration", registration).putExtra("suitePushTopic", topic);
        PendingIntent intent = PendingIntent.getActivity(this, 0, tap, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_push)
            .setContentTitle("Solid Suite").setContentText(count > 1 ? body + " (" + count + ")" : body).setNumber(count)
            .setAutoCancel(true).setContentIntent(intent).setPriority(NotificationCompat.PRIORITY_HIGH);
        // Explicit permission check above also covers lint's MissingPermission contract.
        NotificationManagerCompat.from(this).notify(tag, 0, notification.build());
    }
}
