import path from "path";
import fs from "fs";
import { StorageProvider, StoragePutResult, StorageGetResult } from "./types";
import { UPLOADS_POSTS_DIR } from "@/lib/post-service";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  private readonly baseDir: string;

  constructor(baseDir: string = UPLOADS_POSTS_DIR) {
    this.baseDir = baseDir;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolveSafePath(key: string): string {
    // Sanitize against directory traversal
    if (
      !key ||
      key.includes("..") ||
      path.isAbsolute(key) ||
      /^[a-zA-Z]:/.test(key)
    ) {
      throw new Error(`Invalid storage key: directory traversal attempt rejected.`);
    }

    // Strip leading slashes
    const cleanKey = key.replace(/^[/\\]+/, "");
    const resolvedPath = path.resolve(this.baseDir, cleanKey);

    // Verify resolved path stays within baseDir
    if (!resolvedPath.startsWith(path.resolve(this.baseDir))) {
      throw new Error(`Invalid storage key: path escapes base storage directory.`);
    }

    return resolvedPath;
  }

  async putObject(
    key: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<StoragePutResult> {
    const fullPath = this.resolveSafePath(key);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    await fs.promises.writeFile(fullPath, buffer);
    return {
      key,
      sizeBytes: buffer.length,
      mimeType,
      storageProvider: "local",
    };
  }

  async getObject(key: string): Promise<StorageGetResult> {
    const fullPath = this.resolveSafePath(key);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Object not found in local storage: ${key}`);
    }

    const data = await fs.promises.readFile(fullPath);
    const ext = path.extname(key).toLowerCase();
    let mimeType = "application/octet-stream";
    if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
    else if (ext === ".png") mimeType = "image/png";
    else if (ext === ".webp") mimeType = "image/webp";
    else if (ext === ".mp4") mimeType = "video/mp4";
    else if (ext === ".webm") mimeType = "video/webm";
    else if (ext === ".mov") mimeType = "video/quicktime";

    return {
      data,
      mimeType,
      sizeBytes: data.length,
    };
  }

  async deleteObject(key: string): Promise<void> {
    const fullPath = this.resolveSafePath(key);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const fullPath = this.resolveSafePath(key);
      return fs.existsSync(fullPath);
    } catch {
      return false;
    }
  }

  getLocalFilePath(key: string): string | null {
    try {
      return this.resolveSafePath(key);
    } catch {
      return null;
    }
  }
}
