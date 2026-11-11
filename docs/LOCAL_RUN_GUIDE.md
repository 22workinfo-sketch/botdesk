# Telegram Bot Backstage — Local Windows Run Guide

Follow these exact steps to run and test your Telegram Bot Backstage on Windows.

---

## 1. Prerequisites Check
Ensure Docker Desktop is running in your Windows taskbar.

---

## 2. Windows PowerShell Script Fix (One-time)
If PowerShell shows an error about script execution (`npm.ps1 cannot be loaded`), open Windows PowerShell and run:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```
*(Or alternatively, invoke commands with `npm.cmd`)*

---

## 3. Starting the Local PostgreSQL Database
In the root `BackStage` directory:
```powershell
docker compose up -d
```
To verify PostgreSQL is running and healthy:
```powershell
docker ps --filter "name=backstage-pg"
```
*(PostgreSQL is strictly bound to `127.0.0.1:5432`)*

---

## 4. Setting Your Local Admin Password Privately
The database is initially seeded with default test credentials (`admin@local.test` / `change_me_local_password_123`).

To replace this with your own private password **without revealing it in chat or modifying other database tables**:
```powershell
$env:NEW_ADMIN_PASSWORD="YourPrivatePasswordHere"
npm.cmd run admin:password
Remove-Item Env:NEW_ADMIN_PASSWORD
```
This script:
- Hashes your chosen password with bcrypt (12 salt rounds).
- Updates ONLY the `admin_users` record in PostgreSQL.
- Leaves your bot configuration, welcome message, menu buttons, and user profiles untouched.
- Immediately removes the variable from PowerShell memory so it is not stored.

---

## 5. Starting the Services

### Terminal 1: Admin Web Interface (Next.js)
```powershell
npm.cmd run dev
```
*(The web server is restricted to `127.0.0.1:3000` via `-H 127.0.0.1` and will not accept traffic from external LAN devices)*

Open your browser to:
- **Admin Panel**: [http://127.0.0.1:3000](http://127.0.0.1:3000) (or [http://localhost:3000](http://localhost:3000))
- **Health Check**: [http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health)

Log in using your admin email and the password you set in Step 4.

---

### Terminal 2: Telegram Bot Service (Long Polling)

#### Step A: Configure your Test Bot Token
1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Create a test bot using the `/newbot` command.
3. Copy the token provided by BotFather (e.g. `123456789:ABCdef...`).
4. Open your local `.env` file in the root `BackStage` directory with Notepad and insert your token:
   ```env
   TELEGRAM_BOT_TOKEN="your_actual_token_from_botfather"
   ```
   *(Important: Never paste this token in public chats or commit the `.env` file!)*

#### Step B: Start the Bot Runner
In a second PowerShell window:
```powershell
npm.cmd run bot
```
The console will display:
```text
[Bot Runner] Initializing Telegram bot long polling...
[Bot Runner] Long polling active for @your_test_bot
[Bot Runner] Ready to receive Telegram messages. Press Ctrl+C to stop.
```

---

### Terminal 3: Scheduler Background Worker (Scheduled Channel Posts)

In a third PowerShell window:
```powershell
npm.cmd run scheduler
```
The console will display:
```text
[Scheduler Worker] Initializing worker "worker-..." (Poll interval: 5000ms)...
[Scheduler Worker] Monitoring PostgreSQL for due scheduled posts...
```
*(The scheduler worker polls PostgreSQL for due posts, reclaims expired leases after crashes, atomically claims jobs with lease locks, and dispatches broadcasts to Telegram channels at the chosen instant).*

---

## 6. Using the Botdesk Navigation & Menu Builder in Backstage

The admin web panel follows the clean **Botdesk** design system with a dedicated sidebar:

- **▦ Bots** (`/dashboard`): Overview of connected bots, search, metrics, live welcome message editor, registered users table, and conversation simulator.
- **▦ Bot menu** (`/menu`): Dedicated Bot Menu Builder with side-by-side Telegram preview simulator, button reordering, enable/disable toggles, and auto-delete settings.
- **📢 Channels** (`/channels`): Dedicated Channel Manager to configure channels/groups, private or public invite links, required vs. optional gating, and voluntary Telegram membership verification.
- **✉ Channel posts** (`/posts`): Prepare, preview, draft, and publish announcements and media to Telegram channels with inline buttons and safe concurrency guards.
- **♙ Users & access** (`/staff`): Transparent overview of administrator access, role permissions (Owner, Admin, Staff), and local security architecture.
- **≡ Activity** (`/activity`): Real-time audit log timeline loading configuration changes and menu updates directly from PostgreSQL.
- **⚙ Workspace** (`/workspace`): System health, long polling runner status, database connection, and production roadmap.

### Managing Menu Buttons (in `/menu` or Bot Details):

1. Open **Bot menu** from the sidebar (or visit `http://127.0.0.1:3000/menu`).
2. **Add a Button**:
   - Click **＋ Add button**.
   - Enter a label (e.g. `🕒 Working Hours` or `📢 Official Channels`, max 64 chars).
   - Select an **Action Type**:
     - **Send Text Reply (`SEND_TEXT`)**: Enter the text message the bot will send when the button is tapped (max 2000 chars).
       - **Auto-Delete Bot Reply (Optional)**: Check this toggle to automatically delete the bot's reply message after a delay.
       - **Delete After (Seconds)**: Set the delay in seconds (between 5 and 86,400 seconds / up to 24h). Default is 30s.
     - **Request Contact (`REQUEST_CONTACT`)**: Telegram's phone-sharing button with built-in ownership validation.
     - **Join Channels & Check Membership (`JOIN_CHANNELS`)**: Sends an inline keyboard with URLs to configured enabled channels plus a `🔄 Check Joined` callback button.
   - Click **Save button**.
