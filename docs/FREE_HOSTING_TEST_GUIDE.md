# Cloud Test Deployment Guide: Render, Neon & Cloudflare R2

This guide walks you through preparing, deploying, verifying, and rolling back a separate **cloud test deployment** of the **Telegram Bot BackStage** project using:
- **Render** (Free or Starter Web Service)
- **Neon PostgreSQL** (Serverless PostgreSQL)
- **Cloudflare R2** (Private Object Storage)
- **Two Telegram Test Bots** (Dedicated test bots from BotFather)

> [!IMPORTANT]
> **Safety & Scope Rules**
> 1. **Complete Isolation**: Do NOT point to or reuse any production database, live Telegram bot tokens, or production channels. Use completely fresh test resources.
> 2. **Secret Hygiene**: Never commit, log, screenshot, or share `.env` files, bot tokens, database passwords, encryption keys, or webhook secret tokens.
> 3. **Single Mode Execution**: A bot must run EITHER in **polling mode** (local development) OR in **webhook mode** (cloud hosting). Running both simultaneously causes Telegram `HTTP 409 Conflict` errors.

---

## 1. Readiness Verification Status

### A. Locally Verified Architecture (142 Automated Tests Passing)
- **Multi-Bot Token Encryption**: Verified AES-256-GCM cipher (`enc:v1:<iv>:<authTag>:<ciphertext>`) with isolated keys per bot.
- **Dedicated Webhook Routing**: Each bot has its own endpoint (`/api/telegram/webhook/[botId]`) verifying `X-Telegram-Bot-Api-Secret-Token` via timing-safe comparison.
- **Durable Webhook Tracking**: PostgreSQL `telegram_update_logs` provides update deduplication, concurrent lock rejection (`HTTP 409`), and stalled lease recovery ($>60$s).
- **Opportunistic Auto-Delete Sweeper**: Deletions execute opportunistically whenever webhook requests wake the server, and pending jobs resume automatically.
- **Dual Storage Provider**: Local storage (`STORAGE_PROVIDER="local"`) and S3/R2 (`STORAGE_PROVIDER="s3"`) with private media streaming proxy (`/api/media/posts/[filename]`).
- **Staff Access Control**: Role hierarchy (`SUPER_ADMIN`, `ADMIN`, `EDITOR`, `VIEWER`), bot-scoped assignments, and immediate session invalidation on password change or deactivation.
- **Persistent Rate Limiter**: PostgreSQL-backed brute-force limiter (`login_rate_limits`) preventing credential stuffing across server restarts.
- **IPv4 Connection Agent**: Telegram client explicitly configured with `family: 4` to prevent dual-stack socket hangs on Windows/cloud networks.
- **Token Redaction**: Automatic regex scrubbing of Telegram tokens from logs, audit records, and error messages.

### B. UNVERIFIED Status (Requires Live Cloud Setup)
- **Live Render Web Service Wakeup**: Cold-start response latency (~30–50s on Free plan) when Telegram delivers the first webhook request.
- **Live Neon SSL Latency & PgBouncer**: Connecting to remote Neon compute over public SSL (`?sslmode=require`).
- **Live Cloudflare R2 Uploads**: Uploading and streaming real media files to Cloudflare R2 endpoints.
- **Live Webhook Delivery for Two Bots**: Telegram delivering real updates via HTTPS webhooks to the deployed service.

---

## 2. Resource Provisioning Checklist

### Checklist Item 1: Neon Serverless PostgreSQL
1. Sign up or log in to [Neon](https://neon.tech).
2. Click **Create Project** and name it `backstage-test-db`.
3. Choose your preferred cloud region (e.g. `US East (Ohio)` or `EU Central (Frankfurt)`).
4. In the Neon Console under **Connection Details**:
   - For **Application / Runtime** queries (pooled connection): Select **Pooled connection** (`ep-xyz-pooler...`).
   - For **Database Migrations** (direct connection): Select **Direct connection** (`ep-xyz...`).
5. Connection String format:
   ```env
   # Pooled connection string for web application runtime:
   DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>-pooler.<REGION>.aws.neon.tech/<DB_NAME>?sslmode=require&connect_timeout=30"

   # Direct connection string for Prisma migrations:
   DIRECT_DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>.<REGION>.aws.neon.tech/<DB_NAME>?sslmode=require&connect_timeout=30"
   ```

### Checklist Item 2: Cloudflare R2 Private Bucket
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com) and navigate to **R2**.
2. Click **Create Bucket** and name it (e.g. `backstage-media-test`).
3. Leave bucket access as **Private** (Do NOT enable public bucket access or custom domains).
4. Click **Manage R2 API Tokens** > **Create API Token**:
   - Permissions: **Object Read & Write**
   - Bucket: Apply to `backstage-media-test` only
   - TTL: As desired for your testing window
5. Save the generated credentials:
   - **Endpoint**: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - **Access Key ID**: `<R2_ACCESS_KEY_ID>`
   - **Secret Access Key**: `<R2_SECRET_ACCESS_KEY>`

