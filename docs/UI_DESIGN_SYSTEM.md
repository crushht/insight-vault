# 设计系统 UI DESIGN SYSTEM — INSIGHT VAULT / 灵感仓

- 版本：v0.1（Phase 1 产出）
- 目标：**成熟商业 SaaS 的视觉完成度**，不是「AI 生成的管理后台」
- 落地位置：`tooling/tailwind/tokens.css`（新建）+ `tooling/tailwind/web.ts`（扩展）+ `apps/web/app` 全量替换
- 参考研究（真实采集，非印象）：`artifacts/visual/`（Craft Anything `web_site_capture`，含截图 / design tokens / 布局测量）

---

## 1. 视觉定位

### 1.1 品牌内核

**灵感仓 = 私人典藏室。** 不是喧闹的信息流，而是安静、有序、可回溯的藏书空间。
「灵感」是光，「仓」是秩序——设计语言因此由两组元素构成：

- **秩序**：克制的墨色/纸色中性阶、严格的 8pt 网格、大量留白、细边框而非重阴影。
- **光**：唯一的高纯度强调色（AI 光带），只出现在「AI 正在为你做事」的位置。

### 1.2 三条设计原则

| 原则 | 定义 | 反面（禁止） |
|---|---|---|
| **内容优先** | 界面元素退到内容之后；卡片无重阴影，靠留白与细线分层 | 大色块底座、渐变按钮铺满全屏、彩色边框卡片 |
| **克制的光** | 一屏最多一处渐变/高亮；AI 相关才允许发光 | 每个图标都彩色、每个按钮都有渐变 |
| **可追溯的层次** | 任何「AI 生成」的内容必须视觉可辨（角标、细描边、引用编号） | AI 结果与用户内容视觉混同 |

### 1.3 与三个参考产品的差异（研究结论）

| 参考 | 观察（实测） | 我们吸收什么 | 我们拒绝什么 |
|---|---|---|---|
| **Karakeep** | 白底 `#ffffff` + 近黑文字 `#171717`；强调紫 `#a855f7`；标题字体 Bricolage Grotesque；圆角 8/12/16/24；内容栏 1248 / 896 / 672；区块间距 96–104 | 内容栏宽度体系、卡片圆角尺度、深浅两套区块节奏 | 紫色作为主品牌色（过于「AI 工具」化）、纯白无纸感的底色 |
| **Raindrop.io** | 主色蓝 `#0b7ed0`；系统字体；有机色块背景（粉 `#fef1f0` / 米 `#fff5e1` / 薄荷 `#effaf7`）；产品截图倾斜悬浮；圆角 4–8 | 分类色块的用法（用于空状态与专题封面，不用于主界面） | 营销手册式的倾斜截图与超大留白（不适合工具型产品） |
| **mymind** | 衬线 display 字体；橙红径向光晕；编辑感排版（斜体引导词）；瀑布流卡片墙；极简导航 | **衬线标题 + 编辑感排版**、暖色光晕（用于官网与空状态） | 全站暖橙（长时间使用的工具界面会疲劳） |

**结论**：INSIGHT VAULT 采用「**冷墨 + 纸白 + 单一青光 + 琥珀高亮**」，标题用衬线，正文用无衬线，AI 用紫→青渐变光带。这套组合在三个参考产品中都不存在，具备独立识别度。

---

## 2. 色彩系统

### 2.1 品牌色

| Token | Hex | 用途 |
|---|---|---|
| `--iv-brand-50` | `#EAF6F5` | 选中背景、标签底 |
| `--iv-brand-100` | `#CFEAE7` | hover 底 |
| `--iv-brand-300` | `#6FBDB6` | 图表次色、禁用态文字 |
| `--iv-brand-500` | `#12857F` | 图标、链接（暗色模式下的主色） |
| `--iv-brand-600` | `#0B6E6E` | **主色**：主按钮、选中态、进度 |
| `--iv-brand-700` | `#075656` | hover / pressed |
| `--iv-brand-900` | `#043434` | 深底强调 |

> 选择理由：青墨色（teal-ink）在知识/研究类产品中罕见，长时间阅读不刺眼，与琥珀高亮形成冷暖互补；避免了 Karakeep 紫与 Raindrop 蓝的直接撞色。

### 2.2 强调与语义色

