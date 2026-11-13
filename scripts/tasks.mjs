// 任务队列（给「我自己」用的小工具）
//
// 目的：不管什么时候停下，下一次都能从 docs/queue.json 直接接上，
// 不用重新想「我刚才做到哪了」。命令都很短，适合在收尾时无脑敲。
//
//   node scripts/tasks.mjs list                 看全部
//   node scripts/tasks.mjs next                 看下一件该做的（含验收命令）
//   node scripts/tasks.mjs start <id>           标记开始
//   node scripts/tasks.mjs done <id> [--note]   标记完成
//   node scripts/tasks.mjs block <id> --reason  标记被外部条件卡住
//   node scripts/tasks.mjs add "标题" [--verify "命令"] [--needs "缺什么"]
//
// 约定：`next` 取第一个 status=doing 的；没有就取第一个 todo；
// 全部 done / blocked 时退出码 2（表示「队列空了」，不是出错）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queueFile = path.join(root, "docs", "queue.json");

const STATUS_LABEL = {
  doing: "进行中",
  todo: "待办",
  done: "已完成",
  blocked: "被卡住",
};

function load() {
  if (!fs.existsSync(queueFile)) {
    return { updatedAt: new Date().toISOString(), items: [] };
  }
  const data = JSON.parse(fs.readFileSync(queueFile, "utf8"));
  data.items ??= [];
  return data;
}

function save(data) {
  data.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  fs.writeFileSync(queueFile, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function printItem(item, index) {
  const needs = item.needs?.length ? `  缺：${item.needs.join("；")}` : "";
  const verify = item.verify ? `  验收：${item.verify}` : "";
  console.log(
    `${String(index).padStart(2, " ")}. [${STATUS_LABEL[item.status] ?? item.status}] ${item.id}  ${item.title}`,
  );
  if (item.why) console.log(`     为什么：${item.why}`);
  if (verify) console.log(`    ${verify.trim()}`);
  if (needs) console.log(`    ${needs.trim()}`);
}

function main() {
  const [cmdRaw, ...argv] = process.argv.slice(2);
  const cmd = cmdRaw ?? "next";
  const data = load();

  switch (cmd) {
    case "list": {
      if (data.items.length === 0) {
        console.log("队列是空的，用 `add` 加一条。");
        return 0;
      }
      data.items.forEach((item, i) => printItem(item, i + 1));
      console.log(`\n共 ${data.items.length} 条，更新于 ${data.updatedAt}`);
      return 0;
    }
    case "next": {
      const doing = data.items.find((i) => i.status === "doing");
      const todo = data.items.find((i) => i.status === "todo");
      const item = doing ?? todo;
      if (!item) {
        console.log("队列空了（没有 doing / todo）。加新任务或标记 blocked。");
        return 2;
      }
      console.log(`下一个：${item.id}  ${item.title}`);
      if (item.why) console.log(`为什么：${item.why}`);
      if (item.verify) console.log(`验收：${item.verify}`);
      if (item.notes?.length) console.log(`备注：\n  - ${item.notes.join("\n  - ")}`);
      if (item.status === "todo") console.log("（还没 start，先 `start " + item.id + "`）");
      return 0;
    }
    case "start": {
      const id = argv[0];
      const item = data.items.find((i) => i.id === id);
      if (!item) return fail(`没有这条任务：${id}`);
      for (const other of data.items) {
        if (other.status === "doing" && other.id !== id) other.status = "todo";
      }
      item.status = "doing";
      item.startedAt = new Date().toISOString();
      save(data);
      console.log(`开始：${item.id}  ${item.title}`);
      return 0;
    }
    case "done": {
      const id = argv[0];
      const item = data.items.find((i) => i.id === id);
      if (!item) return fail(`没有这条任务：${id}`);
      item.status = "done";
      item.finishedAt = new Date().toISOString();
      const note = argValue(argv, "--note");
      if (note) item.notes = [...(item.notes ?? []), note];
      save(data);
      console.log(`完成：${item.id}  ${item.title}`);
      return 0;
    }
    case "block": {
      const id = argv[0];
      const item = data.items.find((i) => i.id === id);
      if (!item) return fail(`没有这条任务：${id}`);
      item.status = "blocked";
      item.blockedReason = argValue(argv, "--reason") ?? "未说明";
      save(data);
      console.log(`已标记卡住：${item.id}（${item.blockedReason}）`);
      return 0;
    }
    case "add": {
      const title = argv[0];
      if (!title) return fail("用法：add \"标题\" [--verify 命令] [--needs 缺什么]");
      const id =
        argValue(argv, "--id") ??
        `task-${Date.now().toString(36)}`;
      data.items.push({
        id,
        title,
        status: "todo",
        why: argValue(argv, "--why"),
        verify: argValue(argv, "--verify"),
        needs: argValue(argv, "--needs") ? [argValue(argv, "--needs")] : [],
      });
      save(data);
      console.log(`已加入：${id}  ${title}`);
      return 0;
    }
    default:
      return fail(`未知命令：${cmd}（可用 list / next / start / done / block / add）`);
  }
}

function fail(message) {
  console.error(message);
  return 1;
}

process.exit(main());
