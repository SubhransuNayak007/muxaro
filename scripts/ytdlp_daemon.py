#!/usr/bin/env python3
"""
MUXARO Warm yt-dlp Persistent Extraction Daemon
scripts/ytdlp_daemon.py

Maintains a long-lived Python process with yt_dlp loaded in memory.
Eliminates the 400-900ms Python cold-boot penalty per analysis request.
Communicates via newline-delimited JSON-RPC over stdin/stdout.
"""

import sys
import json
import traceback

try:
    import yt_dlp
except ImportError:
    print(json.dumps({"error": "yt_dlp module is not installed"}), flush=True)
    sys.exit(1)

# Default extraction options with IPv4 preference
DEFAULT_OPTS = {
    'quiet': True,
    'no_warnings': True,
    'skip_download': True,
    'extract_flat': False,
    'force_ipv4': True,
    'noplaylist': True,
    'socket_timeout': 30,
}

def sanitize_format(f):
    """Keep only essential fields to minimize IPC serialization overhead"""
    return {
        'format_id': f.get('format_id'),
        'format_note': f.get('format_note'),
        'ext': f.get('ext'),
        'url': f.get('url'),
        'manifest_url': f.get('manifest_url'),
        'width': f.get('width'),
        'height': f.get('height'),
        'fps': f.get('fps'),
        'vcodec': f.get('vcodec'),
        'acodec': f.get('acodec'),
        'filesize': f.get('filesize') or f.get('filesize_approx'),
        'tbr': f.get('tbr'),
        'vbr': f.get('vbr'),
        'abr': f.get('abr'),
        'asr': f.get('asr'),
        'http_headers': f.get('http_headers', {}),
    }

def handle_request(req):
    req_id = req.get('id', 'unknown')
    method = req.get('method', 'extract')

    if method == 'ping':
        return {'id': req_id, 'result': {'status': 'pong', 'version': yt_dlp.version.__version__}}

    if method == 'extract':
        url = req.get('url')
        if not url:
            return {'id': req_id, 'error': 'Missing url parameter'}

        try:
            with yt_dlp.YoutubeDL(DEFAULT_OPTS) as ydl:
                info = ydl.extract_info(url, download=False)
            if not info:
                return {'id': req_id, 'error': 'No video information returned'}

            # Filter formats to avoid massive payloads
            raw_formats = info.get('formats', [])
            compact_formats = [sanitize_format(f) for f in raw_formats if f.get('url') or f.get('manifest_url')]

            result = {
                'id': info.get('id'),
                'title': info.get('title'),
                'uploader': info.get('uploader') or info.get('channel'),
                'uploader_url': info.get('uploader_url') or info.get('channel_url'),
                'duration': info.get('duration'),
                'thumbnail': info.get('thumbnail'),
                'webpage_url': info.get('webpage_url') or url,
                'formats': compact_formats,
                'is_live': info.get('is_live', False),
            }
            return {'id': req_id, 'result': result}
        except Exception as e:
            return {'id': req_id, 'error': str(e)}

    return {'id': req_id, 'error': f'Unknown method: {method}'}

def main():
    # Signal daemon readiness to Node parent process
    print(json.dumps({"status": "ready", "version": yt_dlp.version.__version__}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            res = handle_request(req)
            print(json.dumps(res), flush=True)
        except Exception as err:
            err_res = {'id': None, 'error': f'JSON-RPC error: {str(err)}'}
            print(json.dumps(err_res), flush=True)

if __name__ == '__main__':
    main()
