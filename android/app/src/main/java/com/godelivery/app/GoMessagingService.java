package com.godelivery.app;

import android.app.ActivityManager;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import io.capawesome.capacitorjs.plugins.firebase.messaging.MessagingService;
import java.util.Map;

/**
 * Reemplaza al servicio del plugin de push (ver AndroidManifest.xml) y hace lo mismo, más una
 * cosa: los avisos de chat llegan solo con datos (goReply = "1") y se muestran acá con el cuadro
 * para responder. Con la app abierta no se muestra nada: lo resuelve la app como siempre.
 */
public class GoMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        if (remoteMessage.getNotification() == null && "1".equals(data.get("goReply")) && !appInForeground()) {
            ChatReply.show(this, data);
        }
    }

    private static boolean appInForeground() {
        ActivityManager.RunningAppProcessInfo info = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(info);
        return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
    }
}
