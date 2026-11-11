export interface StoragePutResult {
  key: string;
  sizeBytes: number;
  mimeType: string;
  storageProvider: "local" | "s3";
}

export interface StorageGetResult {
  data: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface StorageObjectMetadata {
  key: string;
  sizeBytes: number;
  mimeType: string;
  originalName?: string | null;
  botId?: string | null;
  isPrivate?: boolean;
}

export interface StorageProvider {
  readonly name: "local" | "s3";
  putObject(
    key: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<StoragePutResult>;
  getObject(key: string): Promise<StorageGetResult>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getLocalFilePath?(key: string): string | null;
}
