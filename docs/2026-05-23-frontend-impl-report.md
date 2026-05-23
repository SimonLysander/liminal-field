# 前端设计系统落地报告 · 2026-05-23

> 分支 `feat/design-tokens`(未 push)。一夜自主实施 + 全套验证。

## TL;DR

完成了**设计系统地基 + 全局安全替换 + 全套验证**(前后端 tsc / build / lint / 单测 / e2e 全绿),并修复了过程中发现的一处**静默失败**。

中高风险的「组件化替换」「巨型组件拆分」**按质量优先原则留作 follow-up**——它们改 JSX 结构 / 架构,需要在真实页面上做视觉验证,我不在你睡觉、无法核对视觉时盲改埋雷(这正是你 CLAUDE.md 里"批量改坏 20 文件"那条坑)。方案见文末。

---

## ✅ 已完成(均已验证)

### 1. L1 设计 token(`client/src/index.css`)
- **主题色 `--accent` → 长春花紫 Very Peri**:daylight `#6667AB` / midnight `#9091CE`,加 hover/soft/border/contrast 衍生。原有 **24 处 `var(--accent)` 自动焕新**(主操作、链接、勾选激活、光标、当前项,全变长春花紫)。
- **语义色纸墨化**:`--mark-red/green` 改沉稳值,加 `--danger`/`--success` alias(现有几十处 `var(--mark-red)` 自动升级)。
- **新增 z-index scale**(`--z-base … --z-texture`);纸纹层已用上 `--z-texture`。
- **输入框 focus**:原 3px 柔光环 → 1px accent 细边。

### 2. L2/L3 标准组件(8 个)
- 新建:`Dot` `Tag` `FieldError`(ui)、`SaveStatus` `EmptyState` `Modal`(shared)
- 定制:`Button`(+`primary` 长春花紫实心 / +`danger` 红字)、`Input`(透明淡底 + focus)、`Dialog`(遮罩纸墨纯暗化 `.4` 无毛玻璃)

### 3. 全局安全替换(5 个 sonnet subagent 分模块 + 逐个验收)
- **~130 处** inline `fontSize` → Tailwind `text-*` class
- **~15 处** `borderRadius` → `rounded-*`、`zIndex` 处理
- 删 `console.log/debug` 噪音
- 全部**等价替换**;PaperGarden 定格动画、动态计算值、`clamp()`、`50%` 等正确保留未碰

### 4. 修复:静默失败(重要)
安全替换**误删了 21 条 catch 块的 `console.error/warn`**(错误日志)——会导致静默吞错、ErrorBoundary 不记录。**已全部恢复**并改回变量名。(根因:我给 subagent 的"删 console"指令太宽泛,已记取。)

### 5. code-review + 修复
- 修:Tag 圆角 `rounded-sm`、Input focus 与全局同步、纸纹用 `--z-texture`
- reviewer 确认无问题:`--accent` 24 处语义全成立、fontSize 替换等价、无空 `style={{}}`、组件类型安全、Modal 关闭逻辑正确

### 6. code-simplifier
组件已足够简洁(刻意 Notion 式轻量);1 处去重:`SaveStatus` 复用 `DotVariant` 类型防漂移。

---

## 🔬 验证结果(全绿)

| 检查 | 结果 |
|---|---|
| client `tsc -b --noEmit` | ✓ 通过 |
| client `vite build` | ✓ 5.5s |
| client `eslint` | 14 problems = **main 基线**(净引入 0;全是仓库原有预先债) |
| server `nest build` | ✓ 147 files |
| server 单测 `jest` | ✓ **102 / 102** |
| server e2e | ✓ **150 / 150**(20 suites,内存 mongo) |

---

## 📦 提交记录(`feat/design-tokens`,未 push)

1. `feat(design): L1 token + L2/L3 组件 + 全局安全替换`
2. `fix: 恢复批量重构误删的 21 条错误日志`
3. `fix(review): Tag 圆角 / Input focus / 纸纹 z-token`
4. `refactor: SaveStatus 复用 DotVariant`(simplifier)

---

## ⏳ Follow-up(留你在场,需真实页面视觉验证)

### A. 组件化替换(标准件已就绪,只差替换)
| 替换 | 数量 | 目标件 |
|---|---|---|
| 独立 Modal → `<Modal>` | 11 | `shared/Modal` |
| 错误提示 → `<FieldError>` | 14 | `ui/field-error` |
| inline 按钮 → `<Button variant>` | 12 | `ui/button` |
| StatusDot → `<SaveStatus>` | 3 | `shared/SaveStatus` |

建议:逐模块开小 PR,改完 `pnpm dev` 看一眼交互/视觉,再下一个。组件都建好了,替换是机械活,但需眼睛确认。

### B. 巨型组件拆分(7 个,高风险——先读懂再拆)
- `pages/gallery/index.tsx`(898)→ 拆 `ArcTimeline` / `BlurBackground` / `PhotoView` / feed 卡片 + 抽 hook
- `pages/admin/settings/IntegrationTab.tsx`(757)→ 按各 integration 拆卡片组件
- `pages/admin/anthology/edit.tsx`(679)→ 拆编辑区 / 侧栏 / 顶栏
- `pages/admin/batch-import.tsx`(614)→ 按导入步骤拆
- `pages/admin/anthology/index.tsx`(581)→ 列表 / 预览面板分离
- `pages/admin/edit.tsx`(555)→ 拆草稿区 / 版本区
- `pages/admin/settings/SettingsUI.tsx`(547)→ 抽 `Section` / `EditableSection` 复用件

### C. 杂项
- z-index:全站 26 处 inline / `z-50` 统一到 token(逐页)
- 颜色 hex(~100 处):**大部分是合理固定色**(深色/照片上的 `#fff` 白字)或分类色(VersionTimeline 的 AI 紫 / IMPORT 橙标签)——不该机械换 token,逐个看
- `--color-destructive-foreground` compat 层补一行(destructive variant 几乎没用)
- 仓库**原有** 14 个 lint 债(`set-state-in-effect`、空 interface 等,非本次引入)

---

## 👀 怎么验收

1. `git log feat/design-tokens` 看 4 个 commit;`git diff main feat/design-tokens` 看全部改动
2. `cd client && pnpm dev` → **全站主色已是长春花紫**(开 `/login` 最直观:按钮 + focus 边)
3. 设计依据:`docs/design-language.md`(哲学+颜色)、`docs/design-system.md`(L1–L4 件)
4. 组件长什么样:浏览器开 `client/mockup-components.html`(可交互画廊)
5. **主色不满意?改 `index.css` 一个 `--accent` 值,全站一键换**

## 待你定的(之前挂着的)
- `#10` 空状态纸艺素材:你用 GPT 生成"一株待生长"的专属素材,替换 EmptyState 现在的 `dandelion-4.webp` 占位
- 文字记号(编辑器高亮)的具体几个呼应色
