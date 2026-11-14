import os from "os";
import { and, eq } from "drizzle-orm";

import type { AssetPreprocessingRequest } from "@karakeep/shared-server";
import { db } from "@karakeep/db";
import {
  assets,
  AssetTypes,
  bookmarkAssets,
  bookmarks,
} from "@karakeep/db/schema";
import {
  addLogFields,
  AssetPreprocessingQueue,
  EmbeddingsQueue,
  newAssetId,
  OpenAIQueue,
  QuotaService,
  readAsset,
  saveAsset,
  StorageQuotaError,
  triggerSearchReindex,
} from "@karakeep/shared-server";
import serverConfig from "@karakeep/shared/config";
import { InferenceClientFactory } from "@karakeep/shared/inference";
import logger from "@karakeep/shared/logger";
import { buildOCRPrompt } from "@karakeep/shared/prompts";
import {
  DequeuedJob,
  EnqueueOptions,
  getQueueClient,
} from "@karakeep/shared/queueing";

import { workerStatsCounter } from "../metrics";
import { withWorkerEventLog, withWorkerTracing } from "../workerTracing";

export class AssetPreprocessingWorker {
  static async build() {
    logger.info("Starting asset preprocessing worker ...");
    const worker =
      (await getQueueClient())!.createRunner<AssetPreprocessingRequest>(
        AssetPreprocessingQueue,
        {
          run: withWorkerTracing(
            "assetPreprocessingWorker.run",
            withWorkerEventLog("assetPreprocessingWorker.run", run),
          ),
          onComplete: async (job) => {
            workerStatsCounter.labels("assetPreprocessing", "completed").inc();
            const jobId = job.id;
            logger.info(
              `[assetPreprocessing][${jobId}] Completed successfully`,
            );
            return Promise.resolve();
          },
          onError: async (job) => {
            workerStatsCounter.labels("assetPreProcessing", "failed").inc();
            if (job.numRetriesLeft == 0) {
              workerStatsCounter
                .labels("assetPreProcessing", "failed_permanent")
                .inc();
            }
            const jobId = job.id;
            logger.error(
              `[assetPreprocessing][${jobId}] Asset preprocessing failed: ${job.error}\n${job.error.stack}`,
            );

            const bookmarkId = job.data?.bookmarkId;
            if (bookmarkId && job.numRetriesLeft == 0) {
              await db.transaction((tx) => {
                tx.update(bookmarks)
                  .set({
                    taggingStatus: null,
                  })
                  .where(
                    and(
                      eq(bookmarks.id, bookmarkId),
                      eq(bookmarks.taggingStatus, "pending"),
                    ),
                  )
                  .run();
                tx.update(bookmarks)
                  .set({
                    summarizationStatus: null,
                  })
                  .where(
                    and(
                      eq(bookmarks.id, bookmarkId),
                      eq(bookmarks.summarizationStatus, "pending"),
                    ),
                  )
                  .run();
                tx.update(bookmarks)
                  .set({
                    embeddingStatus: null,
                  })
                  .where(
                    and(
                      eq(bookmarks.id, bookmarkId),
                      eq(bookmarks.embeddingStatus, "pending"),
                    ),
                  )
                  .run();
              });
            }
            return Promise.resolve();
          },
        },
        {
          concurrency: serverConfig.assetPreprocessing.numWorkers,
          pollIntervalMs: 1000,
          timeoutSecs: serverConfig.assetPreprocessing.jobTimeoutSec,
        },
      );

    return worker;
  }
}

async function readImageText(buffer: Buffer) {
  if (serverConfig.ocr.langs.length == 1 && serverConfig.ocr.langs[0] == "") {
    return null;
  }
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(serverConfig.ocr.langs, undefined, {
    cachePath: serverConfig.ocr.cacheDir ?? os.tmpdir(),
  });
  try {
    const ret = await worker.recognize(buffer);
    if (ret.data.confidence <= serverConfig.ocr.confidenceThreshold) {
      return null;
    }
    return ret.data.text;
  } finally {
    await worker.terminate();
  }
}

async function readImageTextWithLLM(
  buffer: Buffer,
  contentType: string,
): Promise<string | null> {
  const inferenceClient = InferenceClientFactory.build();
  if (!inferenceClient) {
    logger.warn(
      "[assetPreprocessing] LLM OCR is enabled but no inference client is configured. Falling back to Tesseract.",
    );
    return readImageText(buffer);
  }

  const base64 = buffer.toString("base64");
  const prompt = buildOCRPrompt();

  const response = await inferenceClient.inferFromImage(
    prompt,
    contentType,
    base64,
    {
      schema: null,
    },
  );

  const extractedText = response.response.trim();
  if (!extractedText) {
    return null;
  }

  return extractedText;
}

