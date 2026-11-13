"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * 「装到桌面」提示。
 *
 * 浏览器给 `beforeinstallprompt` 才能显示（Chrome/Edge）。用户拒绝或已安装过就不再打扰：
 * 记在 localStorage 里，不重复弹。
 */

const DISMISS_KEY = "iv.installDismissed";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      return;
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  if (!deferred || hidden) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 rounded-xl border border-border bg-surface-raised p-4 shadow-e2">
      <button
        type="button"
        onClick={dismiss}
        aria-label="关闭安装提示"
        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
      <p className="mb-1 flex items-center gap-1.5 text-label font-medium text-foreground">
        <Download className="size-4 text-brand-600" />
        把灵感仓装到桌面
      </p>
      <p className="mb-3 text-caption leading-relaxed text-muted-foreground">
        装成应用后可以独立窗口打开，断网也能看到已缓存的页面。
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={dismiss}>
          以后再说
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            await deferred.prompt();
            const choice = await deferred.userChoice.catch(() => null);
            if (choice?.outcome === "accepted") {
              try {
                window.localStorage.setItem(DISMISS_KEY, "1");
              } catch {
                // localStorage 被禁用时忽略即可，不影响安装流程
              }
            }
            setHidden(true);
          }}
        >
          安装
        </Button>
      </div>
    </div>
  );
}