3. **Edit a Button**: Click **Edit** on any button to change its label, reply text, or auto-delete configuration.
4. **Enable / Disable**: Click **Disable** to temporarily hide a button from the keyboard without deleting it.
5. **Reorder**: Use the **↑ (Move Up)** and **↓ (Move Down)** controls to adjust button ordering.
6. **Telegram Live Preview**:
   - Test your buttons interactively in the **Telegram preview** box on the right.
   - Tapping an auto-delete button demonstrates the countdown and message removal right in the preview!
7. **Delete with Confirmation**: Click **Delete**, then confirm with **OK**.
8. **Save Changes**: Click **Save Menu Changes** at the bottom to write the updated menu to PostgreSQL.

---

## 7. Managing Channels & Voluntary Membership Verification

### Step A: Bot Channel Administrator Setup (Crucial Requirement)
Telegram's `getChatMember` API requires the bot to be an **Administrator** in private channels or supergroups to query member status. If the bot is not an admin, Telegram returns `400 Bad Request: chat not found` or `bot is not a member of the chat`.
1. In Telegram, open your channel settings -> **Administrators** -> **Add Administrator**.
2. Search for your bot username (e.g. `@your_test_bot`).
3. Grant the bot basic administrator rights (**"Manage Chat"** or **"Invite Users via Link"**).
4. For public channels, note the username (e.g. `@my_channel`).
5. For private channels, note the numeric ID (e.g. `-1001234567890`) and create a join link (e.g. `https://t.me/+AbCdEfGh123`).

### Step B: Configure Channels in Backstage
1. In Backstage sidebar, click **📢 Channels** (or visit `http://127.0.0.1:3000/channels`).
2. Click **＋ Add channel**.
3. Fill in the details:
   - **Channel Name**: Human-readable name (e.g. `Official Announcements`).
   - **Telegram Chat ID / Username**: Channel username (`@announcements`) or numeric ID (`-100...`).
   - **Invite Link**: Valid Telegram invite URL (`https://t.me/...` or `https://telegram.me/...`).
   - **Button Label**: Text displayed on the Telegram inline button (e.g. `📢 Join Announcements`).
   - **Required for Verification**: Toggle ON for required channels, OFF for optional channels.
   - **Active (Enabled)**: Toggle ON to include in the bot's inline keyboard.
4. Click **Add Channel**, then click **Save Channels Changes** to persist to PostgreSQL.

