package app.muxaro.studio;

import android.Manifest;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "MuxaroAi",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class MuxaroAiPlugin extends Plugin {
    private static final String PREFS_NAME = "muxaro_ai_prefs";
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private SpeechRecognizer speechRecognizer;
    private volatile boolean isListening = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        super.load();
        try {
            tts = new TextToSpeech(getContext(), status -> {
                if (status == TextToSpeech.SUCCESS) {
                    int langStatus = tts.setLanguage(Locale.US);
                    ttsReady = langStatus != TextToSpeech.LANG_MISSING_DATA
                            && langStatus != TextToSpeech.LANG_NOT_SUPPORTED;
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {
                            JSObject ev = new JSObject();
                            ev.put("state", "start");
                            notifyListeners("ttsState", ev);
                        }

                        @Override
                        public void onDone(String utteranceId) {
                            JSObject ev = new JSObject();
                            ev.put("state", "done");
                            notifyListeners("ttsState", ev);
                        }

                        @Override
                        public void onError(String utteranceId) {
                            JSObject ev = new JSObject();
                            ev.put("state", "error");
                            notifyListeners("ttsState", ev);
                        }
                    });
                } else {
                    ttsReady = false;
                }
            });
        } catch (Throwable ignored) {
            ttsReady = false;
        }
    }

    @Override
    protected void handleOnDestroy() {
        destroyRecognizerOnUi();
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Throwable ignored) {}
            tts = null;
        }
        super.handleOnDestroy();
    }

    private void destroyRecognizerOnUi() {
        mainHandler.post(() -> {
            isListening = false;
            if (speechRecognizer != null) {
                try {
                    speechRecognizer.cancel();
                    speechRecognizer.destroy();
                } catch (Throwable ignored) {}
                speechRecognizer = null;
            }
        });
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject ret = new JSObject();
        Context ctx = getContext();
        ret.put("ttsReady", ttsReady);
        ret.put("slmReady", false);
        ret.put("recommendedMaxParams", "1.5B");

        boolean speechAvail = false;
        boolean onDeviceAvail = false;
        try {
            speechAvail = SpeechRecognizer.isRecognitionAvailable(ctx);
            if (Build.VERSION.SDK_INT >= 31) {
                onDeviceAvail = SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx);
            }
        } catch (Throwable ignored) {}
        ret.put("speechRecognizerAvailable", speechAvail);
        ret.put("onDeviceSttAvailable", onDeviceAvail);
        ret.put(
            "micPermissionGranted",
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        );

        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String key = prefs.getString("byok_key", "");
        String provider = prefs.getString("byok_provider", "gemini");
        ret.put("byokConfigured", key != null && !key.isEmpty());
        ret.put("byokProvider", provider);

        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                ret.put("totalRamMb", Math.round(mi.totalMem / (1024f * 1024f)));
            }
        } catch (Throwable ignored) {}

        call.resolve(ret);
    }

    @PluginMethod
    public void startNativeListening(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
            return;
        }
        launchRecognizer(call);
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            launchRecognizer(call);
        } else {
            call.reject("Microphone access was denied. Enable Microphone permission in Android App Settings.");
        }
    }

    private void launchRecognizer(PluginCall call) {
        String languageTag = call.getString("language", Locale.getDefault().toLanguageTag());
        boolean preferOffline = call.getBoolean("preferOffline", true);

        mainHandler.post(() -> {
            try {
                if (speechRecognizer != null) {
                    speechRecognizer.cancel();
                    speechRecognizer.destroy();
                    speechRecognizer = null;
                }

                Context ctx = getContext();
                boolean usedOnDeviceApi = false;
                if (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)) {
                    speechRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx);
                    usedOnDeviceApi = true;
                } else if (SpeechRecognizer.isRecognitionAvailable(ctx)) {
                    speechRecognizer = SpeechRecognizer.createSpeechRecognizer(ctx);
                } else {
                    call.reject("No speech recognition engine available on this Android device.");
                    return;
                }

                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) {
                        JSObject ev = new JSObject();
                        ev.put("state", "listening");
                        notifyListeners("voiceState", ev);
                    }
                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {
                        float norm = Math.max(0f, Math.min(1f, (rmsdB + 2f) / 12f));
                        JSObject ev = new JSObject();
                        ev.put("level", norm);
                        notifyListeners("voiceLevel", ev);
                    }
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() {
                        JSObject ev = new JSObject();
                        ev.put("state", "transcribing");
                        notifyListeners("voiceState", ev);
                    }
                    @Override public void onError(int error) {
                        isListening = false;
                        JSObject ev = new JSObject();
                        ev.put("code", error);
                        ev.put("message", mapRecognizerError(error));
                        notifyListeners("voiceError", ev);
                    }
                    @Override public void onResults(Bundle results) {
                        isListening = false;
                        ArrayList<String> matches = results != null ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) : null;
                        String text = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";
                        JSObject ev = new JSObject();
                        ev.put("text", text);
                        notifyListeners("voiceFinal", ev);
                    }
                    @Override public void onPartialResults(Bundle partialResults) {
                        ArrayList<String> matches = partialResults != null ? partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) : null;
                        String text = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";
                        if (!text.isEmpty()) {
                            JSObject ev = new JSObject();
                            ev.put("text", text);
                            notifyListeners("voicePartial", ev);
                        }
                    }
                    @Override public void onEvent(int eventType, Bundle params) {}
                });

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                if (preferOffline) {
                    intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                }

                isListening = true;
                speechRecognizer.startListening(intent);

                JSObject res = new JSObject();
                res.put("started", true);
                res.put("onDevice", usedOnDeviceApi);
                call.resolve(res);
            } catch (Throwable ex) {
                isListening = false;
                call.reject(ex.getMessage() != null ? ex.getMessage() : "Unable to start Android speech recognition.");
            }
        });
    }

    @PluginMethod
    public void stopNativeListening(PluginCall call) {
        mainHandler.post(() -> {
            isListening = false;
            if (speechRecognizer != null) {
                try {
                    speechRecognizer.stopListening();
                } catch (Throwable ignored) {}
            }
            call.resolve();
        });
    }

    private String mapRecognizerError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "Audio recording failed on microphone.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Microphone permission is required for Voice mode.";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                return "Offline speech language pack is not installed in Android System Settings.";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "No speech detected — tap the mic and speak clearly.";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "Offline speech pack missing on this phone (download Google On-Device Speech pack in Android Settings).";
            default:
                return "Speech recognition paused (" + error + ").";
        }
    }

    @PluginMethod
    public void speakText(PluginCall call) {
        String text = call.getString("text", "");
        Float rate = call.getFloat("rate", 1.04f);
        boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
        if (text == null || text.trim().isEmpty()) {
            call.reject("Text is required");
            return;
        }
        if (tts == null || !ttsReady) {
            call.reject("Android offline TTS engine is not ready yet.");
            return;
        }
        tts.setSpeechRate(rate != null ? rate : 1.04f);
        String clean = text.length() > 3800 ? text.substring(0, 3800) : text;
        int queueMode = append ? TextToSpeech.QUEUE_ADD : TextToSpeech.QUEUE_FLUSH;
        tts.speak(clean, queueMode, null, "muxaro_" + System.currentTimeMillis());
        JSObject ret = new JSObject();
        ret.put("speaking", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) {
            tts.stop();
        }
        JSObject ev = new JSObject();
        ev.put("state", "stopped");
        notifyListeners("ttsState", ev);
        call.resolve();
    }

    @PluginMethod
    public void saveByokKey(PluginCall call) {
        String provider = call.getString("provider", "gemini");
        String apiKey = call.getString("apiKey", "");
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor ed = prefs.edit();
        if (apiKey == null || apiKey.trim().isEmpty()) {
            ed.remove("byok_key");
        } else {
            ed.putString("byok_provider", provider);
            ed.putString("byok_key", apiKey.trim());
        }
        ed.apply();
        call.resolve();
    }

    @PluginMethod
    public void clearByokKey(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove("byok_key").apply();
        call.resolve();
    }
}
