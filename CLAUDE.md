

1. 至少先进行的足够的思考再行动，需要进行有深度、有广度的思考
2. 注释与代码同行：当你写下某段代码，你也应该简述说明【如果需要】为了解决什么问题、【如果需要】要做什么、【如果需要】作了什么样的设计，当你要更新代码时也不应该忘记更新注释
3. 时刻以务实犀利的态度讨论方案、设计、需求，不能一味迎合我，一切为了高质量、高扩展的优秀项目；涉及一些关键的、影响项目质量的方案、设计、实现，你应该主动询问我以消除未知、不确定的因素，避免因为其导致项目推进和质量出现问题
4. 你可以把反复踩的、关键的、影响项目推进的坑持续迭代在 Agents.md

\# 设计系统

核心原则：**展示端和管理端相同语义角色的组件，视觉规格完全一致。**

## 一致性检查清单

新建或修改 UI 组件时，检查对端（展示/管理）是否有等价组件，逐项对齐：

1. **字号** — token 选择、font-weight、letter-spacing、line-height
2. **间距** — padding、margin、gap
3. **尺寸** — icon size、icon strokeWidth
4. **色彩** — 文字色（ink 系列）、背景色（shelf/sidebar-bg）、边框色（separator/box-border）
5. **形状** — border-radius、border width/style
6. **交互状态** — hover 效果、selected 背景/字重、transition duration/easing
7. **布局结构** — flex 对齐、item 内部结构（icon + text + chevron）

## 字号系统

字号语义映射定义在 `src/index.css` 的 Type scale 注释中。规则：
- 全部通过 Tailwind class（`text-base`、`text-xs` 等）引用，不用 inline `fontSize`
- 相同语义角色使用相同 token
- 修改字号前必须查阅 `src/index.css` 注释确认语义角色

## 样式写法

- 字号：Tailwind class（`text-base`），不用 inline `fontSize: 'var(--text-base)'`
- 颜色：inline style `color: 'var(--ink)'`（CSS 变量无对应 Tailwind class 时）
- 间距/圆角/布局：Tailwind class 优先
- 一个项目一套写法，不混用

\# 代码变更检查

每次修改代码后、提交前，必须运行：

1. **Server**: `cd server && pnpm build` — SWC 编译检查
2. **Client**: `cd client && npx tsc -b --noEmit` — TypeScript 类型检查
3. **Server 单元测试**: `cd server && npx jest --passWithNoTests` — 如果改了业务逻辑
4. **Client build**: `cd client && pnpm build` — 如果要验证生产构建（Docker 部署前必跑）

不通过不提交。

\# 关键踩坑记录

## 批量重构必须走 branch + review + 验收

**现象：** 派 subagent 批量清理 inline style，结果改坏了 20+ 文件——间距、字号、动画时长、路由逻辑全被偷换，页面视觉完全走样。

**根因（5 whys）：** 对"简单任务"放松了流程纪律。认为机械替换不需要 branch/review/验收，跳过了"先思考再行动"。

**规则：**
1. 任何涉及多文件修改的任务，必须先开 feature branch
2. subagent prompt 必须包含显式的禁止列表（不改值、不改逻辑、不新建文件、不超出指定文件范围）
3. subagent 完成后必须 `git diff` 逐文件验收，确认只有预期的变更类型
4. 涉及设计系统（token 值、间距、字号、动画）的文件不交给 subagent，手动处理