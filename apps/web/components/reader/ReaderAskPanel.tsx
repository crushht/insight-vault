"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Send, Sparkles, X } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

import { Button } from "@/components/ui/button";

/**
 * 阅读台里的「就这篇提问」。
 *
 * 只在这条收藏自己的分块里检索（`chat.askAboutBookmark`），回答带 `[n]` 引用，
 * 点一下展开命中原文；不写进聊天历史，也不会跨收藏串味。
 */

interface Citation {
  n: number;
  bookmarkId: string;
  chunkId?: string;
  quote?: string;
  startOffset?: number;
  endOffset?: number;
}

interface Turn {
  question: string;
  answer: string;
  citations: Citation[];
  error?: string;
  needsAi?: boolean;
}

export function ReaderAskPanel({
  bookmarkId,
  onClose,
}: {
  bookmarkId: string;
  onClose: () => void;
}) {
  const api = useTRPC();
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [openQuote, setOpenQuote] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const ask = useMutation(api.chat.askAboutBookmark.mutationOptions());

  const submit = async () => {
    const question = draft.trim();
    if (!question || ask.isPending) return;
    setDraft("");
    try {
      const res = await ask.mutateAsync({ bookmarkId, question });
      setTurns((prev) => [
        ...prev,
        { question, answer: res.answer, citations: res.citations },
      ]);
    } catch (e) {
      const err = e as { data?: { code?: string }; message?: string };
      const needsAi = err?.data?.code === "PRECONDITION_FAILED";
      setTurns((prev) => [
        ...prev,
        {
          question,
          answer: "",
          citations: [],
          error: needsAi
            ? "还没配置 AI 模型"
            : (err?.message ?? "提问失败，请稍后重试"),
          needsAi,
        },
      ]);
    } finally {
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    }
  };

  const renderAnswer = (turn: Turn) => {
    const parts = turn.answer.split(/(\[\d+\])/g);
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {parts.map((part, i) => {
          const m = /^\[(\d+)\]$/.exec(part);
          if (!m) return <span key={i}>{part}</span>;
          const n = Number(m[1]);
          const citation = turn.citations.find((c) => c.n === n);
          if (!citation) return <span key={i}>{part}</span>;
          const key = `${turn.question}-${n}`;
          return (
            <button
              key={i}
              type="button"
              onClick={() =>
                setOpenQuote((prev) => (prev === key ? null : key))
              }
              className="mx-0.5 rounded px-1 text-caption text-brand-600 underline decoration-dotted hover:bg-brand-50"
              title="查看原文片段"
            >
              [{n}]
            </button>
          );
        })}
      </p>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-brand-600" />
          就这篇提问
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭提问面板">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <p className="text-caption leading-relaxed text-muted-foreground">
            问这篇里的任何细节，例如「作者的核心结论是什么？」「这个方法有什么前提？」。
            回答会标注引用的原文片段，点 <span className="text-brand-600">[1]</span> 就能看到出处。
          </p>
        )}
        {turns.map((turn, idx) => (
          <div key={idx} className="space-y-2">
            <p className="text-label font-medium text-foreground">
              {turn.question}
            </p>
            {turn.error ? (
              <p className="text-caption text-destructive">
                {turn.error}
                {turn.needsAi && (
                  <>
                    {" "}
                    <Link href="/settings/ai" className="underline">
                      去配置
                    </Link>
                  </>
                )}
              </p>
            ) : (
              <div className="rounded-lg bg-surface-sunken px-3 py-2">
                {renderAnswer(turn)}
                {turn.citations.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-border pt-2">
                    {turn.citations.map((c) => {
                      const key = `${turn.question}-${c.n}`;
                      const quote = c.quote ?? "";
                      return (
                        <div key={c.chunkId ?? c.n} className="text-caption">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenQuote((prev) => (prev === key ? null : key))
                            }
                            className="text-brand-600 hover:underline"
                          >
                            [{c.n}] 出处
                          </button>
                          {openQuote === key && (
                            <blockquote className="mt-1 border-l-2 border-brand-300 pl-2 text-muted-foreground">
                              {quote.slice(0, 300)}
                              {quote.length > 300 ? "…" : ""}
                            </blockquote>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={3}
          placeholder="就这篇问一句…（Enter 发送，Shift+Enter 换行）"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          data-testid="reader-ask-input"
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={ask.isPending || !draft.trim()}
            data-testid="reader-ask-submit"
          >
            {ask.isPending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Send className="mr-1 size-3.5" />
            )}
            提问
          </Button>
        </div>
      </div>
    </div>
  );
}
