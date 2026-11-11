import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const targetEmail =
    process.argv[2] || process.env.ADMIN_DEFAULT_EMAIL || "admin@local.test";
  const newPassword = process.env.NEW_ADMIN_PASSWORD;

  if (!newPassword || newPassword.trim() === "") {
    console.error("[Admin Security Error] NEW_ADMIN_PASSWORD environment variable is required.");
    console.error("Usage in Windows PowerShell:");
    console.error('  $env:NEW_ADMIN_PASSWORD="YourPrivatePassword"; npm.cmd run admin:password; Remove-Item Env:NEW_ADMIN_PASSWORD');
    process.exit(1);
  }

  const existingAdmin = await prisma.adminUser.findUnique({
    where: { email: targetEmail.toLowerCase().trim() },
  });

  if (!existingAdmin) {
    console.error(`[Error] Admin user with email "${targetEmail}" was not found in the database.`);
    process.exit(1);
  }

  // Hash new password securely
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(newPassword, salt);

  // Update ONLY the admin password hash
  await prisma.adminUser.update({
    where: { id: existingAdmin.id },
    data: {
      passwordHash,
      updatedAt: new Date(),
    },
  });

  console.log(`[Admin Security] Successfully updated password for admin: ${existingAdmin.email}`);
  console.log("[Admin Security] No other database tables or bot configurations were altered.");
}

main()
  .catch((e) => {
    console.error("[Admin Security Error]", e instanceof Error ? e.message : "Update failed");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
