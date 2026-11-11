# Telegram Channel Post Manager Roadmap & Architecture Guide

This document outlines the technical specification, API parameter mapping, and development roadmap for the Telegram Channel Post Manager in BackStage. It covers all post types, Telegram Bot API capabilities, hosting constraints, and safety considerations.

---

## 1. Executive Summary & Capabilities Matrix

The BackStage Channel Post Manager is designed to provide an administrative workspace composer comparable to Telegram's native client, backed by PostgreSQL persistence and grammY Telegram Bot API dispatch.

| Post Type | Telegram API Method | Max Caption / Text | Spoiler (`has_spoiler`) | Inline Buttons (`reply_markup`) | Silent (`disable_notification`) | File Size Limit (Bot API) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Text** | `sendMessage` | 4,096 chars | ❌ (Entities only) | ✅ Up to 100 buttons | ✅ Supported | N/A |
| **Photo** | `sendPhoto` | 1,024 chars | ✅ Supported | ✅ Supported | ✅ Supported | 10 MB |
| **Video** | `sendVideo` | 1,024 chars | ✅ Supported | ✅ Supported | ✅ Supported | 50 MB (25 MB MVP) |
| **Document** | `sendDocument` | 1,024 chars | ❌ Not supported | ✅ Supported | ✅ Supported | 50 MB (25 MB MVP) |
| **Media Album** | `sendMediaGroup` | 1,024 chars | ✅ Supported (per item) | ❌ **API Limitation** | ✅ Supported | Up to 10 items |
| **Audio** | `sendAudio` | 1,024 chars | ❌ Not supported | ✅ Supported | ✅ Supported | 50 MB |
| **Voice Note** | `sendVoice` | 1,024 chars | ❌ Not supported | ✅ Supported | ✅ Supported | 50 MB (OGG Opus) |
| **Poll / Quiz** | `sendPoll` | 300 char question | ❌ Not supported | ✅ Supported | ✅ Supported | N/A |
| **Animation / GIF**| `sendAnimation` | 1,024 chars | ✅ Supported | ✅ Supported | ✅ Supported | 50 MB |
| **Paid Media** | `sendPaidMedia` | 1,024 chars | ✅ (Stars paywall) | ✅ Supported | ✅ Supported | Photos & Videos |

> [!IMPORTANT]
> **Telegram Bot API Critical Limitation - Media Albums (`sendMediaGroup`)**:
> Telegram Bot API's `sendMediaGroup` method **does NOT accept inline keyboards** (`reply_markup`). To attach inline buttons to an album, BackStage will implement the standard two-message pattern: send the album first, then immediately dispatch a short follow-up message carrying the inline keyboard.

---

## 2. Phased Implementation Roadmap

### Phase 1 — Core Media, Delivery Options & Document Fallback (CURRENT)
- [x] **Video with Caption**: Direct `sendVideo` with streaming flag `supports_streaming: true`.
- [x] **Send Video as Document**: Dispatch video files via `sendDocument` to preserve exact source bitrates and containers without Telegram compression.
- [x] **Silent Delivery**: `disable_notification: true` across all post types.
- [x] **Media Spoiler Protection**: `has_spoiler: true` for photos and regular videos (automatically disabled with user guidance when sending as document or text).
- [x] **Local Preference Memory**: Non-sensitive UI preference `botdesk_pref_send_as_document` safely remembered via browser `localStorage`.
- [x] **Draft, Preview & Safe Dispatch**: Pre-publish confirmation modal, live simulation with video player, document cards, and spoiler blur hover peek.

---

### Phase 2 — Media Albums (`sendMediaGroup`)
- **Capabilities**:
  - Upload 2 to 10 photos and videos in a single post draft.
  - Drag-and-drop reordering of album slides.
  - Assign caption to the first item (`InputMediaPhoto` / `InputMediaVideo`).
  - Item-level spoiler toggle (`has_spoiler` on individual photos or videos).
- **Inline Button Handling**:
  - Automatically detect if inline buttons are configured for an album.
  - Option A: Append button URLs to the album caption as formatted links.
  - Option B (Recommended): Dispatch album via `sendMediaGroup`, then immediately dispatch an anchored announcement with the inline keyboard.
- **Database Schema Additions**:
  ```prisma
  model AlbumItem {
    id        String      @id @default(uuid())
    postId    String
    post      ChannelPost @relation(fields: [postId], references: [id], onDelete: Cascade)
    mediaType String      // "PHOTO" | "VIDEO"
    filePath  String
    order     Int         @default(0)
    hasSpoiler Boolean    @default(false)
  }
  ```

---

### Phase 3 — Audio Tracks & Voice Messages (`sendAudio`, `sendVoice`)
- **Capabilities**:
  - `sendAudio`: MP3, M4A, FLAC uploads with metadata extraction (artist, track title, duration in seconds, embedded album artwork thumbnail).
  - `sendVoice`: OGG Opus voice memos with waveform display in channel feeds.
- **Validation**:
  - Magic byte detection: `ID3` tag for MP3, `OggS` for OGG.
  - Duration limits: up to 120 minutes per audio file.

---

