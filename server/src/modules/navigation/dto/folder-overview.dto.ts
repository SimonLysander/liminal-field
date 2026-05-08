/**
 * FolderOverviewDto — 文件夹着陆页所需的概览数据。
 *
 * 包含子项列表（带发布状态和摘要）以及聚合统计，
 * 供前端一次请求渲染完整的文件夹着陆页。
 */

export type ChildPublishStatus = 'published' | 'updated' | 'unpublished';

export class FolderOverviewStatsDto {
  folderCount: number;
  docCount: number;
  published: number;
  updated: number;
  unpublished: number;
}

export class FolderOverviewChildDto {
  id: string;
  name: string;
  type: 'FOLDER' | 'DOC';
  contentItemId?: string;
  /** FOLDER 子节点：子树中 DOC 总数 */
  childDocCount?: number;
  /** FOLDER 子节点：子树中已发布 DOC 数 */
  childPublishedCount?: number;
  /** DOC 子节点：发布状态 */
  publishStatus?: ChildPublishStatus;
  /** DOC 子节点：摘要截断 */
  summary?: string;
}

export class FolderOverviewDto {
  folder: { id: string; name: string };
  stats: FolderOverviewStatsDto;
  children: FolderOverviewChildDto[];
}