async function readPDFText(buffer: Buffer): Promise<{
  text: string;
  metadata: Record<string, object>;
}> {
  const { default: PDFParser } = await import("pdf2json");
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, true);
    pdfParser.on("pdfParser_dataError", reject);
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      resolve({
        text: pdfParser.getRawTextContent(),
        metadata: pdfData.Meta,
      });
    });
    pdfParser.parseBuffer(buffer);
  });
}

export async function extractAndSavePDFScreenshot(
  jobId: string,
  asset: Buffer,
  bookmark: NonNullable<Awaited<ReturnType<typeof getBookmark>>>,
  isFixMode: boolean,
): Promise<boolean> {
  {
    const alreadyHasScreenshot =
      bookmark.assets.find(
        (r) => r.assetType === AssetTypes.ASSET_SCREENSHOT,
      ) !== undefined;
    if (alreadyHasScreenshot && isFixMode) {
      logger.info(
        `[assetPreprocessing][${jobId}] Skipping PDF screenshot generation as it's already been generated.`,
      );
      return false;
    }
  }
  logger.info(
    `[assetPreprocessing][${jobId}] Attempting to generate PDF screenshot for bookmarkId: ${bookmark.id}`,
  );
  try {
    const { fromBuffer } = await import("pdf2pic");
    /**
     * If you encountered any issues with this library, make sure you have ghostscript and graphicsmagick installed following this URL
     * https://github.com/yakovmeister/pdf2image/blob/HEAD/docs/gm-installation.md
     */
    const screenshot = await fromBuffer(asset, {
      density: 100,
      quality: 100,
      format: "png",
      preserveAspectRatio: true,
    })(1, { responseType: "buffer" });

    if (!screenshot.buffer) {
      logger.error(
        `[assetPreprocessing][${jobId}] Failed to generate PDF screenshot`,
      );
      return false;
    }

    // Check storage quota before inserting
    const quotaApproved = await QuotaService.checkStorageQuota(
      db,
      bookmark.userId,
      screenshot.buffer.byteLength,
    );

    // Store the screenshot
    const assetId = newAssetId();
    const fileName = "screenshot.png";
    const contentType = "image/png";
    await saveAsset({
      userId: bookmark.userId,
      assetId,
      asset: screenshot.buffer,
      metadata: {
        contentType,
        fileName,
      },
      quotaApproved,
    });

    if (!screenshot.buffer || screenshot.buffer.byteLength === 0) {
      logger.warn(
        `[assetPreprocessing][${jobId}] 截图缓冲区为空（多半是缺少 ImageMagick/GraphicsMagick），跳过写库以免前端出现破图。`,
      );
      return true;
    }

    // Insert into database
    await db.insert(assets).values({
      id: assetId,
      bookmarkId: bookmark.id,
      userId: bookmark.userId,
      assetType: AssetTypes.ASSET_SCREENSHOT,
      contentType,
      size: screenshot.buffer.byteLength,
      fileName,
    });

    logger.info(
      `[assetPreprocessing][${jobId}] Successfully saved PDF screenshot to database`,
    );
    return true;
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      logger.warn(
        `[assetPreprocessing][${jobId}] Skipping PDF screenshot due to quota exceeded: ${error.message}`,
      );
      return true; // Return true to indicate the job completed successfully, just skipped the asset
    }
    logger.error(
      `[assetPreprocessing][${jobId}] Failed to process PDF screenshot: ${error}`,
    );
    return false;
  }
}

async function extractAndSaveImageText(
  jobId: string,
  asset: Buffer,
  contentType: string,
  bookmark: NonNullable<Awaited<ReturnType<typeof getBookmark>>>,
  isFixMode: boolean,
): Promise<boolean> {
  {
    const alreadyHasText = !!bookmark.asset.content;
    if (alreadyHasText && isFixMode) {
      logger.info(
        `[assetPreprocessing][${jobId}] Skipping image text extraction as it's already been extracted.`,
      );
      return false;
    }
  }
  let imageText = null;

  if (serverConfig.ocr.useLLM) {
    logger.info(
      `[assetPreprocessing][${jobId}] Attempting to extract text from image using LLM OCR.`,
    );
    try {
      imageText = await readImageTextWithLLM(asset, contentType);
    } catch (e) {
      logger.error(
        `[assetPreprocessing][${jobId}] Failed to read image text with LLM: ${e}`,
      );
    }
  } else {
    logger.info(
      `[assetPreprocessing][${jobId}] Attempting to extract text from image using Tesseract.`,
    );
    try {
      imageText = await readImageText(asset);
    } catch (e) {
      logger.error(
        `[assetPreprocessing][${jobId}] Failed to read image text: ${e}`,
      );
    }
  }

  if (!imageText) {
    return false;
  }

  logger.info(
    `[assetPreprocessing][${jobId}] Extracted ${imageText.length} characters from image.`,
  );
  await db
    .update(bookmarkAssets)
    .set({
      content: imageText,
      metadata: null,
    })
    .where(eq(bookmarkAssets.id, bookmark.id));
  return true;
}

