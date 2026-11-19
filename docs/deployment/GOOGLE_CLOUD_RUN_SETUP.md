# Google Cloud Run Deployment Guide — MUXARO Real Media Processing Engine

This guide walks you through deploying the **MUXARO API & Media Worker** (`apps/api`) to **Google Cloud Run** using the provided `infra/Dockerfile.api`. 

This setup provides **real `yt-dlp` and `ffmpeg` execution** in the cloud for free (scale-to-zero), connecting seamlessly with your frontend at `https://muxaro.pages.dev`.

---

## Why Google Cloud Run?
- **Genuine Media Processing**: Includes Python 3, `yt-dlp`, and `ffmpeg` inside an isolated Linux container.
- **Scale-to-Zero (100% Free)**: When no downloads are active, instances scale to `0` (consuming ₹0).
- **Free Monthly Tier**: Google provides 2 million requests, 360,000 vCPU-seconds, and 180,000 GiB-seconds free every month.

---

## Route 1: One-Command Deployment via Google Cloud Shell (Recommended)

You do **not** need to install `gcloud` or `docker` on your Windows PC. Google Cloud Shell runs directly in your browser with everything pre-configured.

### Step 1: Open Google Cloud Shell
1. Visit **[https://shell.cloud.google.com](https://shell.cloud.google.com)**.
2. Sign in with your Google account.

### Step 2: Run the Deployment Command
Paste and run the following command in the Cloud Shell terminal:

```bash
# 1. Clone your MUXARO repository (or cd into it)
git clone https://github.com/SubhransuNayak007/muxaro.git
cd muxaro

# 2. Copy Dockerfile to root so gcloud automatically uses it
cp infra/Dockerfile.api Dockerfile

# 3. Deploy directly to Cloud Run
gcloud run deploy muxaro-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "NODE_ENV=production,HOST=0.0.0.0,PORT=8080,RATE_LIMIT_ENABLED=true,TRUST_PROXY=true,STORAGE_DIR=/tmp/muxaro-scratch,MUXARO_DB_PATH=/tmp/muxaro-data/muxaro.db"
```

### Step 3: Get Your Public Service URL
When the build completes, Cloud Run will print:
```text
Service [muxaro-api] revision [muxaro-api-00001-xxx] has been deployed and is serving 100 percent of traffic.
Service URL: https://muxaro-api-xxxxxxxxxx-uc.a.run.app
```
Copy this URL!

---

## Route 2: Deploying via Google Cloud Console Web UI

If you prefer using the Google Cloud web interface:

1. Open **[https://console.cloud.google.com/run](https://console.cloud.google.com/run)**.
2. Click **Create Service**.
3. Under **Deployment platform**:
   - Choose **Continuously deploy from a repository** (Cloud Build).
   - Click **Set up with Cloud Build**.
   - Select provider: **GitHub**.
   - Authenticate and select your repository: **`SubhransuNayak007/muxaro`**.
   - Branch: `^main$`.
   - Build Type: **Dockerfile**.
   - Source location: `/infra/Dockerfile.api`.
4. Under **Service settings**:
   - Service name: `muxaro-api`.
   - Region: `us-central1` (or your nearest region).
5. Under **Authentication**:
   - Select **Allow unauthenticated invocations** (public API).
6. Under **Container, Networking, Security**:
   - **Container port**: `8080`.
   - **Capacity**: `1 vCPU`, `1 GiB RAM`.
   - **Scaling**:
     - Minimum number of instances: `0` *(Crucial: ensures it scales to zero and costs ₹0 when idle)*.
     - Maximum number of instances: `2`.
   - **Environment variables**:
     - `NODE_ENV` = `production`
     - `HOST` = `0.0.0.0`
     - `PORT` = `8080`
     - `RATE_LIMIT_ENABLED` = `true`
     - `TRUST_PROXY` = `true`
7. Click **Create**.
8. Copy the generated HTTPS service URL (e.g. `https://muxaro-api-xxxxxxxxxx-uc.a.run.app`).

---

## Connecting Cloud Run to Cloudflare Pages (`muxaro.pages.dev`)

Now connect your live Cloudflare Pages website to your new Cloud Run media worker:

### Method A: Via Cloudflare Dashboard
1. Go to **[Cloudflare Dashboard](https://dash.cloudflare.com)**.
2. Navigate to **Workers & Pages** -> Select **`muxaro`**.
3. Click on **Settings** -> **Variables and Secrets**.
4. Click **Add variable**:
   - **Variable name**: `UPSTREAM_API_URL`
   - **Value**: `https://muxaro-api-xxxxxxxxxx-uc.a.run.app` (your Cloud Run URL).
5. Click **Save and deploy**.

### Method B: Via Terminal / Wrangler
Run this command from your PC:
```powershell
cd "d:\yt doenlord\apps\web"
npx wrangler pages secret put UPSTREAM_API_URL --project-name=muxaro
# When prompted, paste your Cloud Run URL: https://muxaro-api-xxxxxxxxxx-uc.a.run.app
```

---

## Verification Checklist

Once connected:
1. Open `https://muxaro.pages.dev/api/v1/health` in your browser:
   - Should return `status: "HEALTHY"`, `backendConnected: true`.
2. Open `https://muxaro.pages.dev`:
   - Paste any YouTube link.
   - Click **Analyse** -> Real video metadata, real author, real thumbnail will appear in ~3 seconds.
   - Click **Download video** or **Extract audio** -> Cloud Run executes `ffmpeg` and serves the genuine, playable `.mp4` or `.mp3` file directly.
