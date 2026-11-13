import { Ollama } from "ollama";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import { loadAiConfig } from "./aiConfigStore";
import serverConfig from "./config";
import { createCustomFetch } from "./customFetch";
import logger from "./logger";

export interface InferenceResponse {
  response: string;
  totalTokens: number | undefined;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  totalTokens: number | undefined;
  promptTokens: number | undefined;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "number")
  );
}

function isNumberArray2D(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every(isNumberArray);
}

function validateEmbeddingDimensions(embeddings: number[][]): void {
  const expectedDimensions = serverConfig.embedding.dimensions;
  for (const [index, embedding] of embeddings.entries()) {
    if (embedding.length !== expectedDimensions) {
      throw new Error(
        `Got embedding response item ${index} with ${embedding.length} dimensions from inference provider; expected ${expectedDimensions} configured by EMBEDDING_DIMENSIONS`,
      );
    }
  }
}

function parseEmbeddingResponse(response: unknown): number[][] {
  if (!response || typeof response !== "object") {
    throw new Error(`Got invalid embedding response from inference provider`);
  }

  if ("data" in response && Array.isArray(response.data)) {
    const embeddings = response.data.map((item) => {
      if (
        item &&
        typeof item === "object" &&
        "embedding" in item &&
        isNumberArray(item.embedding)
      ) {
        return item.embedding;
      }
      throw new Error(
        `Got embedding response item without a numeric embedding array`,
      );
    });
    return embeddings;
  }

  if ("embeddings" in response && isNumberArray2D(response.embeddings)) {
    return response.embeddings;
  }

  if ("embedding" in response && isNumberArray(response.embedding)) {
    return [response.embedding];
  }

  const keys = Object.keys(response).join(", ");
  throw new Error(
    `Got embedding response with unsupported shape from inference provider. Keys: ${keys}`,
  );
}

function getNumericField(
  value: Record<string, unknown>,
  field: string,
): number | undefined {
  const raw = value[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function parseEmbeddingUsage(response: unknown): {
  promptTokens: number | undefined;
  totalTokens: number | undefined;
} {
  if (!response || typeof response !== "object") {
    return { promptTokens: undefined, totalTokens: undefined };
  }

  const responseObj = response as Record<string, unknown>;
  const usage = responseObj.usage;
  if (usage && typeof usage === "object") {
    const usageObj = usage as Record<string, unknown>;
    return {
      promptTokens: getNumericField(usageObj, "prompt_tokens"),
      totalTokens: getNumericField(usageObj, "total_tokens"),
    };
  }

  const promptTokens =
    getNumericField(responseObj, "prompt_eval_count") ??
    getNumericField(responseObj, "prompt_tokens");
  const totalTokens =
    getNumericField(responseObj, "total_tokens") ??
    getNumericField(responseObj, "eval_count") ??
    promptTokens;

  return { promptTokens, totalTokens };
}

export interface InferenceOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodSchema<any> | null;
  abortSignal?: AbortSignal;
}

const defaultInferenceOptions: InferenceOptions = {
  schema: null,
};

export interface EmbeddingClient {
  generateEmbeddingFromText(inputs: string[]): Promise<EmbeddingResponse>;
}

export interface InferenceClient extends EmbeddingClient {
  inferFromText(
    prompt: string,
    opts: Partial<InferenceOptions>,
  ): Promise<InferenceResponse>;
  /**
   * 流式生成（可选能力）。
   *
   * 不是所有 provider 都支持；调用方必须先用 `typeof client.inferFromTextStream === "function"`
   * 判断，不支持时回退到 `inferFromText` 再自行分块推送。
   */
  inferFromTextStream?(
    prompt: string,
    opts: Partial<InferenceOptions>,
  ): AsyncIterable<string>;
  inferFromImage(
    prompt: string,
    contentType: string,
    image: string,
    opts: Partial<InferenceOptions>,
  ): Promise<InferenceResponse>;
}

const mapInferenceOutputSchema = <
  T,
  S extends typeof serverConfig.inference.outputSchema,
>(
  opts: Record<S, T>,
  type: S,
): T => {
  return opts[type];
};

const mapOpenAIResponseFormat = (
  schema: z.ZodSchema | null,
  outputSchema: typeof serverConfig.inference.outputSchema,
) => {
  if (schema === null) {
    return undefined;
  }

  return mapInferenceOutputSchema(
    {
      structured: zodResponseFormat(schema, "schema"),
      json: { type: "json_object" as const },
      plain: undefined,
    },
    outputSchema,
  );
};

export interface OpenAIInferenceConfig {
  apiKey: string;
  baseURL?: string;
  proxyUrl?: string;
  timeoutSec?: number;
  serviceTier?: typeof serverConfig.inference.openAIServiceTier;
  textModel: string;
  imageModel: string;
  contextLength: number;
  maxOutputTokens: number;
  useMaxCompletionTokens: boolean;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  outputSchema: "structured" | "json" | "plain";
}

export interface OpenAIEmbeddingConfig {
  apiKey: string;
  baseURL?: string;
  proxyUrl?: string;
  timeoutSec?: number;
}

const buildOpenAIClient = (config: OpenAIEmbeddingConfig) =>
  new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout:
      config.timeoutSec !== undefined ? config.timeoutSec * 1000 : undefined,
    defaultHeaders: {
      "X-Title": "Karakeep",
      "HTTP-Referer": "https://karakeep.app",
    },
    fetch: createCustomFetch(
      config.timeoutSec !== undefined
        ? config.timeoutSec * 1000
        : OpenAI.DEFAULT_TIMEOUT,
      config.proxyUrl,
    ),
  });

