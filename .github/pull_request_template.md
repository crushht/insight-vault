## 这个 PR 做了什么

<!-- 一句话说清动机：修了什么、加了什么、为什么现在做 -->

Fixes #

## 改动类型

- [ ] 修复（bug）
- [ ] 新功能
- [ ] 界面 / 文案
- [ ] 重构（行为不变）
- [ ] 文档 / 工程配置

## 怎么验证的

<!-- 贴命令与结果，别只写"跑过了" -->

```bash
pnpm typecheck
pnpm --filter @karakeep/shared exec vitest run
pnpm --filter @karakeep/trpc exec vitest run
pnpm --filter @karakeep/web exec vitest run
```

涉及界面的改动请附截图（390 / 1440 各一张）；涉及认证的改动请说明注册、登录、保持登录三条路径都验过。

## 自查

- [ ] 没有提交 `.env`、密钥、数据库文件
- [ ] 新增/修改的接口有类型与错误分支
- [ ] 改了 `packages/db/schema.ts` 就有对应迁移
- [ ] 更新了 `CHANGELOG.md`（面向用户的改动）