### Checklist Item 3: Two Telegram Test Bots
1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Create Test Bot 1:
   - Command: `/newbot`
   - Name: `BackStage Test Alpha`
   - Username: `<unique_test_name_1>_bot`
   - Save the token securely.
3. Create Test Bot 2:
   - Command: `/newbot`
   - Name: `BackStage Test Beta`
   - Username: `<unique_test_name_2>_bot`
   - Save the token securely.
4. Create One Private Test Channel:
   - In Telegram, tap New Channel > Private Channel (e.g. `BackStage Private Test`).
   - Add both Test Bot 1 and Test Bot 2 as **Administrators** with the **"Post Messages"** permission enabled.

### Checklist Item 4: Render Web Service
1. Log in to [Render](https://render.com).
2. Connect your private GitHub repository containing the BackStage code.
3. Select **Web Service**:
   - Environment: `Node`
   - Plan: `Free` (or `Starter` $7/mo to avoid the 15-minute inactivity sleep)
   - Build Command: `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
   - Start Command: `npm start`

---

## 3. Environment Variables Reference

Configure these in Render's **Environment** tab. Use strong, randomly generated secrets:

| Variable Name | Required | Example / Description |
| :--- | :---: | :--- |
| `NODE_ENV` | **Yes** | `production` |
| `PORT` | **Yes** | `3000` (or leave default on Render) |
| `DATABASE_URL` | **Yes** | `postgresql://USER:PASSWORD@ep-xyz.REGION.aws.neon.tech/neondb?sslmode=require&connect_timeout=30` |
| `ADMIN_SESSION_SECRET` | **Yes** | 64-char random hex string (`node -e "console.log(crypto.randomBytes(32).toString('hex'))"`) |
| `BOT_TOKEN_ENCRYPTION_KEY` | **Yes** | 64-char random hex string (separate from session secret) |
| `TELEGRAM_MODE` | **Yes** | `webhook` *(enforces webhook mode and disables polling)* |
| `TELEGRAM_WEBHOOK_SECRET` | **Yes** | 32-64 char random string (`[A-Za-z0-9_-]`) passed to Telegram `setWebhook` |
| `STORAGE_PROVIDER` | **Yes** | `s3` *(activates S3/R2 object storage provider)* |
| `S3_ENDPOINT` | **Yes** | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_BUCKET_NAME` | **Yes** | `backstage-media-test` |
| `S3_REGION` | **Yes** | `auto` |
| `S3_ACCESS_KEY_ID` | **Yes** | `<R2_ACCESS_KEY_ID>` |
| `S3_SECRET_ACCESS_KEY` | **Yes** | `<R2_SECRET_ACCESS_KEY>` |
| `ADMIN_DEFAULT_EMAIL` | Optional | Initial setup email (e.g. `admin@yourdomain.test`) |
| `ADMIN_DEFAULT_PASSWORD` | Optional | Initial setup password (must be strong, never default) |

> [!WARNING]
> Do NOT configure `TELEGRAM_BOT_TOKEN` in Render environment variables if you intend to add and manage both bots dynamically through the BackStage UI. Tokens added through the UI are encrypted in the database with `BOT_TOKEN_ENCRYPTION_KEY`.

---

## 4. Safe Deployment & Migration Steps

### Step 1: Pre-Deploy Database Migration
Before triggering the web service build, run migrations from your local terminal to verify database connectivity:

```powershell
# Set temporary connection string to Neon
$env:DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>.<REGION>.aws.neon.tech/<DB_NAME>?sslmode=require&connect_timeout=30"

# Verify pending migrations without changing data
npx prisma migrate status

# Apply the 11 migrations safely
npx prisma migrate deploy

# Clear the terminal variable
Remove-Item env:DATABASE_URL
```

All 11 migrations will be applied:
1. `20261030154040_init`
2. `20261030185650_add_bot_buttons`
3. `20261031024644_add_auto_delete`
4. `20261101100500_add_bot_channels`
5. `20261101112032_add_channel_posts`
6. `20261103182054_add_telegram_update_logs`
7. `20261103185913_add_video_and_post_options`
8. `20261104103553_add_album_post_items`
9. `20261104162204_add_staff_and_storage`
10. `20261104165823_add_persistent_rate_limit`
11. `20261105070100_add_multi_bot_support`

### Step 2: Seed Initial Super-Admin Account
Run the database seed script locally pointing to Neon to create your initial administrator:

```powershell
$env:DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>.<REGION>.aws.neon.tech/<DB_NAME>?sslmode=require&connect_timeout=30"
$env:NODE_ENV="production"
$env:ADMIN_DEFAULT_EMAIL="admin@testbackstage.com"
$env:ADMIN_DEFAULT_PASSWORD="YourStrongInitialPassword123!"

npx tsx prisma/seed.ts

# Clear temporary environment variables
Remove-Item env:DATABASE_URL, env:NODE_ENV, env:ADMIN_DEFAULT_EMAIL, env:ADMIN_DEFAULT_PASSWORD
```

### Step 3: Deploy on Render
1. Trigger **Manual Deploy** > **Deploy latest commit** in Render.
2. Monitor build logs: verify Prisma client generation, migration check, and Next.js compilation succeed.
3. When the service displays `Live`, open your Render URL: `https://<your-render-app>.onrender.com`.

---

## 5. Multi-Bot Webhook Registration & Rollback

Once the web service is live, register each test bot's webhook with Telegram.

### Bot 1 Webhook Setup
1. Log in to BackStage UI and add Test Bot 1 using its BotFather token.
2. Note the generated Bot UUID (e.g. `00000000-0000-0000-0000-000000000001`).
3. In PowerShell, register the webhook with Telegram:
   ```powershell
   curl.exe -F "url=https://<your-render-app>.onrender.com/api/telegram/webhook/<BOT_1_UUID>" `
            -F "secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>" `
            "https://api.telegram.org/bot<BOT_1_TOKEN>/setWebhook"
   ```
4. Verify webhook status:
   ```powershell
   curl.exe "https://api.telegram.org/bot<BOT_1_TOKEN>/getWebhookInfo"
   ```

### Bot 2 Webhook Setup
1. In BackStage UI, add Test Bot 2 using its BotFather token.
2. Note the generated Bot UUID (e.g. `32d19daf-4ae8-4898-aee9-743d51fa58f9`).
3. In PowerShell, register the webhook with Telegram:
   ```powershell
   curl.exe -F "url=https://<your-render-app>.onrender.com/api/telegram/webhook/<BOT_2_UUID>" `
            -F "secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>" `
            "https://api.telegram.org/bot<BOT_2_TOKEN>/setWebhook"
   ```
4. Verify webhook status:
   ```powershell
   curl.exe "https://api.telegram.org/bot<BOT_2_TOKEN>/getWebhookInfo"
   ```

### Rollback Procedure (Returning to Local Polling)
If you wish to switch back to local development polling:
1. Delete the webhook on Telegram:
   ```powershell
   curl.exe "https://api.telegram.org/bot<BOT_1_TOKEN>/deleteWebhook?drop_pending_updates=true"
   curl.exe "https://api.telegram.org/bot<BOT_2_TOKEN>/deleteWebhook?drop_pending_updates=true"
   ```
2. Verify both bots report `"url": ""` in `getWebhookInfo`.
3. In local `.env`, set `TELEGRAM_MODE="polling"` and run `npm run bot`.

---

## 6. End-to-End Smoke Test Checklist

### Test 1: Admin Login & Password Enforcement
- [ ] Navigate to `https://<your-render-app>.onrender.com/login`.
- [ ] Log in with initial credentials.
- [ ] If `mustChangePassword=true` was set, verify the password change dialog is required before accessing other pages.
- [ ] Verify test failed logins trigger rate-limit countdown after 5 failed attempts.

### Test 2: Two-Bot Registration & Isolation
- [ ] View the Dashboard: verify Bot 1 and Bot 2 show connection status `CONNECTED`.
- [ ] In Telegram, send `/start` to Bot 1: verify Bot 1 responds with its custom welcome message.
- [ ] In Telegram, send `/start` to Bot 2: verify Bot 2 responds with its own custom welcome message.
- [ ] In BackStage UI, verify subscriber counts and user lists are completely isolated between Bot 1 and Bot 2.

### Test 3: Private R2 Storage & Media Upload
- [ ] Navigate to **Channel Posts & Broadcast** (`/posts`).
- [ ] Upload an image (PNG or JPG).
- [ ] Verify the thumbnail preview displays in the composer preview (loaded via authenticated proxy from private R2).
- [ ] Verify in Cloudflare R2 Console that the object key exists in your bucket.

### Test 4: Private Test Channel Publishing
- [ ] Select Bot 1 and your target private test channel.
- [ ] Verify the permission badge displays: 🟢 **Can Post**.
- [ ] Click **Publish to Channel**.
- [ ] Verify the post appears in the Telegram channel with correct image, caption, and inline buttons.
- [ ] Repeat with Bot 2 to confirm independent publishing capability.

---

## 7. Free Plan Limitations vs Code Architecture

| Feature / Behavior | Render Free Plan Limitation | BackStage Code Architecture |
| :--- | :--- | :--- |
| **Inactivity Sleep** | Web Service sleeps after 15 min of no HTTP traffic. | Code does not crash; inbound Telegram webhook requests wake the container (~30–50s cold start). |
| **Scheduled Message Auto-Delete** | Background timers (`setInterval`) pause while the container sleeps. | Opportunistic sweeper processes all due deletions as soon as any incoming request wakes the server. |
| **Database Compute Pause** | Neon compute suspends after 5 min of inactivity. | Prisma Client uses `connect_timeout=30` and automatic retry to reconnect seamlessly upon wake-up. |
| **Persistent Media Storage** | Ephemeral container disk wipes on restart. | Code uses Cloudflare R2 object storage; media persists permanently across all container restarts. |
| **Concurrent Polling vs Webhook** | Multiple instances polling the same bot causes Telegram 409 conflict. | Code provides `TELEGRAM_MODE=webhook` guard and per-bot webhook endpoints with update deduplication. |