| Token | Hex | 用途 |
|---|---|---|
| `--iv-amber-500` | `#D98324` | 高亮划线、星标、会员徽章 |
| `--iv-amber-100` | `#FBEFD9` | 高亮底 |
| `--iv-ai-from` | `#6D5EF8` | AI 渐变起点 |
| `--iv-ai-to` | `#14B8A6` | AI 渐变终点 |
| `--iv-success` | `#16794C` | 成功、已完成 |
| `--iv-warning` | `#B45309` | 警告、配额接近上限 |
| `--iv-danger` | `#B42318` | 错误、删除 |
| `--iv-info` | `#175CD3` | 提示 |

**规则**：AI 渐变**只**用于「AI 正在生成/已生成」的容器边框、图标与加载态；不得用于普通按钮。

### 2.3 中性阶（两套主题共用语义名）

| 语义 | Light | Dark | 用途 |
|---|---|---|---|
| `surface` | `#FBFBF9`（纸白） | `#0C0D0F` | 页面底 |
| `surface-raised` | `#FFFFFF` | `#14161A` | 卡片、弹层 |
| `surface-sunken` | `#F2F2EE` | `#08090A` | 输入框、代码块 |
| `border` | `#E4E4DE` | `#24272C` | 1px 分隔 |
| `border-strong` | `#CFCFC7` | `#34383F` | 聚焦前、强调分隔 |
| `text-primary` | `#16181A` | `#F2F3F5` | 正文 |
| `text-secondary` | `#565A5F` | `#A6ABB3` | 辅助说明 |
| `text-tertiary` | `#8A8F96` | `#6E737B` | 占位、时间戳 |
| `text-inverse` | `#FFFFFF` | `#0C0D0F` | 深底上的文字 |

> 现有代码的最大问题：`--primary` 在亮色是近黑（slate-900）、暗色是亮蓝（`223 87% 57%`），**同一按钮在两种主题下是两个品牌色**（`tooling/tailwind/globals.css:18` / `:52`）。新系统必须让 `brand` 在两侧同源，仅调亮度。

### 2.4 跨端一致性（硬约束）

现状：Web 用 `hsl()`，移动端用 `rgb()` 空格语法，且 `accent` 在两端语义不同（Web 浅灰 / Mobile 红粉 `255 40 84`），导致 `shared-react` 的 Button 在两端呈现不同颜色。

**新规则**：

1. 单一真源：`tooling/tailwind/tokens.css` 定义 `--iv-*` 原始值（hex + oklch 备选）；
2. Web 与 Mobile 都从该文件派生 `hsl(var(--iv-*))` 形式，**不各写一套**；
3. `accent` 一词废弃，改为 `highlight`（琥珀）与 `selected`（brand-100），语义唯一。

---

## 3. 字体与排版

### 3.1 字体族

| 角色 | 字体 | 回退 | 说明 |
|---|---|---|---|
| 标题（中西文） | **Noto Serif SC**（思源宋体） | `Songti SC, serif` | 编辑感，用于 h1/h2 与官网大标题 |
| 正文（中文） | **Noto Sans SC** | `PingFang SC, Microsoft YaHei, sans-serif` | 屏幕阅读优化 |
| 正文（西文/数字） | **Inter** | `system-ui, sans-serif` | 现有 Inter 保留，但必须补中文子集 |
| 等宽 | **JetBrains Mono** | `ui-monospace, monospace` | 代码、URL、ID |

> 现状缺陷：`app/layout.tsx:18-21` 只加载 Inter 且 `subsets:["latin"]`，**中文全部回退系统字体**，跨平台观感不一致。必须新增中文字体并按 `unicode-range` 分包，避免首屏拉 3MB。

### 3.2 字号标尺

| Token | size / line-height | 字重 | 用途 |
|---|---|---|---|
| `display` | 56 / 64 | 600（serif） | 官网首屏 |
| `h1` | 40 / 48 | 600（serif） | 页面主标题 |
| `h2` | 32 / 40 | 600（serif） | 区块标题 |
| `h3` | 24 / 32 | 600 | 卡片组标题 |
| `h4` | 20 / 28 | 600 | 卡片标题 |
| `body-lg` | 17 / 28 | 400 | 阅读器正文 |
| `body` | 15 / 24 | 400 | 界面正文 |
| `label` | 13 / 20 | 500 | 按钮、表单标签 |
| `caption` | 12 / 16 | 400 | 辅助信息 |
| `mono` | 13 / 20 | 400 | 代码 |

**禁止**：裸用 `text-sm` / `text-2xl` 当标题（现状 248 次 `text-sm`、页面标题直接 `text-2xl`）。