### Step C: How the User Flow Works (Voluntary User Action Only)
> [!IMPORTANT]
> The bot **NEVER** claims or attempts to automatically join users to channels. Joining each channel requires the user's voluntary tap in Telegram.
1. User taps the menu button configured with `JOIN_CHANNELS` (e.g. `📢 Channels & Community`).
2. The bot sends a message with inline URL buttons for each enabled channel and a bottom `🔄 Check Joined` callback button.
3. The user voluntarily taps each channel button to join them in Telegram.
4. The user returns to the bot and taps `🔄 Check Joined`.
5. The bot receives Telegram's callback query, extracts the tamper-proof user ID from `ctx.from.id`, and calls `getChatMember` for each configured channel.
6. **Result**:
   - If all required channels are joined (`creator`, `administrator`, `member`, or `restricted` with `is_member: true`), the bot confirms: `✅ Verification Complete! You have joined all required channels.`
   - If any required channels are missing, the bot clearly lists which channels still need to be joined.
   - If an API or permission error occurs (e.g. bot not an admin in channel), the bot clearly explains the issue and **NEVER** treats an error as verified.

### Note on Auto-Approval (Phase 5 / Future Roadmap):
Telegram channels configured with "Request Admin Approval" (Join Requests) are not automatically approved in this phase. The bot currently verifies active membership via `getChatMember`. Automatic processing of `chat_join_request` webhooks is scheduled for Phase 5.

---

## 8. Managing Channel Posts & Broadcasts (`/posts`)

The Channel Post Manager allows you to draft, preview, and broadcast official announcements or photos with inline URL buttons directly to a Telegram channel.

### Step A: Bot Channel Posting Rights Setup
To post to a channel, the bot must be an **Administrator** with the **"Post Messages"** permission enabled in Telegram:
1. In Telegram, open your target channel settings -> **Administrators** -> tap your bot (`@your_test_bot`).
2. Verify the following permission toggle is **ON**:
   - **Post Messages**: `Enabled` (Allows the bot to publish new messages in the channel)
   - *(Optional: "Edit Messages of Others" and "Delete Messages" if needed in future phases)*
3. If the bot is only a regular member or missing this right, Telegram will return `400 Bad Request: need administrator rights in the channel to post messages`.
4. In the backstage `/posts` page, the permission status badge will automatically check and display:
   - `✓ Can Post Messages` (green): Bot is confirmed with posting rights.
   - `⚠️ Missing Post Permission` (yellow): Bot is administrator but "Post Messages" is toggled off.
   - `✕ Not Channel Admin` (red): Bot is not an administrator in the channel.
   - `? Permission Unknown` (gray): Status could not be verified (honest unknown; proceed cautiously).

### Step B: Composing a Post
1. Open **✉ Channel posts** in the sidebar (or visit `http://127.0.0.1:3000/posts`).
2. Select your **Publishing Bot** and **Target Channel** from the dropdowns.
3. Choose **Post Type**:
   - **📝 Text-Only Message**: Enter your announcement (up to 4,096 characters).
   - **🖼️ Photo with Caption**:
     - Upload an image file (JPEG, PNG, or WebP up to 5 MB).
     - Images are stored locally in the non-public `uploads/posts/` directory.
     - Add an optional caption (up to 1,024 characters).
4. **Add Inline URL Buttons** (Optional, up to 10):
   - Click **＋ Add Button**.
   - Enter **Button Label** (e.g. `🌐 Read Full Story`, max 64 characters).
   - Enter **Destination URL** (HTTPS or `tg://`).
   - Click **Add Button**.
5. Check the **Telegram Post Preview** on the right side of the screen.

### Step C: Saving Drafts & Publishing
1. **Save Draft**:
   - Click **💾 Save Draft** anytime to persist the post and buttons to PostgreSQL.
   - The post appears in the **Post History & Drafts** table below with status `DRAFT`.
2. **Publishing**:
   - Click **🚀 Publish Now**.
   - A confirmation dialog appears showing the target bot, channel name, post type, and inline buttons.
   - Click **Yes, Publish to Channel**.
   - Concurrency guards prevent double-click duplicate publishing.
   - Upon confirmed Telegram delivery, the post updates to `PUBLISHED` with the Telegram `message_id` recorded.
