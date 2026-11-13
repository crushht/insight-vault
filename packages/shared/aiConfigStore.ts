/**
 * AI 模型配置的「界面可编辑」存储。
 *
 * 为什么单独搞一个文件而不是只读 .env：
 * - 界面里填完要**立刻生效**，不能要求重启 web 与 workers；
 * - web 与 workers 是两个进程，必须通过**共享文件**看到同一份配置；
 * - .env 是部署层的东西，不该被运行时改动。
 *
 * 位置：`${DATA_DIR}/ai-config.json`
 * API Key 用 AES-256-GCM 加密，密钥由 NEXTAUTH_SECRET 派生。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import serverConfig from "./config";

export interface AiConfig {
  provider: "openai" | "ollama" | "anthropic";
  /** 明文只在内存里出现；落盘时加密 */
  apiKey?: string;
  baseUrl?: string;
  textModel?: string;
  imageModel?: string;
  embeddingModel?: string;
  updatedAt?: number;
}

interface StoredConfig {
  provider: "openai" | "ollama" | "anthropic";
  apiKeyEnc?: string;
  apiKeyTail?: string;
  baseUrl?: string;
  textModel?: string;
  imageModel?: string;
  embeddingModel?: string;
  updatedAt?: number;
}

const FILE_NAME = "ai-config.json";
const CACHE_TTL_MS = 3_000;

let cache: { value: AiConfig | null; at: number } | null = null;

function filePath(): string {
  return path.join(serverConfig.dataDir, FILE_NAME);
}

function secretKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET ?? "insight-vault-dev-secret";
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), enc.toString("base64"), tag.toString("base64")].join(":");
}

function decrypt(payload: string): string | null {
  try {
    const [ivB64, encB64, tagB64] = payload.split(":");
    if (!ivB64 || !encB64 || !tagB64) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      secretKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** 读配置（同步、带短缓存）。没有配置文件时返回 null。 */
export function loadAiConfig(): AiConfig | null {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  let value: AiConfig | null = null;
  try {
    const p = filePath();
    if (fs.existsSync(p)) {
      const stored = JSON.parse(fs.readFileSync(p, "utf8")) as StoredConfig;
      value = {
        provider: stored.provider,
        apiKey: stored.apiKeyEnc ? (decrypt(stored.apiKeyEnc) ?? undefined) : undefined,
        baseUrl: stored.baseUrl,
        textModel: stored.textModel,
        imageModel: stored.imageModel,
        embeddingModel: stored.embeddingModel,
        updatedAt: stored.updatedAt,
      };
      // 解不出来就当没配
      if (stored.apiKeyEnc && !value.apiKey) {
        value = null;
      }
    }
  } catch {
    value = null;
  }

  cache = { value, at: now };
  return value;
}

export function saveAiConfig(cfg: AiConfig): void {
  const stored: StoredConfig = {
    provider: cfg.provider,
    apiKeyEnc: cfg.apiKey ? encrypt(cfg.apiKey) : undefined,
    apiKeyTail: cfg.apiKey ? cfg.apiKey.slice(-4) : undefined,
    baseUrl: cfg.baseUrl,
    textModel: cfg.textModel,
    imageModel: cfg.imageModel,
    embeddingModel: cfg.embeddingModel,
    updatedAt: Date.now(),
  };
  fs.mkdirSync(serverConfig.dataDir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(stored, null, 2), "utf8");
  cache = null; // 立刻失效，下一次 build() 读到新值
}

export function clearAiConfig(): void {
  try {
    const p = filePath();
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  } catch {
    // ignore
  }
  cache = null;
}

/** 给界面看的状态（不含明文 Key） */
export function describeAiConfig(): {
  configured: boolean;
  provider?: "openai" | "ollama" | "anthropic";
  baseUrl?: string;
  textModel?: string;
  imageModel?: string;
  embeddingModel?: string;
  apiKeyTail?: string;
  updatedAt?: number;
} {
  const p = filePath();
  if (!fs.existsSync(p)) {
    return { configured: false };
  }
  try {
    const stored = JSON.parse(fs.readFileSync(p, "utf8")) as StoredConfig;
    return {
      configured: !!stored.apiKeyEnc || stored.provider === "ollama",
      provider: stored.provider,
      baseUrl: stored.baseUrl,
      textModel: stored.textModel,
      imageModel: stored.imageModel,
      embeddingModel: stored.embeddingModel,
      apiKeyTail: stored.apiKeyTail,
      updatedAt: stored.updatedAt,
    };
  } catch {
    return { configured: false };
  }
}
