package com.emiliopousada.sendamtb;

import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final long MIN_SPLASH_DURATION_MS = 700;
    private static final long MAX_SPLASH_DURATION_MS = 15000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable splashTimeout = this::removeStartupSplash;
    private final Runnable splashMinimumElapsed = this::removeStartupSplash;
    private boolean backCheckPending = false;
    private boolean systemSplashCanExit = false;
    private long splashStartedAt;
    private View startupSplashView;
    private WebViewListener startupWebViewListener;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashStartedAt = SystemClock.elapsedRealtime();
        splashScreen.setKeepOnScreenCondition(
                () -> !systemSplashCanExit
                        && SystemClock.elapsedRealtime() - splashStartedAt < MAX_SPLASH_DURATION_MS);
        registerPlugin(BatteryInfoPlugin.class);
        registerPlugin(ScreenControlPlugin.class);
        super.onCreate(savedInstanceState);

        showStartupSplash();
        systemSplashCanExit = true;
        mainHandler.postDelayed(splashTimeout, MAX_SPLASH_DURATION_MS);

        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            scheduleStartupSplashRemoval();
            return;
        }

        WebView webView = bridge.getWebView();
        startupWebViewListener = new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                scheduleStartupSplashRemoval();
            }
        };
        bridge.addWebViewListener(startupWebViewListener);
        if (webView.getProgress() >= 100 && webView.getUrl() != null) {
            scheduleStartupSplashRemoval();
        }
    }

    private void showStartupSplash() {
        View content = findViewById(android.R.id.content);
        if (!(content instanceof ViewGroup)) return;

        ImageView image = new ImageView(this);
        image.setImageResource(R.drawable.splash);
        image.setBackgroundColor(Color.BLACK);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setContentDescription(getString(R.string.app_name));
        ((ViewGroup) content).addView(image, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        startupSplashView = image;
    }

    private void scheduleStartupSplashRemoval() {
        long elapsed = SystemClock.elapsedRealtime() - splashStartedAt;
        long delay = Math.max(0, MIN_SPLASH_DURATION_MS - elapsed);
        mainHandler.removeCallbacks(splashMinimumElapsed);
        mainHandler.postDelayed(splashMinimumElapsed, delay);
    }

    private void removeStartupSplash() {
        mainHandler.removeCallbacks(splashTimeout);
        mainHandler.removeCallbacks(splashMinimumElapsed);
        if (startupSplashView != null && startupSplashView.getParent() instanceof ViewGroup) {
            ((ViewGroup) startupSplashView.getParent()).removeView(startupSplashView);
        }
        startupSplashView = null;
        Bridge bridge = getBridge();
        if (bridge != null && startupWebViewListener != null) {
            bridge.removeWebViewListener(startupWebViewListener);
        }
        startupWebViewListener = null;
    }

    @Override
    public void onDestroy() {
        removeStartupSplash();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (backCheckPending) return;
        if (getBridge() != null && getBridge().getWebView() != null) {
            backCheckPending = true;
            getBridge().getWebView().evaluateJavascript(
                    "(function(){return !!(window.mtbHandleHardwareBack && window.mtbHandleHardwareBack());})()",
                    result -> {
                        backCheckPending = false;
                        if (!"true".equals(result)) showExitDialog();
                    });
            return;
        }
        showExitDialog();
    }

    private void showExitDialog() {
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(padding, padding, padding, 0);

        TextView message = new TextView(this);
        message.setText("¿Quieres salir de senda-mtb?");
        message.setTextSize(18);
        message.setGravity(Gravity.CENTER);
        content.addView(message, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.CENTER);
        actions.setPadding(0, padding, 0, 0);

        Button exitButton = new Button(this);
        exitButton.setText("✅\nSí, salir");
        exitButton.setContentDescription("Sí, salir de la aplicación");
        actions.addView(exitButton, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        Button cancelButton = new Button(this);
        cancelButton.setText("❌\nNo, cancelar");
        cancelButton.setContentDescription("No, cancelar y volver a la aplicación");
        actions.addView(cancelButton, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        content.addView(actions, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setView(content)
                .create();
        exitButton.setOnClickListener(view -> {
            dialog.dismiss();
            if (getBridge() == null || getBridge().getWebView() == null) {
                finishAndRemoveTask();
                return;
            }
            getBridge().getWebView().evaluateJavascript(
                    "(function(){if(typeof window.mtbRequestAppExit!=='function')return false;window.mtbRequestAppExit(true);return true;})()",
                    result -> {
                        if (!"true".equals(result)) finishAndRemoveTask();
                    });
        });
        cancelButton.setOnClickListener(view -> dialog.dismiss());
        dialog.show();
    }
}