/**
 * Anthropic 兼容客户端。
 *
 * 走 Anthropic 的 `/v1/messages` 协议（`x-api-key` + `anthropic-version`），
 * 适用于 Claude 官方，以及提供 Anthropic 兼容层的服务（智谱 GLM、Kimi 等）。
 *
 * 说明：Anthropic 没有 embedding 接口，所以 `generateEmbeddingFromText` 直接抛错；
 * 需要向量检索时请单独配 `EMBEDDING_*`（走 OpenAI 兼容）。
 */
export interface AnthropicInferenceConfig {
  apiKey: string;
  baseURL: string;
  textModel: string;
  imageModel?: string;
  maxOutputTokens: number;
  timeoutSec: number;
}

export class AnthropicInferenceClient implements InferenceClient {
  constructor(private readonly config: AnthropicInferenceConfig) {}

  async inferFromText(
    prompt: string,
    _opts: Partial<InferenceOptions>,
  ): Promise<InferenceResponse> {
    const url = `${this.config.baseURL.replace(/\/+$/, "")}/v1/messages`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(5, this.config.timeoutSec) * 1000,
    );

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.config.textModel,
          max_tokens: this.config.maxOutputTokens,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });

      const raw = (await res.text()) || "{}";
      if (!res.ok) {
        throw new Error(
          `Anthropic ${res.status}: ${raw.slice(0, 300)}`,
        );
      }

      const json = JSON.parse(raw) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const text = (json.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("");

      const usage = json.usage;
      return {
        response: text,
        totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0) || 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async inferFromImage(
    _prompt: string,
    _contentType: string,
    _image: string,
    _opts: Partial<InferenceOptions>,
  ): Promise<InferenceResponse> {
    // 图片走文本通道会丢信息，明确拒绝而不是静默降级
    throw new Error(
      "Anthropic 兼容模式暂不支持图片推理；请用 OpenAI 兼容作为视觉模型",
    );
  }

  async generateEmbeddingFromText(): Promise<EmbeddingResponse> {
    throw new Error(
      "Anthropic 兼容模式不提供 embedding；如需向量检索，请单独配置 EMBEDDING_* （OpenAI 兼容）",
    );
  }
}

export class InferenceClientFactory {
  static build(): InferenceClient | null {
    // 1) 界面里填的配置优先（保存在 ${DATA_DIR}/ai-config.json，web 与 workers 共享）
    //    这样用户在设置页保存后立刻生效，不需要改 .env、也不需要重启。
    const runtime = loadAiConfig();
    if (runtime) {
      if (runtime.provider === "openai" && runtime.apiKey) {
        return new OpenAIInferenceClient({
          apiKey: runtime.apiKey,
          baseURL: runtime.baseUrl ?? serverConfig.inference.openAIBaseUrl,
          proxyUrl: serverConfig.inference.openAIProxyUrl,
          timeoutSec: serverConfig.inference.openAITimeoutSec,
          serviceTier: serverConfig.inference.openAIServiceTier,
          textModel: runtime.textModel ?? serverConfig.inference.textModel,
          imageModel: runtime.imageModel ?? serverConfig.inference.imageModel,
          contextLength: serverConfig.inference.contextLength,
          maxOutputTokens: serverConfig.inference.maxOutputTokens,
          useMaxCompletionTokens:
            serverConfig.inference.useMaxCompletionTokens,
          outputSchema: serverConfig.inference.outputSchema,
          reasoningEffort: serverConfig.inference.openAIReasoningEffort,
        });
      }
      if (runtime.provider === "anthropic" && runtime.apiKey) {
        return new AnthropicInferenceClient({
          apiKey: runtime.apiKey,
          baseURL:
            runtime.baseUrl ??
            serverConfig.inference.openAIBaseUrl ??
            "https://api.anthropic.com",
          textModel: runtime.textModel ?? serverConfig.inference.textModel,
          imageModel: runtime.imageModel ?? serverConfig.inference.imageModel,
          maxOutputTokens: serverConfig.inference.maxOutputTokens,
          timeoutSec: serverConfig.inference.openAITimeoutSec ?? 60,
        });
      }
      if (runtime.provider === "ollama" && runtime.baseUrl) {
        // Ollama 分支沿用环境变量里的模型名（界面里也可以覆盖）
        return new OllamaInferenceClient({
          ...serverConfig.inference,
          ollamaBaseUrl: runtime.baseUrl,
          textModel: runtime.textModel ?? serverConfig.inference.textModel,
          imageModel: runtime.imageModel ?? serverConfig.inference.imageModel,
        } as never);
      }
    }

    // 2) 回退到 .env
    if (serverConfig.inference.openAIApiKey) {
      return OpenAIInferenceClient.fromConfig();
    }

    if (serverConfig.inference.ollamaBaseUrl) {
      return OllamaInferenceClient.fromConfig();
    }
    return null;
  }
}

