"use client";

import { useEffect } from "react";

/**
 * 注册 Service Worker（只在生产构建里做；dev 下注册会和热更新打架）。
 * 注册失败不影响任何功能，静默即可。
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 离线能力是可选项，注册失败就算了
      });
    };
    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
