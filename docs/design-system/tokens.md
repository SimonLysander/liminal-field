# Liminal Field · 设计系统(L1–L4 完整设计)

> 本文档是 `design-language.md`(**L0 原则**)往下的 **L1–L4 实现标准**。
>
> **核心病灶(2026-05 盘点):不是缺组件,是装了 shadcn 基础件却不采用,页面 inline 复制 → 混杂、不可复用、每次开发漂移。**
>
> **工作法:先把这四层完整设计透(本文档),再统一实施——不边做边设计。** 实施时每个 inline 都能按本文档明确归位到某层某件。
>
> **铁律:页面只能用标准件,禁止 inline 复制其样式。**

---

## L1 · Token(原子值)— 完整定义

所有原子值只能引用以下 token,禁 inline 魔法值。多数已在 `index.css`,缺的(z-index)在此补全。

### 颜色
见 `design-language.md` §3(底色 / 语义醒目档 / 草木)。**偏差:硬编码 hex ~101 → 全换 token。**

### 字号 — Tailwind `text-*`(已有)
语义角色映射(见 index.css Type scale):Caption `text-2xs` · Subheadline `text-xs` · Callout `text-sm` · Body `text-base` · 卡片 `text-md` · 阅读 `text-lg` · h3/h2/h1 `text-xl/2xl/3xl` · 页面标题 `text-4xl` · 文章标题 `text-5xl` · 页面主标题 `text-6xl`(28px,首页问候语)。

完整字号语义表:

| token | px | Apple HIG 对应 | 典型场景 |
|---|---|---|---|
| `text-2xs` | 10 | Caption | section label、节点计数、分隔符 |
| `text-xs` | 11 | Subheadline | 面包屑、加载状态、底部按钮 |
| `text-sm` | 12 | Callout | TOC 条目、版本时间线 |
| `text-base` | 13 | Body / Headline | 节点名、面板标题、导航菜单项 |
| `text-md` | 14 | — | 卡片描述、表格、内联代码 |
| `text-lg` | 15 | Title 3 | markdown body、对话消息、阅读正文 |
| `text-xl` | 16 | — | markdown h3 |
| `text-2xl` | 18 | — | markdown h2 |
| `text-3xl` | 20 | — | markdown h1 |
| `text-4xl` | 22 | Title 1 | 页面级标题 |
| `text-5xl` | 26 | Large Title | 文章标题 |
| `text-6xl` | 28 | — | 页面主标题、首页问候语 |

> 值的定义在 `client/src/index.css` `@theme` 段(`--text-*`)，Type scale 语义注释在同文件 `:root` 内。本表不镜像 CSS 值，只说明「为什么这么分级」。

**规则:禁 inline `fontSize`。相同语义角色两端(展示端/管理端)使用相同 token。偏差 ~188。**

### 间距 — Tailwind scale(不另造)
4px 基数:`1=4 2=8 3=12 4=16 5=20 6=24 8=32 10=40`。用 `p-/m-/gap-/space-`。
**规则:禁 inline padding/margin px。偏差 22。**

### 圆角(已有)
`rounded-sm=6`(pill/按钮/小元素)· `md=8`(卡片/图片)· `lg=10`(面板/卡)· `xl=12`(Modal/大面板)· `2xl=16`(柔和大圆角:agent 输入框等 Claude 式面,2026-05-24 新增)。
**规则:禁 inline `borderRadius`。偏差 38。**

### 阴影(已有)
`shadow-xs/sm/md/lg/xl` + `shadow-inset`;卡片 hover 升一级。**规则:用 token。**

### 动效(已有,少人用)
时长 `--duration-fast=120 / normal=220 / slow=380`;缓动 `--ease-out`(常规)· `--ease-spring`(入场/弹性)。
**规则:`transition` 只用这些。禁 inline 魔法时长。偏差 19。**

### 层级 z-index(❌ 新建,写进 index.css)
```css
--z-base: 0;        /* 常规流 */
--z-sticky: 10;     /* sticky 顶栏 / 侧栏 */
--z-dropdown: 1000; /* 下拉 / 气泡 / tooltip */
--z-overlay: 2000;  /* Modal 遮罩 */
--z-modal: 2100;    /* Modal 内容 */
--z-toast: 3000;    /* 全局 toast / banner */
--z-texture: 9990;  /* 纸纹叠层(pointer-none) */
```
**规则:禁 inline `zIndex`,26 处按上表归类。**

---

## L2 · 基础件(Primitives)— 优先定制现有 shadcn,不另造

