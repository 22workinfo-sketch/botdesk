# Telegram Bot Backstage — MVP Technical Audit Report

> **Audit Date**: 2026-10-30  
> **Target Repository**: `C:\Users\JM505 Computers\Documents\BackStage`  
> **Status**: Audit & Security Hardening Complete  
> **Auditor**: Senior Software Architect & Implementation Partner

---

## 1. Executive Summary & Readiness Assessment

### Is the project ready for a local live-bot test?
**YES, READY.**

All pre-requisite security fixes identified in the initial inspection have been implemented and verified:
1. **Contact Ownership Validation**: `handleTelegramContact` now strictly verifies that `contact.user_id` is present and matches the sender's Telegram ID (`senderTelegramId`). Forwarded or third-party contacts are rejected without overwriting existing data.
2. **Localhost Restriction**: Next.js development server is locked to `127.0.0.1:3000` via `-H 127.0.0.1`.
3. **Private Admin Password Management**: A dedicated script (`npm.cmd run admin:password`) updates only the admin account in PostgreSQL without touching other tables.
4. **Automated Test Suite**: Expanded to **13 automated tests** across 3 test suites with 100% pass rate.

---

## 2. Project State & Git Tracking Verification

| Item | Expected Status | Verified Status | Evidence |
| :--- | :--- | :--- | :--- |
| **Project Directory** | `C:\Users\JM505 Computers\Documents\BackStage` | Verified | Workspace confirmed |
| **Git Repository** | Initialized | Verified | Local Git repository on `master` branch |
| **Untracked Commits** | Clean local state | Verified | Zero remote targets; no code pushed |
| **`.env` Ignored** | Must NEVER be tracked | Verified | `git check-ignore -v .env` confirms ignore rule at `.gitignore:7` |
| **`.env` Index Status** | Not in index | Verified | `git ls-files .env` returns 0 files |
| **`.env.example`** | Safe placeholders only | Verified | Safe placeholders only; no real secrets |

---

## 3. Original Scope vs. Implemented Scope

`docs/PROJECT_PLAN.md` exists and defines the approved MVP requirements.

### Implemented Features Inside Scope
1. **Telegram `/start` Command Flow**: Upserts profile, provides welcome greeting and menu.
2. **User Profile Persistence**: Records `telegram_id` (BigInt), `name` (`firstName` + `lastName`), `username`, and timestamps.
3. **Dynamic Welcome Message**: Stored in `bot_configs` and fetched dynamically on `/start`.
4. **Admin Web Backstage**: Next.js App Router with login page, bot dashboard, and bot settings editor.
5. **Session-Based Authentication**: Encrypted JWT cookies (`jose`), bcrypt password hashing, and route protection.
6. **Data Isolation (`bot_id`)**: All bot tables enforce `bot_id`. Queries strictly isolate user records per bot.
7. **Local Long Polling**: Uses grammY long polling (outbound only, 0 inbound open ports).
8. **Health Check Endpoint**: `/api/health` reports status, database connectivity, and registered bot counts.

### Implemented Features Added via User Request
- **Secured Phone Number Collection (`telegram_ph_no`)**:
  - Optional for the user.
  - Transparent notice displayed during `/start` explaining support/contact purpose.
  - Strict server-side ownership verification (`contact.user_id === from.id`).
  - Stored in PostgreSQL `telegram_users.telegramPhNo`.
  - Displayed only in the authenticated backstage user table.

### Features Beyond Minimum MVP Scope (Architectural Enhancements)
- **Audit Logging Table (`audit_logs`)**: Records configuration changes with previous & new values, admin ID, and timestamps.
- **Bot Standby Mock Mode**: Exits cleanly with setup instructions if `TELEGRAM_BOT_TOKEN` is unset or a placeholder.
- **Dedicated Admin Password Updater**: `scripts/update-admin-password.ts` updates only `admin_users.passwordHash`.

---

## 4. In-Depth Component Inspection

### 4.1 Telegram `/start` Flow & Database Persistence
- **Implementation**: Located in `src/bot/index.ts` and `src/lib/bot-service.ts` (`handleTelegramStart`).
- **Mechanism**:
  - `ctx.from` provides `id`, `first_name`, `last_name`, `username`, and `language_code`.
  - Upsert query: `prisma.telegramUser.upsert` with composite unique constraint `@@unique([botId, telegramId])`.
  - Profile is created on first interaction and `lastSeenAt` is updated on subsequent interactions.
  - Includes a clear disclosure note informing users that phone sharing is optional and only used by backstage staff for customer support.
  - Basic menu works fully without phone sharing.

