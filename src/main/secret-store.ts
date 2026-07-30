import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import type { ProviderId } from "../shared/contracts";

type SecretFile = Partial<Record<ProviderId, string>>;

export class SecretStore {
  private readonly filePath: string;
  private readonly sessionValues = new Map<ProviderId, string>();
  private encryptedValues: SecretFile = {};
  private persistence: "encrypted" | "session_only" = "session_only";

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "provider-secrets.json");
  }

  async initialize(): Promise<void> {
    const asyncAvailable = await safeStorage.isAsyncEncryptionAvailable();
    const unsafeLinuxBackend =
      process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text";
    this.persistence = asyncAvailable && !unsafeLinuxBackend ? "encrypted" : "session_only";
    if (this.persistence !== "encrypted") return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.encryptedValues = JSON.parse(raw) as SecretFile;
    } catch {
      this.encryptedValues = {};
    }
  }

  getPersistence(): "encrypted" | "session_only" {
    return this.persistence;
  }

  async has(providerId: ProviderId): Promise<boolean> {
    return Boolean(await this.get(providerId));
  }

  async get(providerId: ProviderId): Promise<string | undefined> {
    const session = this.sessionValues.get(providerId);
    if (session) return session;
    const encoded = this.encryptedValues[providerId];
    if (!encoded || this.persistence !== "encrypted") return undefined;
    try {
      const encrypted = Buffer.from(encoded, "base64");
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      if (decrypted.shouldReEncrypt) {
        await this.set(providerId, decrypted.result);
      }
      return decrypted.result;
    } catch {
      return undefined;
    }
  }

  async set(providerId: ProviderId, value: string): Promise<void> {
    const normalized = value.trim();
    if (!normalized) throw new Error("API Key 不能为空。");
    if (this.persistence === "session_only") {
      this.sessionValues.set(providerId, normalized);
      return;
    }
    const encrypted = await safeStorage.encryptStringAsync(normalized);
    this.encryptedValues[providerId] = encrypted.toString("base64");
    await this.flush();
  }

  async delete(providerId: ProviderId): Promise<void> {
    this.sessionValues.delete(providerId);
    if (this.encryptedValues[providerId]) {
      delete this.encryptedValues[providerId];
      await this.flush();
    }
  }

  async clear(): Promise<void> {
    this.sessionValues.clear();
    this.encryptedValues = {};
    if (this.persistence === "encrypted") await this.flush();
  }

  private async flush(): Promise<void> {
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(this.encryptedValues), {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, this.filePath);
  }
}