/** 扫描版 PDF：把前几页渲染成 PNG，逐页交给视觉模型读字。 */
async function renderPDFPagesToPngs(
  buffer: Buffer,
  maxPages: number,
  scale: number,
  jobId: string,
): Promise<Array<{ page: number; png: Buffer }>> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    // 只做栅格化，不需要字体数据
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  const pages: Array<{ page: number; png: Buffer }> = [];
  const numPages = Number((doc as { numPages?: number })?.numPages ?? 0);
  const total = Math.max(1, Math.min(numPages || 1, maxPages));
  logger.info(
    `[assetPreprocessing][${jobId}] PDF 共 ${numPages} 页，渲染前 ${total} 页（scale=${scale}）。`,
  );
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext("2d");
    await page.render({
      canvas: canvas as never,
      canvasContext: ctx as never,
      viewport,
    }).promise;
    pages.push({ page: i, png: canvas.toBuffer("image/png") });
    page.cleanup();
  }
  await loadingTask.destroy();
  return pages;
}

async function readScannedPDFText(
  jobId: string,
  buffer: Buffer,
): Promise<{ text: string; pages: number } | null> {
  const maxPages = Number(process.env.PDF_OCR_MAX_PAGES ?? 5);
  const scale = Number(process.env.PDF_OCR_SCALE ?? 1.6);

  let pages: Array<{ page: number; png: Buffer }>;
  try {
    pages = await renderPDFPagesToPngs(buffer, maxPages, scale, jobId);
  } catch (e) {
    logger.warn(
      `[assetPreprocessing][${jobId}] 渲染扫描版 PDF 失败：${(e as Error)?.message ?? e}`,
    );
    return null;
  }
  if (pages.length === 0) {
    logger.warn(`[assetPreprocessing][${jobId}] 没有渲染出任何页面。`);
    return null;
  }

  const chunks: string[] = [];
  for (const { page, png } of pages) {
    try {
      const text = await readImageTextWithLLM(png, "image/png");
      logger.info(
        `[assetPreprocessing][${jobId}] 第 ${page} 页 PNG ${png.length} 字节，OCR 得到 ${text?.length ?? 0} 字符。`,
      );
      if (text?.trim()) {
        chunks.push(`【第 ${page} 页】\n${text.trim()}`);
      }
    } catch (e) {
      logger.warn(
        `[assetPreprocessing][${jobId}] 第 ${page} 页 OCR 失败：${(e as Error)?.message ?? e}`,
      );
    }
  }
  if (chunks.length === 0) return null;
  return { text: chunks.join("\n\n"), pages: pages.length };
}

