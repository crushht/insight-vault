import { z } from "zod";

import {
  clearAiConfig,
  describeAiConfig,
  loadAiConfig,
  saveAiConfig,
} from "@karakeep/shared/aiConfigStore";
import { InferenceClientFactory } from "@karakeep/shared/inference";

import { authedProcedure, router } from "../index";

/**
 * 界面里编辑 AI 模型配置（对标 CC Switch 的体验）。
 *
 * 保存后立刻生效：配置写进 `${DATA_DIR}/ai-config.json`，
 * `InferenceClientFactory.build()` 每次构造客户端时会读它（带 3 秒缓存）。
 * web 与 workers 共享同一个文件，所以不用重启任何进程。
 */

export const aiConfigAppRouter = router({
  /** 当前配置（Key 只回显末 4 位） */
  get: authedProcedure.query(() => {
    const described = describeAiConfig();
    const runtime = loadAiConfig();
    return {
      ...described,
      // 只用于前端回显「看起来像什么」，绝不返回明文
      hasKey: !!runtime?.apiKey,
      editable: true,
    };
  }),

  /** 保存配置并立即生效 */
  save: authedProcedure
    .input(
      z.object({
        provider: z.enum(["openai", "ollama", "anthropic"]),
        apiKey: z.string().trim().optional(),
        baseUrl: z.string().trim().url().optional().or(z.literal("")),
        textModel: z.string().trim().optional(),
        imageModel: z.string().trim().optional(),
        embeddingModel: z.string().trim().optional(),
      }),
    )
    .mutation(({ input }) => {
      if (input.provider === "openai" && !input.apiKey) {
        throw new Error("OpenAI 兼容模式必须填 API Key");
      }
      if (input.provider === "anthropic" && !input.apiKey) {
        throw new Error("Anthropic 兼容模式必须填 API Key");
      }
      if (input.provider === "ollama" && !input.baseUrl) {
        throw new Error("Ollama 模式必须填 Base URL（如 http://127.0.0.1:11434）");
      }

      saveAiConfig({
        provider: input.provider,
        apiKey: input.apiKey || undefined,
        baseUrl: input.baseUrl || undefined,
        textModel: input.textModel || undefined,
        imageModel: input.imageModel || undefined,
        embeddingModel: input.embeddingModel || undefined,
      });

      return { ok: true as const, ...describeAiConfig() };
    }),

  /** 用当前配置真实打一次模型，验证是否可用 */
  test: authedProcedure.mutation(async () => {
    const client = InferenceClientFactory.build();
    if (!client) {
      return {
        ok: false as const,
        message: "还没有可用配置（既没有界面配置，也没有 .env 里的 Key）",
      };
    }
    try {
      const started = Date.now();
      const resp = await client.inferFromText(
        "请只回复两个字：可用",
        {},
      );
      return {
        ok: true as const,
        latencyMs: Date.now() - started,
        sample: (resp.response ?? "").slice(0, 120),
      };
    } catch (e) {
      return {
        ok: false as const,
        message: String((e as Error)?.message ?? e).slice(0, 300),
      };
    }
  }),

  /** 清除界面配置，回退到 .env */
  clear: authedProcedure.mutation(() => {
    clearAiConfig();
    return { ok: true as const };
  }),
});
