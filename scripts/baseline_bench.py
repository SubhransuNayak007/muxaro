import time
import subprocess
import json
import os
import sys

URL = "https://youtu.be/g3nhipW9lmQ"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "storage", "benchmarks")
os.makedirs(OUT_DIR, exist_ok=True)
OUT_FILE = os.path.join(OUT_DIR, "baseline_1080p.mp4")

print(f"=== AGENT 02: BASELINE BENCHMARK ===")
print(f"Target URL: {URL}")

# 1. Cold Analyze benchmark (CLI spawn)
t0 = time.time()
analyze_cmd = [
    "yt-dlp",
    "--dump-single-json",
    "--force-ipv4",
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    URL
]
res = subprocess.run(analyze_cmd, capture_output=True, text=True)
t_analyze_cold_ms = int((time.time() - t0) * 1000)
if res.returncode == 0:
    data = json.loads(res.stdout)
    title = data.get("title", "")
    print(f"Cold Analyze Success: '{title}' in {t_analyze_cold_ms}ms")
else:
    print(f"Cold Analyze Failed ({res.returncode}): {res.stderr[:200]}")
    sys.exit(1)

# 2. Cold 1080p download benchmark via single-stream yt-dlp + FFmpeg muxing
if os.path.exists(OUT_FILE):
    os.remove(OUT_FILE)

t_dl_start = time.time()
dl_cmd = [
    "yt-dlp",
    "--force-ipv4",
    "--no-warnings",
    "--no-playlist",
    "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format", "mp4",
    "-o", OUT_FILE,
    URL
]
res_dl = subprocess.run(dl_cmd, capture_output=True, text=True)
t_dl_total_ms = int((time.time() - t_dl_start) * 1000)

if os.path.exists(OUT_FILE) and os.path.getsize(OUT_FILE) > 0:
    size = os.path.getsize(OUT_FILE)
    print(f"Cold Download + Mux Success: {size} bytes in {t_dl_total_ms}ms")
    print(f"Effective Throughput: {size / (t_dl_total_ms / 1000) / 1024 / 1024:.2f} MB/s")
else:
    print(f"Cold Download Failed ({res_dl.returncode}): {res_dl.stderr[:200]}")
    sys.exit(1)

# Output JSON summary
dossier = {
    "url": URL,
    "title": title,
    "baseline_analyze_cold_ms": t_analyze_cold_ms,
    "baseline_1080p_total_ms": t_dl_total_ms,
    "baseline_1080p_ttfb_ms": t_dl_total_ms, # in serial model TTFB == Total time before client receives byte
    "baseline_output_bytes": size,
    "platform": sys.platform
}

with open(os.path.join(OUT_DIR, "baseline.json"), "w") as f:
    json.dump(dossier, f, indent=2)

print("\n--- BASELINE DOSSIER CREATED ---")
print(json.dumps(dossier, indent=2))
