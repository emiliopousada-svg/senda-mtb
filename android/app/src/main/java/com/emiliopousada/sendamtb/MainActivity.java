package com.emiliopousada.sendamtb;

import android.app.AlertDialog;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean backCheckPending = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(BatteryInfoPlugin.class);
        registerPlugin(ScreenControlPlugin.class);
        super.onCreate(savedInstanceState);
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
