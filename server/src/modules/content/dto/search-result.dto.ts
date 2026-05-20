/** 搜索结果 DTO — 比 ContentListItemDto 更轻量，带 scope 和匹配片段 */
export class SearchResultDto {
  contentItemId!: string;
  title!: string;
  /** 所属 scope（notes / gallery / anthology），来自 NavigationNode */
  scope!: string;
  /** 匹配的上下文片段（~100 字），清理了 Markdown 语法 */
  snippet!: string;
  updatedAt!: string;
}