3. **Honest Delivery Statuses**:
   - `DRAFT`: Saved locally in PostgreSQL.
   - `SCHEDULED`: Queued in PostgreSQL for future broadcast at the specified date, time, and timezone.
   - `SENDING`: Currently claimed by the scheduler worker or publishing in-flight (protected with atomic leases against concurrent attempts).
   - `PUBLISHED`: Verified delivered by Telegram Bot API with message ID.
   - `PARTIAL`: Album delivered successfully, but follow-up inline buttons failed (provides a dedicated "Retry Buttons" action without re-sending the album).
   - `FAILED`: Definitive Telegram API error (e.g. missing administrator permission). Error reason is displayed.
   - `UNKNOWN`: Network timeout occurred while awaiting Telegram confirmation. **The system NEVER auto-retries an UNKNOWN post** to avoid accidental duplicate broadcasts. Inspect your channel manually.

### Step D: Scheduling Posts for Future Broadcast
1. In the composer, toggle **Publishing Timing** from `⚡ Send Now` to `🕒 Schedule Post`.
2. Enter the target **Scheduled Date** (must be future date).
3. Enter the target **Scheduled Time** (24-hour format).
4. Select your **Timezone (IANA)**:
   - Includes priority Southeast Asia timezones (`Asia/Bangkok`, `Asia/Yangon`, `Asia/Singapore`) and standard global zones (`UTC`, `America/New_York`, etc.).
5. Check the live **Schedule Summary** box showing the destination bot, channel, local broadcast time, and worker dispatch notes.
6. Click **🕒 Schedule Post** and confirm the dialog.
7. The post appears in the **Post History & Drafts** table with a purple `🕒 SCHEDULED` badge and formatted broadcast time.
8. **Managing Scheduled Posts**:
   - **Reschedule**: Click **Reschedule** to load the post back into the composer, edit its text or attachments, and pick a new time.
   - **Cancel Schedule**: Click **Cancel** to immediately remove the schedule and revert the post back to `DRAFT` status without deleting it.
   - **Publish Now**: Click **Publish Now** to immediately dispatch a scheduled post to the channel before its scheduled time.
   - **Filter Tabs**: Use the `Scheduled`, `Drafts`, and `Published` tabs above the table to quickly organize posts.

---

## 9. How to Test the MVP Flow End-to-End

> [!IMPORTANT]
> - Use **only your own test Telegram account** and test phone number for local verification.
> - When taking screenshots or reporting results, **mask or blur any phone numbers**.

1. **Send `/start` to your bot**:
   - The bot replies with the dynamic welcome greeting loaded from PostgreSQL.
   - It displays a clear note explaining that phone sharing is **optional** and used only by backstage staff for support.
   - The dynamic reply keyboard appears with all your configured enabled buttons.
2. **Test `SEND_TEXT` Buttons**:
   - Tap any text button (e.g. `ℹ️ Help / Info` or your newly created button).
   - The bot immediately replies with the configured response from the database!
3. **Test Auto-Delete Reply Flow**:
   - In the Admin Panel, create or edit a `SEND_TEXT` button (e.g. `⏳ Temporary Promo`).
   - Enable **Auto-Delete Bot Reply** and set delay to `10` seconds. Click **Save Menu Changes**.
   - In Telegram, tap `⏳ Temporary Promo`.
   - The bot immediately sends the promo text.
   - Wait 10 seconds: the bot's reply message disappears from the chat!
   - Notice that your user button tap, welcome message, and other messages **remain completely untouched**.
4. **Test Worker Crash Resilience & Restart**:
   - Configure a button with auto-delete delay of `30` seconds.
   - Tap the button in Telegram.
   - Immediately stop the bot runner in PowerShell (`Ctrl+C`).
   - Wait 35 seconds, then restart the bot runner (`npm.cmd run bot`).
   - The background sweeper detects the due job in PostgreSQL upon startup and deletes the message from Telegram!
