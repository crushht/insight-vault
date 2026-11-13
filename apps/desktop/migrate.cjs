// 数据库迁移执行器（不依赖 drizzle-orm）。
//
// 为什么不用 drizzle 的 migrator：standalone 包里没有 `drizzle-orm/better-sqlite3`
// 这个子路径（它被 bundle 进 server.js 了），`require` 会直接失败。
// 而 drizzle 生成的迁移就是标准 SQL —— 用 better-sqlite3 自己按
// `--> statement-breakpoint` 切开逐句执行即可。
//
// 跑两个库：
//   1. 应用库  db.db        ← packages/db/drizzle（102 个迁移）
//   2. 队列库  queue.db     ← liteque/dist/drizzle（liteque 自己的表）
// 队列库必须在 web 起来之前建好，否则「新建收藏」会在入队时 500（no such table: tasks），
// 桌面版以前只靠 workers 建表，workers 挂了就写不进任何收藏。

const path = require("node:path");
const fs = require("node:fs");

const dataDir = process.env.DATA_DIR;
const migrationsFolder = process.env.MIGRATIONS_FOLDER;
const litequeFolder =
  process.env.LITEQUE_MIGRATIONS || path.join(__dirname, "liteque-drizzle");

if (!dataDir) {
  console.error("[migrate] DATA_DIR 未设置");
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });

function applyMigrations(dbFile, folder, label) {
  if (!fs.existsSync(folder)) {
    throw new Error(`[migrate] 找不到${label}迁移目录：${folder}`);
  }

  const Database = require("better-sqlite3");
  const sqlite = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // drizzle 的迁移记录表（用不上也要建，保持结构与官方一致）
  sqlite
    .prepare(
      `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         hash TEXT NOT NULL,
         created_at NUMERIC
       )`,
    )
    .run();

  const files = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    // 记账表在每个库里各自独立（db.db / queue.db），所以直接用文件名当 hash。
    // 千万别加前缀：改了 hash 会让已应用的迁移被当成新的重跑一遍。
    const hash = file;
    const done = sqlite
      .prepare("SELECT 1 FROM __drizzle_migrations WHERE hash = ?")
      .get(hash);
    if (done) {
      skipped++;
      continue;
    }

    const sql = fs.readFileSync(path.join(folder, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        sqlite.exec(stmt);
      } catch (e) {
        // 已存在的对象（重复执行 / liteque 自己先建过）不算错
        const msg = String(e && e.message ? e.message : e);
        if (!/already exists|duplicate column/i.test(msg)) {
          throw new Error(`${label}/${file}: ${msg}`);
        }
      }
    }

    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run(hash, Date.now());
    applied++;
  }

  const tables = sqlite
    .prepare("select count(*) as c from sqlite_master where type='table'")
    .get();
  sqlite.close();

  return { applied, skipped, files: files.length, tables: tables.c };
}

try {
  const appFile = path.join(dataDir, "db.db");
  const appFolder = migrationsFolder || path.join(__dirname, "drizzle");
  const app = applyMigrations(appFile, appFolder, "app");
  console.log(
    `[migrate] done | db=${appFile} | files=${app.files} | applied=${app.applied} | skipped=${app.skipped} | tables=${app.tables}`,
  );

  // 队列库：没有它，新建收藏会在入队时炸
  const queueFile = path.join(dataDir, "queue.db");
  if (fs.existsSync(litequeFolder)) {
    const queue = applyMigrations(queueFile, litequeFolder, "queue");
    console.log(
      `[migrate] queue done | db=${queueFile} | files=${queue.files} | applied=${queue.applied} | skipped=${queue.skipped} | tables=${queue.tables}`,
    );
  } else {
    console.log(
      `[migrate] 跳过队列迁移（找不到 ${litequeFolder}，收藏入队可能失败）`,
    );
  }

  process.exit(0);
} catch (e) {
  console.error("[migrate] failed:", e && e.stack ? e.stack : e);
  process.exit(1);
}
