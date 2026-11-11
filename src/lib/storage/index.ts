import { StorageProvider } from "./types";
import { LocalStorageProvider } from "./local-provider";
import { S3StorageProvider } from "./s3-provider";
import { prisma } from "@/lib/prisma";

export * from "./types";
export * from "./local-provider";
export * from "./s3-provider";

let defaultProvider: StorageProvider | null = null;
let testProviderOverride: StorageProvider | null = null;

export function setStorageProviderForTesting(provider: StorageProvider | null): void {
  testProviderOverride = provider;
}

export function getStorageProvider(): StorageProvider {
  if (testProviderOverride) {
    return testProviderOverride;
  }

  if (defaultProvider) {
    return defaultProvider;
  }

  const configured = (process.env.STORAGE_PROVIDER || "local").toLowerCase().trim();
  if (configured === "s3" || configured === "r2") {
    defaultProvider = new S3StorageProvider();
  } else {
    defaultProvider = new LocalStorageProvider();
  }

  return defaultProvider;
}

export async function recordMediaInDatabase(meta: {
  storageKey: string;
  storageProvider: "local" | "s3";
  mimeType: string;
  sizeBytes: number;
  originalName?: string | null;
  botId?: string | null;
  uploadedById?: string | null;
  isPrivate?: boolean;
}) {
  let validUploadedById: string | null = null;
  if (meta.uploadedById) {
    const userExists = await prisma.adminUser.findUnique({
      where: { id: meta.uploadedById },
      select: { id: true },
    });
    if (userExists) {
      validUploadedById = userExists.id;
    }
  }

  return prisma.storedMedia.upsert({
    where: { storageKey: meta.storageKey },
    create: {
      storageKey: meta.storageKey,
      storageProvider: meta.storageProvider,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      originalName: meta.originalName || null,
      botId: meta.botId || null,
      uploadedById: validUploadedById,
      isPrivate: meta.isPrivate !== false,
    },
    update: {
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      originalName: meta.originalName || null,
      botId: meta.botId || null,
      uploadedById: validUploadedById,
      isPrivate: meta.isPrivate !== false,
    },
  });
}
