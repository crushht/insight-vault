"use client";

import { useEffect, useState } from "react";
import { Copy, HardDrive, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingsSection } from "./SettingsPage";

interface SystemInfo {
  version: string;
  node: string;
  platform: string;
  dataDir: string;
  uptimeSeconds: number;
  storage: { dbBytes: number; queueBytes: number; assetsBytes: number };
  counts: { bookmarks: number; tags: number; lists: number };
  ai: {
    configured: boolean;
    provider: string | null;
    textModel: string | null;
    imageModel: string | null;
  };
  smtpConfigured: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86400)} 天`;
}

export function SystemStatus() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/system");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SystemInfo;
        if (!cancelled) setInfo(data);
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message ?? e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: { label: string; value: string }[] = info
    ? [
        { label: "版本", value: info.version || "开发版" },
        { label: "运行时长", value: formatUptime(info.uptimeSeconds) },
        { label: "运行环境", value: `Node ${info.node} · ${info.platform}` },
        { label: "数据目录", value: info.dataDir },
        { label: "数据库", value: formatBytes(info.storage.dbBytes) },
        { label: "队列库", value: formatBytes(info.storage.queueBytes) },
        { label: "附件", value: formatBytes(info.storage.assetsBytes) },
        {
          label: "我的数据",
          value: `${info.counts.bookmarks} 条收藏 · ${info.counts.tags} 个标签 · ${info.counts.lists} 个收藏夹`,
        },
        {
          label: "AI 模型",
          value: info.ai.configured
            ? `${info.ai.provider ?? "已配置"}${info.ai.textModel ? ` · ${info.ai.textModel}` : ""}`
            : "未配置（收藏/搜索/图谱仍可用）",
        },
        {
          label: "邮件服务",
          value: info.smtpConfigured ? "已配置（验证码走邮件）" : "未配置（本机走本地模式）",
        },
      ]
    : [];

  const copy = async () => {
    if (!info) return;
    const text = rows.map((r) => `${r.label}: ${r.value}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板被拒时静默失败即可
    }
  };

  return (
    <SettingsSection title="系统状态">
      {error && (
        <p className="text-caption text-destructive">
          读取失败：{error}（可以刷新页面重试）
        </p>
      )}
      {!info && !error && (
        <p className="flex items-center gap-2 text-caption text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在读取…
        </p>
      )}
      {info && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 text-caption text-muted-foreground">
            <HardDrive className="size-3.5" />
            数据都在你自己的机器上；拷走数据目录就等于完整备份。
          </div>
          <dl className="divide-y divide-border rounded-lg border border-border">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3"
              >
                <dt className="w-24 shrink-0 text-caption text-muted-foreground">
                  {row.label}
                </dt>
                <dd className="break-all text-caption text-foreground">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            <Copy className="mr-1 size-3.5" />
            {copied ? "已复制" : "复制诊断信息"}
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