export class EmbeddingClientFactory {
  static build(): EmbeddingClient | null {
    if (
      serverConfig.embedding.openAIApiKey ||
      serverConfig.embedding.openAIBaseUrl
    ) {
      const apiKey =
        serverConfig.embedding.openAIApiKey ??
        serverConfig.inference.openAIApiKey;
      if (!apiKey) {
        logger.error(
          "EMBEDDING_OPENAI_API_KEY or OPENAI_API_KEY must be set when using EMBEDDING_OPENAI_BASE_URL",
        );
        return null;
      }
      return new OpenAIEmbeddingClient({
        apiKey,
        baseURL:
          serverConfig.embedding.openAIBaseUrl ??
          serverConfig.inference.openAIBaseUrl,
        proxyUrl: serverConfig.inference.openAIProxyUrl,
        timeoutSec: serverConfig.inference.openAITimeoutSec,
      });
    }

    return InferenceClientFactory.build();
  }
}

export class OpenAIEmbeddingClient implements EmbeddingClient {
  private openAI: OpenAI;

  constructor(config: OpenAIEmbeddingConfig) {
    this.openAI = buildOpenAIClient(config);
  }

  async generateEmbeddingFromText(
    inputs: string[],
  ): Promise<EmbeddingResponse> {
    const embedResponse = await this.openAI.embeddings.create({
      model: serverConfig.embedding.textModel,
      input: inputs,
      encoding_format: "float",
      ...(serverConfig.embedding.textModelDimensionOverride !== undefined
        ? {
            dimensions: serverConfig.embedding.textModelDimensionOverride,
          }
        : {}),
    });
    const embeddings = parseEmbeddingResponse(embedResponse);
    validateEmbeddingDimensions(embeddings);
    const usage = parseEmbeddingUsage(embedResponse);
    return { embeddings, ...usage };
  }
}

function extractOpenAIMessageContent(
  chatCompletion: OpenAI.Chat.Completions.ChatCompletion,
  opts: { allowEmpty: boolean },
): string {
  const choice = chatCompletion.choices[0];
  if (!choice) {
    throw new Error(`Got no choices in the response from OpenAI`);
  }
  const content = choice.message.content;
  if (content) {
    return content;
  }
  if (choice.message.refusal) {
    throw new Error(`OpenAI refused the request: ${choice.message.refusal}`);
  }
  if (choice.finish_reason === "length") {
    throw new Error(
      `Got no message content from OpenAI: the model hit the output token limit (INFERENCE_MAX_OUTPUT_TOKENS) before producing an answer. If you're using a reasoning model, consider increasing INFERENCE_MAX_OUTPUT_TOKENS.`,
    );
  }
  if (opts.allowEmpty && choice.finish_reason === "stop") {
    return "";
  }
  throw new Error(
    `Got no message content from OpenAI (finish_reason: ${choice.finish_reason})`,
  );
}

export class OpenAIInferenceClient implements InferenceClient {
  openAI: OpenAI;
  private config: OpenAIInferenceConfig;

  constructor(config: OpenAIInferenceConfig) {
    this.config = config;

    this.openAI = buildOpenAIClient(config);
  }

