"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare, Plus, Send, Trash2 } from "lucide-react";

import { useTRPC } from "@karakeep/shared-react/trpc";

import { ActionButton } from "@/components/ui/action-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { splitCitations } from "@/lib/citations";
import { useTranslation } from "@/lib/i18n/client";

interface Citation {
  n: number;
  bookmarkId: string;
  quote?: string;
}

export default function ChatPage() {
  useTranslation();
  const api = useTRPC();
  const [chatId, setChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const sessions = useQuery(api.chat.listSessions.queryOptions());
  const messages = useQuery(
    api.chat.getMessages.queryOptions(
      { chatId: chatId ?? "" },
      { enabled: Boolean(chatId) },
    ),
  );

  const createSession = useMutation(api.chat.createSession.mutationOptions());
  const deleteSession = useMutation(api.chat.deleteSession.mutationOptions());

  const handleNewSession = async () => {
    const session = await createSession.mutateAsync({ title: "新对话" });
    setChatId(session.id);
    await sessions.refetch();
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !chatId) return;
    setDraft("");
    setStreamError(null);
    setStreaming("");

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, content }),
      });
      if (!res.ok || !res.body) {
        setStreamError(`请求失败（${res.status}）`);
        setStreaming(null);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as { delta?: string; error?: string };
            if (parsed.error) setStreamError(parsed.error);
            if (parsed.delta) {
              acc += parsed.delta;
              setStreaming(acc);
            }
          } catch {
            /* 忽略非 JSON 帧 */
          }
        }
      }
    } catch (e) {
      setStreamError(String((e as Error)?.message ?? e));
    } finally {
      setStreaming(null);
      await messages.refetch();
      await sessions.refetch();
    }
  };

  return (
    <div className="flex min-h-[60vh] flex-col gap-4 lg:h-[calc(100vh-8rem)] lg:flex-row">
      {/* 会话列表 */}
      <aside className="flex w-full shrink-0 flex-col gap-2 lg:w-60">
        <ActionButton
          className="w-full"
          ignoreDemoMode
          onClick={handleNewSession}
          loading={createSession.isPending}
          data-testid="chat-new-session"
        >
          <Plus className="size-4" />
          新对话
        </ActionButton>
        <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-surface-raised">
          {sessions.data?.length ? (
            sessions.data.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setChatId(s.id)}
                className={`flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-label transition-colors hover:bg-accent ${
                  chatId === s.id ? "bg-brand-50 text-brand-700" : ""
                }`}
              >
                <span className="truncate">{s.title}</span>
                <Trash2
                  className="size-3.5 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteSession
                      .mutateAsync({ chatId: s.id })
                      .then(() => {
                        if (chatId === s.id) setChatId(null);
                        return sessions.refetch();
                      });
                  }}
                />
              </button>
            ))
          ) : (
            <p className="p-4 text-caption text-muted-foreground">
              还没有对话，点上方「新对话」开始。
            </p>
          )}
        </div>
      </aside>

      {/* 消息区 */}
      <Card className="flex min-w-0 flex-1 flex-col">
        <CardHeader className="border-b border-border py-3">
          <CardTitle className="flex items-center gap-2 text-body-lg">
            <MessageSquare className="size-4 text-brand-600" />
            AI 对话（基于你的收藏）
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="flex-1 space-y-3 overflow-y-auto">
            {!chatId && (
              <p className="text-body text-muted-foreground">
                选择一个对话，或新建一个。回答只会引用你自己的收藏。
              </p>
            )}
            {messages.data?.map((m) => {
              const citations =
                (m.metadata as { citations?: Citation[] } | null)?.citations ?? [];
              return (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[80%] rounded-lg bg-brand-600 px-3 py-2 text-body text-white"
                      : "mr-auto max-w-[85%] rounded-lg border border-border bg-surface px-3 py-2 text-body"
                  }
                >
                  {m.role === "assistant" ? (
                    <p className="whitespace-pre-wrap">
                      {splitCitations(
                        m.content,
                        citations.map((c) => ({
                          n: c.n,
                          bookmarkId: c.bookmarkId,
                        })),
                      ).map((seg, i) =>
                        seg.n !== undefined && seg.bookmarkId ? (
                          <Link
                            key={i}
                            href={`/dashboard/preview/${seg.bookmarkId}`}
                            title={`引用 ${seg.n}`}
                            className="mx-0.5 align-super text-[0.7em] font-medium text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-700"
                          >
                            [{seg.n}]
                          </Link>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        ),
                      )}
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                  {m.role === "assistant" && citations.length > 0 && (
                    <div className="mt-2 border-t border-border pt-2 text-caption text-muted-foreground">
                      引用：
                      {citations.map((c) => (
                        <span key={c.n} className="mr-2 text-brand-600">
                          [{c.n}]
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {streaming !== null && streaming.length > 0 && (
            <div className="mr-auto max-w-[85%] rounded-lg border border-brand-300/60 bg-surface px-3 py-2 text-body">
              <p className="whitespace-pre-wrap">{streaming}</p>
              <span className="mt-1 inline-block size-2 animate-pulse rounded-full bg-brand-500" />
            </div>
          )}
          <div className="flex gap-2">
            <input
              className="h-9 flex-1 rounded-md border border-input bg-surface-raised px-3 text-body outline-none focus-visible:border-brand-500"
              placeholder={chatId ? "问点什么…" : "先新建或选择一个对话"}
              value={draft}
              disabled={!chatId}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              data-testid="chat-input"
            />
            <ActionButton
              onClick={handleSend}
              disabled={!chatId || !draft.trim()}
              loading={streaming !== null}
              data-testid="chat-send"
            >
              <Send className="size-4" />
              发送
            </ActionButton>
          </div>
          {streamError && (
            <p className="text-caption text-destructive">{streamError}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
