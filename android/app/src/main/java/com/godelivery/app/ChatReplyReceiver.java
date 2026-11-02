package com.godelivery.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;

/** Lo que se escribe en "Responder" del aviso de chat (ChatReply). */
public class ChatReplyReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence typed = results != null ? results.getCharSequence(ChatReply.KEY_TEXT) : null;
        String text = typed != null ? typed.toString().trim() : "";
        String tag = intent.getStringExtra(ChatReply.EXTRA_TAG);
        String title = intent.getStringExtra(ChatReply.EXTRA_TITLE);
        String url = intent.getStringExtra(ChatReply.EXTRA_URL);
        String token = intent.getStringExtra(ChatReply.EXTRA_TOKEN);
        String endpoint = intent.getStringExtra(ChatReply.EXTRA_ENDPOINT);
        if (text.isEmpty() || tag == null || token == null || endpoint == null) return;

        final Context app = context.getApplicationContext();
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                boolean ok = ChatReply.send(endpoint, token, text);
                ChatReply.showResult(app, tag, title, url, text, ok);
            } finally {
                pending.finish();
            }
        }).start();
    }
}