5. **Test `REQUEST_CONTACT` Button**:
   - Tap `📱 Share Phone Number`.
   - Telegram sends your verified contact (`contact.user_id === your_id`).
   - The bot verifies ownership and replies:
     `✅ Thank you! Your phone number has been verified and securely recorded for support purposes in Backstage.`
6. **Test Contact Ownership Rejection**:
   - If you forward a third-party contact card, the bot detects the mismatch and politely rejects it:
     `⚠️ We could not verify this phone number. To protect your account, we only accept your own personal contact...`
   - Your existing verified phone number is preserved in the database.
7. **Test `JOIN_CHANNELS` Flow**:
   - In `/channels`, configure your test channel (with the bot added as administrator) and mark it **Required**.
   - In `/menu`, add a menu button `📢 Official Channels` with action `JOIN_CHANNELS`. Click **Save Menu Changes**.
   - In Telegram, send `/start` and tap `📢 Official Channels`.
   - The bot sends an inline keyboard with `📢 Join [Channel Name]` and `🔄 Check Joined`.
   - Before joining, tap `🔄 Check Joined`: the bot reports `⚠️ Please join the required channels: "[Channel Name]" before verifying again.`
   - Tap `📢 Join [Channel Name]` and join the channel in Telegram.
   - Tap `🔄 Check Joined` again: the bot verifies your membership and confirms `✅ Verification Complete! You have joined all required channels.`
8. **Inspect in Admin Panel**:
   - In your browser, open `http://127.0.0.1:3000/bots/00000000-0000-0000-0000-000000000001`.
   - The user table shows your `telegram_id`, name, `@username`, and verified phone number.
9. **Test Live Menu Updates**:
   - In the Admin Panel, add a new button (e.g. `🎁 Bonus Info`) and click **Save Menu Changes**.
   - In Telegram, send `/start`.
   - Telegram immediately updates your keyboard to show the new button.
   - Tap `🎁 Bonus Info` to verify the bot sends your new reply text!

10. **Test Channel Post Publishing**:
    - In your browser, open `http://127.0.0.1:3000/posts`.
    - Ensure your test channel has the bot added as an administrator with "Post Messages" enabled.
    - Compose a test post (e.g. `🔥 Special Announcement: System update complete!`).
    - Add an inline button (Label: `🌐 Visit Portal`, URL: `https://example.com`).
    - Click **💾 Save Draft** and verify it appears in the history table.
    - Click **🚀 Publish Now**, confirm in the modal.
    - The post status updates to `PUBLISHED` with its Telegram message ID.
    - Open your Telegram app and verify the post and inline button appear in your test channel!

---

## 10. Running Automated Tests
Run the 74 automated unit and integration tests anytime:
```powershell
npm.cmd test
```
- Tests for bcrypt hashing, jose JWT sessions, and mock request guards run using **in-memory mocks**.
- Tests for health check, user upsert, contact persistence, greeting updates, menu CRUD, channel management, channel post drafts, local image uploads, double-submission guards, getChatMember membership evaluation, API route guards, auto-delete scheduling, atomic sweeper claiming, error resilience, and cross-bot isolation run against **real local PostgreSQL**.

---

## 11. Current Limitations & Scope
- **Single-Admin MVP**: Admin-to-bot granular authorization is not yet implemented. Any authenticated admin can manage the bot and publish posts.
- **Single-Channel Publishing**: Posts are dispatched to one selected channel at a time. Multi-channel bulk broadcasting is scheduled for a future phase.
- **Immediate Publishing Only**: Posts publish immediately upon confirmation. Scheduled broadcast queues (e.g. via cron or delayed job queue) are planned for the next phase.
- **Immutable Published Posts**: Editing or deleting messages already published on Telegram is not implemented in this phase. The backstage only manages the local post record and publishing action.
- **Local-Only Media Storage**: Image uploads are stored locally in the non-public `uploads/posts/` folder and streamed securely for preview. Cloud storage (S3/GCS) is not included in the local MVP.
- **Telegram API Deletion Limits**: Telegram allows deleting bot messages up to 48 hours after sending. Older messages return `message can't be deleted`; our sweeper safely marks these as `FAILED` rather than retrying indefinitely.
