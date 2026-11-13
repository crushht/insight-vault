// 出包前清理 standalone 里的目录联接（junction）。
//
// `next dev` 的产物不带 static/public，桌面版开发模式与 Playwright 套件会用
// junction 把它们补进去；electron-builder 递归复制时会把 junction 当成目录跟进，
// 直接报错（fileMatcher / EPERM）。这里只删「联接」，真目录不动。

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "web", ".next", "standalone", "apps", "web");

for (const rel of [path.join(".next", "static"), "public"]) {
  const target = path.join(root, rel);
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(target);
      console.log(`[clean] 已移除联接 ${target}`);
    }
  } catch {
    // 不存在就跳过
  }
}