### 3.3 排版规则

- 中文正文行高 ≥1.6；西文 ≥1.5；
- 中文与数字/西文之间自动加 1/4 空格（`text-spacing` 或零宽处理）；
- 标题字距：serif 大标题 `-0.01em`，正文 `0`；
- 段落最大宽度 72ch（阅读器 68ch）。

---

## 4. 空间、圆角、阴影

### 4.1 间距（4pt 基）

`0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`

语义别名：`gap-inline-xs 4` / `sm 8` / `md 12` / `lg 16`；`section-y 64`（桌面）/ `40`（移动）。

### 4.2 圆角

| Token | 值 | 用途 |
|---|---|---|
| `radius-sm` | 6px | 标签、徽章 |
| `radius-md` | 10px | 按钮、输入框 |
| `radius-lg` | 14px | 卡片 |
| `radius-xl` | 20px | 弹层、面板 |
| `radius-2xl` | 28px | 官网大卡片 |
| `radius-full` | 9999px | 头像、开关 |

> 现状：`md 85 / full 68 / lg 59 / xl 9 / 2xl 3` 的离散使用说明圆角没有语义。新系统规定「卡片只用 `lg`，弹层只用 `xl`，按钮只用 `md`」。

### 4.3 阴影（低对比，两套主题分开）

| Token | Light | Dark |
|---|---|---|
| `e1`（卡片 hover） | `0 1px 2px rgba(16,18,20,.06), 0 1px 1px rgba(16,18,20,.04)` | `0 1px 2px rgba(0,0,0,.6)` |
| `e2`（弹层） | `0 8px 24px -8px rgba(16,18,20,.16)` | `0 8px 24px -8px rgba(0,0,0,.8)` |
| `e3`（模态） | `0 24px 64px -16px rgba(16,18,20,.24)` | `0 24px 64px -16px rgba(0,0,0,.9)` |
| `focus-ring` | `0 0 0 2px var(--surface), 0 0 0 4px var(--brand-500)` | 同 |

---

## 5. 动效

| Token | 时长 | 曲线 | 场景 |
|---|---|---|---|
| `motion-fast` | 120ms | `cubic-bezier(.2,0,0,1)` | hover、颜色 |
| `motion-base` | 180ms | 同上 | 展开、弹层出现 |
| `motion-slow` | 240ms | 同上 | 页面切换、抽屉 |
| `motion-spring` | 320ms | `cubic-bezier(.32,.72,0,1)` | 卡片拖拽、图谱节点 |

规则：
- 尊重 `prefers-reduced-motion`，全部降级为 0ms；
- 列表进入用 20ms 阶梯淡入，最多 8 项；
- 骨架屏用 1.4s 循环的 8%→18% 亮度扫过，不用旋转 spinner 占满页面。

---

## 6. 组件规范

### 6.1 Button

| 变体 | 底 | 字 | 边框 | 用途 |
|---|---|---|---|---|
| `primary` | brand-600 | white | — | 每屏最多 1 个 |
| `secondary` | surface-raised | text-primary | border | 常规操作 |
| `ghost` | transparent | text-secondary | — | 图标按钮、工具栏 |
| `danger` | danger | white | — | 删除确认 |
| `ai` | AI 渐变（8% 透明底 + 渐变描边） | text-primary | 1px gradient | AI 触发专属 |

尺寸：`sm 28px / md 36px / lg 44px`；圆角 `md`；图标与文字间距 8px；`loading` 时宽度锁定不跳动。

### 6.2 输入

高度 36/44；聚焦显示 `focus-ring` 且边框变 brand-500；错误态边框 danger + 下方 12px 说明；支持前置图标、后缀快捷键提示（`⌘K`）。

### 6.3 卡片（收藏条目）

```
┌─────────────────────────────────────┐
│ [封面 16:10 或 站点图标]              │
│ 标题（h4，2 行截断）                  │
│ 摘要（body，2 行，text-secondary）    │
│ ─────────────────────────────────── │
│ ● 域名 · 2 小时前   #标签 #标签  ⋯   │
└─────────────────────────────────────┘
```

- 圆角 `lg`，边框 `1px border`，hover 升 `e1` + 边框转 `border-strong`；
- **禁止**默认加阴影（现状 WrappedContent 等 51 处彩色卡片需清洗）；
- 未读条：标题左侧 3px brand 竖线；已归档：整体 60% 不透明度 + 灰度封面。

### 6.4 侧边栏

