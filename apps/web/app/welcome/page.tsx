import Link from "next/link";
import { ArrowRight, Database, MessageSquare, Network, Sparkles } from "lucide-react";

import { BRAND } from "@/lib/brand";
import BrandLogo from "@/components/BrandLogo";
import { getServerAuthSession } from "@/server/auth";

/**
 * 官网落地页（未登录可访问）。
 *
 * 这一页不继承 dashboard 的鉴权逻辑，是产品的对外门面。
 * 全部使用语义 token，无图片依赖 —— 首屏不需要等待任何资源。
 */

export const metadata = {
  title: `${BRAND.nameZh} · ${BRAND.name}`,
  description: BRAND.description,
};

const CAPABILITIES = [
  {
    icon: Database,
    title: "把中文互联网收进来",
    body: "微信公众号、B 站、知乎、小红书各有一条适配路径；解析失败也能退化成「链接 + 你的补充」，照样可搜、可被 AI 使用。",
  },
  {
    icon: MessageSquare,
    title: "回答必须能溯源",
    body: "AI 对话只使用你自己的收藏，每个事实句带 [n] 引用；资料不足时它会直接说「你的收藏里没有相关内容」。",
  },
  {
    icon: Sparkles,
    title: "专题与创作，不配 AI 也能用",
    body: "输入一个主题，先给你素材清单与引用编号；配置模型后升级成结构化报告。六类产物从文章到 PPT 大纲。",
  },
  {
    icon: Network,
    title: "知识图谱自动长出关系",
    body: "从正文抽取人物、组织、技术、概念，同句共现即连边。点任意节点都能回到原文。",
  },
];

export default async function WelcomePage() {
  const session = await getServerAuthSession();

  return (
    <div className="min-h-screen bg-background">
      {/* 顶栏 */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <BrandLogo height={30} withWordmark />
        <nav className="flex items-center gap-4 text-label">
          {session ? (
            <Link
              href="/dashboard/bookmarks"
              className="rounded-md bg-brand-600 px-4 py-2 text-white transition-colors hover:bg-brand-700"
            >
              进入知识库
            </Link>
          ) : (
            <>
              <Link
                href="/signin"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                登录
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-brand-600 px-4 py-2 text-white transition-colors hover:bg-brand-700"
              >
                免费开始
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pb-16 pt-14 text-center">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised px-3 py-1 text-caption text-muted-foreground">
          <span className="size-1.5 rounded-full bg-brand-500" />
          自托管 · 数据在自己手里
        </p>
        <h1 className="font-display text-[2.75rem] font-semibold leading-[1.15] tracking-tight text-foreground sm:text-[3.25rem]">
          把互联网收进仓库，
          <br className="hidden sm:block" />
          让 AI 替你读懂它。
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-body-lg text-muted-foreground">
          收藏网页、图片、PDF 与笔记，自动整理成可检索的知识库；
          用带引用的 AI 回答理解它们，再把它们写成你自己的东西。
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={session ? "/dashboard/bookmarks" : "/signup"}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-5 py-2.5 text-label font-medium text-white transition-colors hover:bg-brand-700"
          >
            {session ? "进入知识库" : "免费开始"}
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href={session ? "/dashboard/chat" : "/signin"}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-raised px-5 py-2.5 text-label transition-colors hover:border-border-strong"
          >
            {session ? "打开 AI 对话" : "已有账号"}
          </Link>
        </div>
        <p className="mt-4 text-caption text-muted-foreground">
          无需信用卡 · 单机可跑 · 支持 Ollama 与任意 OpenAI 兼容接口
        </p>
      </section>

      {/* 能力 */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div
              key={c.title}
              className="rounded-xl border border-border bg-surface-raised p-6 shadow-e1"
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-brand-100/70">
                <c.icon className="size-4 text-brand-700" strokeWidth={1.75} />
              </div>
              <h2 className="font-display text-h4 font-semibold text-foreground">
                {c.title}
              </h2>
              <p className="mt-2 text-body text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 定价 */}
      <section className="mx-auto max-w-4xl px-6 pb-20">
        <h2 className="mb-6 text-center font-display text-h2 font-semibold tracking-tight">
          简单定价
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { name: "免费", price: "¥0", desc: "20 万 AI Token / 月", extra: "1 GB 存储" },
            { name: "Pro", price: "¥29/月", desc: "500 万 AI Token / 月", extra: "50 GB 存储", featured: true },
            { name: "Max", price: "¥79/月", desc: "3000 万 AI Token / 月", extra: "500 GB 存储" },
          ].map((p) => (
            <div
              key={p.name}
              className={`rounded-xl border bg-surface-raised p-6 ${
                p.featured ? "border-brand-500/50 shadow-e2" : "border-border shadow-e1"
              }`}
            >
              <p className="text-caption uppercase tracking-wider text-muted-foreground">
                {p.name}
              </p>
              <p className="mt-2 font-display text-h3 font-semibold">{p.price}</p>
              <p className="mt-3 text-label text-muted-foreground">{p.desc}</p>
              <p className="text-label text-muted-foreground">{p.extra}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 页脚 */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-caption text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <BrandLogo height={20} />
            <span>{BRAND.fullName}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/signin" className="hover:text-foreground">
              登录
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              注册
            </Link>
            <span>{BRAND.copyright}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
