/**
 * 迁移脚本：给 Notes 的 ContentSnapshot 加 frontmatter，给 Gallery 的 frontmatter 补 title 字段。
 *
 * 运行方式：
 *   cd server && npx ts-node --esm src/scripts/migrate-frontmatter.ts
 *   （或）cd server && npx ts-node -r tsconfig-paths/register src/scripts/migrate-frontmatter.ts
 *
 * 前置条件：
 * - 设置好以下环境变量（与生产环境一致）：
 *   MONGO_HOST, MONGO_PORT, MONGO_USER, MONGO_PASSWORD, MONGO_DATABASE
 * - 或直接在脚本顶部的 MONGO_URI 变量修改为你的连接字符串
 *
 * 幂等性保证：
 * - Notes：bodyMarkdown 已以 "---" 开头的 snapshot 跳过，不重复包装
 * - Gallery：frontmatter 中已有 title 字段的 snapshot 跳过
 * - EditorDraft（草稿）：notes 草稿不加 frontmatter（草稿是编辑器中间态）
 *
 * 统计输出：
 * - 迁移的 notes snapshot 数量
 * - 跳过的 notes snapshot 数量（已有 frontmatter）
 * - 迁移的 gallery snapshot 数量
 * - 跳过的 gallery snapshot 数量（已有 title）
 */

import mongoose from 'mongoose';
import * as yaml from 'js-yaml';

// ─── 连接配置 ───────────────────────────────────────────────────────────────
// 优先读取环境变量，其次用 localhost 默认值（本地开发）
const MONGO_URI =
  process.env.MONGO_URI ??
  (() => {
    const host = process.env.MONGO_HOST ?? 'localhost';
    const port = process.env.MONGO_PORT ?? '27017';
    const user = process.env.MONGO_USER ?? '';
    const password = process.env.MONGO_PASSWORD ?? '';
    const database = process.env.MONGO_DATABASE ?? 'liminal_field';
    const authSource = 'admin';

    if (user && password) {
      return `mongodb://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?authSource=${authSource}`;
    }
    return `mongodb://${host}:${port}/${database}`;
  })();

// ─── 类型定义 ───────────────────────────────────────────────────────────────

/**
 * ContentSnapshot 的 MongoDB 文档结构（仅包含迁移所需字段）。
 * _id 是 versionId（nanoid string）。
 */
interface SnapshotDoc {
  _id: string;
  contentItemId: string;
  title: string;
  bodyMarkdown: string;
  fileName?: string | null;
}

/**
 * NavigationNode 文档（只取 scope 和 contentItemId）。
 */
interface NavNodeDoc {
  scope: string;
  contentItemId?: string;
  nodeType: string;
}

/**
 * EditorDraft 文档（草稿不加 frontmatter，此处仅声明类型供注释参考）。
 */
// interface DraftDoc { contentItemId: string; bodyMarkdown: string; }

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 给 notes bodyMarkdown 加 frontmatter（与 NoteViewService.addNoteFrontmatter 完全一致）。
 * 幂等：已有 frontmatter 的不重复包装。
 */
function addNoteFrontmatter(title: string, bodyMarkdown: string): string {
  if (bodyMarkdown.startsWith('---')) {
    return bodyMarkdown; // 已有 frontmatter，跳过
  }
  return `---\ntitle: ${title}\n---\n\n${bodyMarkdown}`;
}

/**
 * 给 gallery frontmatter 补 title 字段（幂等）。
 * - 无 frontmatter：不做处理（旧数据或格式异常）
 * - 已有 title：跳过
 * - 无 title：在 frontmatter 开头插入 title 字段
 *
 * 返回 { updated: string; changed: boolean }。
 */
