import type { MetadataRoute } from "next";

import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.nameZh} · ${BRAND.name}`,
    short_name: BRAND.nameZh,
    description: BRAND.description,
    // 与 tokens.css 的品牌色保持一致：暖纸白底、青墨主题色
    background_color: "#FBFBF9",
    theme_color: "#0B6E6E",
    start_url: "/dashboard/bookmarks",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "zh-CN",
    categories: ["productivity", "utilities"],
    shortcuts: [
      {
        name: "收藏库",
        url: "/dashboard/bookmarks",
      },
      {
        name: "AI 对话",
        url: "/dashboard/chat",
      },
      {
        name: "知识图谱",
        url: "/dashboard/graph",
      },
    ],
    icons: [
      {
        src: "/icons/logo-16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        src: "/icons/logo-48.png",
        sizes: "48x48",
        type: "image/png",
      },
      {
        src: "/icons/logo-128.png",
        sizes: "128x128",
        type: "image/png",
      },
      {
        src: "/icons/logo-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
