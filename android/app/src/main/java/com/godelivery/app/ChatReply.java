package com.godelivery.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.json.JSONObject;

/** El aviso de un mensaje de chat con "Responder", y qué pasa con lo que se escribe ahí. */
final class ChatReply {

    static final String KEY_TEXT = "go_reply_text";
    static final String EXTRA_TAG = "go_reply_tag";
    static final String EXTRA_TITLE = "go_reply_title";
    static final String EXTRA_URL = "go_reply_url";
    static final String EXTRA_TOKEN = "go_reply_token";
    static final String EXTRA_ENDPOINT = "go_reply_endpoint";
    private static final String CHANNEL = "chat_alerts";
    // El tag (chat-<id>) separa los chats; el id es el mismo para todos
    private static final int NOTIFICATION_ID = 7301;

    private ChatReply() {}

    static void show(Context ctx, Map<String, String> data) {
        String tag = orDefault(data.get("tag"), "chat");
        String title = orDefault(data.get("title"), "GO!");
        String body = orDefault(data.get("body"), "Mensaje nuevo");
        String url = orDefault(data.get("url"), "https://godelivery-magdalena.web.app/#/mis-chats");
        String token = data.get("replyToken");
        String endpoint = data.get("replyUrl");

        NotificationCompat.Builder b = base(ctx, tag, title, url)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL);

        if (token != null && !token.isEmpty() && endpoint != null && endpoint.startsWith("https://")) {
            Intent reply = new Intent(ctx, ChatReplyReceiver.class)
                .putExtra(EXTRA_TAG, tag)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_URL, url)
                .putExtra(EXTRA_TOKEN, token)
                .putExtra(EXTRA_ENDPOINT, endpoint);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent replyPi = PendingIntent.getBroadcast(ctx, tag.hashCode(), reply, flags);
            RemoteInput input = new RemoteInput.Builder(KEY_TEXT).setLabel("Escribí tu respuesta").build();
            b.addAction(new NotificationCompat.Action.Builder(R.drawable.ic_stat_notification, "Responder", replyPi)
                .addRemoteInput(input)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .build());
        }
        notify(ctx, tag, b);
    }

    /** Después de responder Android espera que se actualice el aviso; si no, queda girando. */
    static void showResult(Context ctx, String tag, String title, String url, String text, boolean ok) {
        NotificationCompat.Builder b = base(ctx, tag, title, url)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentText(ok ? "Vos: " + text : "No se pudo enviar. Tocá para abrir el chat.");
        if (ok) b.setTimeoutAfter(8000);
        notify(ctx, tag, b);
    }

    private static NotificationCompat.Builder base(Context ctx, String tag, String title, String url) {
        ensureChannel(ctx);
        // Tocar el aviso abre la app en el chat, por el mismo camino que un link (src/utils/app-links.js)
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .setClass(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setColor(ContextCompat.getColor(ctx, R.color.notification_color))
            .setContentTitle(title)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(openPi);
    }

    private static void notify(Context ctx, String tag, NotificationCompat.Builder b) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        try {
            nm.notify(tag, NOTIFICATION_ID, b.build());
        } catch (SecurityException e) {
            // Sin permiso de notificaciones no hay nada que mostrar
        }
    }

    /** La app crea el canal al pedir permiso (src/utils/notifications.js); por si todavía no lo hizo. */
    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Mensajes", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Mensajes del repartidor, del comercio o de soporte");
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    /** Manda la respuesta al servidor (chatReplyFromPush). Corre fuera del hilo principal. */
    static boolean send(String endpoint, String token, String text) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("text", text);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            return conn.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
