package app.muxaro.studio;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "MuxaroMedia")
public class MuxaroMediaPlugin extends Plugin {
    private static final String MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
    private static final String ANDROID_YT_UA =
        "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
    private static final String ANDROID_VR_UA =
        "com.google.android.apps.youtube.vr.oculus/1.56.21 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";

    private final ExecutorService executor = Executors.newCachedThreadPool();

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private String readAll(InputStream is) throws Exception {
        if (is == null) return "";
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = reader.read(buf)) != -1) {
                sb.append(buf, 0, n);
            }
            return sb.toString();
        }
    }

    private HttpURLConnection openConnectionWithRedirects(
        String rawUrl,
        String method,
        String ua,
        String extraReferer,
        String acceptHeader,
        String rangeHeader
    ) throws Exception {
        String current = rawUrl;
        for (int hops = 0; hops < 6; hops++) {
            URL url = new URL(current);
            String proto = url.getProtocol().toLowerCase();
            if (!"https".equals(proto) && !"http".equals(proto)) {
                throw new IllegalArgumentException("Unsupported scheme: " + proto);
            }
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(25000);
            conn.setRequestMethod(method);
            conn.setRequestProperty("User-Agent", ua != null && !ua.isEmpty() ? ua : MOBILE_UA);
            conn.setRequestProperty("Accept", acceptHeader != null && !acceptHeader.isEmpty() ? acceptHeader : "*/*");
            if (extraReferer != null && !extraReferer.isEmpty()) {
                conn.setRequestProperty("Referer", extraReferer);
            }
            if (rangeHeader != null && !rangeHeader.isEmpty()) {
                conn.setRequestProperty("Range", rangeHeader);
            }
            int code = conn.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.isEmpty()) break;
                URL nextUrl = new URL(url, loc);
                current = nextUrl.toString();
                continue;
            }
            return conn;
        }
        throw new Exception("Too many redirects while connecting to URL.");
    }

    private String extractYouTubeVideoId(String rawUrl) {
        if (rawUrl == null) return null;
        String[] patterns = new String[] {
            "(?:youtube\\.com/watch\\?[^#]*v=|youtu\\.be/|youtube\\.com/shorts/|youtube\\.com/live/|youtube\\.com/embed/)([A-Za-z0-9_-]{11})",
            "^([A-Za-z0-9_-]{11})$"
        };
        for (String p : patterns) {
            Matcher m = Pattern.compile(p, Pattern.CASE_INSENSITIVE).matcher(rawUrl.trim());
            if (m.find()) return m.group(1);
        }
        return null;
    }

    private JSONObject callInnerTubePlayer(String videoId, String clientName, String clientVersion, String userAgent, JSONObject extraDevice) throws Exception {
        URL url = new URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(20000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("User-Agent", userAgent);
        conn.setRequestProperty("Origin", "https://www.youtube.com");

        JSONObject clientObj = new JSONObject();
        clientObj.put("clientName", clientName);
        clientObj.put("clientVersion", clientVersion);
        clientObj.put("hl", "en");
        clientObj.put("gl", "US");
        if (extraDevice != null) {
            Iterator<String> keys = extraDevice.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                clientObj.put(k, extraDevice.get(k));
            }
        }

        JSONObject ctxObj = new JSONObject();
        ctxObj.put("client", clientObj);

        JSONObject payload = new JSONObject();
        payload.put("videoId", videoId);
        payload.put("context", ctxObj);
        payload.put("contentCheckOk", true);
        payload.put("racyCheckOk", true);

        byte[] bodyBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(bodyBytes);
        }

        int status = conn.getResponseCode();
        InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String responseText = readAll(stream);
        conn.disconnect();

        if (responseText == null || responseText.isEmpty()) return null;
        return new JSONObject(responseText);
    }

    @PluginMethod
    public void fetchUrlText(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String ua = call.getString("userAgent", MOBILE_UA);
        String accept = call.getString("accept", "*/*");
        String referer = call.getString("referer", "");
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            call.reject("URL is required");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = openConnectionWithRedirects(rawUrl.trim(), "GET", ua, referer, accept, "");
                int status = conn.getResponseCode();
                InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String text = readAll(is);
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("ok", status >= 200 && status < 300);
                ret.put("url", conn.getURL() != null ? conn.getURL().toString() : rawUrl);
                ret.put("contentType", conn.getContentType() != null ? conn.getContentType() : "");
                ret.put("body", text);
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : "HTTP fetch failed");
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    @PluginMethod
    public void probeHead(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String ua = call.getString("userAgent", MOBILE_UA);
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            call.reject("URL is required");
            return;
        }
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = openConnectionWithRedirects(rawUrl.trim(), "HEAD", ua, "", "*/*", "");
                int status = conn.getResponseCode();
                String ct = conn.getContentType() != null ? conn.getContentType() : "";
                long cl = conn.getContentLengthLong();
                String finalUrl = conn.getURL() != null ? conn.getURL().toString() : rawUrl;
                conn.disconnect();
                conn = null;

                if (status == 405 || status == 403 || cl <= 0) {
                    conn = openConnectionWithRedirects(finalUrl, "GET", ua, "", "*/*", "bytes=0-1024");
                    status = conn.getResponseCode();
                    if (ct.isEmpty() && conn.getContentType() != null) ct = conn.getContentType();
                    String cr = conn.getHeaderField("Content-Range");
                    if (cr != null && cr.contains("/")) {
                        try {
                            cl = Long.parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim());
                        } catch (Exception ignored) {}
                    }
                    if (cl <= 0 && conn.getContentLengthLong() > 0) {
                        cl = conn.getContentLengthLong();
                    }
                    if (conn.getURL() != null) finalUrl = conn.getURL().toString();
                }

                JSObject ret = new JSObject();
                ret.put("ok", status >= 200 && status < 400);
                ret.put("status", status);
                ret.put("contentType", ct);
                ret.put("contentLength", cl > 0 ? cl : 0);
                ret.put("finalUrl", finalUrl);
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : "Probe failed");
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    @PluginMethod
    public void probeYouTube(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String videoId = extractYouTubeVideoId(rawUrl);
        if (videoId == null) {
            call.reject("Could not extract a valid YouTube video ID from URL.");
            return;
        }

        executor.execute(() -> {
            try {
                JSONObject player = null;
                String lastReason = "";

                JSONObject vrExtra = new JSONObject();
                vrExtra.put("deviceMake", "Oculus");
                vrExtra.put("deviceModel", "Quest 3");
                vrExtra.put("androidSdkVersion", 32);
                vrExtra.put("osName", "Android");
                vrExtra.put("osVersion", "12L");

                JSONObject androidExtra = new JSONObject();
                androidExtra.put("androidSdkVersion", 34);
                androidExtra.put("osName", "Android");
                androidExtra.put("osVersion", "14");

                String[][] clients = new String[][] {
                    { "ANDROID_VR", "1.56.21", ANDROID_VR_UA },
                    { "ANDROID", "20.10.38", ANDROID_YT_UA },
                    { "IOS", "20.10.4", "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X;)" },
                    { "TVHTML5_EMBEDDED_PLAYER", "2.0", MOBILE_UA }
                };

                for (int cIdx = 0; cIdx < clients.length; cIdx++) {
                    try {
                        JSONObject extra = cIdx == 0 ? vrExtra : (cIdx == 1 ? androidExtra : null);
                        JSONObject candidate = callInnerTubePlayer(videoId, clients[cIdx][0], clients[cIdx][1], clients[cIdx][2], extra);
                        if (candidate == null) continue;
                        JSONObject streaming = candidate.optJSONObject("streamingData");
                        if (streaming != null) {
                            JSONArray fmts = streaming.optJSONArray("formats");
                            JSONArray afmts = streaming.optJSONArray("adaptiveFormats");
                            boolean hasDirect = false;
                            if (fmts != null) {
                                for (int i = 0; i < fmts.length(); i++) {
                                    if (!fmts.getJSONObject(i).optString("url", "").isEmpty()) {
                                        hasDirect = true;
                                        break;
                                    }
                                }
                            }
                            if (!hasDirect && afmts != null) {
                                for (int i = 0; i < afmts.length(); i++) {
                                    if (!afmts.getJSONObject(i).optString("url", "").isEmpty()) {
                                        hasDirect = true;
                                        break;
                                    }
                                }
                            }
                            if (hasDirect) {
                                player = candidate;
                                break;
                            }
                        }
                        JSONObject ps = candidate.optJSONObject("playabilityStatus");
                        if (ps != null && !ps.optString("reason", "").isEmpty()) {
                            lastReason = ps.optString("reason", "");
                        }
                    } catch (Exception innerEx) {
                        lastReason = innerEx.getMessage() != null ? innerEx.getMessage() : lastReason;
                    }
                }

                if (player == null) {
                    call.reject(lastReason.isEmpty()
                        ? "YouTube restricted stream playback from this device client."
                        : "YouTube returned: " + lastReason);
                    return;
                }

                JSONObject details = player.optJSONObject("videoDetails");
                JSONObject streaming = player.optJSONObject("streamingData");
                String title = details != null ? details.optString("title", "YouTube Video") : "YouTube Video";
                String author = details != null ? details.optString("author", "YouTube Creator") : "YouTube Creator";
                long duration = details != null ? details.optLong("lengthSeconds", 0L) : 0L;
                String thumbUrl = "";
                if (details != null && details.optJSONObject("thumbnail") != null) {
                    JSONArray thumbs = details.getJSONObject("thumbnail").optJSONArray("thumbnails");
                    if (thumbs != null && thumbs.length() > 0) {
                        thumbUrl = thumbs.getJSONObject(thumbs.length() - 1).optString("url", "");
                    }
                }
                if (thumbUrl.isEmpty()) {
                    thumbUrl = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
                }

                JSArray videoStreams = new JSArray();
                JSArray audioStreams = new JSArray();

                if (streaming != null) {
                    JSONArray progressive = streaming.optJSONArray("formats");
                    if (progressive != null) {
                        for (int i = 0; i < progressive.length(); i++) {
                            JSONObject f = progressive.getJSONObject(i);
                            String sUrl = f.optString("url", "");
                            if (sUrl.isEmpty()) continue;
                            int h = f.optInt("height", 360);
                            int w = f.optInt("width", Math.round((h * 16f) / 9f));
                            String mime = f.optString("mimeType", "video/mp4");
                            long size = f.optLong("contentLength", 0L);
                            JSObject vs = new JSObject();
                            vs.put("streamIndex", videoStreams.length());
                            vs.put("streamType", "video");
                            vs.put("codec", mime.contains("avc") ? "h264" : mime.contains("vp9") ? "vp9" : "h264");
                            vs.put("formatId", String.valueOf(f.optInt("itag", 18)));
                            vs.put("width", w);
                            vs.put("height", h);
                            vs.put("resolutionLabel", h + "p");
                            vs.put("fps", f.optInt("fps", 30));
                            vs.put("bitrateKbps", Math.round(f.optLong("bitrate", 1500000L) / 1000f));
                            vs.put("estimatedSizeBytes", size);
                            vs.put("sizeIsEstimate", size <= 0);
                            vs.put("isStreamCopyCandidate", true);
                            vs.put("transcodeRequired", false);
                            vs.put("notes", "muxed");
                            vs.put("url", sUrl);
                            videoStreams.put(vs);
                        }
                    }

                    JSONArray adaptive = streaming.optJSONArray("adaptiveFormats");
                    if (adaptive != null) {
                        for (int i = 0; i < adaptive.length(); i++) {
                            JSONObject f = adaptive.getJSONObject(i);
                            String sUrl = f.optString("url", "");
                            if (sUrl.isEmpty()) continue;
                            String mime = f.optString("mimeType", "").toLowerCase();
                            long size = f.optLong("contentLength", 0L);
                            if (mime.startsWith("audio/")) {
                                JSObject as = new JSObject();
                                as.put("streamIndex", audioStreams.length());
                                as.put("streamType", "audio");
                                as.put("codec", mime.contains("mp4a") ? "aac" : mime.contains("opus") ? "opus" : "aac");
                                as.put("formatId", String.valueOf(f.optInt("itag", 140)));
                                as.put("bitrateKbps", Math.max(64, Math.round(f.optLong("bitrate", 128000L) / 1000f)));
                                as.put("sampleRateHz", f.optInt("audioSampleRate", 44100));
                                as.put("channels", f.optInt("audioChannels", 2));
                                as.put("estimatedSizeBytes", size);
                                as.put("sizeIsEstimate", size <= 0);
                                as.put("isNativeLossless", false);
                                as.put("isStreamCopyCandidate", true);
                                as.put("transcodeRequired", false);
                                as.put("notes", mime.contains("mp4a") ? "m4a" : "webm");
                                as.put("url", sUrl);
                                audioStreams.put(as);
                            } else if (mime.startsWith("video/") && (mime.contains("mp4") || mime.contains("avc") || mime.contains("hev"))) {
                                int h = f.optInt("height", 0);
                                if (h <= 0) continue;
                                int w = f.optInt("width", Math.round((h * 16f) / 9f));
                                String codec = mime.contains("av01") ? "av1" : mime.contains("hev") || mime.contains("hvc") ? "hevc" : "h264";
                                // Android MediaMuxer supports AVC/HEVC in MP4 cleanly; keep compatible MP4 tracks
                                if ("av1".equals(codec) && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) continue;
                                JSObject vs = new JSObject();
                                vs.put("streamIndex", videoStreams.length());
                                vs.put("streamType", "video");
                                vs.put("codec", codec);
                                vs.put("formatId", String.valueOf(f.optInt("itag", 137)));
                                vs.put("width", w);
                                vs.put("height", h);
                                vs.put("resolutionLabel", h + "p");
                                vs.put("fps", f.optInt("fps", 30));
                                vs.put("hdr", f.optJSONObject("colorInfo") != null && mime.contains("10"));
                                vs.put("bitrateKbps", Math.round(f.optLong("bitrate", 2500000L) / 1000f));
                                vs.put("estimatedSizeBytes", size);
                                vs.put("sizeIsEstimate", size <= 0);
                                vs.put("isStreamCopyCandidate", true);
                                vs.put("transcodeRequired", false);
                                vs.put("notes", "adaptive");
                                vs.put("url", sUrl);
                                videoStreams.put(vs);
                            }
                        }
                    }
                }

                if (videoStreams.length() == 0 && audioStreams.length() == 0) {
                    call.reject("No directly playable streams were found for this video.");
                    return;
                }

                JSObject result = new JSObject();
                result.put("ok", true);
                result.put("id", "yt_" + videoId);
                result.put("platform", "youtube");
                result.put("title", title);
                result.put("author", author);
                result.put("durationSeconds", duration);
                result.put("thumbnailUrl", thumbUrl);
                result.put("sourceUrl", rawUrl);
                result.put("container", "mp4");
                result.put("videoStreams", videoStreams);
                result.put("audioStreams", audioStreams);
                call.resolve(result);
            } catch (Exception ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : "YouTube probe error");
            }
        });
    }

    private void emitProgress(String jobId, int percent, String status, String message) {
        JSObject payload = new JSObject();
        payload.put("jobId", jobId);
        payload.put("percent", percent);
        payload.put("status", status);
        payload.put("message", message);
        notifyListeners("muxaroMediaProgress", payload);
    }

    private void downloadStreamToFile(String rawUrl, File dest, String jobId, int basePct, int spanPct, String label) throws Exception {
        HttpURLConnection conn = openConnectionWithRedirects(rawUrl, "GET", MOBILE_UA, "", "*/*", "");
        int code = conn.getResponseCode();
        if (code >= 400) {
            conn.disconnect();
            throw new Exception("Server responded with HTTP " + code + " while downloading stream.");
        }
        long total = conn.getContentLengthLong();
        long read = 0L;
        int lastEmitted = -1;
        try (InputStream is = new BufferedInputStream(conn.getInputStream());
             FileOutputStream fos = new FileOutputStream(dest)) {
            byte[] buf = new byte[32768];
            int n;
            while ((n = is.read(buf)) != -1) {
                fos.write(buf, 0, n);
                read += n;
                if (total > 0) {
                    int pct = basePct + (int) Math.round(((double) read / (double) total) * spanPct);
                    if (pct - lastEmitted >= 2) {
                        lastEmitted = pct;
                        emitProgress(jobId, Math.min(98, pct), "DOWNLOADING", label + " (" + Math.min(98, pct) + "%)");
                    }
                }
            }
            fos.flush();
        } finally {
            conn.disconnect();
        }
        if (!dest.exists() || dest.length() < 512) {
            throw new Exception("Downloaded stream file was empty or blocked by server.");
        }
    }

    private void muxMp4TracksNatively(File videoFile, File audioFile, File outputFile) throws Exception {
        MediaExtractor vExtractor = new MediaExtractor();
        MediaExtractor aExtractor = new MediaExtractor();
        MediaMuxer muxer = null;
        try {
            vExtractor.setDataSource(videoFile.getAbsolutePath());
            aExtractor.setDataSource(audioFile.getAbsolutePath());

            int vTrackIdx = -1;
            MediaFormat vFormat = null;
            for (int i = 0; i < vExtractor.getTrackCount(); i++) {
                MediaFormat fmt = vExtractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) {
                    vTrackIdx = i;
                    vFormat = fmt;
                    break;
                }
            }

            int aTrackIdx = -1;
            MediaFormat aFormat = null;
            for (int i = 0; i < aExtractor.getTrackCount(); i++) {
                MediaFormat fmt = aExtractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    aTrackIdx = i;
                    aFormat = fmt;
                    break;
                }
            }

            if (vFormat == null) throw new Exception("No valid video track found for muxing.");

            muxer = new MediaMuxer(outputFile.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int outVTrack = muxer.addTrack(vFormat);
            int outATrack = aFormat != null ? muxer.addTrack(aFormat) : -1;
            muxer.start();

            ByteBuffer buffer = ByteBuffer.allocate(1024 * 1024);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

            vExtractor.selectTrack(vTrackIdx);
            while (true) {
                int sampleSize = vExtractor.readSampleData(buffer, 0);
                if (sampleSize < 0) break;
                info.offset = 0;
                info.size = sampleSize;
                info.presentationTimeUs = vExtractor.getSampleTime();
                info.flags = vExtractor.getSampleFlags();
                muxer.writeSampleData(outVTrack, buffer, info);
                vExtractor.advance();
            }

            if (outATrack >= 0 && aTrackIdx >= 0) {
                aExtractor.selectTrack(aTrackIdx);
                while (true) {
                    int sampleSize = aExtractor.readSampleData(buffer, 0);
                    if (sampleSize < 0) break;
                    info.offset = 0;
                    info.size = sampleSize;
                    info.presentationTimeUs = aExtractor.getSampleTime();
                    info.flags = aExtractor.getSampleFlags();
                    muxer.writeSampleData(outATrack, buffer, info);
                    aExtractor.advance();
                }
            }

            muxer.stop();
        } finally {
            vExtractor.release();
            aExtractor.release();
            if (muxer != null) {
                try {
                    muxer.release();
                } catch (Exception ignored) {}
            }
        }
    }

    private String saveToPublicDownloads(File sourceFile, String filename, String mimeType) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MUXARO");
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (itemUri == null) throw new Exception("Unable to allocate file in Android Downloads.");
            try (InputStream is = new FileInputStream(sourceFile);
                 OutputStream os = resolver.openOutputStream(itemUri)) {
                if (os == null) throw new Exception("Cannot open Android Downloads output stream.");
                byte[] buf = new byte[32768];
                int n;
                while ((n = is.read(buf)) != -1) {
                    os.write(buf, 0, n);
                }
                os.flush();
            }
            ContentValues doneValues = new ContentValues();
            doneValues.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(itemUri, doneValues, null, null);
            return itemUri.toString();
        } else {
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File muxDir = new File(downloadsDir, "MUXARO");
            if (!muxDir.exists()) muxDir.mkdirs();
            File dest = new File(muxDir, filename);
            try (InputStream is = new FileInputStream(sourceFile);
                 FileOutputStream fos = new FileOutputStream(dest)) {
                byte[] buf = new byte[32768];
                int n;
                while ((n = is.read(buf)) != -1) {
                    fos.write(buf, 0, n);
                }
                fos.flush();
            }
            return Uri.fromFile(dest).toString();
        }
    }

    @PluginMethod
    public void downloadMedia(PluginCall call) {
        String jobId = call.getString("jobId", "apk_" + System.currentTimeMillis());
        String videoUrl = call.getString("videoUrl", "");
        String audioUrl = call.getString("audioUrl", "");
        String rawFilename = call.getString("filename", "muxaro_video.mp4");
        String mimeType = call.getString("mimeType", "video/mp4");

        if (videoUrl == null || videoUrl.trim().isEmpty()) {
            call.reject("A direct stream URL is required to download.");
            return;
        }

        String safeName = rawFilename.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (safeName.isEmpty()) safeName = "muxaro_media.mp4";
        final String finalName = safeName;

        executor.execute(() -> {
            File tmpVideo = new File(getContext().getCacheDir(), jobId + "_v.tmp");
            File tmpAudio = new File(getContext().getCacheDir(), jobId + "_a.tmp");
            File tmpMuxed = new File(getContext().getCacheDir(), jobId + "_mux.mp4");
            try {
                emitProgress(jobId, 4, "DOWNLOADING", "Connecting to media stream…");
                boolean needsMux = audioUrl != null && !audioUrl.trim().isEmpty() && !audioUrl.equals(videoUrl);

                if (needsMux) {
                    downloadStreamToFile(videoUrl.trim(), tmpVideo, jobId, 5, 55, "Downloading video track");
                    downloadStreamToFile(audioUrl.trim(), tmpAudio, jobId, 60, 28, "Downloading audio track");
                    emitProgress(jobId, 90, "MERGING", "Muxing video + audio natively on device…");
                    muxMp4TracksNatively(tmpVideo, tmpAudio, tmpMuxed);
                } else {
                    downloadStreamToFile(videoUrl.trim(), tmpMuxed, jobId, 5, 85, "Downloading media");
                }

                emitProgress(jobId, 96, "VERIFYING", "Saving to Downloads/MUXARO…");
                String savedUri = saveToPublicDownloads(tmpMuxed, finalName, mimeType);
                long finalSize = tmpMuxed.length();
                emitProgress(jobId, 100, "READY", "Saved to Downloads/MUXARO/" + finalName);

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("jobId", jobId);
                res.put("filename", finalName);
                res.put("sizeBytes", finalSize);
                res.put("mimeType", mimeType);
                res.put("savedUri", savedUri);
                res.put("savedPath", "Downloads/MUXARO/" + finalName);
                call.resolve(res);
            } catch (Exception ex) {
                emitProgress(jobId, 0, "FAILED", ex.getMessage() != null ? ex.getMessage() : "Download failed");
                call.reject(ex.getMessage() != null ? ex.getMessage() : "Native Android download failed");
            } finally {
                if (tmpVideo.exists()) tmpVideo.delete();
                if (tmpAudio.exists()) tmpAudio.delete();
                if (tmpMuxed.exists()) tmpMuxed.delete();
            }
        });
    }

    @PluginMethod
    public void openSavedMedia(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String mime = call.getString("mimeType", "video/mp4");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("Missing URI");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(uriStr), mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception ex) {
            call.reject(ex.getMessage() != null ? ex.getMessage() : "No app available to open this file");
        }
    }
}
