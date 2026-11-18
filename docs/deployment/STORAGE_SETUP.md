# MUXARO Object Storage Setup (Cloudflare R2 & Local Disk)

**Primary Implementation:** `apps/api/src/services/storage.service.ts` (zero-dependency pure-Node `AWS4-HMAC-SHA256` SigV4 client)  
**Verification Script:** `qa/harness/verify-r2-sigv4.ts`

---

## 1. Honest Mode Selection (`r2` vs. `local`)

`StorageService` inspects the 4 required R2 environment variables at startup:
- **`R2_ACCOUNT_ID`**
- **`R2_ACCESS_KEY_ID`**
- **`R2_SECRET_ACCESS_KEY`**
- **`R2_BUCKET_NAME`**

| Condition | Active Mode | Behaviour |
| :--- | :---: | :--- |
| All 4 `R2_*` variables set | `storageMode: 'r2'` | Uses private Cloudflare R2 bucket via AWS SigV4 REST requests & presigned download URLs (`GET /api/v1/ready` reports `r2Configured: true`). |
| Any of the 4 `R2_*` variables unset | `storageMode: 'local'` | Cleanly uses local directories (`.muxaro-uploads/`, `.muxaro-artifacts/`) and reports `r2Configured: false`. Partial R2 configurations emit a warning via `validateProductionConfig()`. |

---

## 2. Bucket Layout & Non-Guessable Object Keys

Create a single **private** Cloudflare R2 bucket (e.g., `muxaro-media`) with **Public Development URL disabled**.

All objects reside under 4 allowed logical prefixes enforced by `StorageService.assertSafeObjectKey()`:

| Prefix | Contents | Retention Policy |
| :--- | :--- | :--- |
| `uploads/` | User local file uploads awaiting processing | 24h R2 lifecycle auto-purge |
| `processed/` | Completed video/audio output artifacts | 60-min signed URL TTL + 24h lifecycle safety net |
| `playlists/` | Packaged multi-item ZIP archives | 60-min signed URL TTL + 24h lifecycle safety net |
| `temporary/` | Intermediate scratch chunks / abandoned multipart state | 24h R2 lifecycle auto-purge |

Object key pattern (`generateObjectKey()`):
```text
<prefix>/<YYYYMMDD>/<sha256(ownerId)[0..12]>/<24-hex-random-nonce>_<sanitizedFilename>
```
- Owner IDs are hashed (never raw emails or user IDs).
- Path traversal (`..`), null bytes, backslashes, leading slashes, and unknown prefixes are rejected.
- Uploads enforce MIME allowlist (`video/*`, `audio/*`, `application/octet-stream`, `application/zip`), 2 GiB max byte cap, and `x-amz-meta-sha256` integrity tagging.

---

## 3. Provisioning Cloudflare R2

1. **Create Bucket:** Cloudflare Dashboard → **R2 Object Storage → Create bucket** → Name: `muxaro-media` (Private).
2. **Create Scoped API Token:** **R2 → Manage R2 API Tokens → Create API Token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: **`muxaro-media` only** (least privilege).
3. **Store Secrets in Google Secret Manager:** Populate `muxaro-r2-account-id`, `muxaro-r2-access-key-id`, `muxaro-r2-secret-access-key`, and `muxaro-r2-bucket-name` (see [Secrets Management](../security/SECRETS_MANAGEMENT.md)).
4. **Configure Lifecycle Auto-Purge Rules** (R2 Bucket → Settings → Object lifecycle rules):
   - Delete objects under `uploads/`, `processed/`, `playlists/`, and `temporary/` after **1 day**.
   - **Abort incomplete multipart uploads** (prefix `""`) after **1 day** to prevent orphaned storage billing.
5. **Optional CORS Policy** (required only if enabling direct browser-to-R2 multipart PUTs):
   ```json
   [
     {
       "AllowedOrigins": ["https://muxaro.app"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["Content-Type", "Content-Length", "Range", "If-Range", "x-amz-meta-sha256"],
       "ExposeHeaders": ["ETag", "Content-Range", "Content-Length", "Accept-Ranges"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

---

## 4. Verification

```bash
# Verify pure-Node AWS SigV4 signing, key sanitization, and presigned URL generation locally
npx tsx qa/harness/verify-r2-sigv4.ts
```

After live R2 credentials are mounted in staging/production, verify `GET /api/v1/ready` reports `"storageMode": "r2", "r2Configured": true` and smoke-test a presigned `GET` including `Range: bytes=0-1023` (`206 Partial Content`).
