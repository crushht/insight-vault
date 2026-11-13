import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 防止界面英文回潮。
 *
 * 只拦「用户一眼能看到的写死英文」，不拦代码标识符、组件名、产品名（Pocket / Raindrop 之类）。
 * 新增一条就写进 BLOCKED，别在别处再手写英文按钮。
 */

const BLOCKED = [
  "Load More",
  "Reader View",
  "This action is irreversible",
  "Enter your password to confirm deletion",
  "Delete Account",
  "HTML File",
  ">Import<",
  ">Export<",
  ">Timezone<",
  ">Close<",
  ">Add<",
];

const ROOTS = ["components", "app"];
const SKIP = /(^|[\\/])(node_modules|\.next|i18n|.*\.test\.)/;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP.test(full)) continue;
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

describe("界面英文清扫", () => {
  const webRoot = path.resolve(import.meta.dirname, "..");

  it("源码里不再出现写死的英文界面文案", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(path.join(webRoot, root))) {
        const text = readFileSync(file, "utf8");
        for (const needle of BLOCKED) {
          if (text.includes(needle)) {
            offenders.push(`${path.relative(webRoot, file)} → ${needle}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