  static fromConfig(): OpenAIInferenceClient {
    return new OpenAIInferenceClient({
      apiKey: serverConfig.inference.openAIApiKey!,
      baseURL: serverConfig.inference.openAIBaseUrl,
      proxyUrl: serverConfig.inference.openAIProxyUrl,
      timeoutSec: serverConfig.inference.openAITimeoutSec,
      serviceTier: serverConfig.inference.openAIServiceTier,
      textModel: serverConfig.inference.textModel,
      imageModel: serverConfig.inference.imageModel,
      contextLength: serverConfig.inference.contextLength,
      maxOutputTokens: serverConfig.inference.maxOutputTokens,
      useMaxCompletionTokens: serverConfig.inference.useMaxCompletionTokens,
      outputSchema: serverConfig.inference.outputSchema,
      reasoningEffort: serverConfig.inference.openAIReasoningEffort,
    });
  }

  async inferFromText(
    prompt: string,
    _opts: Partial<InferenceOptions>,
  ): Promise<InferenceResponse> {
    const optsWithDefaults: InferenceOptions = {
      ...defaultInferenceOptions,
      ..._opts,
    };
    const chatCompletion = await this.openAI.chat.completions.create(
      {
        messages: [{ role: "user", content: prompt }],
        model: this.config.textModel,
        ...(this.config.serviceTier
          ? { service_tier: this.config.serviceTier }
          : {}),
        ...(this.config.useMaxCompletionTokens
          ? { max_completion_tokens: this.config.maxOutputTokens }
          : { max_tokens: this.config.maxOutputTokens }),
        response_format: mapOpenAIResponseFormat(
          optsWithDefaults.schema,
          this.config.outputSchema,
        ),
        reasoning_effort: this.config.reasoningEffort,
      },
      {
        signal: optsWithDefaults.abortSignal,
      },
    );

    const response = extractOpenAIMessageContent(chatCompletion, {
      allowEmpty: false,
    });
    return { response, totalTokens: chatCompletion.usage?.total_tokens };
  }

