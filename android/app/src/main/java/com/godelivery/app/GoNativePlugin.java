package com.godelivery.app;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/**
 * Lo que la web no puede hacer sola (src/utils/native.js): vibraciones cortas y el cartel de Google
 * Play para calificar la app. Que el plugin exista también le dice a la app que este APK arma los
 * avisos de chat con "Responder" (GoMessagingService).
 */
@CapacitorPlugin(name = "GoNative")
public class GoNativePlugin extends Plugin {

    @PluginMethod
    public void haptic(PluginCall call) {
        String kind = call.getString("kind", "light");
        try {
            Vibrator v = vibrator();
            if (v != null && v.hasVibrator()) vibrate(v, kind);
        } catch (Exception ignored) {
            // Sin vibración no pasa nada
        }
        call.resolve();
    }

    private Vibrator vibrator() {
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager m = (VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return m != null ? m.getDefaultVibrator() : null;
        }
        return (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
    }

    @SuppressWarnings("deprecation")
    private void vibrate(Vibrator v, String kind) {
        long[] pattern;
        switch (kind) {
            case "warning": pattern = new long[] { 0, 40, 80, 40 }; break;
            case "error": pattern = new long[] { 0, 60, 60, 60, 60, 60 }; break;
            case "success": pattern = new long[] { 0, 20, 60, 30 }; break;
            case "heavy": pattern = new long[] { 0, 30 }; break;
            case "medium": pattern = new long[] { 0, 18 }; break;
            case "selection": pattern = new long[] { 0, 8 }; break;
            default: pattern = new long[] { 0, 12 };
        }
        if (Build.VERSION.SDK_INT >= 29) {
            // Los efectos del sistema se sienten como el teclado: más finos que un pulso fijo
            switch (kind) {
                case "selection": v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)); return;
                case "light":
                case "medium": v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)); return;
                case "heavy": v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK)); return;
                case "success": v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK)); return;
                default: break;
            }
        }
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(pattern, -1));
        else v.vibrate(pattern, -1);
    }

    /** Google decide si muestra el cartel (tiene un cupo por persona): siempre resuelve. */
    @PluginMethod
    public void requestReview(PluginCall call) {
        try {
            ReviewManager manager = ReviewManagerFactory.create(getContext());
            manager.requestReviewFlow().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || getActivity() == null) {
                    call.resolve();
                    return;
                }
                manager.launchReviewFlow(getActivity(), task.getResult()).addOnCompleteListener(done -> call.resolve());
            });
        } catch (Exception e) {
            call.resolve();
        }
    }
}