### 4.2 Contact / Phone Number Handling & Ownership Analysis
- **Collection Mechanism**:
  - `src/bot/index.ts` listens on `bot.on(":contact")`.
  - Calls `handleTelegramContact` with `senderTelegramId: from.id`, `contactUserId: contact.user_id`, and `phoneNumber: contact.phone_number`.
- **Validation Logic**:
  1. Verifies `contact.user_id` is defined and not null.
  2. Verifies `BigInt(contact.user_id) === BigInt(senderTelegramId)`.
  3. If invalid: Rejects with `"OWNERSHIP_MISMATCH"` or `"MISSING_CONTACT_USER_ID"`. Does NOT update the database. Preserves any existing verified phone number. Replies with guidance to use the "Share Phone Number" button.
  4. If valid: Persists phone number to PostgreSQL and acknowledges.
- **Logging Safety**: Phone numbers are NEVER printed to logs.

### 4.3 Admin Login, Session Handling & Route Protection
- **Password Security**: Standard bcrypt with 12 salt rounds (`bcryptjs`).
- **Session Tokens**: Signed HS256 JWTs using `jose` with a 24-hour expiration.
- **Cookie Security**: Set with `httpOnly: true`, `sameSite: "lax"`, and `path: "/"`.
- **API Guarding**:
  - Protected API routes (`/api/bots/[id]/config`, `/api/bots/[id]/users`) extract session and return `401 Unauthorized` if missing or invalid.
  - Unauthenticated requests cannot read user records or phone numbers.
- **Server Component Guarding**:
  - Server components (`/dashboard`, `/bots/[id]`) check `getAdminSession()` and issue `redirect("/login")` if unauthenticated.

### 4.4 Bot-Level Authorization & Data Separation
- **Data Isolation at DB Layer**: Enforced. Every query in `src/lib/bot-service.ts` uses `where: { botId }`. Tests prove Bot 1 never retrieves Bot 2 users.
- **Single-Admin MVP Limitation**:
  - The API verifies that the caller is an authenticated admin, but does not yet implement a multi-tenant permission table mapping specific admin accounts to specific `bot_id`s.
  - Under the current single-admin, single-bot MVP, this is intentional and safe, but proper multi-staff RBAC is required before multi-admin expansion.

---

## 5. Network Interface & Localhost Binding Verification

| Component | Port | Interface Binding | Evidence & Verdict |
| :--- | :--- | :--- | :--- |
| **PostgreSQL Database** | 5432 | `127.0.0.1:5432` | **STRICTLY LOCALHOST**. `docker-compose.yml` explicitly specifies `127.0.0.1:5432:5432`. Not reachable from external LAN adapters. |
| **Telegram Bot Runner** | None | Outbound only | **NO INBOUND PORTS**. Uses Telegram long polling (`getUpdates`). No inbound server socket is opened. |
| **Next.js Web Admin** | 3000 | `127.0.0.1:3000` | **STRICTLY LOCALHOST**. `package.json` dev script updated to `next dev -H 127.0.0.1`. Verified via `Get-NetTCPConnection` that socket binds to `127.0.0.1:3000`. |

---

## 6. Test Suite Analysis & Coverage Audit

### Exact Test Execution Evidence
- **Command**: `npm.cmd test` (`vitest run`)
- **Duration**: 3.03s
- **Result**: 3 test files passed, 13 tests passed (100% pass rate).

### Mock vs. Real Infrastructure Breakdown

| Test File | Test Case | Target Tested | Real Infra vs. Mock |
| :--- | :--- | :--- | :--- |
| `tests/auth.test.ts` | Hash & verify password | bcryptjs hashing | **In-Memory Logic Mock** |
| `tests/auth.test.ts` | Old/new password lifecycle | Password update behavior | **In-Memory Logic Mock** (Disposable test credentials) |
| `tests/auth.test.ts` | Create & verify session | jose JWT signing | **In-Memory Logic Mock** |
| `tests/auth.test.ts` | Reject tampered tokens | jose JWT rejection | **In-Memory Logic Mock** |
| `tests/api.test.ts` | `GET /api/health` returns 200 | Health check route | **Real PostgreSQL** (`prisma.bot.count()`) |
| `tests/api.test.ts` | `PUT /api/bots/[id]/config` rejects 401 | Unauthenticated guard | **Mock NextRequest** |
| `tests/api.test.ts` | `GET /api/bots/[id]/users` rejects 401 | Unauthenticated guard & no data leak | **Mock NextRequest** |
| `tests/bot-service.test.ts` | `/start` works without phone number | Profile upsert & greeting | **Real PostgreSQL** (Docker container) |
| `tests/bot-service.test.ts` | Contact accepted on matching ID | Contact verification | **Real PostgreSQL** (Synthetic test data) |
| `tests/bot-service.test.ts` | Contact rejected on ID mismatch | Ownership validation | **Real PostgreSQL** (Synthetic test data; no overwrite) |
| `tests/bot-service.test.ts` | Contact rejected on missing ID | Missing ID validation | **Real PostgreSQL** (Synthetic test data; no overwrite) |
| `tests/bot-service.test.ts` | Update welcome text & audit log | `updateBotWelcomeMessage` | **Real PostgreSQL** (Docker container) |
| `tests/bot-service.test.ts` | Cross-bot data isolation | `getBotUsers` isolation | **Real PostgreSQL** (Docker container) |