/** pdf2json 会把分页标记和多余空白混进正文；先清干净再判断「有没有文本层」。 */
function cleanPdfText(raw: string): string {
  return raw
    .replace(/-{3,}\s*Page\s*\(\d+\)\s*Break\s*-{3,}/gi, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractAndSavePDFText(
  jobId: string,
  asset: Buffer,
  bookmark: NonNullable<Awaited<ReturnType<typeof getBookmark>>>,
  isFixMode: boolean,
): Promise<boolean> {
  {
    const alreadyHasText = !!bookmark.asset.content;
    if (alreadyHasText && isFixMode) {
      logger.info(
        `[assetPreprocessing][${jobId}] Skipping PDF text extraction as it's already been extracted.`,
      );
      return false;
    }
  }
  logger.info(
    `[assetPreprocessing][${jobId}] Attempting to extract text from pdf.`,
  );
  const pdfParse = await readPDFText(asset);
  let text = cleanPdfText(pdfParse?.text ?? "");
  let metadata = pdfParse?.metadata;

  // 没有文本层（扫描件 / 图片拼的 PDF）→ 渲染前几页，交给视觉模型读字
  if (text.length < 40) {
    logger.info(
      `[assetPreprocessing][${jobId}] PDF 文本层几乎为空（${text.length} 字符），尝试视觉 OCR。`,
    );
    const ocr = await readScannedPDFText(jobId, asset);
    if (ocr) {
      text = ocr.text;
      metadata = {
        ...(metadata ?? {}),
        ocr: "vision",
        ocrPages: ocr.pages,
      } as unknown as Record<string, object>;
      logger.info(
        `[assetPreprocessing][${jobId}] 视觉 OCR 读到 ${text.length} 字符（${ocr.pages} 页）。`,
      );
    }
  }

  if (!text) {
    throw new Error(
      `[assetPreprocessing][${jobId}] PDF text is empty. Please make sure that the PDF includes text and not just images.`,
    );
  }
  logger.info(
    `[assetPreprocessing][${jobId}] Extracted ${text.length} characters from pdf.`,
  );
  await db
    .update(bookmarkAssets)
    .set({
      content: text,
      metadata: metadata ? JSON.stringify(metadata) : null,
    })
    .where(eq(bookmarkAssets.id, bookmark.id));
  return true;
}

async function getBookmark(bookmarkId: string) {
  return db.query.bookmarks.findFirst({
    where: eq(bookmarks.id, bookmarkId),
    with: {
      asset: true,
      assets: true,
    },
  });
}

async function run(req: DequeuedJob<AssetPreprocessingRequest>) {
  const isFixMode = req.data.fixMode;
  const jobId = req.id;
  const bookmarkId = req.data.bookmarkId;
  addLogFields<"assetPreprocessingWorker.run">({ "bookmark.id": bookmarkId });

  const bookmark = await db.query.bookmarks.findFirst({
    where: eq(bookmarks.id, bookmarkId),
    with: {
      asset: true,
      assets: true,
    },
  });

  logger.info(
    `[assetPreprocessing][${jobId}] Starting an asset preprocessing job for bookmark with id "${bookmarkId}"`,
  );

  if (!bookmark) {
    throw new Error(`[assetPreprocessing][${jobId}] Bookmark not found`);
  }

  if (!bookmark.asset) {
    throw new Error(
      `[assetPreprocessing][${jobId}] Bookmark is not an asset (not an image or pdf)`,
    );
  }

  const { asset, metadata } = await readAsset({
    userId: bookmark.userId,
    assetId: bookmark.asset.assetId,
  });

  if (!asset) {
    throw new Error(
      `[assetPreprocessing][${jobId}] AssetId ${bookmark.asset.assetId} for bookmark ${bookmarkId} not found`,
    );
  }

  addLogFields<"assetPreprocessingWorker.run">({
    "user.id": bookmark.userId,
    "asset.type": bookmark.asset.assetType,
    "asset.size": asset.length,
    "asset.content_type": metadata.contentType,
    "preprocessing.fix_mode": isFixMode,
  });

  let anythingChanged = false;
  switch (bookmark.asset.assetType) {
    case "image": {
      const extractedText = await extractAndSaveImageText(
        jobId,
        asset,
        metadata.contentType,
        bookmark,
        isFixMode,
      );
      anythingChanged ||= extractedText;
      break;
    }
    case "pdf": {
      const extractedText = await extractAndSavePDFText(
        jobId,
        asset,
        bookmark,
        isFixMode,
      );
      const extractedScreenshot = await extractAndSavePDFScreenshot(
        jobId,
        asset,
        bookmark,
        isFixMode,
      );
      anythingChanged ||= extractedText || extractedScreenshot;
      break;
    }
    default:
      throw new Error(
        `[assetPreprocessing][${jobId}] Unsupported bookmark type`,
      );
  }

  addLogFields<"assetPreprocessingWorker.run">({
    "preprocessing.changed": anythingChanged,
  });

  // Propagate priority to child jobs
  const enqueueOpts: EnqueueOptions = {
    priority: req.priority,
    groupId: bookmark.userId,
  };
  if (!isFixMode || anythingChanged) {
    if (serverConfig.embedding.enableAutoIndexing) {
      await EmbeddingsQueue.enqueue(
        {
          bookmarkId,
          type: "embed",
          runTaggingOnComplete: true,
        },
        enqueueOpts,
      );
    } else {
      await OpenAIQueue.enqueue(
        {
          bookmarkId,
          type: "tag",
        },
        enqueueOpts,
      );
    }
    await OpenAIQueue.enqueue(
      {
        bookmarkId,
        type: "summarize",
      },
      enqueueOpts,
    );

    // Update the search index
    await triggerSearchReindex(bookmarkId, enqueueOpts);
  }
}