宽 264px（可折叠至 64px）；分组：`知识库 / 智能 / 系统`；当前项：brand-50 底 + brand-600 文字 + 左侧 2px 指示条；hover 仅背景变化，不位移。

### 6.5 弹层（收藏详情）

- 桌面：居中 Dialog，宽 `min(1120px, 92vw)`，高 `88vh`，圆角 `xl`，`e3`；
- 内部三栏：正文（flex-1）| 详情（360px）| AI 面板（可切换，380px）；
- 移动：全屏 Sheet 从底部上滑，内容纵向堆叠，Tab 切换「正文 / 详情 / AI」。

### 6.6 标签与 Chip

- 手动标签：`surface-sunken` 底 + `text-secondary`；
- AI 标签：左侧 8px AI 渐变点 + `brand-50` 底；
- 高亮 Chip：amber-100 底 + amber-500 文字。

### 6.7 四态规范（每个页面必须实现）

| 状态 | 规范 |
|---|---|
| Loading | 骨架屏，形状与最终内容一致；>3s 追加「正在抓取/分析」文案 |
| Empty | 48px 线性图标 + 一句价值主张 + 一个主按钮；带插画时用纸感单色线稿 |
| Error | 明确原因 + 重试按钮 + 错误码（可复制）；禁止只显示「出错了」 |
| 正常 | — |

### 6.8 AI 专属视觉

- 生成中：容器 1px AI 渐变描边 + 顶部 2px 流光条；
- 已生成：右上角 `AI` 小徽章（渐变字）；
- 引用：行内 `[1]` 上标，amber-500，点击跳转并高亮原文段落 2s；
- 无依据：显示「你的收藏里没有相关内容」+ 建议去收藏。

---

## 7. 布局与响应式

### 7.1 断点

| 名称 | 宽度 | 布局 |
|---|---|---|
| `sm` | <640 | 单列，底部 Tab 导航 |
| `md` | 640–1023 | 双列卡片，抽屉式侧栏 |
| `lg` | 1024–1279 | 三栏（侧栏 240 + 内容 + 详情 320） |
| `xl` | 1280–1535 | 三栏（264 + 内容 + 360） |
| `2xl` | ≥1536 | 内容区最大 1440，居中留白 |

### 7.2 关键页面结构

| 页面 | 桌面 | 移动 |
|---|---|---|
| 知识首页 | 问候 + 3 个统计卡 + 「继续阅读」横向卡列 + 「今日 AI 摘要」 + 最近收藏网格 | 单列堆叠，隐藏统计卡只留数字行 |
| 收藏库 | 左筛选栏（类型/标签/收藏夹）+ 顶部工具条（视图切换/排序/批量）+ 网格 | 顶部 Segmented + 底部筛选 Sheet |
| 搜索 | 大输入框 + 三模式切换 + 结果 + 右侧「AI 回答」面板 | 输入框吸顶，结果单列，AI 回答可展开 |
| AI 对话 | 会话列表 240 + 消息流 + 引用侧栏 | 单列，历史抽屉 |
| 知识图谱 | 全屏画布 + 左上过滤器 + 右下缩略图 | 触摸手势，双指缩放，节点详情底部 Sheet |
| 创作工作台 | 左：素材选择器；中：编辑器；右：AI 指令面板 | 三段式 Tab |
| 设置 | 左侧二级导航 + 表单区（最大 720） | 列表页 + 详情页 |
| 管理后台 | 侧栏 + 数据卡 + 表格 | 卡片化列表 |

### 7.3 官网

- 首屏：serif 大标题 + 一句价值主张 + 主/次按钮 + 产品截图（**不倾斜**，用浮层卡片 + e2 阴影）；
- 信任条：开源/自托管/端到端；
- 三段功能演示：以真实 UI 截图（Phase 2 完成后替换）为准，不用抽象插画；
- 定价表：三列，Pro 居中高亮（brand-600 描边，不加阴影）；
- 页脚：四列链接 + 语言切换 + 状态页。

---

## 8. 无障碍

- 所有文本对比度 ≥4.5:1（正文）、≥3:1（大字）；
- 焦点可见：`focus-ring` 不得移除；
- 图标按钮必须有 `aria-label`；
- 图谱提供「表格视图」替代，供键盘与读屏使用；
- 动效尊重 `prefers-reduced-motion`；
- 中文断行用 `word-break: normal` + `overflow-wrap: anywhere` 只用于 URL。

---

## 9. 实现映射（从设计到代码）

