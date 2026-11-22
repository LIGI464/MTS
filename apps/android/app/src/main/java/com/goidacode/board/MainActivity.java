package com.goidacode.board;

import static android.view.ViewGroup.LayoutParams.MATCH_PARENT;
import static android.view.ViewGroup.LayoutParams.WRAP_CONTENT;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

public final class MainActivity extends Activity {
    private static final String BOARD_HOST = "skinsloot.tech";
    private static final String BOARD_URL = "https://" + BOARD_HOST + "/admin/incidents";
    private static final String WEB_STATE = "webState";
    private static final String FAILED_URL = "failedUrl";

    private WebView webView;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private String failedUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= 35) {
            content.setOnApplyWindowInsetsListener((view, insets) -> {
                var system = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                var keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(system.left, system.top, system.right, Math.max(system.bottom, keyboard.bottom));
                return insets;
            });
        }

        webView = new WebView(this);
        configureWebView();
        content.addView(webView, new FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT));

        progress = new ProgressBar(this);
        progress.setContentDescription(getString(R.string.loading));
        content.addView(progress, new FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.CENTER));

        errorPanel = createErrorPanel();
        content.addView(errorPanel, new FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.CENTER));
        setContentView(content);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
        }

        Bundle webState = savedInstanceState == null ? null : savedInstanceState.getBundle(WEB_STATE);
        String previousFailure = savedInstanceState == null ? null : savedInstanceState.getString(FAILED_URL);
        if (previousFailure != null) {
            showError(previousFailure);
        } else if (webState == null || webView.restoreState(webState) == null) {
            webView.loadUrl(BOARD_URL);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri destination = request.getUrl();
                if (!request.isForMainFrame() || isBoardUrl(destination)) {
                    return false;
                }
                if (request.hasGesture() && "https".equalsIgnoreCase(destination.getScheme())) {
                    openExternalLink(destination);
                }
                return true;
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                progress.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError(request.getUrl().toString());
                }
            }
        });
    }

    private LinearLayout createErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, 0, padding, 0);
        panel.setVisibility(View.GONE);

        TextView message = new TextView(this);
        message.setText(R.string.page_unavailable);
        message.setTextSize(16);
        message.setGravity(Gravity.CENTER);
        panel.addView(message);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(view -> {
            String url = failedUrl;
            clearError();
            progress.setVisibility(View.VISIBLE);
            webView.loadUrl(url);
        });
        panel.addView(retry);

        return panel;
    }

    private void showError(String url) {
        failedUrl = isBoardUrl(Uri.parse(url)) ? url : BOARD_URL;
        progress.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void clearError() {
        failedUrl = null;
        errorPanel.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    private static boolean isBoardUrl(Uri url) {
        return "https".equalsIgnoreCase(url.getScheme()) && BOARD_HOST.equalsIgnoreCase(url.getHost())
                && (url.getPort() == -1 || url.getPort() == 443);
    }

    private void openExternalLink(Uri url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, R.string.no_link_handler, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        navigateBack();
    }

    private void navigateBack() {
        if (webView.canGoBack()) {
            clearError();
            webView.goBack();
        } else {
            finish();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        Bundle webState = new Bundle();
        webView.saveState(webState);
        outState.putBundle(WEB_STATE, webState);
        outState.putString(FAILED_URL, failedUrl);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        ((FrameLayout) webView.getParent()).removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
