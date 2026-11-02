package com.godelivery.app;

import android.content.res.Configuration;
import android.content.res.Resources;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GoSharePlugin.class);
        registerPlugin(GoNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public Resources getResources() {
        Resources res = super.getResources();
        Configuration config = res.getConfiguration();
        if (config.fontScale != 1.0f) {
            config.fontScale = 1.0f;
            res.updateConfiguration(config, res.getDisplayMetrics());
        }
        return res;
    }
}
