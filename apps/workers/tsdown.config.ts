import { defineConfig } from "tsdown";

// workers 会被原样拷进桌面安装包（resources/workers），运行时没有 pnpm 的 node_modules。
// 所以：普通 JS 依赖全部打进 dist；只有带原生二进制 / 浏览器驱动的包留在外部，
// 由 electron-builder 的 extraResources 单独拷进 resources/workers/node_modules。
const EXTERNAL = [
  "better-sqlite3",
  "patchright",
  "patchright-core",
  "playwright-core",
  "sharp",
  "re2",
  "node-cron",
  "@napi-rs/canvas",
];

export default defineConfig({
  entry: ["index.ts", "scripts/parseHtmlSubprocess.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  minify: false,
  sourcemap: true,
  platform: "node",
  shims: true,
  external: EXTERNAL,
  // 其余一律打包（含 workspace 包与它们的普通依赖）
  noExternal: [/./],
});
