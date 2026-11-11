import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log("--- Starting BackStage Database Seeding ---");

  const defaultBotId =
    process.env.BOT_DEFAULT_ID || "00000000-0000-0000-0000-000000000001";
  const defaultBotName = process.env.BOT_DEFAULT_NAME || "Local Test Bot";
  const defaultBotUsername =
    process.env.BOT_DEFAULT_USERNAME || "local_test_bot";
  const adminEmail = process.env.ADMIN_DEFAULT_EMAIL || "admin@local.test";
  const adminPassword =
    process.env.ADMIN_DEFAULT_PASSWORD || "change_me_local_password_123";

  // Production safety check: Never seed default credentials in production
  if (process.env.NODE_ENV === "production") {
    if (
      !process.env.ADMIN_DEFAULT_EMAIL ||
      !process.env.ADMIN_DEFAULT_PASSWORD ||
      adminPassword.includes("change_me")
    ) {
      console.error(
        "[Seed Error] Refusing to seed default test admin in production without explicit, secure credentials."
      );
      process.exit(1);
    }
  }

  // 1. Seed Default Admin User
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(adminPassword, salt);

  const admin = await prisma.adminUser.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash,
      role: "SUPER_ADMIN",
      isActive: true,
    },
    update: {
      passwordHash, // update hash if rerun
      isActive: true,
    },
  });

  console.log(`[Seed] Admin user verified: ${admin.email} (Role: ${admin.role})`);

  // 2. Seed Default Bot
  const rawToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const tokenBotIdMatch = rawToken.match(/^(\d{8,12}):/);
  const defaultTelegramBotId = tokenBotIdMatch ? BigInt(tokenBotIdMatch[1]) : null;
  const tokenLast4 = rawToken.length >= 4 ? rawToken.slice(-4) : null;

  const bot = await prisma.bot.upsert({
    where: { id: defaultBotId },
    create: {
      id: defaultBotId,
      name: defaultBotName,
      username: defaultBotUsername,
      telegramBotId: defaultTelegramBotId,
      tokenEnvVar: "TELEGRAM_BOT_TOKEN",
      tokenLast4,
      connectionStatus: "STANDBY",
      isActive: true,
    },
    update: {
      name: defaultBotName,
      username: defaultBotUsername,
      telegramBotId: defaultTelegramBotId ?? undefined,
      tokenLast4: tokenLast4 ?? undefined,
      isActive: true,
    },
  });

  console.log(`[Seed] Test bot verified: "${bot.name}" (@${bot.username}) [ID: ${bot.id}]`);

  // 3. Seed Default Bot Config (Welcome Message & Menu)
  const defaultWelcomeMessage =
    "Hello! Welcome to the Telegram Bot Backstage test bot.\n\n" +
    "This message is dynamically loaded from your PostgreSQL database.\n" +
    "You can edit this greeting live in your local admin panel!";

  const config = await prisma.botConfig.upsert({
    where: { botId: bot.id },
    create: {
      botId: bot.id,
      welcomeMessage: defaultWelcomeMessage,
      menuConfig: {
        buttons: [
          { text: "📱 Share Phone Number", request_contact: true },
          { text: "ℹ️ Help / Info", callback_data: "help_placeholder" },
        ],
      },
    },
    update: {
      // Do not overwrite existing custom welcome message on re-seed if already customized
    },
  });

  console.log(`[Seed] Bot config verified for bot ${config.botId}`);

  // 4. Seed Default Menu Buttons (if none exist for this bot)
  const existingButtonsCount = await prisma.botButton.count({
    where: { botId: bot.id },
  });

  if (existingButtonsCount === 0) {
    await prisma.botButton.createMany({
      data: [
        {
          botId: bot.id,
          label: "📱 Share Phone Number",
          actionType: "REQUEST_CONTACT",
          order: 0,
          isEnabled: true,
        },
        {
          botId: bot.id,
          label: "ℹ️ Help / Info",
          actionType: "SEND_TEXT",
          replyText:
            "ℹ️ Backstage Test Bot Help:\n\n" +
            "• Send /start to reload your profile and see the welcome message.\n" +
            "• Tap 'Share Phone Number' to store your contact number in PostgreSQL.\n" +
            "• The welcome message and menu buttons can be updated live from your local Admin Web Panel!",
          order: 1,
          isEnabled: true,
        },
      ],
    });
    console.log(`[Seed] Created 2 default menu buttons for bot ${bot.id}`);
  } else {
    console.log(
      `[Seed] Found ${existingButtonsCount} existing buttons for bot ${bot.id}. Preserving custom buttons.`
    );
  }

  console.log("--- Seeding Completed Successfully ---");
}

main()
  .catch((e) => {
    console.error("[Seed Error]", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
