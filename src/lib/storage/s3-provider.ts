import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { StorageProvider, StoragePutResult, StorageGetResult } from "./types";

export interface S3ProviderOptions {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  client?: S3Client;
}

export class S3StorageProvider implements StorageProvider {
  readonly name = "s3" as const;
  private readonly bucket: string;
  private readonly s3Client: S3Client;

  constructor(options?: Partial<S3ProviderOptions>) {
    this.bucket = options?.bucket || process.env.S3_BUCKET_NAME || "";

    if (!this.bucket) {
      throw new Error(
        "Storage Configuration Error: S3_BUCKET_NAME must be specified when using S3/R2 storage provider."
      );
    }

    if (options?.client) {
      this.s3Client = options.client;
      return;
    }

    const endpoint = options?.endpoint || process.env.S3_ENDPOINT;
    const region = options?.region || process.env.S3_REGION || "auto";
    const accessKeyId = options?.accessKeyId || process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey =
      options?.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        "Storage Configuration Error: S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured for S3/R2 storage provider."
      );
    }

    this.s3Client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Recommended for Cloudflare R2 and MinIO compatibility
    });
  }

  private cleanKey(key: string): string {
    if (!key || key.includes("..")) {
      throw new Error("Invalid S3 object key: directory traversal pattern rejected.");
    }
    return key.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  }

  async putObject(
    key: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<StoragePutResult> {
    const safeKey = this.cleanKey(key);
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    return {
      key: safeKey,
      sizeBytes: buffer.length,
      mimeType,
      storageProvider: "s3",
    };
  }

  async getObject(key: string): Promise<StorageGetResult> {
    const safeKey = this.cleanKey(key);
    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: safeKey,
        })
      );

      if (!response.Body) {
        throw new Error(`Empty response body for object: ${safeKey}`);
      }

      // Convert stream/byteArray to Buffer
      const byteArray = await response.Body.transformToByteArray();
      const buffer = Buffer.from(byteArray);
      const mimeType = response.ContentType || "application/octet-stream";

      return {
        data: buffer,
        mimeType,
        sizeBytes: buffer.length,
      };
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        throw new Error(`Object not found in S3 bucket: ${safeKey}`);
      }
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const safeKey = this.cleanKey(key);
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: safeKey,
      })
    );
  }

  async exists(key: string): Promise<boolean> {
    const safeKey = this.cleanKey(key);
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: safeKey,
        })
      );
      return true;
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  getLocalFilePath(_key: string): string | null {
    // S3 objects are stored remotely, not on local disk
    return null;
  }
}
