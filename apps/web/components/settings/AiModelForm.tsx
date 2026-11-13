"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, XCircle } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

import { Button } from "@/components/ui/button";
import { SettingsSection } from "./SettingsPage";
import { Input } from "@/components/ui/input";

/**
 * 模型配置表单（对标 CC Switch 的体验）。
 *
 * 保存 → 写入 `${DATA_DIR}/ai-config.json` → `InferenceClientFactory.build()`
 * 下次构造客户端时立刻读到新值，**web 与 workers 都不用重启**。
 */

export interface AiPreset {
  id: string;
  label: string;
  provider: "openai" | "ollama" | "anthropic";
  baseUrl: string;
  textModel: string;
  imageModel: string;
}

/** 常见供应商的地址与模型名，点一下直接填好。 */
export const PRESETS: AiPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    provider: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    textModel: "deepseek-chat",
    imageModel: "",
  },
  {
    id: "qwen",
    label: "通义千问",
    provider: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    textModel: "qwen-plus",
    imageModel: "qwen-vl-plus",
  },
  {
    id: "kimi",
    label: "Kimi",
    provider: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    textModel: "moonshot-v1-8k",
    imageModel: "moonshot-v1-8k-vision-preview",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    provider: "anthropic",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    textModel: "glm-4.6",
    imageModel: "",
  },
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    textModel: "gpt-4o-mini",
    imageModel: "gpt-4o-mini",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    provider: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    textModel: "Qwen/Qwen2.5-7B-Instruct",
    imageModel: "Qwen/Qwen2-VL-7B-Instruct",
  },
  {
    id: "ollama",
    label: "本地 Ollama",
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    textModel: "qwen2.5:7b",
    imageModel: "llava",
  },
];
export function AiModelForm() {
  const api = useTRPC();
  const config = useQuery(api.aiConfig.get.queryOptions());
  const save = useMutation(api.aiConfig.save.mutationOptions());
  const test = useMutation(api.aiConfig.test.mutationOptions());
  const clear = useMutation(api.aiConfig.clear.mutationOptions());

  const [provider, setProvider] = useState<"openai" | "ollama" | "anthropic">(
    "openai",
  );
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [textModel, setTextModel] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // 首次加载把已保存的值填进表单
  // 只在「保存/清除」后回填一次；不要依赖整个 data 对象，
  // 否则任何一次后台 refetch 都会把正在输入的框清空 —— 用户看到的就是「一直在闪」。
  const updatedAt = config.data?.updatedAt;
  useEffect(() => {
    const d = config.data;
    if (!d) return;
    if (d.provider) setProvider(d.provider);
    setBaseUrl(d.baseUrl ?? "");
    setTextModel(d.textModel ?? "");
    setImageModel(d.imageModel ?? "");
    setApiKey("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);

  const doSave = async () => {
    setFeedback(null);
    try {
      await save.mutateAsync({
        provider,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        textModel: textModel.trim() || undefined,
        imageModel: imageModel.trim() || undefined,
      });
      setApiKey("");
      await config.refetch();
      setFeedback({ ok: true, text: "已保存，立即生效（无需重启）" });
    } catch (e) {
      setFeedback({
        ok: false,
        text: String((e as { message?: string })?.message ?? e),
      });
    }
  };

  const doTest = async () => {
    setFeedback(null);
    const res = await test.mutateAsync();
    if (res.ok) {
      setFeedback({
        ok: true,
        text: `连接成功（${"latencyMs" in res ? res.latencyMs : "?"} ms）：${
          "sample" in res ? (res.sample ?? "") : ""
        }`,
      });
    } else {
      setFeedback({ ok: false, text: res.message });
    }
  };

  const doClear = async () => {
    await clear.mutateAsync();
    setApiKey("");
    await config.refetch();
    setFeedback({ ok: true, text: "已清除界面配置，回退到 .env" });
  };

  const d = config.data;
  const configured = d?.configured ?? false;

  return (
    <SettingsSection title="模型配置（在这里填，保存即生效）">
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-2">
          {configured ? (
            <>
              <CheckCircle2 className="size-4 text-success" />
              <span className="text-foreground">
                已配置
                {d?.provider === "ollama"
                  ? "（Ollama）"
                  : d?.provider === "anthropic"
                    ? "（Anthropic 兼容）"
                    : "（OpenAI 兼容）"}
                {d?.apiKeyTail && (
                  <span className="ml-1 text-muted-foreground">
                    · Key 尾号 {d.apiKeyTail}
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <XCircle className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                尚未配置 —— AI 功能不会真正运行（收藏/搜索/图谱仍可用）
              </span>
            </>
          )}
        </div>

        {/* 一键预设：选一个供应商，把地址与模型名填好，用户只补 Key */}
        <div className="space-y-2">
          <p className="text-caption text-muted-foreground">
            一键填入常见供应商（填完只需补 API Key，然后点「测试连接」）
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setProvider(preset.provider);
                  setBaseUrl(preset.baseUrl);
                  setTextModel(preset.textModel);
                  setImageModel(preset.imageModel);
                  setFeedback({
                    ok: true,
                    text: `已填入「${preset.label}」预设，补上 API Key 后点「测试连接」`,
                  });
                }}
                className="rounded-full border border-border px-3 py-1 text-caption text-muted-foreground transition-colors hover:border-brand-400 hover:text-brand-600"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* provider */}
        <div className="flex gap-2">
          {(
            [
              ["openai", "OpenAI 兼容"],
              ["anthropic", "Anthropic 兼容"],
              ["ollama", "本地 Ollama"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setProvider(value)}
              className={`rounded-md border px-3 py-1.5 transition-colors ${
                provider === value
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-border text-muted-foreground hover:border-border-strong"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-muted-foreground">Base URL</span>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                provider === "ollama"
                  ? "http://127.0.0.1:11434"
                  : provider === "anthropic"
                    ? "https://api.anthropic.com（或智谱 / Kimi 的 Anthropic 兼容地址）"
                    : "https://api.openai.com/v1（或 DeepSeek / 通义 的兼容地址）"
              }
            />
          </label>

          {provider !== "ollama" && (
            <label className="block space-y-1">
              <span className="flex items-center gap-1 text-muted-foreground">
                <KeyRound className="size-3.5" />
                API Key
                {d?.apiKeyTail && (
                  <span className="text-caption">
                    （留空则保持已保存的 · 尾号 {d.apiKeyTail}）
                  </span>
                )}
              </span>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
              />
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-muted-foreground">文本模型</span>
            <Input
              value={textModel}
              onChange={(e) => setTextModel(e.target.value)}
              placeholder={
                provider === "ollama"
                  ? "qwen2.5:7b"
                  : provider === "anthropic"
                    ? "claude-sonnet-4-5 / glm-4.6"
                    : "gpt-4o-mini / deepseek-chat"
              }
            />
          </label>

          <label className="block space-y-1">
            <span className="text-muted-foreground">视觉模型（可选）</span>
            <Input
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void doSave()}
            disabled={save.isPending || test.isPending}
          >
            {save.isPending && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            保存
          </Button>
          <Button
            variant="outline"
            onClick={() => void doTest()}
            disabled={test.isPending || save.isPending}
          >
            {test.isPending && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            测试连接
          </Button>
          {configured && (
            <Button variant="ghost" onClick={() => void doClear()}>
              清除配置
            </Button>
          )}
        </div>

        {feedback && (
          <p
            className={`text-caption ${feedback.ok ? "text-success" : "text-destructive"}`}
          >
            {feedback.text}
          </p>
        )}

        <p className="text-caption text-muted-foreground">
          配置保存在服务器端的 <code>{"${DATA_DIR}/ai-config.json"}</code>，
          Key 用 AES-256-GCM 加密。也可以继续用 <code>.env</code>（这里留空即可）。
        </p>
      </div>
    </SettingsSection>
  );
}
