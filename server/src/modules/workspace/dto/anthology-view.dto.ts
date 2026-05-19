/**
 * Anthology scope 的专用 DTO，按消费场景拆分。
 *
 * 设计：展示端 / 管理端各自独立 DTO，避免字段越界。
 * - 展示端只暴露已发布的信息（不含状态、hasUnpublishedChanges 等管理字段）
 * - 条目列表 DTO 不含正文（减少流量），详情 DTO 才含正文
 * - prev/next 导航在条目详情中由后端计算，前端无需自行推导
 *
 * 两层发布模型（2026-05-18 新增）：
 * - 文集级发布：ContentItem.publishedVersion 指向索引 snapshot（文集上线/下线）
 * - 条目级发布：索引 frontmatter 中每篇的 publishedVersionId（单篇独立发布）
 * - 展示端只能看到文集已发布 + 条目 publishedVersionId 非 null 的条目
 */

// ── 共用子类型 ──

/** 索引中单个条目的简要信息（目录展示用）。 */
export interface AnthologyEntryRef {
  key: string;
  title: string;
  /** ISO 8601 日期字符串，null 表示未设置。 */
  date: string | null;
}

// ── 展示端 ──

export class AnthologyPublicListItemDto {
  id: string;
  title: string;
  description: string;
  /** 已发布条目数量（仅 publishedVersionId 非 null 的条目）。 */
  entryCount: number;
  updatedAt: string;
}

export class AnthologyPublicDetailDto {
  id: string;
  title: string;
  description: string;
  /** 条目列表（不含正文），仅包含 publishedVersionId 非 null 的已发布条目。 */
  entries: AnthologyEntryRef[];
}

/** 单篇条目的阅读 DTO，含正文和前后导航。 */
export class AnthologyEntryDetailDto {
  key: string;
  title: string;
  /** 内容日期（frontmatter），兜底 snapshot createdAt。 */
  date: string | null;
  /** 最后更新时间（最新 snapshot 的 createdAt），与 NoteReader 的 updatedAt 同语义。 */
  updatedAt: string;
  bodyMarkdown: string;
  /** 上一篇（按索引顺序），null 表示已是第一篇。 */
  prev: { key: string; title: string } | null;
  /** 下一篇（按索引顺序），null 表示已是最后一篇。 */
  next: { key: string; title: string } | null;
}

// ── 管理端 ──

/**
 * 管理端条目引用，额外含 hasContent 和两层发布状态字段。
 * - publishedVersionId: 该条目已发布时指向的 snapshot versionId，null 表示未发布
 * - hasUnpublishedChanges: 条目有新提交未同步到 publishedVersionId（最新 snapshot != 已发布 snapshot）
 */
export interface AnthologyAdminEntryRef extends AnthologyEntryRef {
  /** 该条目是否已有实际内容（snapshot 存在且正文非空）。 */
  hasContent: boolean;
  /** 已发布的 snapshot versionId，null 表示条目尚未发布。 */
  publishedVersionId: string | null;
  /** 条目最新 snapshot 与已发布 snapshot 不一致（有待发布的新改动）。 */
  hasUnpublishedChanges: boolean;
}

export class AnthologyAdminListItemDto extends AnthologyPublicListItemDto {
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
}

export class AnthologyAdminDetailDto extends AnthologyPublicDetailDto {
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
  entries: AnthologyAdminEntryRef[];
}