---

## 7. Security and Functionality Gaps (Ranked by Priority)

### [Resolved] Contact Ownership Validation
- **Status**: **RESOLVED**. Implemented in `src/lib/bot-service.ts` and `src/bot/index.ts`. Tested in `tests/bot-service.test.ts`.

### [Resolved] Next.js Host Binding
- **Status**: **RESOLVED**. Configured with `-H 127.0.0.1` in `package.json` and verified with `Get-NetTCPConnection`.

### [Medium Priority - Future Phase] Multi-Admin to Bot Authorization Mapping
- **Status**: Architectural limitation of the single-admin MVP.
- **Details**: Currently, any authenticated admin can access any bot ID. Before adding multiple admin staff, an `AdminBotPermission` table or ownership check must be introduced.

### [Low Priority - Future Phase] Role-Based Access Control (RBAC) in Route Handlers
- **Status**: In the current single-admin setup, the owner is `SUPER_ADMIN`. Before onboarding `VIEWER` accounts, route handlers should check `session.role !== "SUPER_ADMIN"`.

---

## 8. Unverified @UnitySpaceBot Requirements

The features of `@UnitySpaceBot` remain **UNVERIFIED**. The following remain completely excluded from the codebase:

| Feature Area | Current Status in BackStage | Action Required from User |
| :--- | :--- | :--- |
| **In-Bot Payments / Stars / Stripe** | Excluded | Provide screenshots/recording of payment flow |
| **Crypto / Fiat Wallets** | Excluded | Provide screenshots of deposit/balance mechanics |
| **Betting / Prediction Markets** | Excluded | Confirm if this is even a feature of the bot |
| **Mass Broadcast Messaging** | Excluded | Provide screenshots of broadcast UI |
| **Referral / Affiliate Tracking** | Excluded | Provide screenshots of invite link format |
| **Telegram Mini App (Web Modal)** | Excluded | Provide recording of webapp launch |

---

## 9. Local End-to-End Testing Checklist

- [ ] **Step 1: Verify PostgreSQL**  
  `docker ps --filter "name=backstage-pg"` (status must be `Up (healthy)`).
- [ ] **Step 2: Update Admin Password Privately (Optional)**  
  `$env:NEW_ADMIN_PASSWORD="YourPassword"; npm.cmd run admin:password; Remove-Item Env:NEW_ADMIN_PASSWORD`
- [ ] **Step 3: Insert Real Test Bot Token**  
  Place your BotFather token in `.env` as `TELEGRAM_BOT_TOKEN="..."`.
- [ ] **Step 4: Launch Web Dashboard**  
  In Terminal 1: `npm.cmd run dev`. Open `http://127.0.0.1:3000` and sign in.
- [ ] **Step 5: Launch Bot Runner**  
  In Terminal 2: `npm.cmd run bot`.
- [ ] **Step 6: Send `/start` in Telegram**  
  Verify the bot sends greeting and explains that phone sharing is optional.
- [ ] **Step 7: Test Menu Without Phone Sharing**  
  Tap `ℹ️ Help / Info` or send messages. Confirm everything works without sharing contact.
- [ ] **Step 8: Share Contact via Button**  
  Tap `📱 Share Phone Number`. Verify confirmation message from bot.
- [ ] **Step 9: Verify Backstage Display**  
  Refresh `http://127.0.0.1:3000/bots/00000000-0000-0000-0000-000000000001` and verify your row appears.
- [ ] **Step 10: Edit Welcome Message**  
  Change text in admin panel, click **Save Welcome Message**, and send `/start` in Telegram to confirm immediate reflection.