  async *inferFromTextStream(
    prompt: string,
    _opts: Partial<InferenceOptions>,
  ): AsyncIterable<string> {
    const optsWithDefaults: InferenceOptions = {
      ...defaultInferenceOptions,
      ..._opts,
    };
    const stream = await this.openAI.chat.completions.create(
      {
        messages: [{ role: "user", content: prompt }],
        model: this.config.textModel,
        stream: true,
        ...(this.config.serviceTier
          ? { service_tier: this.config.serviceTier }
          : {}),
        ...(this.config.useMaxCompletionTokens
          ? { max_completion_tokens: this.config.maxOutputTokens }
          : { max_tokens: this.config.maxOutputTokens }),
        reasoning_effort: this.config.reasoningEffort,
      },
      { signal: optsWithDefaults.abortSignal },
    );

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        yield delta;
      }
    }
  }

  async inferFromImage(
    prompt: string,
    contentType: string,
    image: string,
    _opts: Partial<InferenceOptions>,
  ): Promise<InferenceResponse> {
    const optsWithDefaults: InferenceOptions = {
      ...defaultInferenceOptions,
      ..._opts,
    };
    const chatCompletion = await this.openAI.chat.completions.create(
      {
        model: this.config.imageModel,
        ...(this.config.serviceTier
          ? { service_tier: this.config.serviceTier }
          : {}),
        ...(this.config.useMaxCompletionTokens
          ? { max_completion_tokens: this.config.maxOutputTokens }
          : { max_tokens: this.config.maxOutputTokens }),
        response_format: mapOpenAIResponseFormat(
          optsWithDefaults.schema,
          this.config.outputSchema,
        ),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${contentType};base64,${image}`,
                  detail: "low",
                },
              },
            ],
          },
        ],
      },
      {
        signal: optsWithDefaults.abortSignal,
      },
    );

    // Free-form image prompts (e.g. OCR) can legitimately produce an empty
    // answer when there's nothing to extract, so don't treat that as an error.
    // Structured requests (e.g. tagging) always expect a JSON payload.
    const response = extractOpenAIMessageContent(chatCompletion, {
      allowEmpty: optsWithDefaults.schema === null,
    });
    return { response, totalTokens: chatCompletion.usage?.total_tokens };
  }

  async generateEmbeddingFromText(
    inputs: string[],
  ): Promise<EmbeddingResponse> {
    const model = serverConfig.embedding.textModel;
    const embedResponse = await this.openAI.embeddings.create({
      model: model,
      input: inputs,
      encoding_format: "float",
      ...(serverConfig.embedding.textModelDimensionOverride !== undefined
        ? {
            dimensions: serverConfig.embedding.textModelDimensionOverride,
          }
        : {}),
    });
    const embedding2D = parseEmbeddingResponse(embedResponse);
    validateEmbeddingDimensions(embedding2D);
    const usage = parseEmbeddingUsage(embedResponse);
    return { embeddings: embedding2D, ...usage };
  }
}

export interface OllamaInferenceConfig {
  baseUrl: string;
  textModel: string;
  imageModel: string;
  contextLength: number;
  maxOutputTokens: number;
  keepAlive?: string;
  outputSchema: "structured" | "json" | "plain";
}

class OllamaInferenceClient implements InferenceClient {
  ollama: Ollama;
  private config: OllamaInferenceConfig;

  constructor(config: OllamaInferenceConfig) {
    this.config = config;
    this.ollama = new Ollama({
      host: config.baseUrl,
      fetch: createCustomFetch(serverConfig.inference.fetchTimeoutSec * 1000),
    });
  }

  static fromConfig(): OllamaInferenceClient {
    return new OllamaInferenceClient({
      baseUrl: serverConfig.inference.ollamaBaseUrl!,
      textModel: serverConfig.inference.textModel,
      imageModel: serverConfig.inference.imageModel,
      contextLength: serverConfig.inference.contextLength,
      maxOutputTokens: serverConfig.inference.maxOutputTokens,
      keepAlive: serverConfig.inference.ollamaKeepAlive,
      outputSchema: serverConfig.inference.outputSchema,
    });
  }

  async runModel(
    model: string,
    prompt: string,
    _opts: InferenceOptions,
    image?: string,
  ) {
    const optsWithDefaults: InferenceOptions = {
      ...defaultInferenceOptions,
      ..._opts,
    };

    let newAbortSignal = undefined;
    if (optsWithDefaults.abortSignal) {
      newAbortSignal = AbortSignal.any([optsWithDefaults.abortSignal]);
      newAbortSignal.onabort = () => {
        this.ollama.abort();
      };
    }
    const chatCompletion = await this.ollama.generate({
      model: model,
      format: mapInferenceOutputSchema(
        {
          // Use Zod 4's native JSON Schema emitter for Ollama structured output.
          structured: optsWithDefaults.schema
            ? z.toJSONSchema(optsWithDefaults.schema)
            : undefined,
          json: "json",
          plain: undefined,
        },
        this.config.outputSchema,
      ),
      stream: true,
      keep_alive: this.config.keepAlive,
      options: {
        num_ctx: this.config.contextLength,
        num_predict: this.config.maxOutputTokens,
      },
      prompt: prompt,
      images: image ? [image] : undefined,
    });

    let totalTokens = 0;
    let response = "";
    try {
      for await (const part of chatCompletion) {
        response += part.response;
        if (!isNaN(part.eval_count)) {
          totalTokens += part.eval_count;
        }
        if (!isNaN(part.prompt_eval_count)) {
          totalTokens += part.prompt_eval_count;
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw e;
      }
      // There seem to be some bug in ollama where you can get some successful response, but still throw an error.
      // Using stream + accumulating the response so far is a workaround.
      // https://github.com/ollama/ollama-js/issues/72
      totalTokens = NaN;
      logger.warn(
        `Got an exception from ollama, will still attempt to deserialize the response we got so far: ${e}`,
      );
    } finally {
      if (newAbortSignal) {
        newAbortSignal.onabort = null;
      }
    }

    return { response, totalTokens };
  }

  async inferFromText(
    prompt: string,
    _opts: Partial<InferenceOptions>,
  ): Promise<InferenceResponse> {
    const optsWithDefaults: InferenceOptions = {
      ...defaultInferenceOptions,
      ..._opts,
    };
    return await this.runModel(
      this.config.textModel,
      prompt,
      optsWithDefaults,
      undefined,
    );
  }

  async inferFromImage(
    prompt: string,
    _contentType: string,
    image: string,
    _opts: Partial<InferenceOptions>,
  ): Promise<InferenceResponse> {
    const optsWithDefaults: InferenceOptions = {
      ...defaultInferenceOptions,
      ..._opts,
    };
    return await this.runModel(
      this.config.imageModel,
      prompt,
      optsWithDefaults,
      image,
    );
  }

  async generateEmbeddingFromText(
    inputs: string[],
  ): Promise<EmbeddingResponse> {
    const embedding = await this.ollama.embed({
      model: serverConfig.embedding.textModel,
      input: inputs,
      // Truncate the input to fit into the model's max token limit,
      // in the future we want to add a way to split the input into multiple parts.
      truncate: true,
    });
    validateEmbeddingDimensions(embedding.embeddings);
    const usage = parseEmbeddingUsage(embedding);
    return { embeddings: embedding.embeddings, ...usage };
  }
}
