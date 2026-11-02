package com.godelivery.app;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Comprobantes compartidos desde otras apps (Mercado Pago, billeteras): el archivo queda esperando
 * hasta que la app lo pide (src/utils/share-receiver.js), porque al abrirse puede no haber sesión.
 * También abre los ajustes de notificaciones de la app.
 */
@CapacitorPlugin(name = "GoShare")
public class GoSharePlugin extends Plugin {

    private static final int MAX_BYTES = 15 * 1024 * 1024;
    private Uri pendingUri = null;

    @Override
    public void load() {
        takeFrom(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (takeFrom(intent)) notifyListeners("shared", new JSObject(), true);
    }

    private boolean takeFrom(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return false;
        pendingUri = uri;
        // Si Android vuelve a crear la pantalla con este mismo pedido, no se manda dos veces
        intent.removeExtra(Intent.EXTRA_STREAM);
        return true;
    }

    @PluginMethod
    public void getSharedFile(PluginCall call) {
        final Uri uri = pendingUri;
        pendingUri = null;
        JSObject out = new JSObject();
        if (uri == null) {
            call.resolve(out);
            return;
        }
        new Thread(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) throw new Exception("Sin datos");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    bytes.write(buffer, 0, n);
                    if (bytes.size() > MAX_BYTES) {
                        out.put("tooLarge", true);
                        call.resolve(out);
                        return;
                    }
                }
                out.put("name", fileName(uri));
                out.put("type", getContext().getContentResolver().getType(uri));
                out.put("base64", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                call.resolve(out);
            } catch (Exception e) {
                call.reject("No se pudo leer el archivo", e);
            }
        }).start();
    }

    private String fileName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception e) {
            // Sin nombre: la app usa uno genérico
        }
        return "comprobante";
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudieron abrir los ajustes", e);
        }
    }
}
