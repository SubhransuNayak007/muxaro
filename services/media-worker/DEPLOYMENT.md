# MUXARO Media Worker — Production Deployment & Operations Guide

The MUXARO Media Worker is an ultra-lightweight, zero-transcode, non-root streaming microservice powered by Node.js, static FFmpeg, and yt-dlp. It handles fast media inspection (probe) and direct stream copy remuxing (`-c:v copy -c:a copy`) with zero disk writes, streaming output directly into the HTTP response.

---

## 1. Architecture & Resource Profile

- **Zero-Transcoding Stream Copy**: Remuxes input packets directly into fragmented MP4 (`-f mp4 -movflags frag_keyframe+empty_moov`). Video and audio streams are preserved bit-for-bit without CPU re-encoding.
- **Zero Disk Writes**: Media packets are piped in real-time from FFmpeg `stdout` into the HTTP response socket.
- **Immediate Disconnect Cleanup**: If a client cancels the download or disconnects, the socket close event (`req.raw.on('close')`) immediately sends `SIGKILL` to FFmpeg and yt-dlp. Tini (PID 1) reaps the process to prevent zombie leaks.
- **Footprint**:
  - **Memory Idle**: ~45–60 MB RAM
  - **Memory Under Load**: ~90–140 MB RAM
  - **CPU Utilization**: <15% of 1 core during 2K/1440p stream copy
  - **Target Tiers**: Oracle Cloud Always Free (2 OCPU, 12 GB RAM) and Render Free (0.1 CPU, 512 MB RAM).

---

## 2. Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5001` | HTTP listening port (Render automatically provides `PORT=10000`). |
| `HOST` | `0.0.0.0` | Network binding interface. |
| `NODE_ENV` | `production` | Node runtime environment. |
| `ALLOWED_ORIGINS` | `*` | Allowed CORS origins (e.g. `https://muxaro.vercel.app,http://localhost:3000`). |
| `MAX_FILE_SIZE_MB` | `500` | Stream size ceiling before terminating to prevent runaway bandwidth. |
| `MAX_CONCURRENT_STREAMS` | `5` | Maximum active FFmpeg stream copy pipelines per container instance. |
| `STREAM_TIMEOUT_SECONDS` | `300` | Hard timeout (5 minutes) for any single stream pipeline. |
| `PROBE_TIMEOUT_SECONDS` | `8` | Hard timeout (8 seconds) for metadata probe operations. |
| `LOG_LEVEL` | `info` | Logger verbosity (`fatal`, `error`, `warn`, `info`, `debug`). |

---

## 3. Deployment to Oracle Cloud Infrastructure (OCI Always Free)

Oracle Cloud provides up to 4 Ampere A1 (ARM64) cores and 24 GB RAM for free (or 2 cores / 12 GB RAM per VM).

### Step 3.1: Provision Compute Instance
1. In the OCI Console, navigate to **Compute > Instances > Create Instance**.
2. **Image**: Canonical Ubuntu 22.04 Minimal or Debian 12.
3. **Shape**: `VM.Standard.A1.Flex` (2 OCPU, 12 GB RAM).
4. Add your SSH Public Key and click **Create**.

### Step 3.2: Configure Network Firewall
In the OCI Console:
1. Open the instance's **Virtual Cloud Network (VCN) > Security Lists > Default Security List**.
2. Add an **Ingress Rule**:
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: TCP
   - **Destination Port Range**: `5001, 80, 443`

In the VM terminal, open the host firewall:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 5001 -j ACCEPT
sudo netfilter-persistent save
```

### Step 3.3: Install Docker & Docker Compose
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

### Step 3.4: Deploy MUXARO Media Worker
```bash
git clone https://github.com/your-org/muxaro.git
cd muxaro/services/media-worker

# Setup environment
cp .env.example .env

# Build and start container in detached mode
docker compose up -d --build

# Verify container status
docker compose ps
docker compose logs -f
```

### Step 3.5: Configure Systemd Auto-Start
Create `/etc/systemd/system/muxaro-worker.service`:
```ini
[Unit]
Description=MUXARO Media Worker Container
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/muxaro/services/media-worker
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```
Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable muxaro-worker.service
```

---

## 4. Deployment to Render.com (Free Tier)

Render's Free Web Service tier includes 512 MB RAM, 0.1 CPU, and automatic HTTPS.

### Step 4.1: Connect GitHub / GitLab Repository
1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click **New + > Web Service**.
3. Select your MUXARO repository.

