import sys
import platform
import shutil
import os

print("--- AGENT 02: ENVIRONMENT PROBE ---")
print(f"OS Platform: {sys.platform} ({platform.platform()})")
print(f"Python Version: {sys.version.split()[0]}")
print(f"CPU Count: {os.cpu_count()}")

try:
    import yt_dlp
    print(f"yt_dlp Python Module: AVAILABLE (version {yt_dlp.version.__version__})")
except ImportError as e:
    print(f"yt_dlp Python Module: NOT INSTALLED ({e})")

binaries = ['yt-dlp', 'ffmpeg', 'ffprobe', 'deno', 'node', 'aria2c']
for b in binaries:
    path = shutil.which(b)
    print(f"Binary {b}: {'FOUND at ' + path if path else 'NOT FOUND'}")

# Check /dev/shm
has_shm = os.path.exists('/dev/shm') and os.access('/dev/shm', os.W_OK)
print(f"/dev/shm RAM-disk available: {has_shm}")
