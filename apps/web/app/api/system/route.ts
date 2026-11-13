import fs from "node:fs";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@karakeep/db";
import { bookmarkLists, bookmarkTags, bookmarks } from "@karakeep/db/schema";
import { describeAiConfig } from "@karakeep/shared/aiConfigStore";
import serverConfig from "@karakeep/shared/config";

import { getServerAuthSession } from "@/server/auth";

/**
 * 系统状态（登录后可见）：版本、运行时长、数据目录占用、当前用户的收藏/标签/收藏夹数量、
 * AI 与 SMTP 是否已配置。桌面版出问题时报障用得上，不用再问「你的数据在哪」。
 */

function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function dirBytes(dir: string, budget = 20_000): number {
  let total = 0;
  let seen = 0;
  const walk = (current: string) => {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (seen++ > budget) return;
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
      } else {
        total += fileBytes(full);
      }
    }
  };
  walk(dir);
  return total;
}

export async function GET() {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }

  const userId = session.user.id;
  const [bookmarkCount] = await db
    .select({ c: count() })
    .from(bookmarks)
    .where(eq(bookmarks.userId, userId));
  const [tagCount] = await db
    .select({ c: count() })
    .from(bookmarkTags)
    .where(eq(bookmarkTags.userId, userId));
  const [listCount] = await db
    .select({ c: count() })
    .from(bookmarkLists)
    .where(eq(bookmarkLists.userId, userId));

  const dataDir = serverConfig.dataDir;
  const ai = describeAiConfig();

  return NextResponse.json({
    version: serverConfig.serverVersion,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    dataDir,
    uptimeSeconds: Math.round(process.uptime()),
    storage: {
      dbBytes:
        fileBytes(path.join(dataDir, "db.db")) +
        fileBytes(path.join(dataDir, "db.db-wal")),
      queueBytes:
        fileBytes(path.join(dataDir, "queue.db")) +
        fileBytes(path.join(dataDir, "queue.db-wal")),
      assetsBytes: dirBytes(path.join(dataDir, "assets")),
    },
    counts: {
      bookmarks: bookmarkCount?.c ?? 0,
      tags: tagCount?.c ?? 0,
      lists: listCount?.c ?? 0,
    },
    ai: {
      configured: ai.configured,
      provider: ai.provider ?? null,
      textModel: ai.textModel ?? null,
      imageModel: ai.imageModel ?? null,
    },
    smtpConfigured: !!serverConfig.email.smtp,
  });
}