### Step 4.2: Configure Service Settings
- **Name**: `muxaro-media-worker`
- **Region**: Choose the region closest to your users (e.g. Frankfurt, Oregon, Singapore).
- **Environment**: `Docker`
- **Root Directory**: `services/media-worker`
- **Dockerfile Path**: `services/media-worker/Dockerfile`
- **Plan**: `Free`

### Step 4.3: Set Environment Variables
In the Render Service dashboard, add the following under **Environment**:
```env
NODE_ENV=production
ALLOWED_ORIGINS=*
MAX_FILE_SIZE_MB=500
MAX_CONCURRENT_STREAMS=5
STREAM_TIMEOUT_SECONDS=300
PROBE_TIMEOUT_SECONDS=8
```
*(Note: Render automatically injects `PORT=10000`, which our Dockerfile and healthcheck automatically support via `${PORT:-5001}`)*.

### Step 4.4: Configure Health Check Path
Under **Advanced Settings**:
- **Health Check Path**: `/health`

Click **Create Web Service**. Render builds the multi-stage Dockerfile and deploys the service with a public `https://<service-name>.onrender.com` URL.

---

## 5. Verification & Testing Commands (curl)

Run these terminal commands to verify the media worker's functionality, performance, and failure modes.

### 5.1 Service Healthcheck
```bash
curl -i http://localhost:5001/health
```
**Expected Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 47

{"status":"ok","worker":"muxaro-media-worker"}
```

---

### 5.2 Direct MP4 Stream Copy Verification
Tests streaming a direct open MP4 stream with zero transcoding:
```bash
curl -i -N \
  "http://localhost:5001/stream?url=https%3A%2F%2Fcommondatastorage.googleapis.com%2Fgtv-videos-bucket%2Fsample%2FBigBuckBunny.mp4&format=mp4&quality=1080p" \
  -o test_direct_1080p.mp4
```
**Verification Points:**
- `HTTP/1.1 200 OK`
- `Content-Type: video/mp4`
- `Content-Disposition: attachment; filename="muxaro_stream.mp4"`
- `Transfer-Encoding: chunked`
- Output file plays smoothly and has valid MP4 moov/atom headers.

---

### 5.3 HLS / m3u8 Stream Remux Verification
Tests remuxing live or VOD HLS streams into an MP4 container on the fly:
```bash
curl -i -N \
  "http://localhost:5001/stream?url=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8&format=mp4&quality=720p" \
  -o test_hls_720p.mp4
```
**Verification Points:**
- Remux starts transmitting bytes within 1–2 seconds.
- Memory usage stays below 120 MB.

---

### 5.4 Fast Metadata Probe Verification
Tests fast format inspection with the 8-second strict timeout:
```bash
curl -i -X POST http://localhost:5001/probe \
  -H "Content-Type: application/json" \
  -d '{"url":"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"}'
```
**Expected Response:**
```json
{
  "ok": true,
  "title": "BigBuckBunny",
  "formats": [
    { "format_id": "1080p", "resolution": "1080p", "ext": "mp4", "quality": "1080p · Cloud" },
    { "format_id": "720p", "resolution": "720p", "ext": "mp4", "quality": "720p · Cloud" },
    { "format_id": "audio", "resolution": "audio", "ext": "mp3", "quality": "Audio Only · Cloud" }
  ]
}
```

---

### 5.5 Fast Bot-Detection / Host-Blocked 403 Verification
Tests that cloud-blocked hosts (e.g. YouTube datacenter IP blocking) return an honest 403 immediately without hanging:
```bash
curl -i -X POST http://localhost:5001/probe \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```
**Expected Response (<2 seconds):**
```http
HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8

{
  "ok": false,
  "code": "HOST_BLOCKED",
  "status": 403,
  "message": "This host blocks free cloud servers. Use Desktop Direct or connect a custom residential worker."
}
```

---

### 5.6 Early Disconnect & Process Cleanup Verification
Tests that terminating client download immediately terminates FFmpeg with zero zombie processes:
```bash
# Start download and immediately abort after reading 1 MB
curl -N "http://localhost:5001/stream?url=https%3A%2F%2Fcommondatastorage.googleapis.com%2Fgtv-videos-bucket%2Fsample%2FBigBuckBunny.mp4&format=mp4" | head -c 1048576 > /dev/null
```
**Verification Points:**
- Check container processes via `docker exec -it muxaro-media-worker ps aux`.
- No lingering `ffmpeg` or `yt-dlp` child processes remain running.
- CPU immediately drops back to 0.0%.