### 9.1 新建文件

| 文件 | 内容 |
|---|---|
| `tooling/tailwind/tokens.css` | 全部 `--iv-*` 原始变量（light + dark 两套） |
| `tooling/tailwind/semantic.ts` | 把原始变量映射为 Tailwind 语义色板（`bg-surface` / `text-secondary` / `border-strong`） |
| `tooling/tailwind/scale.ts` | `fontSize` / `spacing` / `borderRadius` / `boxShadow` / `transitionTimingFunction` 标尺 |
| `apps/web/app/globals.css` | 只保留 `@tailwind` 指令与极少量基础样式，不再定义品牌色 |

### 9.2 迁移顺序（先做护栏，再改视觉）

1. **N10 护栏**：给 8 条关键路由加 `data-testid`，把现有 e2e 从「依赖英文可访问名」解耦；
2. **N7 视觉基线**：用 Craft Anything 对现状 8 页 × 2 宽度截图存档（改造前后可 diff）；
3. **token 层**：落地 `tokens.css` 与语义映射，`--primary` 明暗同源；
4. **组件层**：Button/Input/Card/Dialog 四件套先改（覆盖面最大）；
5. **页面层**：按「设置 → 收藏库 → 详情 → 首页 → 搜索 → 官网」顺序；
6. **清洗**：338 处硬编码色分 6 批，优先级最高的 5 个文件见 [FEATURE_MATRIX](FEATURE_MATRIX.md) 与 `docs/audit/04-web-frontend.md` §9。

### 9.3 Token 示例（可直接落地）

```css
/* tooling/tailwind/tokens.css */
:root {
  --iv-brand-50:#EAF6F5; --iv-brand-100:#CFEAE7; --iv-brand-300:#6FBDB6;
  --iv-brand-500:#12857F; --iv-brand-600:#0B6E6E; --iv-brand-700:#075656;
  --iv-amber-100:#FBEFD9; --iv-amber-500:#D98324;
  --iv-success:#16794C; --iv-warning:#B45309; --iv-danger:#B42318; --iv-info:#175CD3;
  --iv-ai-from:#6D5EF8; --iv-ai-to:#14B8A6;

  --iv-surface:#FBFBF9; --iv-surface-raised:#FFFFFF; --iv-surface-sunken:#F2F2EE;
  --iv-border:#E4E4DE; --iv-border-strong:#CFCFC7;
  --iv-text:#16181A; --iv-text-secondary:#565A5F; --iv-text-tertiary:#8A8F96;

  --iv-radius-sm:6px; --iv-radius-md:10px; --iv-radius-lg:14px;
  --iv-radius-xl:20px; --iv-radius-2xl:28px;

  --iv-e1:0 1px 2px rgba(16,18,20,.06), 0 1px 1px rgba(16,18,20,.04);
  --iv-e2:0 8px 24px -8px rgba(16,18,20,.16);
  --iv-e3:0 24px 64px -16px rgba(16,18,20,.24);
}

.dark {
  --iv-brand-500:#2AA79F; --iv-brand-600:#12857F; --iv-brand-700:#0B6E6E;
  --iv-surface:#0C0D0F; --iv-surface-raised:#14161A; --iv-surface-sunken:#08090A;
  --iv-border:#24272C; --iv-border-strong:#34383F;
  --iv-text:#F2F3F5; --iv-text-secondary:#A6ABB3; --iv-text-tertiary:#6E737B;
  --iv-e1:0 1px 2px rgba(0,0,0,.6);
  --iv-e2:0 8px 24px -8px rgba(0,0,0,.8);
  --iv-e3:0 24px 64px -16px rgba(0,0,0,.9);
}
```

---

## 10. 验收标准

| 项 | 标准 |
|---|---|
| 一致性 | 任意页面截图中出现的颜色，必须能在 token 表中找到；抽查 20 个 className 无硬编码色值 |
| 主题 | 明暗切换后无「隐形文字」、无对比度 <3:1 的组合 |
| 响应式 | 3 个断点（390 / 834 / 1440）无横向滚动、无遮挡、无截断的标题 |
| 四态 | 每个列表/详情页都实现 loading / empty / error / 正常 |
| 跨端 | Web 与移动端的 Button 主色 RGB 差值 ≤4 |
| 视觉回归 | 8 条关键路由的截图 diff 基线在 CI 中比对，阈值 0.5% |
| 性能 | 中文字体分包后首屏字体请求 ≤120KB；LCP <2.0s |
