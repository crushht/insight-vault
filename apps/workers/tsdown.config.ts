import { defineConfig } from "tsdown";

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
  external: [
    // 原生模块必须留在外面（带 .node 二进制，bundle 不了）
    "better-sqlite3",
    "liteque",
  ],
  noExternal: [
    // workspace 包（没发布到 npm）
    /^@karakeep\//,
    // 桌面版 / Docker 版要求 dist 自包含：这些是运行时一定会加载的普通依赖，
    // 留在 external 会导致把 dist 复制到别处后 `Cannot find module`。
    "execa",
  ],
});
