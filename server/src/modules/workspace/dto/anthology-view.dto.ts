/**
 * Anthology scope 的专用 DTO,按消费场景拆分。
 *
 * 设计:展示端只暴露已发布信息;目录列表 DTO 不含正文(减少流量),详情 DTO 才含正文。
 * prev/next 导航在子节点详情中由后端计算,前端无需自行推导。
 *
 * Phase 1 重构(2026-05-31)同步页面树统一:
 * - 删除 AnthologyAdminDetail / AnthologyAdminEntryRef / AnthologyAdminListItemDto
 *   ——管理端文集详情统一改走通用节点 detail DTO,跟笔记一致
 * - AnthologyPublicDetailDto 增 bodyMarkdown(文集容器自身的卷首语),空字符串=无
 * - AnthologyEntryDetailDto 的 prev/next 字段 key → nodeId
 *   (节点 id 即子 contentItemId,跟新的页面树命名一致)
 *
 * Phase 8 polish(2026-05-31):
 * - AnthologyEntryRef.key → nodeId(Phase 1 后端遗留命名)
 *   外层 entries[] 字段名保留(对外稳定语义"目录条目"——文集子节点列表的合理外部表达)
 *
 * 两层发布模型(2026-05-18 新增):
 * - 文集级发布:ContentItem.publishedVersion 指向索引 snapshot(文集上线/下线)
 * - 子节点级发布:子 ContentItem.publishedVersion(每个子节点各自发布)
 * - 展示端只能看到文集已发布 + 子节点 publishedVersion 非 null 的节点
 */

// ── 共用子类型 ──

/** 索引中单个子节点的简要信息(目录展示用)。Phase 8 起 key 字段统一为 nodeId(=子 contentItemId)。 */
export interface AnthologyEntryRef {
  nodeId: string;
  title: string;
  /** ISO 8601 日期字符串,null 表示未设置。 */
  date: string | null;
}

// ── 展示端 ──

export class AnthologyPublicListItemDto {
  id: string;
  title: string;
  description: string;
  /** 已发布条目数量(仅 publishedVersion 非 null 的子节点)。 */
  entryCount: number;
  updatedAt: string;
}

export class AnthologyPublicDetailDto {
  id: string;
  title: string;
  description: string;
  /** 卷首语:文集容器节点自身的正文(Markdown),空字符串表示无。 */
  bodyMarkdown: string;
  /** 目录列表(不含正文),仅包含 publishedVersion 非 null 的已发布子节点。 */
  entries: AnthologyEntryRef[];
}

/** 单个子节点的阅读 DTO,含正文和前后导航。Phase 8 起 key → nodeId。 */
export class AnthologyEntryDetailDto {
  /** 子节点 id(= 子 contentItemId)。Phase 8 polish 起从 key 改为 nodeId。 */
  nodeId: string;
  title: string;
  /** 内容日期(frontmatter),兜底 snapshot createdAt。 */
  date: string | null;
  /** 最后更新时间(最新 snapshot 的 createdAt),与 NoteReader 的 updatedAt 同语义。 */
  updatedAt: string;
  bodyMarkdown: string;
  /** 上一个子节点(按索引顺序),null 表示已是第一个。nodeId = 子 contentItemId。 */
  prev: { nodeId: string; title: string } | null;
  /** 下一个子节点(按索引顺序),null 表示已是最后一个。nodeId = 子 contentItemId。 */
  next: { nodeId: string; title: string } | null;
}
