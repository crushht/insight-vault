"use client";

import { BRAND } from "@/lib/brand";
import { downloadText } from "@/lib/markdown-download";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import FilePickerButton from "@/components/ui/file-picker-button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useBookmarkImport } from "@/lib/hooks/useBookmarkImport";
import { useTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, Loader2, Upload } from "lucide-react";

import { Card, CardContent } from "../ui/card";
import { ImportSessionsSection } from "./ImportSessionsSection";
import { SettingsPage, SettingsSection } from "./SettingsPage";

function ImportCard({
  text,
  description,
  children,
}: {
  text: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-full bg-primary/10 p-2">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium">{text}</h3>
          <p>{description}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function ExportButton() {
  const { t } = useTranslation();
  const [format, setFormat] = useState<"json" | "netscape">("json");
  const queryClient = useQueryClient();
  const { isFetching, refetch, error } = useQuery({
    queryKey: ["exportBookmarks"],
    queryFn: async () => {
      const res = await fetch(`/api/bookmarks/export?format=${format}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error?.error || "Failed to export bookmarks");
      }
      const match = res.headers
        .get("Content-Disposition")
        ?.match(/filename\*?=(?:UTF-8''|")?([^"]+)/i);
      const filename = match
        ? match[1]
        : `karakeep-export-${new Date().toISOString()}.${format}`;
      return { blob: res.blob(), filename };
    },
    enabled: false,
  });

  useEffect(() => {
    if (error) {
      toast({
        description: error.message,
        variant: "destructive",
      });
    }
  }, [error]);

  const onExport = useCallback(async () => {
    const { data } = await refetch();
    if (!data) return;
    const { blob, filename } = data;
    const url = window.URL.createObjectURL(await blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    queryClient.setQueryData(["exportBookmarks"], () => null);
  }, [refetch]);

  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-full bg-primary/10 p-2">
          <Upload className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium">导出文件</h3>
          <p>{t("settings.import.export_links_and_notes")}</p>
          <Select
            value={format}
            onValueChange={(value) => setFormat(value as "json" | "netscape")}
          >
            <SelectTrigger className="mt-2 w-[180px]">
              <SelectValue placeholder="Format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON ({BRAND.name} format)</SelectItem>
              <SelectItem value="netscape">HTML (Netscape format)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          className={cn(
            buttonVariants({ variant: "default", size: "sm" }),
            "flex items-center gap-2",
          )}
          onClick={onExport}
          disabled={isFetching}
        >
          {isFetching && <Loader2 className="size-6 animate-spin" />}
          <p>导出</p>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ImportExportRow() {
  const { t } = useTranslation();
  const { importProgress, quotaError, runUploadBookmarkFile } =
    useBookmarkImport();

  return (
    <div className="flex flex-col gap-3">
      {quotaError && (
        <Alert variant="destructive" className="relative">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>超出导入配额</AlertTitle>
          <AlertDescription>{quotaError}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <ImportCard
          text="HTML 书签文件"
          description={t("settings.import.import_bookmarks_from_html_file")}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".html"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "html" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Pocket"
          description={t("settings.import.import_bookmarks_from_pocket_export")}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "pocket" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Raindrop"
          description="从 Raindrop.io 导出的 CSV 文件导入收藏（含标签与收藏夹）。"
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            inputTestId="import-raindrop-input"
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "raindrop" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Matter"
          description={t("settings.import.import_bookmarks_from_matter_export")}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "matter" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Omnivore"
          description={t(
            "settings.import.import_bookmarks_from_omnivore_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".json"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "omnivore" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Linkwarden"
          description={t(
            "settings.import.import_bookmarks_from_linkwarden_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".json"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "linkwarden" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Tab Session Manager"
          description={t(
            "settings.import.import_bookmarks_from_tab_session_manager_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".json"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "tab-session-manager" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="mymind"
          description={t("settings.import.import_bookmarks_from_mymind_export")}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "mymind" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Instapaper"
          description={t(
            "settings.import.import_bookmarks_from_instapaper_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "instapaper" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text={BRAND.name}
          description={t(
            "settings.import.import_bookmarks_from_karakeep_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".json"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "karakeep" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="Readwise Reader"
          description={t(
            "settings.import.import_bookmarks_from_readwise_reader_export",
          )}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".csv"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "readwise-reader" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ImportCard
          text="OneTab"
          description={t("settings.import.import_bookmarks_from_onetab_export")}
        >
          <FilePickerButton
            size={"sm"}
            loading={false}
            accept=".txt"
            multiple={false}
            className="flex items-center gap-2"
            onFileSelect={(file) =>
              runUploadBookmarkFile({ file, source: "onetab" })
            }
          >
            <p>导入</p>
          </FilePickerButton>
        </ImportCard>
        <ExportButton />
      </div>
      {Object.entries(importProgress).map(([id, progress]) => {
        return (
          <div key={id} className="flex flex-col gap-2">
            <p className="shrink-0 text-sm">
              Processed {progress.done} of {progress.total} bookmarks
            </p>
            <div className="w-full">
              <Progress value={(progress.done * 100) / progress.total} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExportRow() {
  const [busy, setBusy] = useState<"json" | "markdown" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 直接用 tRPC 的 HTTP 端点（batch 格式），避免依赖 useUtils
  const run = async (format: "json" | "markdown") => {
    setBusy(format);
    setError(null);
    try {
      const input = encodeURIComponent(
        JSON.stringify({ "0": { json: { format } } }),
      );
      const res = await fetch(`/api/trpc/bookmarks.exportAll?batch=1&input=${input}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`导出失败（${res.status}）`);
      }
      const payload = (await res.json()) as {
        result?: { data?: { json?: { filename: string; content: string; mime: string } } };
      }[];
      const data = payload[0]?.result?.data?.json;
      if (!data) {
        throw new Error("导出返回为空");
      }
      downloadText(data.filename, data.content, data.mime);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        把你的全部收藏导出成文件。JSON 适合迁移或再加工，Markdown 适合直接阅读与写作。
        导出不包含附件本体（图片 / PDF），只含元数据与文本。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy !== null} onClick={() => void run("markdown")}>
          {busy === "markdown" ? "导出中…" : "导出 Markdown"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void run("json")}
        >
          {busy === "json" ? "导出中…" : "导出 JSON"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export default function ImportExport() {
  const { t } = useTranslation();
  return (
    <SettingsPage title={t("settings.import.import_export")}>
      <SettingsSection title={t("settings.import.import_export_bookmarks")}>
        <ImportExportRow />
      </SettingsSection>

      <ImportSessionsSection />

      <SettingsSection title="导出我的数据">
        <ExportRow />
      </SettingsSection>
    </SettingsPage>
  );
}
