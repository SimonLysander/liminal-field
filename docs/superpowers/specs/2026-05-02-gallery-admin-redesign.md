# 画廊管理端改造设计

## 背景

现有画廊管理端存在以下问题：

1. **保存报错**：后端 `UpdateWorkspaceItemDto` 要求 `changeNote` 为非空字符串，但前端 `galleryApi.update()` 未传此字段，导致保存时报 `changeNote should not be empty`
2. **编辑体验差**：新建用 `window.prompt()`，编辑是原地切换 input/textarea 的简陋模式，没有独立编辑页面
3. **三栏布局不适合照片内容**：左侧列表 200px + 中间详情 + 右侧信息 200px，照片展示空间严重不足

## 设计方案

### 整体架构：朋友圈 Feed 流 + 独立编辑页

管理端改为两个页面：

- `/admin/gallery` — Feed 列表页
- `/admin/gallery/edit/:id` 和 `/admin/gallery/new` — 编辑页

废弃现有三栏布局（`PostList` + `PostDetail` + `InfoPanel`）。

### 页面 1：Feed 列表页

**布局**：单列居中，最大宽度约 600px，页面可滚动。

**顶部操作栏**：
- 左侧：状态筛选标签（全部 / 草稿 / 已发布）
- 右侧：「+ 新建动态」按钮 → 跳转 `/admin/gallery/new`

**每条动态卡片**：
- 标题 + 状态 badge（已发布/草稿）+ 「⋯」操作菜单（shadcn DropdownMenu）
- 照片网格：1 张满宽 16:9，2 张两列，3+ 张三列
- 随笔文字（Plate 内容序列化为纯文本，超过两行截断）
- 底部：地点标签 + 发布时间 + 照片数量

**「⋯」菜单**：
- 编辑 → 跳转 `/admin/gallery/edit/:id`
- 发布 / 取消发布
- 删除（shadcn AlertDialog 二次确认）

### 页面 2：编辑页

**顶部导航栏**（与笔记编辑器一致的心智模型）：
- 左侧：`← 标题`（标题可编辑，点 ← 返回列表）
- 右侧：自动保存状态指示 + 「保存」按钮

**内容区域**（居中，最大宽度 520px），从上到下：

1. **照片区域**
   - 小缩略图网格（5 列），可拖拽排序
   - 有说明的照片右下角显示「说明」标记
   - 末尾「+」上传按钮，支持多选
   - **点击照片 → 弹出照片编辑 Modal**（见下文）
   - 拖拽中的照片显示虚线边框 + 轻微旋转的拖拽状态

2. **随笔**（原「描述」字段）
   - Plate 编辑器，最小化插件配置
   - 工具栏：加粗、斜体、下划线、删除线、超链接、有序列表、无序列表、缩进/反缩进
   - 300 字限制，右上角显示 `42 / 300` 计数
   - 不包含：标题层级、图片插入、代码块、表格、引用块、对齐

3. **地点标签**
   - 底部角落，低调的药丸样式：`📍 北京 ▾`
   - 下拉选择（shadcn Popover + Command），固定选项，可留空
   - 新建时显示 `📍 添加地点 ▾`

**自动保存草稿**：
- 编辑过程中自动保存到后端草稿
- 顶栏状态指示三态：`✓ 已自动保存` / `● 有未保存的更改` / `↻ 保存中...`

### 照片编辑 Modal

使用 shadcn Dialog，左右布局：

**左侧**（320px，暗底背景）：
- 照片大图预览
- 底部居中 `1 / 6` 照片计数
- 左右箭头可切换照片

**右侧**（信息面板），从上到下：
- 标题：「照片详情」+ 关闭按钮
- 文件信息（一行）：`photo-a1b2.jpg · 2400 × 1600 · 2.4 MB`
- 说明：textarea，placeholder「为这张照片添加说明...」
- 底部操作栏：左边「删除照片」（红色），右边「设为封面」+「完成」

### Bug 修复：changeNote 报错

**根因**：`galleryApi.update()` 发送 `{ title, description }`，后端 `UpdateWorkspaceItemDto` 的 `changeNote` 字段有 `@IsString() @IsNotEmpty()` 验证。

**修复方案**：gallery scope 的更新请求，前端自动补充 `changeNote`（如 `'更新画廊动态'`），后端不改。这保持了与 notes scope 一致的版本记录语义。

## 数据模型变更

### 存储位置

照片文件本身仍存于 Git 仓库（`ci_xxx/assets/`），但画廊特有的元数据（标签、照片说明、排序、封面）存于 MongoDB，因为这些是结构化数据，不适合用 Git 文件管理。

具体方案：在 MongoDB 新增 `gallery_posts` collection（或在 `content_items` 上扩展嵌套字段），存储以下画廊专属元数据：

- `contentItemId: string` — 关联 ContentItem
- `tags: { location?: string }` — 动态标签，key 是分类名，value 是选中值。以后新增分类（风格、相机等）直接加字段
- `photos: Array<{ fileName: string, caption?: string, order: number }>` — 照片元数据（说明文字、排序），fileName 对应 Git assets 目录下的文件名
- `coverPhotoFileName?: string` — 手动指定的封面照片（可选，不指定则列表页用第一张做缩略图）

### 随笔存储

随笔使用 Plate 编辑，存储格式为 Plate JSON（与笔记编辑器一致）。现有的 `bodyMarkdown` 字段可复用（Plate 输出序列化为 Markdown 存入 Git），或在 `gallery_posts` 中新增 `prose` 字段存 Plate JSON。具体在实现计划中确定。

### 地点选项

初始固定选项（后续通过数据库管理）：北京、武汉、青岛、东京、大理。可根据需要扩展。

### 自动保存机制

复用笔记编辑器的草稿模式：编辑过程中定时将当前状态保存到 MongoDB 草稿记录，手动点「保存」时正式提交（写入 Git + 更新 MongoDB 版本指针）。

## 技术选型

| 功能 | 方案 |
|------|------|
| 拖拽排序 | dnd-kit (`@dnd-kit/core` + `@dnd-kit/sortable`) |
| 随笔编辑 | Plate（项目已有），最小化插件配置 |
| 操作菜单 | shadcn DropdownMenu（项目已有） |
| 照片 Modal | shadcn Dialog（项目已有） |
| 地点选择 | shadcn Popover + Command（项目已有） |
| 删除确认 | shadcn AlertDialog（项目已有） |
| 图片编辑（裁剪/旋转） | react-easy-crop（后续迭代，本次不做） |

## 不做的事

- 展示端改造（后续单独做）
- 图片裁剪/旋转编辑（后续迭代）
- 批量操作（批量删除、批量发布等）
- 标签管理后台（先硬编码选项，后续做管理界面）

## 侧边栏变更

展示端 Sidebar 已将 `gallery` 加回导航（`spaces: ['notes', 'gallery']`），用户可从侧边栏进入画廊展示页。