### Phase 4 — Interactive Polls & Quizzes (`sendPoll`)
- **Capabilities**:
  - Question text (1 to 300 characters).
  - 2 to 10 poll options (each up to 100 characters).
  - Anonymous vs Public voting (`is_anonymous: boolean`).
  - Multiple answers allowed (`allows_multiple_answers: boolean`).
  - Quiz Mode (`type: "quiz"`):
    - Required `correct_option_id: number`.
    - Optional explanation (`explanation: string`, up to 200 characters) shown when users pick the wrong answer.
- **Preview Simulator**:
  - Interactive radio / checkbox widget in the Right Column simulator.

---

### Phase 5 — Looping Animations, GIFs & Stickers (`sendAnimation`, `sendSticker`)
- **Capabilities**:
  - `sendAnimation`: MP4 without audio or animated GIF files that loop automatically in Telegram without showing a full video transport bar.
  - `sendSticker`: WebP static stickers or TGS (Lottie) / WEBM animated stickers.

---

### Phase 6 — Durable Channel Post Scheduling
- **Native Telegram Scheduling vs BackStage Queue**:
  - *Native Telegram (`schedule_date`)*:
    - Telegram Bot API supports `schedule_date` on some message types, but scheduled messages are managed within Telegram servers and cannot be easily updated or cancelled via standard Bot API once dispatched.
  - *BackStage Durable Scheduler (Recommended)*:
    - Store drafts in PostgreSQL with `scheduledAt DateTime?` and `status = "SCHEDULED"`.
    - Centralized background runner runs a periodic cron tick every 30 seconds:
      `SELECT * FROM "ChannelPost" WHERE status = 'SCHEDULED' AND "scheduledAt" <= NOW() FOR UPDATE SKIP LOCKED`
    - Guarantees editability up to the last second before publishing.
    - Works reliably across container restarts without losing schedule state.

---

### Phase 7 — Telegram Stars Monetization & Paid Media (`sendPaidMedia`)
- **Capabilities**:
  - Telegram Stars Paywall: Channels with paid media enabled can publish photos or videos locked behind a Telegram Stars paywall (`star_count: number`, from 1 to 2,500 Stars).
  - Telegram Bot API method: `sendPaidMedia(chat_id, star_count, media, options)`.
  - Paywall preview: Subscribers see a blurred preview with a lock badge showing "Unlock for X Stars".
- **Difference from `allow_paid_broadcast`**:
  - `sendPaidMedia`: Commercial pay-per-view media posts where the user pays Stars to view content.
  - `allow_paid_broadcast`: Channel-level broadcast fee flag when a bot broadcasts messages to paid channels that have reached broadcast rate-limits.

---

### Phase 8 — Multi-Channel Broadcast & Granular RBAC
- **Capabilities**:
  - Select multiple managed channels simultaneously (e.g. Broadcast to @channel_en and @channel_ru).
  - Real-time progress bar tracking delivery success/failure per channel.
  - Granular permissions:
    - `POST_AUTHOR`: Can draft and edit posts, but cannot publish.
    - `POST_PUBLISHER`: Can approve drafts and dispatch to authorized channels.
    - `SUPER_ADMIN`: Full access to bot tokens, channel settings, and deletion sweepers.

---

## 3. Hosting, Webhook & Worker Reliability Review

### 3.1 Lease Timeouts & Stale Worker Fencing
- **Current Behavior**:
  - In `src/lib/update-tracker.ts`, update claims expire after 60 seconds (`LEASE_TIMEOUT_MS = 60_000`).
  - If a worker crashes or hangs for 61 seconds, a subsequent incoming webhook retry reclaims the update.
- **Race Condition Window**:
  - If the original worker awakens after 65 seconds and attempts to mark the update `COMPLETED`, it could overwrite the active work of the second worker.
- **Required Hardening (Fencing Tokens)**:
  - Add an incrementing `claimVersion Int @default(1)` to `TelegramUpdateLog`.
  - When claiming an update: `claimVersion: { increment: 1 }`.
  - When completing the update:
    `UPDATE "TelegramUpdateLog" SET status = 'COMPLETED' WHERE id = :id AND claimVersion = :workerClaimVersion`
  - If zero rows are updated, the worker aborts cleanly without corrupting the state.

### 3.2 Free Cloud Hosting Constraints (Render & Neon)
1. **Render Free Web Service Spindown**:
   - Free instances spin down after 15 minutes of inbound HTTP inactivity.
   - Incoming Telegram webhooks will experience a 30 to 50 second cold-start delay on the initial request. Telegram retries automatically after 60 seconds if the initial connection times out.
2. **Ephemeral Local Filesystem**:
   - Render Free instances have an ephemeral local disk. Files stored in `uploads/` will be **wiped** whenever the service restarts, deploys, or wakes from idle sleep.
   - **Production Migration Recommendation**: For online deployment, media storage should transition from local disk (`uploads/posts/`) to Cloudflare R2 or AWS S3 presigned URLs.
3. **Opportunistic Sweeper Lifecycle**:
   - The auto-delete message sweeper currently executes opportunistically during active HTTP requests.
   - On free hosting where the app sleeps during quiet hours, scheduled deletions will pause until the next incoming webhook or admin login triggers the sweeper.