**`<Button>`** — 已有(`ui/button.tsx`)
- variant: `primary`(accent 紫底 / accent-contrast 字,即 `var(--accent)`)· `ghost`(透明 / hover shelf)· `danger`(用 `--danger`)· `subtle`(shelf 底)
- size: `sm`(h-8)· `md`(h-9);`icon`(方形)
  > **设计决策**:primary 用 `--accent`(长春花紫,daylight #6667AB / midnight #9091CE)而非 ink 全黑,视觉主动性更强,明确主操作 CTA 语义。注意:shadcn 兼容层的 `--color-primary` 仍映射到 `var(--ink)`,是为 Plate UI 等 shadcn 组件内部兼容,与我们 `Button` primary variant 走不同引用路径,互不干扰。

**`<Input>` / `<Textarea>`** — 已有(`ui/input.tsx`)
- 统一 h-9、`rounded-lg`、shelf 底、separator 边、focus 柔光环(已有全局样式)

**`<Dot>`**(状态点)— 已有(`ui/dot.tsx`)
- variant: `success/danger/warning/info`(语义色)· `herb`(草木,用户场景)· `neutral`
- size: 默认 7px 圆

**`<Tag>` / `<Pill>`** — 已有(`ui/tag.tsx`)
- variant: `default`(shelf)· 可带前置 `<Dot>`

**`<Text>`** — 不建组件,用 Tailwind `text-*` + color token 即标准。
**`<Icon>`** — lucide;**统一 `strokeWidth={2}`(操作)/ `1.5`(装饰)、size 阶梯 12/14/16/20**。

---

## L3 · 复合件(Components)

**`<Modal>`** — 已有(`shared/Modal.tsx`,base: `ui/dialog.tsx`)
- 结构:`<Overlay>`(遮罩固定 `rgba(0,0,0,.4)` 纯暗化、**无 blur**、`z-overlay`)+ 居中卡(`paper`/`rounded-xl`/`shadow-xl`/`z-modal`)+ 可选 header/footer
- props:`open / onClose / title? / footer?`;Esc / 点遮罩关闭

**确认弹框** — 已有 `ConfirmContext.confirm({title,message,confirmLabel,cancelLabel})`
- 收编:各页自写的确认 Modal → 一律走 `confirm()`

**`<SaveStatus>`** — 已有(`shared/SaveStatus.tsx`);**`<StatusDot>`** — 待建
- `<SaveStatus state>`:`saving/dirty/saved/error` → 自动配 `<Dot>` + 文案,自动保存场景统一
- `<StatusDot>`(待建):通用状态指示点,供非保存场景复用

**`<EmptyState>`** — 已有(`shared/EmptyState.tsx`)
- 结构:**统一一株纸艺植物**(GPT 素材,占位用 garden webp)+ 标题(`text-lg`/`ink-faded`)+ 可选副标题 + 可选 action

**`<FieldError>`** — 已有(`ui/field-error.tsx`);**`<FormError>`** — 待建(页面级/全局表单错误)
- 字号锁 `text-xs`、色 `--danger`,统一间距

**`<Card>` / `<ListRow>`** — 待建
- `<ListRow>`:左(icon/日期)+ 中(标题+副标题,truncate)+ 右(meta/action);hover shelf。首页笔记行、列表页复用
- `<Card>`:`rounded-lg`/separator 边/hover 升阴影

**`<Field label error>`** — 待建;包 `<Input>`,统一表单行(label + 控件 + 错误)

---

## L4 · 模式(Patterns)

- **列表页**:页头(标题 + action)+ `<ListRow>` × N + `<EmptyState>`
- **详情/阅读页**:阅读栏(`--layout-reading-max`)+ 侧栏(`--layout-sidebar`)+ 元信息行(日期/字数,**按"无属性"原则精简**)
- **状态态**:加载 `<LoadingState>`(已有)· 空 `<EmptyState>` · 错误统一
- **弹层**:一律 `<Modal>` / `confirm()`,不自写
- **双端语义映射**:展示端 / 管理端同语义 → 同一标准件(`CLAUDE.md` 7 项一致性清单)

---

## 响应式(横切维度)

**范围分治(已定):展示端响应式,管理端桌面优先。**
- **展示端**(home / note / gallery / anthology / login + 公共展示件):移动优先,全面适配
- **管理端**(admin/* + Plate 编辑器):桌面优先;移动端用 `use-mobile`(终于用上这个装了没用的 hook)拦截 → "请用电脑访问管理端"提示页

### 断点 token(L1,统一,移动优先)
对齐 Tailwind 默认,**废掉混用的 480 / 520 / `max-[...]`**:`sm=640 / md=768 / lg=1024 / xl=1280`。
**规则:展示端默认写窄屏样式,用 `sm:/md:/lg:` 往宽加(移动优先);禁 `max-[...]` 桌面优先写法;`index.css` 的媒体查询(现 480/768/1024)统一到这套值。** 偏差:断点方向混用(`sm:`14 / `max-[`11)、`use-mobile` 0 引用。

### 滚动模型
- 展示端:去掉全局 `body { overflow:hidden }`,移动端页面自然滚
- 管理端:保留桌面 app 式(内部容器各自滚)

### 各层响应式行为
- **L2/L3 件**:`<Modal>` 移动端 → 底部 sheet / 全屏;固定侧栏 → `<Drawer>` 抽屉;`<ListRow>` 紧凑堆叠;多栏 → 单列
- **L4 模式(展示端)**:阅读页 TOC 侧栏 → 移动端折叠/抽屉、正文 `px-10→px-4`;首页图集横排 → 横滑;双栏 → 单栏

### 技术选型
- Tailwind 移动优先断点为主
- **容器查询 `@container`** 给标准件用——组件按**自身宽度**响应,跨页面复用时不依赖全局断点,**天然防漂移**(正好配合 L2/L3 标准件)

---

## 偏差清单(实施期的清偿目标,逐项归零)

| 偏差 | 量 | 收敛到 |
|---|---|---|
| 独立 Modal + 自写遮罩 | 11 + 15 | `<Modal>` |
| inline `fontSize` | ~188 | `text-*` |
| 硬编码 hex | ~101 | 色 token |
| inline `borderRadius` | 38 | `rounded-*` |
| inline `zIndex` | 26 | z-index scale |
| inline padding/margin | 22 | Tailwind 间距 |
| inline `transition` | 19 | `--duration/--ease` |
| 错误提示散写 | 14 | `<FieldError>` |
| inline 按钮模式 | 12 | `<Button>` |
| StatusDot 重复 | 3 | `<StatusDot>/<SaveStatus>` |
| `console.*` | ~21 | 删 |

---

## 实施法(设计拍板后才启动)

1. **L1 → L2 → L3**:先落 token(index.css 补 z-index)→ 再建/定制基础件 → 再建复合件。
2. 每个件就位后,**全站替换它收编的所有 inline**,偏差清单对应项归零。
3. **逐模块走 branch + 验收**(CLAUDE.md 踩坑:批量改易翻车)。
4. 优先定制现有 shadcn,不造轮子。

## 变更记录
- **2026-06-23** 对齐 index.css 现状四项修正:① 字号表补 `text-6xl`(28px/页面主标题)并扩展为完整语义表;② Button primary 描述由"ink 底"更新为"accent 紫底"并记录 shadcn 兼容层与设计系统引用路径不冲突的决策;③ z-index 表删除 `--z-raised`(index.css 无此变量);④ L2/L3 组件状态更新——已建(Button/Input/Dot/Tag/FieldError/Modal/EmptyState/SaveStatus)标「已有」并补文件路径,未建(StatusDot/FormError/Card/ListRow/Field)标「待建」。
- **2026-05-22** 初版纲要 → 完整设计。L1 补 z-index scale;L2/L3 列全标准件(variant/职责/收编),确立"设计完再实施"工作法。
- **2026-05-22** 补响应式横切维度:范围分治(展示端响应式 / 管理端桌面优先)、统一断点 token(对齐 Tailwind,废 480/520/max-[)、滚动模型、容器查询策略。
- **2026-05-23** 确立 **Notion 紧凑尺寸基准**(照 Notion DOM 实测):控件高 **28px**(sm 24)、图标 **20**(按钮内 18)、字号 主 **14** / 次·快捷键 **12**、圆角 控件 `sm` · 浮层 `xl`、**1px 细边**、菜单项行高 **28** · 图标 **16**(密集菜单行用 16,区别一般图标 20——20 在 28 行里占满显胖)、浮层宽 **~256**。Button / Input 已按此重做;菜单 / 就近浮层组件待建。
- **2026-05-23 实施落地**(设计转代码,全程浏览器实测):
  - L2 基础件 Button/Input、菜单(DropdownMenu)/就近浮层(Popover)全部按 Notion 紧凑基准重做。
  - **弹层分层落地**:11 个 Modal 按"有无固定锚点 + 输入量 + 触发方式"分流——快速单输入(新建/添加/提交版本)→ 就近浮层;复杂表单(图片编辑/节点表单/删除确认含异步统计/同步)→ 居中 `<Modal>`(纯暗遮罩、无毛玻璃);简单确认 → `confirm()`;全局搜索 → ⌘K 命令面板。
  - **响应式起步**:管理端移动拦截(`useIsMobile`→DesktopOnlyNotice);展示端侧栏→底部 Tab Bar、笔记 TOC 窄屏隐藏、首页图集横滑。
  - **画廊治本重做**:绝对定位 coverflow → 自然 flow 单图相框(白条三栏 EXIF|dots|日期 + 邻图 ±2 预载 + crossfade);沉浸侧栏透明保留、选中态文字加亮。
  - **目录(笔记/两个编辑器)**:黄金比例 61.8vh 上限 + 离顶 8vh + 上下渐隐 + 当前章节 accent。
  - **编辑器返回修复**:`navigate(-1)` → 安全 `goBack`(无 app 内历史则去对应管理后台)。
  - **文档收口**:设计文档纳入 git(`.gitignore` 放行 `/docs/*.md`)。
  - **未做(留用户在场/需素材)**:拆 7 个巨型组件、空状态纸艺素材(#10)。