function addTitleToGalleryFrontmatter(
  title: string,
  bodyMarkdown: string,
): { updated: string; changed: boolean } {
  if (!bodyMarkdown.startsWith('---')) {
    // 无 frontmatter，保持原样（旧数据兼容，下次 commitPost 时会加上）
    return { updated: bodyMarkdown, changed: false };
  }

  const closingIndex = bodyMarkdown.indexOf('\n---', 3);
  if (closingIndex === -1) {
    return { updated: bodyMarkdown, changed: false };
  }

  const yamlContent = bodyMarkdown.slice(4, closingIndex);
  const prose = bodyMarkdown.slice(closingIndex + 4);

  let parsedFrontmatter: Record<string, unknown>;
  try {
    parsedFrontmatter =
      (yaml.load(yamlContent) as Record<string, unknown>) ?? {};
  } catch {
    // YAML 解析失败，跳过
    return { updated: bodyMarkdown, changed: false };
  }

  // 已有 title 字段，跳过
  if (typeof parsedFrontmatter.title === 'string') {
    return { updated: bodyMarkdown, changed: false };
  }

  // 重建 frontmatter，title 放最前
  const newFrontmatter: Record<string, unknown> = { title };
  for (const [k, v] of Object.entries(parsedFrontmatter)) {
    newFrontmatter[k] = v;
  }

  const newYaml = yaml.dump(newFrontmatter, { indent: 2, lineWidth: -1 });
  return { updated: `---\n${newYaml}---${prose}`, changed: true };
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('连接 MongoDB:', MONGO_URI.replace(/:([^:@]+)@/, ':***@'));
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB 连接成功\n');

  // 直接操作底层集合，不经过 Typegoose schema（迁移脚本不依赖 NestJS 模块）
  const db = mongoose.connection.db!;
  const snapshotCol = db.collection<SnapshotDoc>('content_snapshots');
  const navCol = db.collection<NavNodeDoc>('navigation_nodes');

  // ─── Step 1：收集 notes scope 的 contentItemId ───
  const notesNodes = await navCol
    .find({ scope: 'notes', nodeType: 'content' })
    .toArray();
  const notesContentIds = notesNodes
    .map((n) => n.contentItemId)
    .filter((id): id is string => Boolean(id));

  console.log(`找到 notes contentItem: ${notesContentIds.length} 个`);

  // ─── Step 2：迁移 notes snapshots ───
  let notesMigratedCount = 0;
  let notesSkippedCount = 0;

  for (const contentId of notesContentIds) {
    const snapshots = await snapshotCol
      .find({ contentItemId: contentId, fileName: null })
      .toArray();

    for (const snap of snapshots) {
      if (snap.bodyMarkdown.startsWith('---')) {
        // 已有 frontmatter，跳过（幂等）
        notesSkippedCount++;
        continue;
      }

      const newBody = addNoteFrontmatter(snap.title, snap.bodyMarkdown);
      await snapshotCol.updateOne(
        { _id: snap._id },
        { $set: { bodyMarkdown: newBody } },
      );
      notesMigratedCount++;
    }
  }

  // ─── Step 3：收集 gallery scope 的 contentItemId ───
  const galleryNodes = await navCol
    .find({ scope: 'gallery', nodeType: 'content' })
    .toArray();
  const galleryContentIds = galleryNodes
    .map((n) => n.contentItemId)
    .filter((id): id is string => Boolean(id));

  console.log(`找到 gallery contentItem: ${galleryContentIds.length} 个`);

  // ─── Step 4：迁移 gallery snapshots（补 title 字段）───
  let galleryMigratedCount = 0;
  let gallerySkippedCount = 0;

  for (const contentId of galleryContentIds) {
    const snapshots = await snapshotCol
      .find({ contentItemId: contentId, fileName: null })
      .toArray();

    for (const snap of snapshots) {
      const { updated, changed } = addTitleToGalleryFrontmatter(
        snap.title,
        snap.bodyMarkdown,
      );

      if (!changed) {
        gallerySkippedCount++;
        continue;
      }

      await snapshotCol.updateOne(
        { _id: snap._id },
        { $set: { bodyMarkdown: updated } },
      );
      galleryMigratedCount++;
    }
  }

  // ─── Step 5：EditorDraft 不做处理（草稿不走文件协议，不加 frontmatter）───
  // notes 草稿的 bodyMarkdown 是纯 markdown，这是正确的预期状态。
  // gallery 草稿的 bodyMarkdown 已经是 frontmatter 格式，由 GalleryViewService.serializeDto 写入。
  // 草稿在下次正式提交时会由 NoteViewService.saveContent / GalleryViewService.commitPost 重新序列化。

  // ─── 统计输出 ───
  console.log('\n=== 迁移完成 ===');
  console.log(`Notes snapshots 迁移: ${notesMigratedCount} 个`);
  console.log(
    `Notes snapshots 跳过（已有 frontmatter）: ${notesSkippedCount} 个`,
  );
  console.log(`Gallery snapshots 迁移: ${galleryMigratedCount} 个`);
  console.log(
    `Gallery snapshots 跳过（已有 title）: ${gallerySkippedCount} 个`,
  );

  await mongoose.disconnect();
  console.log('\nMongoDB 连接已关闭');
}

main().catch((err: unknown) => {
  console.error('迁移失败:', err);
  process.exit(1);
});
